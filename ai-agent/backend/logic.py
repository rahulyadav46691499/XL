import asyncio
import hashlib
import json
import math
import shutil
import tempfile
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from langchain_core.documents import Document
from liteparse import LiteParse

from agents import jd_agent, resume_agent
from document_check import verify_document
from job_id import normalize_job_id
from output_parser import MAX_FLAGS, JDOutput, ResumeOutput
from progress import finish_one, start_run, stage
from role_criteria import parse_criteria
from vector_store import embeddings, vector_store

parser = LiteParse()

# Original resume files, kept so HR can download what the candidate actually
# sent (Chroma only holds the parsed text).
# ponytail: local disk keyed by uuid; move to object storage if this ever runs on more than one box
RESUME_FILES = Path("resume_files")

# Same for the JD itself, so the Upload JD page can open the posting HR actually
# uploaded rather than the LLM's cleaned-up text. JDs stored before this have no
# file and report has_file=False.
JD_FILES = Path("jd_files")

async def save_upload_temporarily(file: UploadFile) -> str:
    suffix = Path(file.filename or "document.pdf").suffix or ".pdf"

    content = await file.read()

    if not content:
        raise HTTPException(status_code=400,detail="Uploaded file is empty")

    temporary_file = tempfile.NamedTemporaryFile(delete=False,suffix=suffix)

    try:
        temporary_file.write(content)
        temporary_file.flush()
        return temporary_file.name
    finally:
        temporary_file.close()


def parse_document(file_path: str) -> str:
    if file_path.endswith(".txt"):
        text = Path(file_path).read_text(errors="ignore")
    else:
        try:
            parsed_result = parser.parse(file_path)
        except Exception as exc:
            raise HTTPException(status_code=422,
                                detail=f"Could not parse document: {exc}")

        text = getattr(parsed_result, "text", None)

    if not text or not text.strip():
        raise HTTPException(status_code=422,
                            detail="No text could be extracted from the document")

    return text.strip()


def cosine_similarity(first_embedding: list[float],second_embedding: list[float],) -> float:
    dot_product = sum(
        first_value * second_value
        for first_value, second_value
        in zip(first_embedding, second_embedding)
    )

    first_magnitude = math.sqrt(sum(value**2 for value in first_embedding))
    second_magnitude = math.sqrt(sum(value**2 for value in second_embedding))

    if first_magnitude == 0 or second_magnitude == 0:
        return 0.0

    return dot_product / (first_magnitude * second_magnitude)


async def calculate_similarity(resume_text: str,jd_text: str,) -> float:
    resume_embedding, jd_embedding = await asyncio.gather(
        embeddings.aembed_query(resume_text),
        embeddings.aembed_query(jd_text),
    )

    similarity = cosine_similarity(resume_embedding,jd_embedding,)

    # Convert -1...1 to a percentage-like value.
    # For normal text embeddings, values are generally non-negative.
    score = max(0.0, min(1.0, similarity)) * 100
    return round(score, 2)


def reject_duplicate_jd(jd_text: str) -> str:
    """Return the JD's content hash, raising 409 if the same posting is already
    stored under **any** job id.

    One posting is one requisition. The location used to be part of this test —
    the same role opened in Noida and in Chennai read as two real requisitions —
    but that let the same document in under a third job id for a third city, and
    a role's candidates ended up split across job ids where nobody sees the whole
    pool. Ruled out on request: same text is a duplicate, full stop. A role that
    genuinely runs in several cities is one JD, edited.

    The comparison is exact text, so a document changed by even one character is
    a new JD. That is the safe direction to be wrong in: a missed duplicate costs
    a stray requisition, a wrong reject blocks a real one.
    """
    content_hash = hashlib.sha256(jd_text.encode()).hexdigest()

    existing = vector_store.get(
        where={
            "$and": [
                {"content_hash": {"$eq": content_hash}},
                {"document_type": {"$eq": "job_description"}},
            ]
        },
    )

    if existing["ids"]:
        metadata = existing["metadatas"][0]
        clash = metadata.get("job_code") or metadata.get("uuid") or "an existing JD"
        name = str(metadata.get("job_name", "")).strip()
        where = str(metadata.get("primary_location", "")).strip()
        raise HTTPException(
            status_code=409,
            detail=(
                f"This job description is already uploaded as {clash}"
                + (f" ({name})" if name else "")
                + (f" for {where}" if where else "")
                + ". Edit that requisition instead of uploading it again."
            ),
        )

    return content_hash


def reject_duplicate(text: str, extra_filter: dict) -> str:
    """Return the content hash, raising 409 if a document with the same text already exists."""
    content_hash = hashlib.sha256(text.encode()).hexdigest()

    existing = vector_store.get(
        where={"$and": [{"content_hash": {"$eq": content_hash}}, extra_filter]},
    )

    if existing["ids"]:
        raise HTTPException(
            status_code=409,
            detail=f"This document is already uploaded (uuid: {existing['ids'][0]})",
        )

    return content_hash


