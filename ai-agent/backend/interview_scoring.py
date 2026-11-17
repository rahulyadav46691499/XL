"""Archive an AI phone screening onto the candidate, and grade how they spoke.

Runs when HR clicks Save Responses. Four things happen, in this order, each
independent of the ones after it:

  1. the call's dial tally — duration, dials placed, callbacks arranged, dials
     not picked up — is copied onto the candidate for the collective analysis
  2. the call transcript is copied into the candidate's record
  3. the call recording is copied into `interview_files/` next to the resumes
  4. the transcript goes to Mistral Medium (`SCORING_MODEL`, via LangChain)
     for a communication score, replacing the one Sarvam's agent gave at
     call end

Until then the transcript is a loose file in voice/transcripts/ and the
recording exists only at Sarvam, both keyed by session id. Copying them here
puts them in the same store as everything else about the candidate.

Every step is best-effort: HR's screening is already saved by the time this
runs, so Sarvam being unreachable or an LLM that errors must never surface as a
failed save. Failures are logged and leave the previous value in place.
"""
import json
import logging
import os

from langchain.agents import create_agent
from langchain_mistralai import ChatMistralAI
from pydantic import BaseModel, Field

from voice import calls

logger = logging.getLogger(__name__)

# Grading runs on Mistral Medium rather than the app's activeChatModel: it is
# off every critical path (nobody waits on it), and keeping it pinned here means
# switching the chat provider in llm_config.json cannot silently move the scores
# a recruiter is comparing candidates on.
SCORING_MODEL = os.getenv("SCORING_MODEL", "mistral-medium-latest")
_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "llm_config.json"
)

# Alongside resume_files/ and jd_files/, which is where the rest of the
# candidate's artefacts already live.
INTERVIEW_FILES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "interview_files")


class InterviewScores(BaseModel):
    """Structured verdict the model must return."""

    communication_score: int = Field(ge=0, le=100)
    summary: str = Field(description="One or two sentences a recruiter can act on.")


# Kept deliberately in step with the `communication_score` prompt in
# voice/agent_config.json: the same call is graded there (by Sarvam, when
# it ends) and here (when HR saves), and two different
# rubrics would make the number visibly change under the recruiter.
_PROMPT = """You are an experienced technical recruiter reviewing the transcript of a phone screening.

Rate the CANDIDATE only (never the interviewer) on one 0-100 scale:

communication_score -- clarity and relevance of what they said. Did their answers
address the questions asked, clearly enough for a recruiter to act on?

Be generous and fair, not harsh. This is a short screening call, not a presentation:
a candidate who answers the questions clearly has communicated well, and short,
direct answers are perfectly good phone manner -- do not mark someone down for being
brief, for a plain manner, or for an accent. Reserve low scores for genuine
communication problems: answers that never address the question, or speech nobody
could follow. When you are torn between two bands, give the higher one.

Calibration: 85-100 excellent, 70-84 good (most candidates who engage properly belong
here), 55-69 workable with some gaps, below 55 only for real difficulty being
understood.

Important: the transcript comes from automatic speech recognition on an 8 kHz phone
line, so it contains recognition errors. Never penalise the candidate for garbled
words, odd spellings or missing punctuation; judge what they clearly meant.

Judge only how they communicated. Their actual answers -- salary, notice period,
willingness to relocate -- are the recruiter's call to weigh, not yours, so never let
an unwelcome answer pull the score down.

Keep the summary about their communication, and phrase it constructively."""


def _mistral_key() -> str:
    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            for provider in json.load(f).get("providers", []):
                if provider.get("id") == "mistral":
                    return provider.get("apiKey", "")
    except (OSError, ValueError):
        pass
    return os.getenv("MISTRAL_API_KEY", "")


