import json
import os
import re
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ValidationError, field_validator

import agents
import interview_scoring
import joining_assessment
from job_id import normalize_job_id
from logic import create_jd, create_resumes, get_jd_by_uuid, rekey_jd
from output_parser import MAX_FLAGS
from progress import read as read_progress
from role_criteria import parse_criteria
from screening_questions import (
    CALL_QUESTIONS,
    EMPLOYMENT,
    FLOW_INDEX_BASE,
    FLOW_QUESTIONS,
    INDEX,
    KEY_AT,
    LEGACY_FLOW_INDEX_BASE,
    LEGACY_FLOW_QUESTIONS,
    RISK_INDEX_BASE,
    questions_map,
)
from vector_store import vector_store
from voice import calls

# How much JD text to hand the voice service to ground inbound questions with.
# Whole JDs are a few KB; this is a ceiling against a pathological one blowing
# up the request and the agent's prompt, not a target.
JD_CONTEXT_CHARS = 8000
# Same ceiling for the resume the agent gets as context. Resumes are 2-5 KB.
RESUME_CONTEXT_CHARS = 8000


# The lifespan runs the AI phone calls' redial/poll scheduler (voice/calls.py);
# the router is Sarvam's call-end webhook.
app = FastAPI(title="Resume Screening API", version="1.0.0", lifespan=calls.lifespan)
app.include_router(calls.router)
# Through the PUBLIC_URL tunnel, the webhook and nothing else.
app.middleware("http")(calls.tunnel_guard)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "Resume Screening API is running"}


# ─── LLM Config endpoints ─────────────────────────────────────────────────────


class ActiveConfig(BaseModel):
    activeParseProvider: str = ""
    activeParseModel: str = ""
    activeChatProvider: str = ""
    activeChatModel: str = ""


@app.get("/api/config/llm")
async def get_llm_config():
    cfg = agents.get_config()
    return cfg


@app.post("/api/config/llm")
async def save_llm_config(payload: dict):
    if "providers" not in payload:
        raise HTTPException(status_code=400, detail="providers is required")
    cfg = agents.save_config(payload)
    return cfg


@app.post("/api/config/llm/active")
async def set_active_llm(cfg: ActiveConfig):
    current = agents.get_config()
    current["activeParseProvider"] = cfg.activeParseProvider
    current["activeParseModel"] = cfg.activeParseModel
    current["activeChatProvider"] = cfg.activeChatProvider
    current["activeChatModel"] = cfg.activeChatModel
    saved = agents.save_config(current)
    return saved


@app.delete("/api/config/llm/{provider_id}")
async def delete_llm_provider(provider_id: str):
    current = agents.get_config()
    current["providers"] = [p for p in current.get("providers", []) if p["id"] != provider_id]
    if current.get("activeParseProvider") == provider_id:
        current["activeParseProvider"] = ""
        current["activeParseModel"] = ""
    if current.get("activeChatProvider") == provider_id:
        current["activeChatProvider"] = ""
        current["activeChatModel"] = ""
    saved = agents.save_config(current)
    return saved


# ─── Existing endpoints ───────────────────────────────────────────────────────


def update_metadata(doc_uuid: str, expected_type: str, updates: dict) -> None:
    result = vector_store.get(ids=[doc_uuid], include=["metadatas"])

    if not result["ids"] or result["metadatas"][0].get("document_type") != expected_type:
        raise HTTPException(
            status_code=404,
            detail=f"No {expected_type} found for UUID: {doc_uuid}",
        )

    metadata = {**result["metadatas"][0], **updates}
    vector_store._collection.update(ids=[doc_uuid], metadatas=[metadata])


def joining_for(resume_metadata: dict, jd_metadata: dict) -> dict | None:
    """The joining-likelihood verdict for one resume, or None if there isn't one.

    Wrapped rather than called directly for the same reason the sort below the
    listing guards against a missing score: this runs once per resume over
    metadata of every vintage, and one candidate's odd row must not 500 the
    whole JD's shortlist. A verdict that cannot be computed is simply absent.
    """
    try:
        return joining_assessment.assess(resume_metadata, jd_metadata)
    except Exception:
        print(f"[Joining] could not assess resume "
              f"uuid={resume_metadata.get('uuid')!r}", flush=True)
        return None


def with_call(resume_metadata: dict) -> tuple[dict, dict | None]:
    """The row as its AI call left it: metadata whose screening has the call's
    answers in every field HR has not saved, and the call's communication score
    once graded (else None).

    Both used to reach the row only through the HR modal: opening it wrote the
    score onto the candidate, and Save wrote the answers the joining verdict
    reads. So after a bulk call every row stayed blank until HR opened each one.
    Read off the session instead, they show the moment the call ends.
    """
    session_id = resume_metadata.get("interview_session_id")
    session = calls.get(session_id) if session_id else None
    if not session:
        return resume_metadata, None
    scores = session.get("scores") or {}
    # Live, not just the copy archived on Save: a bulk call's dials and spend
    # reach Collective analysis the moment it ends.
    resume_metadata = {**resume_metadata,
                       "interview_call_stats": json.dumps(interview_scoring.call_stats(session))}
    try:
        screening = joining_assessment.with_call(resume_metadata.get("hr_screening"),
                                                 _call_answers(session))
        resume_metadata = {**resume_metadata, "hr_screening": screening}
    except Exception:
        print(f"[Joining] could not read the call for resume "
              f"uuid={resume_metadata.get('uuid')!r}", flush=True)
    return resume_metadata, scores if scores.get("status") == "done" else None


