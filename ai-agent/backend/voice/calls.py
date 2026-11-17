"""AI phone screening on Sarvam Voice Agents: sessions, dialling, results.

Runs inside the backend process. It was a separate service on :8080 until
2026-10-17; folding it in removed a process and an untyped HTTP hop, and kept
the JSON shapes app/main.py reads (`public()`, pinned by check.py).

The phone call itself -- dialling, listening (Saaras v4), deciding what to say,
speaking (Bulbul v4) -- runs on Sarvam's managed Voice Agents platform, in the
agent `SARVAM_AGENT_ID` (prompt and config: agent_prompt.md, agent_config.json).
There is no audio and no LLM here. What is left is the part only TalentAI knows:

  app/main.py --place()--> here --Instant Outbound--> Sarvam --> phone
  app/main.py <--get()---- here <--call-end webhook--- Sarvam

**A session outlives one call.** A callback the candidate asked for, a redial
after a missed or dropped call, and the candidate ringing back all land on the
same session and merge into the same answers, so the first call ending is not
the end of the screening. Each later call asks only what is still unanswered
(script.render with known_answers), and hands the agent the rest as
`answers_so_far`; with nothing left, the agent offers help instead.

**`status` is computed on read** (compute_status), never stored, so it cannot
drift from the fields behind it. Show `status` to HR, never `call_status`.

Results arrive on the webhook (`router`, mounted by app/main.py). If it never
does -- PUBLIC_URL unset, tunnel down -- the scheduler (`lifespan`) reads the
same result back from Sarvam's analytics API, so a finished screening is never
lost to one undelivered POST.

**The voice HR picks is the voice the candidate hears.** Instant Outbound
cannot set a voice per call, so each voice in VOICES is its own committed
version of the agent, identical but for the voice; a call dials the version of
its voice, and passes that voice's name as `agent_name` so the persona matches.

**A candidate can ring the number back.** The inbound deployment
`SARVAM_DEPLOYMENT_ID` answers the agent's number, and every candidate dialled
is put on its known-caller list with their session's script, so a callback
carries the screening on. Its result is read off Sarvam's analytics (inbound
calls have no per-call webhook to point at a session) and filed under the
caller's session, like a redial.

Not carried over from the old Twilio service, a limit of Sarvam rather than a
choice: live per-turn answers (Sarvam extracts them once the call ends).
"""
import asyncio
import json
import logging
import math
import os
import re
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse

from . import sarvam, script

load_dotenv()  # backend/.env; sarvam reads it at call time

logger = logging.getLogger("voice")
if not logger.handlers:  # its own handler: the backend leaves the root logger unconfigured
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

BASE = os.path.dirname(os.path.abspath(__file__))
SESSIONS_DIR = os.path.join(BASE, "sessions")
TRANSCRIPTS_DIR = os.path.join(BASE, "transcripts")
# India has no DST, so a fixed offset is exact -- and, unlike ZoneInfo, needs no
# tzdata package on Windows, where a missing one would stop the whole backend.
IST = timezone(timedelta(hours=5, minutes=30), "IST")

MAX_CALL_ATTEMPTS = int(os.getenv("MAX_CALL_ATTEMPTS", "3"))
RETRY_FIRST_MINUTES = float(os.getenv("NO_ANSWER_RETRY_DELAY_MINUTES", "15"))
RETRY_NEXT_HOURS = float(os.getenv("NO_ANSWER_NEXT_DAY_DELAY_HOURS", "24"))
TICK_SECONDS = float(os.getenv("RESCHEDULE_CHECK_INTERVAL", "5"))
# Redials whose time we choose (a retry after a miss, a callback with no time
# given) ring only in these hours, IST: Sarvam's "respect calling windows". A time the candidate asked for is kept as asked, and HR's
# own click dials when HR clicks.
CALL_HOURS = (int(os.getenv("CALL_WINDOW_START_HOUR", "9")), int(os.getenv("CALL_WINDOW_END_HOUR", "21")))
# A dial with no webhook after this long is looked up in Sarvam's analytics.
POLL_AFTER = timedelta(minutes=float(os.getenv("RESULT_POLL_AFTER_MINUTES", "3")))
POLL_EVERY = timedelta(seconds=60)
# ...and given up on after this long: Sarvam caps a call at 15 minutes
# (max_interaction_time_seconds=900 on the agent), so an hour is never a live call.
GIVE_UP_AFTER = timedelta(minutes=float(os.getenv("RESULT_GIVE_UP_MINUTES", "60")))
# The voices HR can pick, each pinned to the committed agent version that
# speaks in it (text_to_speech_config.internal_id, from the Voice Agents
# voice catalogue). `id` is the same voice's twin on the TTS API, Bulbul v4
# Flash, matched by persona and style name: it is what the preview plays, and
# what the browser remembers. All six speak English and Hindi.
# ponytail: one agent version per voice, so any change to the agent is
# committed once per voice and every `version` here bumped (SETUP.md §4).
# A per-call voice override in Instant Outbound would retire the column.
VOICES = [
    {"id": "simran_enhi_customer", "name": "Simran", "gender": "female", "version": 27,
     "internal_id": "01a0cf17-12bd-7de3-9df0-f607db604d52", "tone": "warm, brisk Hinglish support agent"},
    {"id": "ishita_enhi_customer", "name": "Ishita", "gender": "female", "version": 28,
     "internal_id": "01a0cf17-0b6e-79f0-b8ab-7392cabc497b", "tone": "warm, soft Hinglish support agent"},
    {"id": "shalini_enhi_customer", "name": "Shalini", "gender": "female", "version": 29,
     "internal_id": "01a0cf16-a0c0-76f9-8d2e-79635434a78a", "tone": "warm, expressive Hinglish support agent"},
    {"id": "sunny_enhi_customer", "name": "Sunny", "gender": "male", "version": 30,
     "internal_id": "01a0cf17-0379-7e04-9e7f-9955e5a97657", "tone": "warm, soft-spoken Hinglish support agent"},
    {"id": "shubh_enhi_banking", "name": "Shubh", "gender": "male", "version": 31,
     "internal_id": "01a0cf16-a571-7451-a420-be5f97e71f71", "tone": "expressive Hinglish banking agent"},
    {"id": "shubh_enhi_companion", "name": "Shubh", "gender": "male", "version": 32,
     "internal_id": "01a0e8fc-9123-73bb-bd4e-04df4741957a", "tone": "low, lively Hinglish voice"},
]
DEFAULT_VOICE = VOICES[0]["id"]
_VOICE = {v["id"]: v for v in VOICES}
PREVIEW_TEXT = ("Hi, this is {name} from EXL's hiring team, calling about your "
                "application. Is this the right time to talk?")