async def create_jd(
    file: UploadFile,
    job_id: str,
    primary_location: str,
    job_name: str = "",
    role_criteria: str = "",
    upload_id: str = "",
) -> dict:
    """Store a JD under its job id.

    The job id is the key, so it is checked *before* the document is parsed and
    sent to the LLM — a clash costs nothing and HR gets the answer immediately.
    The role criteria are validated in the same breath, for the same reason: a
    half-specified requisition is rejected before anything is parsed or stored.

    Identical JD text is rejected whatever job id or location it arrives under:
    one posting is one requisition — see `reject_duplicate_jd`.
    """
    try:
        jd_id = normalize_job_id(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not primary_location.strip():
        raise HTTPException(status_code=400, detail="Primary location is required")

    criteria = parse_criteria(role_criteria)

    # ponytail: read-then-write; two uploads of one id in the same instant could
    # race. Add a lock if that ever happens in practice.
    if vector_store.get(ids=[jd_id])["ids"]:
        raise HTTPException(
            status_code=409,
            detail=f"Job ID {jd_id} is already taken. Enter a different one.",
        )

    temporary_path = await save_upload_temporarily(file)
    # Everything above is validation — the stages the browser waits through
    # start here.
    start_run(upload_id, 1)

    try:
        # Every step below goes through a thread (or its async twin). They are
        # all blocking — liteparse, the classifier, the LLM, the Chroma write —
        # and on the event loop they would starve the very endpoint the browser
        # polls for progress: the bar would sit at its opening label until the
        # whole upload finished. The resume path has always done this.
        stage(upload_id, "parsing")
        jd_text = await asyncio.to_thread(parse_document, temporary_path)
        print(f"[JD] parsed '{file.filename}' ({len(jd_text)} chars) for {jd_id}", flush=True)

        # Before the LLM, the embedding or the file copy: an offer letter in the
        # JD slot stops here with a 422 rather than becoming a requisition with
        # invented skills.
        stage(upload_id, "checking")
        await asyncio.to_thread(verify_document, jd_text, "job_description", file.filename or "This file")

        # This posting is already a requisition: stop before the LLM, so a
        # re-upload costs a parse rather than an analysis.
        jd_hash = reject_duplicate_jd(jd_text)

        stage(upload_id, "analyzing")
        agent_result = await jd_agent.ainvoke({"messages": [{"role": "user","content": jd_text}]})

        jd_output: JDOutput = agent_result["structured_response"]
        print(f"[JD] LLM extracted {len(jd_output.skills)} skills: {jd_output.skills}", flush=True)

        # Keep the original posting — it's what HR opens from the JD list.
        # `add_documents` below embeds the text on the way in, so this stage
        # covers both the write and the vector it writes.
        stage(upload_id, "storing")
        JD_FILES.mkdir(exist_ok=True)
        stored_path = JD_FILES / (jd_id + Path(temporary_path).suffix)
        shutil.copyfile(temporary_path, stored_path)
        print(f"[JD] saved original file to {stored_path}", flush=True)

        document = Document(
            id=jd_id,
            page_content=jd_output.text,
            metadata={
                "uuid": jd_id,
                "document_type": "job_description",
                "source": file.filename or "JD.pdf",
                "file_path": str(stored_path),
                "content_hash": jd_hash,
                "job_code": jd_id,
                "primary_location": primary_location.strip(),
                "job_name": job_name.strip(),

                # Chroma metadata is safest with scalar values.
                "skills": json.dumps(jd_output.skills),
                # What the candidate screening flow branches on — see
                # role_criteria.py. `screening_answers` used to sit beside this:
                # eight free-text answers nothing ever compared against. No
                # longer collected; JDs that have them keep them.
                "role_criteria": json.dumps(criteria),
            },
        )

        # Embeds on the way in, so this is a network call, not a memory write.
        await asyncio.to_thread(vector_store.add_documents, documents=[document], ids=[jd_id])
        finish_one(upload_id)
        print(f"[JD] stored in Chroma with job id={jd_id} "
              f"location={primary_location.strip()!r}", flush=True)

        return {
            "jd_uuid": jd_id,
            "job_code": jd_id,
            "primary_location": primary_location.strip(),
            "job_name": job_name.strip(),
            "source": file.filename,
            "skills": jd_output.skills,
            "role_criteria": criteria,
            "text": jd_output.text,
            "message": f"{jd_id} uploaded successfully",
        }

    finally:
        Path(temporary_path).unlink(missing_ok=True)


def rekey_jd(old_id: str, new_id: str, updates: dict) -> int:
    """Move a JD to a new job id, taking its resumes with it.

    The job id *is* the document's key, so changing it is a move rather than an
    edit. The JD is re-added under the new key first and the old one dropped
    last, so a failure part-way leaves it reachable at the old id rather than
    at neither. The stored embedding is carried over — the text hasn't changed,
    so there is nothing to re-embed.

    Returns how many resumes were repointed.
    """
    if vector_store.get(ids=[new_id])["ids"]:
        raise HTTPException(
            status_code=409,
            detail=f"Job ID {new_id} is already taken. Enter a different one.",
        )

    existing = vector_store.get(
        ids=[old_id], include=["documents", "metadatas", "embeddings"]
    )

    vector_store._collection.add(
        ids=[new_id],
        documents=[existing["documents"][0]],
        metadatas=[{**existing["metadatas"][0], **updates}],
        embeddings=[list(existing["embeddings"][0])],
    )

    resumes = vector_store.get(
        where={
            "$and": [
                {"document_type": {"$eq": "resume"}},
                {"jd_uuid": {"$eq": old_id}},
            ]
        },
        include=["metadatas"],
    )

    if resumes["ids"]:
        vector_store._collection.update(
            ids=resumes["ids"],
            metadatas=[{**m, "jd_uuid": new_id} for m in resumes["metadatas"]],
        )

    vector_store.delete(ids=[old_id])
    print(f"[JD] re-keyed {old_id} -> {new_id} with "
          f"{len(resumes['ids'])} resume(s)", flush=True)

    return len(resumes["ids"])


def get_jd_by_uuid(jd_uuid: str) -> Document:
    result = vector_store.get(ids=[jd_uuid],include=["documents", "metadatas"])

    if not result["ids"]:
        raise HTTPException(
            status_code=404,
            detail=f"No job description found for UUID: {jd_uuid}",
        )

    metadata = result["metadatas"][0]
    document_text = result["documents"][0]

    if metadata.get("document_type") != "job_description":
        raise HTTPException(
            status_code=400,
            detail="The supplied UUID does not belong to a job description",
        )

    return Document(id=jd_uuid,page_content=document_text,metadata=metadata)


# Every resume in a batch runs its own LLM call concurrently, so the batch size
# is what bounds load. The UI says "max 10" but only warns, so enforce it here.
MAX_RESUMES_PER_BATCH = 10


async def create_resumes(files: list[UploadFile], jd_uuid: str, upload_id: str = "") -> dict:
    """Process many resumes for one JD in parallel; one failure doesn't sink the batch."""
    get_jd_by_uuid(jd_uuid)

    if len(files) > MAX_RESUMES_PER_BATCH:
        raise HTTPException(
            status_code=400,
            detail=f"Upload at most {MAX_RESUMES_PER_BATCH} resumes at a time "
                   f"({len(files)} were sent).",
        )

    # Parallel tasks would race past the stored-hash check, so drop
    # byte-identical files within the batch up front.
    # ponytail: same-text-different-bytes files in one batch can still race; add a lock if it ever matters
    seen_digests: set[str] = set()
    unique_files: list[UploadFile] = []
    results: list[dict] = []

    for file in files:
        digest = hashlib.sha256(await file.read()).hexdigest()
        await file.seek(0)

        if digest in seen_digests:
            results.append({"source": file.filename, "error": "Duplicate file within this batch"})
        else:
            seen_digests.add(digest)
            unique_files.append(file)

    # Only the files that survived the in-batch duplicate check are worked on,
    # so they are what the bar counts down.
    start_run(upload_id, len(unique_files))
    outcomes = await asyncio.gather(
        *(create_resume(file=file, jd_uuid=jd_uuid, upload_id=upload_id) for file in unique_files),
        return_exceptions=True,
    )

    for file, outcome in zip(unique_files, outcomes):
        if isinstance(outcome, HTTPException):
            print(f"[Resume] FAILED '{file.filename}': {outcome.detail}", flush=True)
            results.append({"source": file.filename, "error": outcome.detail})
        elif isinstance(outcome, BaseException):
            print(f"[Resume] FAILED '{file.filename}': {outcome!r}", flush=True)
            results.append({"source": file.filename, "error": str(outcome)})
        else:
            results.append(outcome)

    return {"jd_uuid": jd_uuid, "total": len(files), "results": results}


async def create_resume(file: UploadFile,jd_uuid: str,upload_id: str = "") -> dict:
    jd_document = get_jd_by_uuid(jd_uuid)

    temporary_path = await save_upload_temporarily(file)

    try:
        stage(upload_id, "parsing")
        resume_text = await asyncio.to_thread(parse_document, temporary_path)
        print(f"[Resume] parsed '{file.filename}' ({len(resume_text)} chars) for jd={jd_uuid}", flush=True)

        # Same gate as the JD: a payslip or a certificate is refused here, so
        # the batch reports it as a failed file instead of storing a candidate
        # the extractor made up out of it.
        stage(upload_id, "checking")
        await asyncio.to_thread(verify_document, resume_text, "resume", file.filename or "This file")

        content_hash = reject_duplicate(resume_text,{"jd_uuid": {"$eq": jd_uuid}})

        agent_input = (f"Job description:\n{jd_document.page_content}\n\n---\n\nResume:\n{resume_text}")

        stage(upload_id, "analyzing")
        try:
            agent_result = await asyncio.wait_for(
                resume_agent.ainvoke({"messages": [{"role": "user", "content": agent_input}]}),
                timeout=180,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504,
                                detail="LLM processing timed out for this resume")

        resume_output: ResumeOutput = agent_result["structured_response"]
        # The prompt asks for 1-5 of each; trim here so the cap holds even when
        # the model ignores it. Done once, before anything reads these.
        resume_output.green_flags = resume_output.green_flags[:MAX_FLAGS]
        resume_output.red_flags = resume_output.red_flags[:MAX_FLAGS]
        print(f"[Resume] LLM extracted name={resume_output.name!r}, "
              f"{resume_output.years_experience} yrs exp, "
              f"{len(resume_output.skills)} skills, "
              f"{len(resume_output.green_flags)} green / {len(resume_output.red_flags)} red flags, "
              f"{len(resume_output.risk_questions)} risk question(s)", flush=True)
        print(f"[Resume] summary: {resume_output.summary}", flush=True)

        stage(upload_id, "embedding")
        similarity_score = await calculate_similarity(resume_text=resume_output.text,
                                                      jd_text=jd_document.page_content,)
        print(f"[Resume] embedding similarity vs JD: {similarity_score}%", flush=True)

        resume_uuid = str(uuid.uuid4())

        # Keep the original file — it's what HR downloads later.
        stage(upload_id, "storing")
        RESUME_FILES.mkdir(exist_ok=True)
        stored_path = RESUME_FILES / (resume_uuid + Path(temporary_path).suffix)
        shutil.copyfile(temporary_path, stored_path)
        print(f"[Resume] saved original file to {stored_path}", flush=True)

        document = Document(
            id=resume_uuid,
            page_content=resume_output.text,
            metadata={
                "uuid": resume_uuid,
                "document_type": "resume",
                "source": file.filename or "resume.pdf",
                "file_path": str(stored_path),
                "content_hash": content_hash,
                "jd_uuid": jd_uuid,
                "candidate_name": resume_output.name,
                "email": resume_output.email or "",
                "phone": resume_output.phone or "",
                "skills": json.dumps(resume_output.skills),
                "years_experience": resume_output.years_experience,
                # Whether they are working somewhere right now. The HR screening
                # flow skips the notice-period, buyout and current-CTC questions
                # when this is "no" — see screening_questions.py. "" (the resume
                # did not say) asks everything, which is the safe direction.
                "currently_employed": resume_output.currently_employed,
                "summary": resume_output.summary,
                "green_flags": json.dumps(resume_output.green_flags),
                "red_flags": json.dumps(resume_output.red_flags),
                # Per-candidate questions about gaps / job hopping / other
                # serious negatives, ticked in the HR modal and read out on the
                # AI phone call. Indexed from RISK_INDEX_BASE — see
                # screening_questions.py for why they get a reserved range.
                "risk_questions": json.dumps(resume_output.risk_questions),
                # screening_questions used to be stored here: the LLM was asked
                # to reproduce the eight Standard Recruitment & Eligibility
                # Checks verbatim for every resume, and the modal then rendered
                # them *and* its own hardcoded copy — sixteen questions, eight of
                # them twice. The list is fixed, so it lives in one place now
                # (screening_questions.py / lib/screening-questions.ts) and no
                # LLM call is spent on it. Older resumes keep the stored key.
                "similarity_score": similarity_score,
            },
        )

        await asyncio.to_thread(vector_store.add_documents, documents=[document], ids=[resume_uuid])
        finish_one(upload_id)
        print(f"[Resume] stored in Chroma with uuid={resume_uuid}", flush=True)

        return {
            "resume_uuid": resume_uuid,
            "jd_uuid": jd_uuid,
            "candidate": {
                "name": resume_output.name,
                "email": resume_output.email,
                "phone": resume_output.phone,
                "skills": resume_output.skills,
                "years_experience": resume_output.years_experience,
                "currently_employed": resume_output.currently_employed,
                "summary": resume_output.summary,
                "green_flags": resume_output.green_flags,
                "red_flags": resume_output.red_flags,
                "risk_questions": resume_output.risk_questions,
            },
            "similarity_score": similarity_score,
            "message": "Resume evaluated and stored successfully",
        }

    finally:
        Path(temporary_path).unlink(missing_ok=True)