def scores_for(resume_metadata: dict, call_scores: dict | None) -> dict | None:
    """The row's communication score: HR's saved regrade, else the call's, else the stored copy."""
    try:
        stored = json.loads(resume_metadata.get("interview_scores") or "null")
    except json.JSONDecodeError:
        stored = None
    if stored and stored.get("model"):
        return stored
    return call_scores or stored


@app.post("/jd/upload")
async def upload_jd(
    file: UploadFile = File(...),
    job_id: str = Form(...),
    primary_location: str = Form(...),
    job_name: str = Form(""),
    role_criteria: str = Form(""),
    upload_id: str = Form(""),
):
    """Upload a JD under a job id (EXL + 6 digits), which becomes its identity.

    The job id, location and role criteria are required *here* rather than
    patched on afterwards: nothing reaches the vector store until HR has said
    which requisition this is, where it sits, and what it expects of a candidate.

    `role_criteria` is the typed set the candidate screening flow branches on
    (experience, budget, workplace mode, notice period, buyout), keyed by
    `role_criteria.py` — every key, and each min no greater than its max.
    """
    return await create_jd(
        file=file,
        job_id=job_id,
        primary_location=primary_location,
        job_name=job_name,
        role_criteria=role_criteria,
        upload_id=upload_id,
    )


@app.post("/resume/upload")
async def upload_resume(
    files: list[UploadFile] = File(...),
    jd_uuid: str = Form(...),
    upload_id: str = Form(""),
):
    return await create_resumes(files=files, jd_uuid=jd_uuid, upload_id=upload_id)


@app.get("/upload/{upload_id}/progress")
async def upload_progress(upload_id: str):
    """Which stage the upload with this id is on — see progress.py.

    The id is minted by the browser and sent with the files, so this is polled
    while the POST above is still in flight. `{}` means nothing is known about
    it: the run has not reached its first stage yet, or it finished and the
    caller has its result already. Never an error — a poll that misses must not
    put a red strip on screen while the upload it is watching is going fine.
    """
    return read_progress(upload_id)


@app.get("/jds")
async def list_jds():
    result = vector_store.get(
        where={"document_type": {"$eq": "job_description"}},
        include=["metadatas"],
    )

    resume_result = vector_store.get(
        where={"document_type": {"$eq": "resume"}},
        include=["metadatas"],
    )
    counts: dict[str, int] = {}
    for metadata in resume_result["metadatas"]:
        jd_id = metadata.get("jd_uuid")
        counts[jd_id] = counts.get(jd_id, 0) + 1

    jds = [
        {
            "jd_uuid": jd_id,
            "source": metadata.get("source"),
            "skills": json.loads(metadata.get("skills", "[]")),
            "job_name": metadata.get("job_name", ""),
            "job_code": metadata.get("job_code", ""),
            "primary_location": metadata.get("primary_location", ""),
            # The dashboard shows the requisition's answer next to each
            # candidate's, so it comes with the JD list rather than needing a
            # second call per JD.
            "screening_answers": json.loads(metadata.get("screening_answers", "{}")),
            # What the HR modal's conditional flow branches on, so it arrives
            # with the JD list for the same reason the answers do.
            "role_criteria": json.loads(metadata.get("role_criteria", "{}")),
            "has_file": bool(metadata.get("file_path")),
            "resume_count": counts.get(jd_id, 0),
        }
        for jd_id, metadata in zip(result["ids"], result["metadatas"])
    ]

    # Most-screened first, so the JD you are actually working on leads the list.
    jds.sort(key=lambda item: item["resume_count"], reverse=True)

    return {"total": len(jds), "jds": jds}


@app.get("/jd/{jd_uuid}")
async def get_jd(jd_uuid: str):
    document = get_jd_by_uuid(jd_uuid)
    skills = json.loads(document.metadata.get("skills", "[]"))

    return {
        "jd_uuid": jd_uuid,
        "source": document.metadata.get("source"),
        "skills": skills,
        "job_name": document.metadata.get("job_name", ""),
        "job_code": document.metadata.get("job_code", ""),
        "primary_location": document.metadata.get("primary_location", ""),
        "screening_answers": json.loads(document.metadata.get("screening_answers", "{}")),
        "role_criteria": json.loads(document.metadata.get("role_criteria", "{}")),
        "has_file": bool(document.metadata.get("file_path")),
        "text": document.page_content,
    }


@app.get("/jd/{jd_uuid}/download")
async def download_jd(jd_uuid: str):
    """The original posting, served inline so it opens in a browser tab.

    Same deal as the resume download: JDs uploaded before the file was kept have
    no `file_path` and 404 here, which is why the UI only links when `has_file`.
    """
    document = get_jd_by_uuid(jd_uuid)
    file_path = document.metadata.get("file_path", "")

    if not file_path or not Path(file_path).exists():
        raise HTTPException(
            status_code=404,
            detail="The original file for this job description was not kept. "
                   "Re-upload it to view.",
        )

    return FileResponse(
        path=file_path,
        filename=document.metadata.get("source") or f"{jd_uuid}.pdf",
        content_disposition_type="inline",
    )