# The questions that make a call an interview. A call that only agreed a
# callback has nothing to score.
_NOT_SCREENING = {"right_time", "callback_time"}
# Callbacks are looked up this far back, every POLL_EVERY.
# ponytail: a callback that ends while the backend is down for longer than this
# is never filed. Persist the last lookup time if that ever matters.
INBOUND_LOOKBACK = timedelta(hours=24)
_inbound_polled_at: datetime | None = None
WEBHOOK_PATH = "/api/sarvam/webhook"
# What a call costs, in rupees, from docs.sarvam.ai/voice-agents/pricing (read
# 2026-11-05): agent minutes in whole 60s pulses plus Sarvam telephony (Vobiz,
# our connection's provider) in 30s pulses, each rounded up, and nothing for a
# call that never connected. Pay-as-you-go by default; set your plan's rate, and
# telephony 0 if the number is your own provider's.
RATE_PER_MINUTE = float(os.getenv("SARVAM_RATE_PER_MINUTE", "3.5"))
TELEPHONY_PER_PULSE = float(os.getenv("SARVAM_TELEPHONY_PER_PULSE", "0.2"))
# Before this account's first call; the usage lookup reads everything after it.
USAGE_SINCE = datetime(2025, 1, 1, tzinfo=timezone.utc)

_lock = threading.Lock()  # ponytail: one process, one lock; a DB if this ever scales out


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str:
    return dt.astimezone(IST).isoformat(timespec="seconds") if dt else ""


def _parse(value: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(str(value).strip())
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=IST)


def _in_hours(at: datetime) -> datetime:
    """`at`, or the next start of CALL_HOURS when it falls outside them."""
    local, (start, end) = at.astimezone(IST), CALL_HOURS
    if local.hour >= end:
        local += timedelta(days=1)
    if not start <= local.hour < end:
        local = local.replace(hour=start, minute=0, second=0, microsecond=0)
    return local


def _utc(value: str) -> datetime | None:
    """An analytics timestamp: naive, but UTC (start_datetime 11:21:23 for a
    call that began at 16:51:23 IST, 2026-10-17), unlike our own naive times."""
    try:
        dt = datetime.fromisoformat(str(value).strip())
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ── Session store: one JSON file per session ───────────────────────────────
def _path(session_id: str) -> str:
    return os.path.join(SESSIONS_DIR, f"{session_id}.json")