def scoring_agent():
    """A LangChain agent that returns InterviewScores and nothing else.

    `response_format` makes the model hand back a validated object rather than
    prose we would have to parse — the schema bounds each score to 0-100, so a
    model that answers "85/100" or invents a third number fails loudly here
    instead of writing nonsense next to a candidate's name.
    """
    return create_agent(
        model=ChatMistralAI(model=SCORING_MODEL, api_key=_mistral_key(), temperature=0),
        tools=[],
        system_prompt=_PROMPT,
        response_format=InterviewScores,
    )


def _has_candidate_speech(transcript: str) -> bool:
    """Did the candidate actually say anything worth grading?

    Mirrors `_NOT_SCREENING` in voice/calls.py: a call where the candidate only
    asked to be rung back is not an interview, and scoring it would put a
    meaningless number next to their name.
    """
    for line in transcript.splitlines():
        if line.startswith("[candidate]") or line.startswith("Candidate:"):
            if line.split("]", 1)[-1].split(":", 1)[-1].strip():
                return True
    return False


def call_stats(session: dict) -> dict:
    """What a candidate's calls cost, in dials and in rupees, for Collective
    analysis: per candidate across every dial and callback of the session."""
    return {
        "seconds": session.get("call_seconds", 0),
        "placed": session.get("call_placed_count", 0),
        "rescheduled": session.get("reschedule_count", 0),
        "not_picked": session.get("call_not_picked_count", 0),
        "callbacks": session.get("call_callbacks", 0),
        "cost": session.get("call_cost", 0),
    }


async def archive_and_score(
    resume_uuid: str,
    session_id: str,
    candidate_name: str,
    update_metadata,
) -> None:
    """Copy the call's transcript and recording onto the candidate, then score it.

    `update_metadata` is passed in rather than imported so this module stays
    independent of app wiring, and testable without a running Chroma.
    """
    updates: dict = {}

    # What the call cost in dials, for the dashboard's collective analysis.
    # Copied onto the candidate, like the transcript and recording, so it stays
    # with them if the session files in voice/sessions/ are cleared.
    session = calls.get(session_id)
    if session:
        updates["interview_call_stats"] = json.dumps(call_stats(session))
    else:
        logger.warning("No voice session %s to archive", session_id)

    transcript = calls.transcript_text(session_id) or ""
    if transcript:
        updates["interview_transcript"] = transcript

    try:
        audio = await calls.recording(session_id)
    except Exception as exc:  # Sarvam down must not cost the transcript and score
        logger.warning("Recording fetch failed for %s: %s", session_id, exc)
        audio = None
    if audio:
        try:
            os.makedirs(INTERVIEW_FILES_DIR, exist_ok=True)
            path = os.path.join(INTERVIEW_FILES_DIR, f"{resume_uuid}.wav")
            with open(path, "wb") as f:
                f.write(audio)
            updates["interview_recording_path"] = path
        except OSError:
            logger.exception("Could not archive recording for %s", resume_uuid)

    if transcript:
        if not _has_candidate_speech(transcript):
            updates["interview_scores"] = json.dumps({
                "status": "skipped",
                "reason": "the candidate did not answer any questions on this call",
            })
        else:
            try:
                result = await scoring_agent().ainvoke({"messages": [{
                    "role": "user",
                    "content": f"Candidate: {candidate_name or 'the candidate'}\n\n"
                               f"Transcript:\n{transcript}",
                }]})
                scores = result["structured_response"]
                updates["interview_scores"] = json.dumps({
                    "status": "done",
                    "communication_score": scores.communication_score,
                    "summary": scores.summary,
                    # Marks this as the grade HR saved, which the dashboard
                    # shows over the call's own (main.py, GET /jd/{id}/resumes).
                    "model": SCORING_MODEL,
                })
                logger.info(
                    "Scored interview for %s on %s: communication=%d",
                    resume_uuid, SCORING_MODEL, scores.communication_score,
                )
            except Exception:
                logger.exception("Scoring failed for %s", resume_uuid)

    if updates:
        try:
            update_metadata(resume_uuid, "resume", updates)
        except Exception:
            logger.exception("Could not store interview archive for %s", resume_uuid)