@app.put("/jd/{jd_uuid}/info")
async def update_jd_info(jd_uuid: str, payload: dict):
    """Edit a stored JD's title, location, or job id.

    Changing the job id moves the document — it is the key — so that path also
    repoints every resume screened against it. The response always carries the
    JD's id afterwards, which callers must use from then on.
    """
    get_jd_by_uuid(jd_uuid)  # 404s if it isn't a real JD

    # job_name is the human title the recruiter typed ("Senior Data Engineer").
    # It used to live only in the browser's localStorage, so the same JD looked
    # like a filename on any other machine. Persist it with the document.
    updates = {}
    if "primary_location" in payload:
        updates["primary_location"] = str(payload.get("primary_location", "")).strip()
    if "job_name" in payload:
        updates["job_name"] = str(payload.get("job_name", "")).strip()

    # Omitting role_criteria leaves the stored set alone; sending it means
    # replacing it, and a replacement has to be complete — the same rule as
    # upload. A partial set would leave the screening flow branching on a
    # threshold that is half the old one and half the new.
    #
    # `screening_answers` had the identical branch. It is no longer collected
    # anywhere, so the branch went with it; whatever a JD already has stays on
    # the document and is still returned, because the HR modal reads it to label
    # answers recorded while those questions were still being asked.
    if payload.get("role_criteria"):
        updates["role_criteria"] = json.dumps(parse_criteria(payload["role_criteria"]))

    new_id = jd_uuid
    if payload.get("job_id"):
        try:
            new_id = normalize_job_id(str(payload["job_id"]))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    if new_id != jd_uuid:
        updates["job_code"] = new_id
        updates["uuid"] = new_id
        moved = rekey_jd(jd_uuid, new_id, updates)
        return {
            "jd_uuid": new_id,
            "previous_jd_uuid": jd_uuid,
            "moved_resumes": moved,
            "message": f"Job ID changed to {new_id}",
        }

    update_metadata(jd_uuid, "job_description", updates)
    print(f"[JD] info updated id={jd_uuid}: "
          f"job_name={payload.get('job_name', '')!r}, "
          f"primary_location={payload.get('primary_location', '')!r}", flush=True)

    return {"jd_uuid": jd_uuid, "message": "JD info updated"}


@app.delete("/jd/{jd_uuid}")
async def delete_jd(jd_uuid: str):
    """Delete a JD and everything screened against it.

    Without this, "delete" only cleared the browser's localStorage: the JD and
    its resumes stayed in Chroma and the resume files stayed on disk, so the JD
    reappeared in the dashboard's picker and the counts never went down.

    Resumes are removed first, so a failure part-way through can never leave a
    resume pointing at a JD that no longer exists.
    """
    jd_document = get_jd_by_uuid(jd_uuid)  # 404s if it isn't a real JD

    resumes = vector_store.get(
        where={
            "$and": [
                {"document_type": {"$eq": "resume"}},
                {"jd_uuid": {"$eq": jd_uuid}},
            ]
        },
        include=["metadatas"],
    )

    for metadata in resumes["metadatas"]:
        if metadata.get("file_path"):
            Path(metadata["file_path"]).unlink(missing_ok=True)

    # Chroma rejects an empty id list, so only call delete when there is work.
    if resumes["ids"]:
        vector_store.delete(ids=resumes["ids"])

    if jd_document.metadata.get("file_path"):
        Path(jd_document.metadata["file_path"]).unlink(missing_ok=True)

    vector_store.delete(ids=[jd_uuid])
    print(f"[JD] deleted uuid={jd_uuid} with {len(resumes['ids'])} resume(s)", flush=True)

    return {
        "jd_uuid": jd_uuid,
        "deleted_resumes": len(resumes["ids"]),
        "message": "Job description and its resumes deleted",
    }


