"""Is the uploaded file actually a resume / a job description?

HR uploads the wrong file often enough to matter — an offer letter into the JD
slot, a payslip or a certificate into the resume batch — and the extractor will
gamely invent a candidate out of an invoice, because it was told to extract a
candidate. Nothing downstream can tell that apart afterwards: a made-up name
with a made-up match score looks exactly like a real one.

So the document is classified **before** anything expensive happens: the check
runs on the parsed text and, if the file is the wrong kind, the upload stops
there — no extraction, no embedding, nothing stored, and HR gets a sentence
naming what the file looks like instead.

The classifier is the LLM already configured for parsing
(`agents.parse_llm`), called with LangChain's structured output
(`with_structured_output`, the documented pattern for a classification with a
fixed set of answers). No second provider, no new dependency — and, being
structured, the answer is a `Literal`, not a sentence to be regex'd.

Two deliberate limits:

- Only the first `CHECK_CHARS` characters are sent. What a document *is* is
  clear from its opening; sending the rest would cost as much as the extraction
  this is meant to avoid.
- It **fails open**. If the classifier errors or times out, the upload
  continues — a wrong file getting through is a bad row HR can delete, while a
  broken classifier blocking every upload stops the hiring work outright.

ponytail: one call per file. If a 10-file batch ever feels slow, classify only
the first page of each and cache by content hash — not worth it until it bites.
"""

from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field

import agents

# Enough to tell a CV from a payslip; far short of the whole document.
CHECK_CHARS = 3000

# Below this there is nothing to judge. parse_document has already rejected
# genuinely empty files, so this is the "two lines of OCR noise" case — let it
# through and let the extractor fail on its own terms.
MIN_CHARS = 200


class DocumentCheck(BaseModel):
    """What an uploaded document actually is."""

    kind: Literal["resume", "job_description", "other"] = Field(
        description=(
            "What this document is. 'resume' for a CV or résumé — one person's own "
            "work history, education and skills. 'job_description' for a job posting "
            "or requisition — a role an employer is hiring for, with responsibilities "
            "and requirements. 'other' for anything else: an invoice, a payslip, an "
            "offer or appointment letter, a certificate, a contract, a report, a "
            "presentation, a scanned form."
        )
    )
    detail: str = Field(
        default="",
        description=(
            "Only when kind is 'other': what the document appears to be instead, as a "
            "short noun phrase of two to five words and nothing else — for example "
            "'an invoice', 'a salary slip', 'a training certificate'. Empty string "
            "when kind is 'resume' or 'job_description'."
        ),
    )


SYSTEM_PROMPT = (
    "You classify uploaded documents for a recruitment tool. Decide what the "
    "document below IS, from its own content — not what it mentions. A CV that "
    "lists the jobs someone has held is a resume, not a job description; a "
    "posting that lists the skills a candidate should have is a job description, "
    "not a resume. An offer letter, appointment letter, payslip, invoice, "
    "certificate or contract is 'other' even though it names a person and a job "
    "title. Answer with the classification only."
)

# What HR calls each kind, for the message they read.
LABELS = {"resume": "a resume", "job_description": "a job description"}


def verify_document(text: str, expected: str, filename: str) -> None:
    """Stop the upload unless `text` is the kind of document `expected` says.

    Raises 422 with a sentence written for HR: which file, what it looks like,
    and what to upload instead. Returns silently in every other case, including
    when the classifier itself is unavailable — see the fail-open note above.
    """
    if len(text) < MIN_CHARS:
        return

    try:
        classifier = agents.parse_llm.with_structured_output(DocumentCheck)
        result: DocumentCheck = classifier.invoke(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": text[:CHECK_CHARS]},
            ]
        )
    except Exception as exc:
        print(f"[Check] classifier unavailable for '{filename}', letting it through: {exc!r}", flush=True)
        return

    print(f"[Check] '{filename}' looks like {result.kind}"
          f"{' (' + result.detail + ')' if result.detail else ''}, expected {expected}", flush=True)

    if result.kind == expected:
        return

    wanted = LABELS[expected]
    if result.kind in LABELS:
        # The other one of the two — the most common mistake, and the most
        # useful message, because it names the mix-up exactly.
        looks_like = LABELS[result.kind]
    else:
        looks_like = (result.detail or "").strip() or "something else"

    raise HTTPException(
        status_code=422,
        detail=(
            f"This does not look like {wanted} — it looks like {looks_like}. "
            f"Nothing was analyzed or saved. Upload {wanted} and try again."
        ),
    )


if __name__ == "__main__":
    # python3 document_check.py — no LLM involved: the checks below cover the
    # branching around the call, which is where the behaviour lives.
    class _Stub:
        def __init__(self, kind, detail=""):
            self.kind, self.detail = kind, detail

        def with_structured_output(self, _schema):
            return self

        def invoke(self, _messages):
            return DocumentCheck(kind=self.kind, detail=self.detail)

    class _Broken:
        def with_structured_output(self, _schema):
            raise RuntimeError("no api key")

    long_text = "x" * (MIN_CHARS + 10)
    real = agents.parse_llm

    try:
        agents.parse_llm = _Stub("resume")
        verify_document(long_text, "resume", "cv.pdf")  # right kind, no raise

        try:
            verify_document(long_text, "job_description", "cv.pdf")
            raise AssertionError("a resume in the JD slot must be refused")
        except HTTPException as exc:
            assert "looks like a resume" in exc.detail, exc.detail
            assert "Upload a job description" in exc.detail, exc.detail

        agents.parse_llm = _Stub("other", "an invoice")
        try:
            verify_document(long_text, "resume", "bill.pdf")
            raise AssertionError("an invoice in the resume batch must be refused")
        except HTTPException as exc:
            assert "looks like an invoice" in exc.detail, exc.detail

        # 'other' with no detail must still read as a sentence.
        agents.parse_llm = _Stub("other")
        try:
            verify_document(long_text, "resume", "mystery.pdf")
            raise AssertionError("unknown document must be refused")
        except HTTPException as exc:
            assert "looks like something else" in exc.detail, exc.detail

        # Fail-open: a classifier that cannot run must not block the upload.
        agents.parse_llm = _Broken()
        verify_document(long_text, "resume", "cv.pdf")

        # Too short to judge — no call is made at all, so the broken stub above
        # would raise if this tried.
        verify_document("two lines", "resume", "scan.pdf")
    finally:
        agents.parse_llm = real

    print("document_check: all checks passed")