def load(session_id: str) -> dict | None:
    if not session_id.isalnum():
        return None
    try:
        with open(_path(session_id), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def save(session: dict) -> None:
    os.makedirs(SESSIONS_DIR, exist_ok=True)
    tmp = _path(session["session_id"]) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(session, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _path(session["session_id"]))  # atomic: a crash never half-writes


def all_sessions() -> list[dict]:
    os.makedirs(SESSIONS_DIR, exist_ok=True)
    out = []
    for name in os.listdir(SESSIONS_DIR):
        if name.endswith(".json"):
            s = load(name[:-5])
            if s:
                out.append(s)
    return out


def compute_status(s: dict) -> str:
    """The one word a recruiter reads. Same vocabulary as before, so
    frontend/lib/call-status.ts needs nothing new:
    queued, in_progress, rescheduled, awaiting_retry, completed,
    not_interested, disconnected, no_answer, failed, cancelled."""
    if s.get("outcome") == "completed":
        return "completed"
    if s.get("outcome") == "not_interested":
        return "not_interested"
    if s.get("call_status") == "in_progress":
        return "in_progress"
    if s.get("cancelled"):
        return "cancelled"
    if s.get("reschedule_scheduled"):
        return "rescheduled"
    if s.get("no_answer_retry_scheduled"):
        return "awaiting_retry"
    if not s.get("call_placed_count"):
        return "failed" if s.get("call_error") else "queued"
    call_status = s.get("call_status")
    if call_status in ("no_answer", "busy"):
        return "no_answer"
    if call_status == "connected":
        return "disconnected"  # answered, but ended without a finish or a callback
    return "failed"


# Sarvam's attempt status -> the `call_status` words the frontend has always
# read: its CALL_ENDED (frontend/lib/api.ts) stops the HR modal's poll on the
# terminal ones, so a Sarvam word there ("connected") would poll forever.
# Sarvam sends no ringing/answered events, so a live dial is "in-progress"
# throughout. check.py pins this against CALL_ENDED.
WIRE_CALL_STATUS = {"queued": "queued", "in_progress": "in-progress", "connected": "completed",
                    "no_answer": "no-answer", "busy": "busy", "failed": "failed"}


def wire_call_status(s: dict) -> str:
    return WIRE_CALL_STATUS.get(s.get("call_status", "queued"), "failed")


def next_call_at(s: dict) -> str:
    if s.get("reschedule_scheduled"):
        return s.get("reschedule_at", "")
    if s.get("no_answer_retry_scheduled"):
        return s.get("no_answer_retry_at", "")
    return ""


def cost(seconds: float, phone: bool = True) -> float:
    """Rupees for one connected call. A connected call bills at least one pulse
    however short; a playground call (`phone=False`) has no telephony leg."""
    seconds = max(float(seconds or 0), 1)
    return (math.ceil(seconds / 60) * RATE_PER_MINUTE
            + (math.ceil(seconds / 30) * TELEPHONY_PER_PULSE if phone else 0))


def call_cost(s: dict) -> float:
    """What this session's calls cost so far, both directions."""
    if "calls" not in s:  # a session from before calls were recorded one by one
        return cost(s["call_seconds"]) if s.get("call_seconds") else 0.0
    return sum(cost(c["seconds"]) for c in s["calls"] if c["status"] == "connected")


def public(s: dict) -> dict:
    """What `get()` returns: every field app/main.py and interview_scoring.py read by name."""
    return {
        "session_id": s["session_id"],
        "candidate_name": s["candidate_name"],
        "phone_number": s["phone_number"],
        "answers": s.get("answers", {}),
        "call_status": wire_call_status(s),
        "status": compute_status(s),
        "scores": s.get("scores") or {"status": "pending"},
        "queue_position": 0,  # Sarvam dials concurrently: there is no queue
        "call_error": s.get("call_error", ""),
        "gate_reason": "",
        "reschedule_at": s.get("reschedule_at", ""),
        "reschedule_scheduled": bool(s.get("reschedule_scheduled")),
        "reschedule_count": s.get("reschedule_count", 0),
        "no_answer_retry_at": s.get("no_answer_retry_at", ""),
        "no_answer_retry_scheduled": bool(s.get("no_answer_retry_scheduled")),
        "call_placed_count": s.get("call_placed_count", 0),
        "call_not_picked_count": s.get("call_not_picked_count", 0),
        "call_seconds": round(s.get("call_seconds", 0)),
        "call_callbacks": len(s.get("inbound_ids", [])),
        "call_cost": round(call_cost(s), 2),
    }


# ── Results ────────────────────────────────────────────────────────────────
def _schedule_retry(s: dict) -> None:
    """After a miss or a drop: soon, then tomorrow, then stop. Counted across
    every dial of the session, callbacks included."""
    placed = s.get("call_placed_count", 0)
    if placed >= MAX_CALL_ATTEMPTS:
        s["call_exhausted"] = True
        return
    delay = timedelta(minutes=RETRY_FIRST_MINUTES) if placed <= 1 else timedelta(hours=RETRY_NEXT_HOURS)
    s["no_answer_retry_at"] = _iso(_in_hours(_now() + delay))
    s["no_answer_retry_scheduled"] = True


def _write_transcript(s: dict) -> None:
    lines = [
        f"Candidate: {s['candidate_name']}",
        f"Phone: {s['phone_number']}",
        f"Session: {s['session_id']}",
        f"Status: {compute_status(s)}",
        "-" * 60, "",
    ]
    for n, key in enumerate([k for k in script.ASK_ORDER if k in s.get("answers", {})], 1):
        a = s["answers"][key]
        lines.append(f"Q{n} [{key}]: {s['questions'].get(key, key)}")
        lines.append(f"A: {a['transcript']}")
        if a["extracted"].get("value"):
            lines.append(f"   (understood as: {a['extracted']['value']})")
        lines.append("")
    for n, call in enumerate(s.get("conversations", []), 1):
        kind = "Callback from the candidate" if call.get("inbound") else "Call"
        lines.append(f"--- {kind} {n} ({call['at']}) ---")
        for turn in call["turns"]:
            who = "Candidate" if turn.get("role") == "user" else "Agent"
            lines.append(f"{who}: {turn.get('en_text', '')}")
        lines.append("")
    os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)
    with open(os.path.join(TRANSCRIPTS_DIR, f"{s['session_id']}.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def apply_result(s: dict, result: dict) -> bool:
    """Fold one finished attempt into its session. Shape: Sarvam's webhook
    payload (docs.sarvam.ai/voice-agents/api/instant-outbound/webhook-payload).
    False when it is not for the attempt in flight -- Sarvam retries
    deliveries, and the poller may race the webhook -- so it is applied once."""
    if result.get("attempt_id") != s.get("attempt_id") or s.get("call_status") != "in_progress":
        return False
    status = result.get("status")
    status = status if status in ("connected", "no_answer", "busy", "failed") else "failed"
    s["call_status"] = status
    s["call_seconds"] = s.get("call_seconds", 0) + float(result.get("duration") or 0)
    # One row per attempt, for what it cost and the dashboard calendar.
    s.setdefault("calls", []).append({"at": s.get("dialed_at", ""), "status": status,
                                      "seconds": round(float(result.get("duration") or 0), 1)})

    if status != "connected":
        if status == "failed":
            s["call_error"] = result.get("failure_reason") or "Sarvam could not place the call"
        else:
            s["call_not_picked_count"] = s.get("call_not_picked_count", 0) + 1
            _schedule_retry(s)
        return True

    _apply_conversation(s, result.get("final_agent_variables") or {},
                        result.get("interaction_transcript"), result.get("interaction_id"))
    return True


def apply_inbound(s: dict, row: dict, turns: list) -> bool:
    """Fold a call the candidate made to us into their session. `row` is the
    call's analytics row (api/analytics/attempts). False if already filed: the
    poller sees the same row on every pass for INBOUND_LOOKBACK."""
    interaction_id = row.get("interaction_id")
    if not interaction_id or interaction_id in s.get("inbound_ids", []):
        return False
    s.setdefault("inbound_ids", []).append(interaction_id)
    s["call_seconds"] = s.get("call_seconds", 0) + float(row.get("duration_in_seconds") or 0)
    s.setdefault("calls", []).append({"at": _iso(_utc(row.get("start_datetime"))), "status": "connected",
                                      "seconds": round(float(row.get("duration_in_seconds") or 0), 1),
                                      "inbound": True})
    # They reached us, so whatever redial was pending is superseded; this
    # call's own outcome arms a new one if it needs one.
    s.update(reschedule_scheduled=False, no_answer_retry_scheduled=False)
    _apply_conversation(s, row.get("agent_variables") or {}, turns, interaction_id, inbound=True)
    return True


def _apply_conversation(s: dict, variables: dict, turns: list | None, interaction_id: str | None,
                        inbound: bool = False) -> None:
    """A connected conversation, either direction: answers, outcome, score."""
    if interaction_id:
        s["interaction_id"] = interaction_id
    s.setdefault("answers", {}).update(script.parse_answers(variables.get("answers_json")))
    s.setdefault("conversations", []).append(
        {"at": _iso(_now()), "turns": turns or [], **({"inbound": True} if inbound else {})})

    outcome = variables.get("screening_outcome") or "incomplete"
    s["outcome"] = outcome
    if outcome == "callback_requested":
        at = _parse(variables.get("callback_at", ""))
        # A time in the past, or none at all, still gets a callback rather than
        # being dropped: the candidate asked for one.
        if not at or at <= _now() + timedelta(minutes=1):
            at = _in_hours(_now() + timedelta(hours=RETRY_NEXT_HOURS))
        s["reschedule_at"] = _iso(at)
        s["reschedule_scheduled"] = True
        s["reschedule_count"] = s.get("reschedule_count", 0) + 1
    elif outcome == "incomplete":
        _schedule_retry(s)

    if set(s["answers"]) - _NOT_SCREENING:
        try:
            score = max(0, min(100, int(str(variables.get("communication_score")).strip())))
            s["scores"] = {"status": "done", "communication_score": score,
                           "summary": str(variables.get("communication_summary") or "").strip()}
        except (TypeError, ValueError):
            s["scores"] = {"status": "skipped", "reason": "Sarvam returned no communication score"}
    else:
        s["scores"] = {"status": "skipped",
                       "reason": "the candidate did not answer any screening questions on this call"}


# ── Dialling ───────────────────────────────────────────────────────────────
def _webhook_url() -> str:
    base = os.getenv("PUBLIC_URL", "").strip().rstrip("/")
    return f"{base}{WEBHOOK_PATH}" if base else ""


def _webhook_token() -> str:
    """Echoed back by Sarvam in webhook_config.metadata; a POST without it is not Sarvam's."""
    return os.getenv("WEBHOOK_SECRET", "") or uuid.uuid5(
        uuid.NAMESPACE_URL, "talentai:" + os.getenv("SARVAM_VOICE_AGENTS_API_KEY", "")).hex


def _call_inputs(s: dict, voice: dict, callback: bool = False) -> tuple[dict, str]:
    """This call's agent variables (agent_config.json) and greeting, from the
    session as it stands now: the script holds only what is still unanswered,
    routed the way the earlier answers went. A callback drops the "is now a good
    time" pair -- they rang us."""
    asked = ({k: v for k, v in s["questions"].items() if k not in script.PER_CALL}
             if callback else s["questions"])
    answers = s.get("answers", {})
    known = script.known_answers(answers)
    variables = {
        "candidate_name": s["candidate_name"], "jd_role": s["jd_role"],
        "primary_location": s["primary_location"], "jd_description": s["jd_description"],
        "candidate_profile": s.get("candidate_profile", ""),
        "call_script": script.render(asked, s["primary_location"], known) or script.NOTHING_LEFT,
        "answers_so_far": script.answered(s["questions"], answers),
        "agent_name": voice["name"],
    }
    return variables, script.greeting(s["candidate_name"], s["jd_role"], asked, voice["name"],
                                      callback=callback, known=known)


def _voice(s: dict) -> dict:
    # A session from before voices could be picked, or one whose voice has
    # since left VOICES, speaks in the default rather than failing its redial.
    return _VOICE.get(s.get("voice", ""), _VOICE[DEFAULT_VOICE])


async def dial(session_id: str) -> None:
    with _lock:
        s = load(session_id)
        if not s or s.get("call_status") == "in_progress" or s.get("cancelled"):
            return
        s.update(call_status="in_progress", outcome="", call_error="",
                 reschedule_scheduled=False, no_answer_retry_scheduled=False,
                 attempt_id="", dialed_at=_iso(_now()), last_polled_at="")
        save(s)
    voice = _voice(s)
    variables, greeting = _call_inputs(s, voice)
    try:
        attempt_id = await sarvam.place_call(
            s["phone_number"], voice["version"], variables, greeting,
            _webhook_url(), {"session_id": session_id, "token": _webhook_token()},
        )
    except Exception as exc:  # noqa: BLE001 -- any failure must reach HR, not just the log
        logger.error("Dial failed for %s: %s", session_id, exc)
        with _lock:
            s = load(session_id)
            s.update(call_status="failed", call_error=str(exc)[:300])
            save(s)
        return
    with _lock:
        s = load(session_id)
        s["attempt_id"] = attempt_id
        s["call_placed_count"] = s.get("call_placed_count", 0) + 1
        save(s)
    logger.info("Dialled %s for session %s (attempt %s)", masked(s["phone_number"]), session_id, attempt_id)


async def add_known_caller(s: dict) -> None:
    """Let the candidate ring back: their number on the inbound deployment's
    known callers, with what is left of their screening, so a callback carries
    on from there. Uploaded when the session opens and again after every call
    that may have changed its answers. The deployment answers in one voice, the
    default's version, so that is the persona the record names. Best effort: a
    call must never fail over its callback. No-op without a deployment.

    ponytail: every upload is a new list (Sarvam cannot update or delete one),
    and which of several lists for one number Sarvam uses is undocumented and
    untested. If it is the oldest, a callback gets the first script and asks
    everything again; answers still merge correctly either way.
    """
    if not sarvam.env("SARVAM_DEPLOYMENT_ID"):
        return
    key = _digits(s["phone_number"])
    newest = _newest([x for x in all_sessions() if _digits(x["phone_number"]) == key])
    if newest and newest["session_id"] != s["session_id"]:
        return  # callbacks file under the newest screening, so its record must stay the last uploaded
    variables, greeting = _call_inputs(s, _VOICE[DEFAULT_VOICE], callback=True)
    try:
        await sarvam.add_known_caller(f"talentai-{s['session_id']}", s["phone_number"],
                                      variables, greeting)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not add session %s as a known caller: %s", s["session_id"], exc)


def _digits(phone: str) -> str:
    # ponytail: the last ten digits, so +91 98765 43210 and 098765 43210 match.
    # Indian numbers only; compare in full if candidates are ever abroad.
    return re.sub(r"\D", "", phone or "")[-10:]


def masked(phone: str) -> str:
    """A number fit for a log line: Sarvam's Analytics docs ask that full
    contacts be kept out of logs, so only the last four digits, as their own
    user_contact_masked does."""
    return "******" + _digits(phone)[-4:]


def _newest(sessions: list[dict], at: datetime | None = None) -> dict | None:
    """The newest of one number's sessions, or the newest as of `at`. A callback
    belongs to the screening that was open when they rang, never one opened
    after it (another job on the same number, or every test call going to one
    phone): filed by "newest now", a callback made at 16:51 landed in a session
    opened at 17:22, with another candidate's answers and a redial of its own."""
    mine = [s for s in sessions if at is None or (_parse(s.get("created_at", "")) or at) <= at]
    return max(mine, key=lambda s: s.get("created_at", ""), default=None)


async def _poll_inbound() -> None:
    """File each finished callback under the caller's newest session as of the
    call (`_newest`). By number,
    because a deployment's known-caller record cannot carry our session id."""
    try:
        rows = await sarvam.inbound_attempts(_now() - INBOUND_LOOKBACK)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Callback lookup failed: %s", exc)
        return
    by_phone: dict[str, list[dict]] = {}
    for s in all_sessions():
        by_phone.setdefault(_digits(s["phone_number"]), []).append(s)
    for row in rows:
        variables = row.get("agent_variables") or {}
        # Not answered, or Sarvam's post-call extraction has not run yet.
        if row.get("connectivity_status") != "connected" or not variables.get("screening_outcome"):
            continue
        s = _newest(by_phone.get(_digits(row.get("user_contact")), []), _utc(row.get("start_datetime")))
        if not s or row.get("interaction_id") in s.get("inbound_ids", []):
            continue  # a stranger, or already filed
        turns = []
        try:
            turns = await sarvam.transcript(row["interaction_id"])
        except Exception as exc:  # noqa: BLE001 -- answers matter more than the transcript
            logger.warning("Callback transcript fetch failed for %s: %s", s["session_id"], exc)
        with _lock:
            fresh = load(s["session_id"])
            filed = bool(fresh) and apply_inbound(fresh, row, turns)
            if filed:
                save(fresh)
                _write_transcript(fresh)
                logger.info("Callback filed under session %s: %s", fresh["session_id"],
                            fresh.get("outcome"))
        if filed:
            await add_known_caller(fresh)


async def _poll(s: dict) -> None:
    """Recover a result whose webhook never arrived, from Sarvam's analytics."""
    dialed = _parse(s.get("dialed_at", ""))
    if not s.get("attempt_id") or not dialed:
        return
    try:
        row = await sarvam.find_attempt(s["attempt_id"], dialed)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Attempt lookup failed for %s: %s", s["session_id"], exc)
        row = None
    result = None
    status = (row or {}).get("connectivity_status")
    variables = (row or {}).get("agent_variables") or {}
    # A connected row is only final once Sarvam's post-call extraction has run.
    if status and (status != "connected" or variables.get("screening_outcome")):
        result = {"attempt_id": s["attempt_id"], "status": status,
                  "duration": row.get("duration_in_seconds"),
                  "interaction_id": row.get("interaction_id"),
                  "failure_reason": None if row.get("failure_reason") == "NO_FAILURE_REASON"
                  else row.get("failure_reason"),
                  "final_agent_variables": variables, "interaction_transcript": []}
        if row.get("interaction_id"):
            try:
                result["interaction_transcript"] = await sarvam.transcript(row["interaction_id"])
            except Exception as exc:  # noqa: BLE001 -- answers matter more than the transcript
                logger.warning("Transcript fetch failed for %s: %s", s["session_id"], exc)
    elif _now() - dialed > GIVE_UP_AFTER:
        result = {"attempt_id": s["attempt_id"], "status": "failed",
                  "failure_reason": "No result came back from Sarvam for this call."}
    with _lock:
        fresh = load(s["session_id"])
        fresh["last_polled_at"] = _iso(_now())
        applied = bool(result) and apply_result(fresh, result)
        if applied:
            _write_transcript(fresh)
            logger.info("Recovered result for %s by polling: %s", fresh["session_id"], result["status"])
        save(fresh)
    if applied and result["status"] == "connected":
        await add_known_caller(fresh)


async def tick() -> None:
    """One pass of the scheduler: due redials, overdue results, then callbacks."""
    global _inbound_polled_at
    now = _now()
    for s in all_sessions():
        due = _parse(next_call_at(s))
        if due and due <= now and not s.get("cancelled"):
            await dial(s["session_id"])
        elif s.get("call_status") == "in_progress" and not s.get("attempt_id"):
            dialed = _parse(s.get("dialed_at", ""))
            if dialed and now - dialed > timedelta(minutes=2):  # crashed mid-dial
                with _lock:
                    fresh = load(s["session_id"])
                    fresh.update(call_status="failed", call_error="The dial did not complete; place the call again.")
                    save(fresh)
        elif s.get("call_status") == "in_progress" and s.get("attempt_id"):
            dialed = _parse(s.get("dialed_at", ""))
            polled = _parse(s.get("last_polled_at", ""))
            if dialed and now - dialed > POLL_AFTER and (not polled or now - polled > POLL_EVERY):
                await _poll(s)
    if sarvam.env("SARVAM_DEPLOYMENT_ID") and (
            not _inbound_polled_at or now - _inbound_polled_at > POLL_EVERY):
        _inbound_polled_at = now
        await _poll_inbound()


async def _scheduler() -> None:
    while True:
        try:
            await tick()
        except Exception:  # noqa: BLE001 -- one bad session must not stop every redial
            logger.exception("Scheduler pass failed")
        await asyncio.sleep(TICK_SECONDS)


@asynccontextmanager
async def lifespan(_app):
    """The backend's lifespan: runs the redial/poll scheduler while it is up."""
    missing = sarvam.missing_config()
    if missing:
        logger.warning("AI phone calls will fail until backend/.env has: %s", ", ".join(missing))
    if not _webhook_url():
        logger.warning("PUBLIC_URL unset: call results will arrive by polling Sarvam, "
                       "%s after each call", POLL_AFTER)
    if not sarvam.env("SARVAM_DEPLOYMENT_ID"):
        logger.warning("SARVAM_DEPLOYMENT_ID unset: candidates who ring back go unanswered")
    task = asyncio.create_task(_scheduler()) if os.getenv("DISABLE_SCHEDULER") != "1" else None
    yield
    if task:
        task.cancel()


# ── What app/main.py calls ─────────────────────────────────────────────────
async def place(candidates: list[dict]) -> list[str]:
    """Open a session per candidate and dial each. Returns the session ids,
    positionally aligned with `candidates`.

    Each candidate: candidate_name, phone_number, jd_role, primary_location,
    jd_description, candidate_profile (the resume in brief), questions
    ({flow key: sentence}) and speaker (a VOICES id, empty for the default), as
    prepare_call builds them.
    """
    missing = sarvam.missing_config()
    if missing:  # say what to fix, before a session exists that can only ever fail
        raise HTTPException(503, "AI phone calls are not set up yet: fill in "
                                 + ", ".join(missing) + " in backend/.env (see SETUP.md).")
    sessions = []
    for c in candidates:  # all validated before any is saved, so a 400 leaves nothing queued
        asked = {k: v for k, v in c["questions"].items() if k in script.FLOW and v.strip()}
        if not asked:
            raise HTTPException(400, f"No askable questions for {c['candidate_name']}.")
        voice = c.get("speaker") or DEFAULT_VOICE
        if voice not in _VOICE:
            raise HTTPException(400, f"Unknown voice {voice!r}. Pick one from the voice list.")
        sessions.append({
            "session_id": uuid.uuid4().hex[:12],
            "created_at": _iso(_now()),
            "candidate_name": c["candidate_name"], "phone_number": c["phone_number"],
            "jd_role": c.get("jd_role") or "this role",
            "primary_location": c.get("primary_location", ""),
            "jd_description": c.get("jd_description", ""), "questions": asked,
            "candidate_profile": c.get("candidate_profile", ""),
            "voice": voice,
            "call_status": "queued", "call_placed_count": 0, "answers": {},
            "scores": {"status": "pending"},
        })
    with _lock:
        for s in sessions:
            save(s)
    # Dialled here, one after another, rather than in background tasks: each
    # dial's real outcome (a refusal is already call_error on the session) is
    # there by the time the caller reads the session, and a bulk batch does not
    # hit Sarvam's rate limit all at once. ~0.5s per dial.
    for s in sessions:
        await dial(s["session_id"])
        await add_known_caller(s)
    return [s["session_id"] for s in sessions]


def get(session_id: str) -> dict | None:
    s = load(session_id)
    return public(s) if s else None


def active() -> dict:
    """The dashboard's one-request poll: every session still in play."""
    out = {}
    for s in all_sessions():
        status = compute_status(s)
        if status in ("queued", "in_progress", "rescheduled", "awaiting_retry"):
            out[s["session_id"]] = {"call_status": wire_call_status(s),
                                    "queue_position": 0, "status": status,
                                    "next_call_at": next_call_at(s),
                                    "call_attempts": s.get("call_placed_count", 0)}
    return {"sessions": out}


def schedule() -> dict:
    """The dashboard calendar: every call made or taken, the one on the line now,
    and every redial still to come. Times are IST ISO strings, so they sort."""
    events = []
    for s in all_sessions():
        who = {"session_id": s["session_id"], "candidate_name": s["candidate_name"],
               "jd_role": s.get("jd_role", "")}
        for c in s.get("calls", []):
            if c.get("at"):
                events.append({**who, "at": c["at"], "seconds": c["seconds"], "status": c["status"],
                               "kind": "callback" if c.get("inbound") else "call"})
        if s.get("call_status") == "in_progress" and s.get("dialed_at"):
            events.append({**who, "at": s["dialed_at"], "seconds": 0, "status": "in_progress",
                           "kind": "call"})
        if next_call_at(s) and not s.get("cancelled"):
            events.append({**who, "at": next_call_at(s), "seconds": 0, "status": "scheduled",
                           "kind": "rescheduled" if s.get("reschedule_scheduled") else "retry"})
    return {"events": sorted(events, key=lambda e: e["at"])}


async def usage() -> dict:
    """What the agent's calls have cost the account, and the credit left.

    Read off Sarvam's analytics rather than our sessions, so playground calls
    and anything placed outside TalentAI count too. Sarvam publishes no balance
    API (nothing in the API reference or the MCP, 2026-11-05), so the balance
    is anchored by hand: SARVAM_CREDIT_BALANCE is what the billing page showed
    at SARVAM_CREDIT_BALANCE_AT (or, with no date, every credit ever added),
    less what every call since has cost. SARVAM_SPENT, the total of Sarvam's
    usage export at the same moment, likewise replaces our estimate of what was
    spent before it.

    ponytail: this agent's calls only. The other agents in the workspace, number
    rental (₹59 / 30 days) and the voice-preview TTS draw on the same credits;
    re-anchor the balance from the billing page when it drifts.
    """
    rows = await sarvam.all_attempts(USAGE_SINCE)
    anchor = _parse(os.getenv("SARVAM_CREDIT_BALANCE_AT", ""))  # None when unset
    spent = since_anchor = 0.0
    connected = 0
    for row in rows:
        if row.get("connectivity_status") != "connected":
            continue  # Sarvam bills only calls that connect
        connected += 1
        rupees = cost(row.get("duration_in_seconds"), str(row.get("user_contact", "")).startswith("+"))
        spent += rupees
        at = _utc(row.get("start_datetime") or row.get("attempted_at"))
        if not anchor or (at and at >= anchor):
            since_anchor += rupees
    balance, billed = _rupees_env("SARVAM_CREDIT_BALANCE"), _rupees_env("SARVAM_SPENT")
    # Sarvam's own usage export, when HR copied it at the anchor, outranks our
    # estimate: the published per-call rounding came to 113 telephony pulses
    # where the bill to 2026-11-05 said 93, and playground minutes differ too.
    if billed is not None and anchor:
        spent = billed + since_anchor
    return {"spent": round(spent, 2), "connected_calls": connected, "attempts": len(rows),
            "credits_left": None if balance is None else round(balance - since_anchor, 2),
            "billed_at": _iso(anchor) if billed is not None and anchor else "",
            "rate_per_minute": RATE_PER_MINUTE}


def _rupees_env(name: str) -> float | None:
    try:
        return float(os.getenv(name, "").strip())
    except ValueError:
        return None


def transcript_text(session_id: str) -> str | None:
    """The Q&A transcript written when a call ends, or None before that."""
    path = os.path.join(TRANSCRIPTS_DIR, f"{session_id}.txt")
    if not session_id.isalnum() or not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return f.read()


async def recording(session_id: str) -> bytes | None:
    """The latest connected call's recording, straight from Sarvam, or None
    while Sarvam has none. Raises SarvamError if Sarvam fails."""
    s = load(session_id)
    if not s or not s.get("interaction_id"):
        return None
    return await sarvam.recording(s["interaction_id"])


def voices() -> dict:
    """The picker's roster: what HR sees, without the Sarvam ids behind it."""
    return {"voices": [{k: v[k] for k in ("id", "name", "gender", "tone")} for v in VOICES],
            "default": DEFAULT_VOICE}


async def voice_preview(speaker: str) -> bytes:
    if speaker not in _VOICE:
        raise HTTPException(404, f"Unknown voice {speaker!r}")
    path = os.path.join(BASE, "media", f"{speaker}.wav")
    if not os.path.exists(path):  # one TTS call per voice, ever
        try:
            audio = await sarvam.preview_wav(PREVIEW_TEXT.format(name=_VOICE[speaker]["name"]), speaker)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, str(exc)[:300])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(audio)
    with open(path, "rb") as f:
        return f.read()


# ── HTTP: Sarvam's webhook, and the tunnel it arrives through ──────────────
router = APIRouter()


@router.post(WEBHOOK_PATH)
async def sarvam_webhook(request: Request):
    """Sarvam's call-end POST, once per attempt, connected or not."""
    try:
        payload = await request.json()
    except ValueError:
        raise HTTPException(400, "Expected JSON")
    meta = (payload.get("webhook_config") or {}).get("metadata") or {}
    if meta.get("token") != _webhook_token():
        raise HTTPException(403, "Bad webhook token")
    with _lock:
        s = load(str(meta.get("session_id", "")))
        if not s:
            raise HTTPException(404, "Unknown interview session")
        applied = apply_result(s, payload)
        if applied:
            save(s)
            _write_transcript(s)
    logger.info("Webhook for %s: %s (%s)", meta.get("session_id"), payload.get("status"),
                "applied" if applied else "duplicate, ignored")
    if applied and s["call_status"] == "connected":
        await add_known_caller(s)
    return {"ok": True, "applied": applied}


@router.post("/interview/{session_id}/cancel")
async def cancel(session_id: str):
    """Call off a pending redial. A call already ringing is Sarvam's to finish.
    No button uses it; it is how to stop the retries to a wrong number by hand."""
    with _lock:
        s = load(session_id)
        if not s:
            raise HTTPException(404, "Unknown interview session")
        s.update(cancelled=True, reschedule_scheduled=False, no_answer_retry_scheduled=False)
        save(s)
    return public(s)


async def tunnel_guard(request: Request, call_next):
    """Through PUBLIC_URL's tunnel, the webhook and nothing else.

    The tunnel exists so Sarvam can POST results, but it publishes the whole
    port, and this port is the whole backend: resumes, LLM API keys. ngrok and
    cloudflared both keep the public hostname in Host by default, which is how
    tunnelled requests are told apart from the frontend's.
    """
    public_host = urlparse(os.getenv("PUBLIC_URL", "").strip()).hostname
    if public_host and request.url.path != WEBHOOK_PATH:
        for header in ("host", "x-forwarded-host"):
            if request.headers.get(header, "").split(":")[0].lower() == public_host:
                return PlainTextResponse("Not found", status_code=404)
    return await call_next(request)