@app.get("/jd/{jd_uuid}/resumes")
async def get_resumes_for_jd(jd_uuid: str):
    # The JD used to be fetched only to 404 on an unknown id. Its metadata is
    # now read as well: the joining assessment below measures each candidate's
    # answers against this requisition's criteria and location, and one lookup
    # here serves every resume under it.
    jd = get_jd_by_uuid(jd_uuid)

    result = vector_store.get(
        where={
            "$and": [
                {"document_type": {"$eq": "resume"}},
                {"jd_uuid": {"$eq": jd_uuid}},
            ]
        },
        include=["documents", "metadatas"],
    )

    resumes = []

    for resume_id, metadata in zip(
        result["ids"],
        result["metadatas"],
    ):
        judged, call_scores = with_call(metadata)
        resumes.append(
            {
                "resume_uuid": resume_id,
                "jd_uuid": metadata["jd_uuid"],
                "name": metadata.get("candidate_name"),
                "email": metadata.get("email"),
                "phone": metadata.get("phone"),
                "skills": json.loads(
                    metadata.get("skills", "[]")
                ),
                "years_experience": metadata.get("years_experience"),
                "summary": metadata.get("summary", ""),
                # Capped on the way out too, not just on the way in: resumes
                # analyzed before the cap existed still carry a dozen flags each
                # and would otherwise render a row of icons twice as long as
                # everyone else's.
                "green_flags": json.loads(metadata.get("green_flags", "[]"))[:MAX_FLAGS],
                "red_flags": json.loads(metadata.get("red_flags", "[]"))[:MAX_FLAGS],
                "screening_questions": json.loads(metadata.get("screening_questions", "[]")),
                "risk_questions": json.loads(metadata.get("risk_questions", "[]")),
                # "yes" / "no" / "" — "" for every resume analyzed before the
                # field existed, which the screening flow reads as "ask
                # everything" rather than guessing.
                "currently_employed": metadata.get("currently_employed", ""),
                "similarity_score": metadata.get("similarity_score"),
                "source": metadata.get("source"),
                "has_file": bool(metadata.get("file_path")),
                # Set once an AI phone screening has been placed — the dashboard
                # shows a play button only for candidates that have one.
                "interview_session_id": metadata.get("interview_session_id", ""),
                # The communication score from the finished call. Mistral's
                # regrade on Save (marked with its `model`) is the one HR saved
                # and wins; else the call's own, there the moment it ends
                # (with_call) and never older than the copy the HR modal stores;
                # else whatever is stored.
                "interview_scores": scores_for(metadata, call_scores),
                # What the call cost — duration, times placed, rescheduled,
                # not picked up, callbacks, and rupees. Live off the session
                # (with_call), else the copy interview_scoring.archive_and_score
                # stored on Save; None for a candidate never called.
                "interview_call_stats": (
                    json.loads(judged["interview_call_stats"])
                    if judged.get("interview_call_stats")
                    else None
                ),
                "hr_screening": (
                    json.loads(metadata["hr_screening"])
                    if metadata.get("hr_screening")
                    else None
                ),
                # How likely this candidate is to actually join, from the
                # screening answers alone — deterministic rules, no LLM, see
                # joining_evaluator.py. Computed on read rather than stored: it
                # is a pure function of the row, so recomputing costs nothing
                # and a rule change can never leave a stale verdict behind.
                # None for anyone not yet screened, which the UI shows as a dash.
                # Judged on the call's answers too, wherever HR has not saved one.
                "joining_assessment": joining_for(judged, jd.metadata),
            }
        )

    # A resume stored without a score would otherwise make this whole listing
    # 500 on the comparison, taking the JD's entire shortlist down with it.
    resumes.sort(
        key=lambda item: item["similarity_score"] or 0,
        reverse=True,
    )

    return {
        "jd_uuid": jd_uuid,
        "total_resumes": len(resumes),
        "resumes": resumes,
    }


@app.put("/resume/{resume_uuid}/screening")
async def save_screening(resume_uuid: str, payload: dict, background_tasks: BackgroundTasks):
    # selected_questions used to be dropped here even though the UI sends it, so
    # a question ticked but left unanswered came back unticked — the modal had to
    # re-guess the set from which answers were non-empty.
    update_metadata(resume_uuid, "resume", {
        "hr_screening": json.dumps({
            "responses": payload.get("responses", {}),
            "selected_questions": payload.get("selected_questions", []),
            "comment": payload.get("comment", ""),
            "decision": payload.get("decision", ""),
            # What the candidate said for the questions whose field cannot hold
            # it — a number input keeps "400000", a radio keeps "yes". Without
            # this the sentence those were parsed from was visible until the
            # modal closed and then gone, so a mis-parse became unnoticeable.
            "heard": payload.get("heard", {}),
            # How many flow questions existed at this save, so a question
            # appended later reads as never seen rather than as unticked
            # (frontend/lib/screening-flow.ts:addedSince).
            "flow_size": payload.get("flow_size"),
        }),
    })
    print(f"[Screening] saved for resume uuid={resume_uuid} "
          f"(decision={payload.get('decision', '')!r})", flush=True)

    # If this candidate was called, archive that call onto them and grade how
    # they communicated. It runs *after* the response goes out, so HR never
    # waits on Sarvam or an LLM round trip to see their save land —
    # and a failure in either can't turn a saved screening into an error.
    metadata = get_resume_metadata(resume_uuid)
    session_id = metadata.get("interview_session_id")
    if session_id:
        background_tasks.add_task(
            interview_scoring.archive_and_score,
            resume_uuid=resume_uuid,
            session_id=session_id,
            candidate_name=metadata.get("candidate_name", ""),
            update_metadata=update_metadata,
        )

    return {"resume_uuid": resume_uuid, "message": "Screening saved"}


def get_resume_metadata(resume_uuid: str) -> dict:
    result = vector_store.get(ids=[resume_uuid], include=["metadatas"])

    if not result["ids"] or result["metadatas"][0].get("document_type") != "resume":
        raise HTTPException(
            status_code=404,
            detail=f"No resume found for UUID: {resume_uuid}",
        )

    return result["metadatas"][0]


# ─── AI phone screening ───────────────────────────────────────────────────────


class CandidatePhone(BaseModel):
    """The candidate's number as it came off the resume, normalised for dialling.

    `ResumeOutput.phone` (output_parser.py) is whatever was printed on the CV —
    "+91 98765-43210", "09876543210", "98765 43210". Calls are dialled in E.164, so
    the cleanup is a pydantic validator here rather than a check at the call site,
    and a number too mangled to dial fails before a call is ever placed.
    """

    number: str

    @field_validator("number")
    @classmethod
    def to_e164(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value)
        if not value.strip().startswith("+"):
            # ponytail: assumes India — the Sarvam number and the requisitions are
            # +91. Make the default country a config value if that stops being true.
            if len(digits) == 11 and digits.startswith("0"):
                digits = digits[1:]
            if len(digits) == 10:
                digits = "91" + digits
        if not 10 <= len(digits) <= 15:
            raise ValueError(f"{value!r} is not a dialable phone number")
        return "+" + digits


class InterviewRequest(BaseModel):
    """Which screening questions to ask on the call, by modal index."""

    question_indices: list[int]
    # Only for when the resume's printed number was mis-read; normally empty and
    # the number comes from the resume.
    phone: str = ""
    # The voice to call in, from the picker (a voice/calls.py VOICES id). Empty
    # means the default; an unknown one is refused before anything is dialled.
    speaker: str = ""


def candidate_profile(resume_uuid: str, metadata: dict) -> str:
    """The candidate's resume, for the agent to talk to them as someone who has
    read it. The parsed text, not HR's view of it: the summary, flags and scores
    are an assessment the agent could repeat to the candidate if asked "what did
    you think of my CV?". Contact details are redacted the way the chatbot does
    it; the agent has no use for them. Never read out (agent_prompt.md)."""
    docs = vector_store.get(ids=[resume_uuid], include=["documents"])["documents"]
    text = (docs[0] if docs else "") or ""
    return agents._redact_contact(text, metadata).strip()[:RESUME_CONTEXT_CHARS]


def prepare_call(
    resume_uuid: str, question_indices: list[int], phone_override: str = "",
    speaker: str = "",
) -> tuple[dict, list[int], dict]:
    """Everything needed to dial one candidate: the payload, the indices those
    questions are stored under, and the resume's metadata.

    Shared by the single-call and bulk endpoints so they cannot drift — a bulk
    call must be the same call, placed n times.

    **This function is where "which questions apply" is decided.** The voice
    service asks exactly the keys it is handed and steps over the rest, so every
    rule that is knowable before the phone rings has to be applied here:
    HR's ticks, the WFH rule that makes relocation moot, and the employment
    gate. All three are `requires` predicates in screening-flow.ts, none of them
    reads an answer, and putting any of them in the agent instead is the bug
    frontend/AGENTS.md records shipping once.
    """
    metadata = get_resume_metadata(resume_uuid)

    raw_phone = phone_override or metadata.get("phone") or ""

    try:
        phone = CandidatePhone(number=raw_phone).number
    except ValidationError:
        raise HTTPException(
            status_code=400,
            detail=f"No usable phone number ({raw_phone or 'none found'}). Fix it on "
                   "the resume or dial manually.",
        )

    # The requisition's criteria fill the `{mode}` / `{location}` placeholders,
    # and `workplace_mode` decides whether relocation is even a question.
    jd = get_jd_by_uuid(metadata["jd_uuid"])
    criteria = json.loads(jd.metadata.get("role_criteria", "{}"))
    job_location = jd.metadata.get("primary_location", "")
    job_name = jd.metadata.get("job_name", "")

    # Whether they are working somewhere, off their resume. "" (never
    # extracted) means unknown, which asks everything: a wrong skip loses an
    # answer, a wrong ask costs twenty seconds.
    employed = EMPLOYMENT.get(metadata.get("currently_employed", ""))
    employed_only = {
        "on_notice", "notice_days_left", "willing_to_resign",
        "notice_days", "buyout", "current_ctc",
    }

    risk_questions = json.loads(metadata.get("risk_questions", "[]"))
    indices = [
        i for i in question_indices
        if (0 <= i - FLOW_INDEX_BASE < len(FLOW_QUESTIONS))
        or (0 <= i - RISK_INDEX_BASE < len(risk_questions))
    ]
    # The two pre-call prunes. Everything else HR left ticked goes out as-is.
    if employed is False:
        indices = [i for i in indices if KEY_AT.get(i) not in employed_only]
    if criteria.get("workplace_mode") == "WFH":
        indices = [i for i in indices if KEY_AT.get(i) != "relocate"]

    questions = questions_map(indices, risk_questions, criteria, job_location)
    if not questions:
        raise HTTPException(status_code=400, detail="Tick at least one question to ask.")
    # Keep the two in step: an index whose question was dropped must not be
    # reported back as one the call went out with.
    indices = [i for i in indices if KEY_AT.get(i, f"risk_{i - RISK_INDEX_BASE}") in questions]

    return (
        {
            "candidate_name": metadata.get("candidate_name") or "there",
            "phone_number": phone,
            "jd_role": job_name or "this role",
            "primary_location": job_location or "the primary work location",
            "questions": questions,
            # Never read out on the screening call. It is the only thing the
            # agent may answer from if the candidate rings the number back with
            # a question about the role — without it, every such question is
            # politely declined. The parsed JD text, not the raw file, because
            # that is what is already in Chroma.
            "jd_description": (jd.page_content or "")[:JD_CONTEXT_CHARS],
            "candidate_profile": candidate_profile(resume_uuid, metadata),
            "speaker": speaker,
        },
        indices,
        metadata,
    )


def record_call(resume_uuid: str, metadata: dict, session_id: str) -> None:
    """Attach a placed call to its candidate, and drop the previous one's traces.

    Without the session id it lived only in the open modal, so the recording
    became unreachable the moment HR closed it — and a reopened form could not
    read back a rescheduled callback dialed hours later. Answers come back keyed
    by flow key, so the session id is all a reopened form needs.

    The previous call's archived artefacts go in the same breath: they are served
    *in preference to* the live session, so leaving them would play the old call
    back over the new one, beside a communication score earned on a different
    conversation. Cleared now rather than after the new call, because the stale
    copy is wrong from the moment the phone rings again. Save Responses
    re-archives from the new session (`archive_and_score`).

    `interview_call_stats` clears with them, and for the same reason: a new call
    is a new voice-service session whose dial tally starts at zero, so the old
    one would sit in the dashboard's collective analysis describing a
    conversation this candidate is no longer having.
    """
    previous = metadata.get("interview_recording_path", "")
    if previous and os.path.exists(previous):
        try:
            os.remove(previous)
        except OSError:
            pass  # a stale file nobody can reach any more; the path is cleared regardless
    update_metadata(resume_uuid, "resume", {
        "interview_session_id": session_id,
        "interview_transcript": "",
        "interview_recording_path": "",
        "interview_scores": "",
        "interview_call_stats": "",
    })


@app.get("/interview/voices")
async def list_interview_voices():
    """The voices HR can pick from, each one a call can actually be placed in."""
    return calls.voices()


@app.get("/interview/voices/{speaker}/preview")
async def get_interview_voice_preview(speaker: str):
    """A few seconds of one voice reading the call's greeting, for the picker.

    Served from here rather than called from the browser because the Sarvam key
    lives server-side. The clip is cached in voice/media/, so repeat auditions
    cost nothing.
    """
    return Response(
        content=await calls.voice_preview(speaker),
        media_type="audio/wav",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.post("/resume/{resume_uuid}/interview")
async def start_phone_interview(resume_uuid: str, payload: InterviewRequest):
    """Call one candidate and ask the ticked screening questions.

    A batch of one, through the same path as the bulk endpoint. The questions
    still come from here — the voice service is handed the exact sentences and
    asks only the keys it is given — but *which question follows which* is now
    the service's decision graph rather than a list read top to bottom.
    """
    candidate, indices, metadata = prepare_call(
        resume_uuid, payload.question_indices, payload.phone, payload.speaker
    )
    session_id = (await calls.place([candidate]))[0]
    record_call(resume_uuid, metadata, session_id)

    print(f"[Interview] resume={resume_uuid} phone={calls.masked(candidate['phone_number'])} "
          f"questions={sorted(candidate['questions'])} session={session_id}", flush=True)

    return {
        "session_id": session_id,
        "phone": candidate["phone_number"],
        "question_indices": indices,
        "queue_position": 0,  # Sarvam dials concurrently: there is no queue
    }


class BulkInterviewRequest(BaseModel):
    """Call several candidates from the dashboard, in one go."""

    resume_uuids: list[str]
    # The ticked set to put to all of them. Empty means every question that
    # applies to each candidate — the bulk path has no open modal to read ticks
    # from, so that is the only sensible default.
    question_indices: list[int] = []
    # One voice for the whole batch; empty means the default.
    speaker: str = ""


@app.post("/interviews/bulk")
async def start_bulk_interviews(payload: BulkInterviewRequest):
    """Call several candidates. They are dialled one after another, then talk
    concurrently.

    A candidate whose number is undialable is reported and left out rather than
    failing the batch: one bad CV must not block the other nine. The response is
    per resume, so the dashboard can show an error on the ones that never made it.
    """
    if not payload.resume_uuids:
        raise HTTPException(status_code=400, detail="Select at least one candidate to call.")

    # The flow, and only the flow. The per-resume risk questions (RISK_INDEX_BASE
    # and up) were removed from HR screening, so nothing offers them and nothing
    # can untick them — leaving them in this default was the one path that would
    # still have read them down the phone, on every bulk call.
    wanted = payload.question_indices or list(INDEX.values())

    prepared, failures = [], []
    for resume_uuid in payload.resume_uuids:
        try:
            candidate, indices, metadata = prepare_call(resume_uuid, wanted, speaker=payload.speaker)
            prepared.append((resume_uuid, candidate, indices, metadata))
        except HTTPException as exc:
            failures.append({"resume_uuid": resume_uuid, "error": str(exc.detail)})

    results = list(failures)
    if prepared:
        session_ids = await calls.place([candidate for _, candidate, _, _ in prepared])
        for (resume_uuid, candidate, indices, metadata), session_id in zip(prepared, session_ids):
            record_call(resume_uuid, metadata, session_id)
            results.append({
                "resume_uuid": resume_uuid,
                "session_id": session_id,
                "phone": candidate["phone_number"],
                "question_indices": indices,
                "queue_position": 0,
            })

    print(f"[Interview] bulk: queued {len(prepared)}, skipped {len(failures)}", flush=True)
    return {"results": results, "queued": len(prepared), "skipped": len(failures)}


def interview_session_id(resume_uuid: str) -> str:
    """The voice-service session for this candidate's AI call, or a 404."""
    session_id = get_resume_metadata(resume_uuid).get("interview_session_id")
    if not session_id:
        raise HTTPException(
            status_code=404,
            detail="No AI interview has been run for this candidate yet.",
        )
    return session_id


@app.get("/resume/{resume_uuid}/interview/recording")
async def get_interview_recording(resume_uuid: str):
    """The candidate's AI interview call as one audio file, for playback.

    Sarvam Voice Agents records the whole call; it is fetched from Sarvam's
    analytics API, which has it a minute or two *after* the call ends — until
    then this 404s, which is what the dashboard's button reports.
    """
    # Prefer our own archived copy, taken when HR saved the screening: playback
    # then keeps working when Sarvam is unreachable or has dropped the file.
    archived = get_resume_metadata(resume_uuid).get("interview_recording_path")
    if archived and os.path.exists(archived):
        return FileResponse(archived, media_type="audio/wav")

    session_id = interview_session_id(resume_uuid)
    try:
        audio = await calls.recording(session_id)
    except Exception as exc:  # Sarvam's own failure, worded by sarvam.SarvamError
        raise HTTPException(status_code=502, detail=str(exc)[:300])
    if audio is None:
        raise HTTPException(
            status_code=404,
            detail="The recording for this call is not ready yet — Sarvam is still "
                   "processing it. Try again in a minute.",
        )

    # ponytail: the whole file is held in memory — a 10-minute call is a few MB.
    # Stream it from Sarvam if calls ever get long.
    return Response(content=audio, media_type="audio/wav")


@app.get("/resume/{resume_uuid}/interview/transcript")
async def get_interview_transcript(resume_uuid: str):
    """The Q&A transcript of the call, as the .txt voice/calls.py writes."""
    # Same rule as the recording: our archived copy first, the live session second.
    archived = get_resume_metadata(resume_uuid).get("interview_transcript")
    if archived:
        name = get_resume_metadata(resume_uuid).get("candidate_name") or resume_uuid
        filename = re.sub(r"[^A-Za-z0-9._-]+", "_", f"{name}-interview.txt")
        return Response(
            content=archived,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    text = calls.transcript_text(interview_session_id(resume_uuid))
    if text is None:
        raise HTTPException(
            status_code=404,
            detail="No transcript was written for this call — it may not have connected.",
        )

    name = get_resume_metadata(resume_uuid).get("candidate_name") or resume_uuid
    filename = re.sub(r"[^A-Za-z0-9._-]+", "_", f"{name}-interview.txt")
    return Response(
        content=text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _extracted_value(extracted: dict | None) -> str:
    """The call's structured reading of an answer, as the string the form stores.

    "yes" for a radio, "400000" for a number input, the cleaned place name for a
    location. "" when the call understood nothing, which leaves the browser's own
    parse as the fallback — `extract_answer` returns {} if its model call fails,
    so that path is load-bearing rather than belt-and-braces.
    """
    if not extracted:
        return ""
    for field in ("answer", "value", "location"):
        value = extracted.get(field)
        if value not in (None, "", "unclear"):
            return str(value)
    return ""


@app.get("/interviews/active")
async def get_active_interviews():
    """Which calls are on the phone or waiting to be, keyed by session id.

    The dashboard polls this to mark the row being called right now.
    """
    return calls.active()


@app.get("/interviews/schedule")
async def get_call_schedule():
    """Every call made, taken and still to come, for the dashboard calendar."""
    return calls.schedule()


@app.get("/interviews/usage")
async def get_call_usage():
    """What the AI calls have cost the Sarvam account, and the credit left."""
    try:
        return await calls.usage()
    except Exception as exc:  # Sarvam down: the page shows a dash, not a 500
        raise HTTPException(status_code=502, detail=f"Could not read call usage from Sarvam: {exc}"[:300])


@app.get("/interview/{session_id}")
async def get_phone_interview(session_id: str, resume_uuid: str = ""):
    """Poll a call in progress, with transcripts keyed by screening-question index,
    ready to drop straight into the HR screening form.

    `resume_uuid` is optional: pass it and the communication score gets
    written onto the candidate the moment the voice service finishes grading, so
    the dashboard table keeps showing them after the modal closes. Without it
    the scores are still returned, they just aren't persisted.
    """
    session = calls.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown interview session")

    answers = _call_answers(session)

    # Post-call communication score. {"status": "pending"} while the
    # call runs, "skipped" when the candidate rescheduled instead of sitting the
    # interview. Graded by the Sarvam agent's post-call extraction
    # (`communication_score` in voice/agent_config.json).
    scores = session.get("scores") or {"status": "pending"}
    if resume_uuid and scores.get("status") == "done":
        try:
            update_metadata(resume_uuid, "resume", {"interview_scores": json.dumps(scores)})
        except HTTPException:
            pass  # unknown/removed candidate: still return the scores to the caller

    return {
        "session_id": session_id,
        "call_status": session.get("call_status", "unknown"),
        "answers": answers,
        "scores": scores,
        # Always 0: Sarvam dials concurrently. Kept for the frontend's type.
        "queue_position": session.get("queue_position", 0),
        # Why a dial failed: Sarvam refused it, or reported the call failed
        # once it ended. Without this the reason would only be in the log.
        "call_error": session.get("call_error") or "",
        # Set when the screening ended early on a rule (won't relocate, won't
        # commit to resigning). The modal already renders its own gate strip
        # from the answers; this is what the *call* decided, for the record.
        "gate_reason": session.get("gate_reason") or "",
        # An armed callback: the candidate said it was a bad time and the voice
        # service will redial **on this same session**, filling these same
        # answers. So `call_status: completed` on the first call is not the end
        # of the screening, and anything that stops watching there sees none of
        # what the redial collects. Empty once the redial has been placed.
        "callback_at": (
            session.get("reschedule_at") or ""
            if session.get("reschedule_scheduled") else ""
        ),
        # The voice service's own one-word verdict on this screening --
        # "completed", "rescheduled", "awaiting_retry", "no_answer",
        # "disconnected", ... It is computed there, from fields only it has
        # (how many dials, what the call ended as), so re-deriving it here from
        # `call_status` would be a second opinion that eventually disagrees.
        # See interview_session.compute_status.
        "status": session.get("status") or "",
        # An automatic retry the service armed itself after a missed or dropped
        # call. Distinct from `callback_at`, which is a time the CANDIDATE
        # asked for -- HR reads the two differently, so they stay separate.
        "retry_at": (
            session.get("no_answer_retry_at") or ""
            if session.get("no_answer_retry_scheduled") else ""
        ),
        # How many times we have dialled this candidate, across the first call
        # and every redial. "Called 3 times, still no answer" is the cue to
        # pick the phone up by hand.
        "call_attempts": session.get("call_placed_count", 0),
    }



def _call_answers(session: dict) -> dict:
    """A call's answers keyed by screening-question index, as the form stores them."""
    # Answers come back keyed by flow key ("relocate"), which is the same string
    # the modal stores that question under, so the mapping is a table lookup.
    # It used to be keyed by position and re-derived with `int(kv[0])` against
    # the list the call went out with — which only held while every call asked a
    # fixed list in a fixed order, and raised the moment one didn't.
    answers = {}
    for key, answer in session.get("answers", {}).items():
        if key.startswith("risk_"):
            index = RISK_INDEX_BASE + int(key[len("risk_"):] or -1)
        else:
            index = INDEX.get(key)
        if index is None:
            continue  # a question this build doesn't know — ignore, never 500
        answers[index] = {
            "transcript": answer.get("transcript") or "",
            "status": answer.get("transcript_status", "pending"),
            # This answer was never put as a question — the candidate
            # volunteered it while answering another one, and the voice service
            # filed it against the question it actually answers. The form says
            # so under the field, because a figure nobody was asked for is one
            # HR should read before saving.
            "volunteered": bool(answer.get("volunteered")),
            # What the call actually understood and branched on. The browser
            # used to re-derive this from the transcript with its own regexes
            # and could land somewhere else — showing HR a value the
            # conversation was not routed by.
            "value": _extracted_value(answer.get("extracted")),
        }
    return answers


@app.get("/resume/{resume_uuid}/download")
async def download_resume(resume_uuid: str):
    metadata = get_resume_metadata(resume_uuid)
    file_path = metadata.get("file_path", "")

    if not file_path or not Path(file_path).exists():
        raise HTTPException(
            status_code=404,
            detail="The original file for this resume was not kept. Re-upload it to download.",
        )

    return FileResponse(
        path=file_path,
        filename=metadata.get("source") or f"{resume_uuid}.pdf",
        content_disposition_type="inline",
    )


@app.delete("/resume/{resume_uuid}")
async def delete_resume(resume_uuid: str):
    metadata = get_resume_metadata(resume_uuid)

    if metadata.get("file_path"):
        Path(metadata["file_path"]).unlink(missing_ok=True)

    vector_store.delete(ids=[resume_uuid])
    print(f"[Resume] deleted uuid={resume_uuid}", flush=True)

    return {"resume_uuid": resume_uuid, "message": "Resume deleted"}


@app.get("/chatbot")
async def chatbot(user_input: str, thread_id: str = "default", resume_uuid: str = ""):
    print(f"[Chatbot] thread={thread_id} resume={resume_uuid or 'all'} question: {user_input}", flush=True)
    try:
        result = agents.chatbot_agent.invoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": user_input,
                    }
                ]
            },
            config={"configurable": {"thread_id": thread_id}},
            context=agents.ChatContext(resume_uuid=resume_uuid),
        )
    except Exception as exc:
        # The chat model is a third party: a rejected key, an exhausted quota or
        # an outage all arrived here as a bare 500 and reached the user as
        # "Sorry, I encountered an error" — true, useless, and indistinguishable
        # from a bug in this app. Say which provider failed and why.
        cfg = agents.get_config()
        provider = cfg.get("activeChatProvider", "the chat model")
        model = cfg.get("activeChatModel", "")
        text = str(exc)
        if "UNAUTHENTICATED" in text or "401" in text or "invalid_api_key" in text.lower():
            detail = (f"The {provider} API key was rejected. Add a valid key for "
                      f"{provider} under LLM settings, or switch the chat model to "
                      f"another provider.")
        elif "429" in text or "quota" in text.lower() or "rate" in text.lower():
            detail = f"The {provider} account is out of quota or rate-limited. Try again shortly."
        else:
            detail = f"{provider} ({model}) could not answer: {text[:200]}"

        print(f"[Chatbot] FAILED via {provider}/{model}: {text[:300]}", flush=True)
        raise HTTPException(status_code=502, detail=detail)

    last_message = result["messages"][-1]
    print(f"[Chatbot] reply ({len(last_message.text)} chars): {last_message.text[:120]}...", flush=True)

    return {
        "response": last_message.text
    }
