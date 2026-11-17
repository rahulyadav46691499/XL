"""Offline self-check for AI phone calls: the whole call lifecycle with Sarvam faked.

    cd backend && .venv/bin/python -m voice.check

No network, no phone. Pins the session fields app/main.py and
interview_scoring.py read, and every way a session moves: completed, callback
then redial, missed calls retried then given up, a webhook delivered twice, a
forged one, a webhook that never arrives (recovered by polling), a dial Sarvam
refuses -- and that the PUBLIC_URL tunnel reaches the webhook and nothing else.
"""
import asyncio
import json
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone

os.environ["DISABLE_SCHEDULER"] = "1"
CONFIG = {"SARVAM_VOICE_AGENTS_API_KEY": "test-key", "SARVAM_ORG_ID": "org", "SARVAM_WORKSPACE_ID": "ws",
          "SARVAM_AGENT_ID": "agent", "SARVAM_CONNECTION_ID": "conn",
          "SARVAM_AGENT_PHONE_NUMBER": "+918000000000", "PUBLIC_URL": "https://example.test",
          "SARVAM_DEPLOYMENT_ID": "dep"}

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from . import calls, script  # noqa: E402  (calls' load_dotenv must not overwrite the fakes below)

os.environ.update(CONFIG)
# Pay-as-you-go, whatever backend/.env sets, so the cost figures below are fixed.
calls.RATE_PER_MINUTE, calls.TELEPHONY_PER_PULSE = 3.5, 0.2

tmp = tempfile.mkdtemp()
calls.SESSIONS_DIR = os.path.join(tmp, "sessions")
calls.TRANSCRIPTS_DIR = os.path.join(tmp, "transcripts")

placed, attempts, known, inbound_rows = [], {}, [], []


async def fake_place_call(phone, app_version, agent_variables, greeting, webhook_url, metadata):
    attempt_id = f"att-{len(placed) + 1}"
    placed.append({"phone": phone, "version": app_version, "vars": agent_variables, "greeting": greeting,
                   "webhook_url": webhook_url, "metadata": metadata, "attempt_id": attempt_id})
    return attempt_id


async def fake_find_attempt(attempt_id, since):
    return attempts.get(attempt_id)


async def fake_add_known_caller(name, phone, agent_variables, greeting):
    known.append({"name": name, "phone": phone,
                  "vars": agent_variables, "greeting": greeting})
    return f"cohort-{len(known)}"


async def fake_inbound_attempts(since):
    return list(inbound_rows)


async def fake_transcript(interaction_id):
    return [{"role": "agent", "en_text": "Hi"}, {"role": "user", "en_text": "Hello"}]


real_find_attempt, real_place_call = calls.sarvam.find_attempt, calls.sarvam.place_call
calls.sarvam.place_call = fake_place_call
calls.sarvam.find_attempt = fake_find_attempt
calls.sarvam.transcript = fake_transcript
calls.sarvam.add_known_caller = fake_add_known_caller
calls.sarvam.inbound_attempts = fake_inbound_attempts

# A fixed mid-morning start, so redials never cross out of calling hours by the time of day the check runs.
clock = [datetime(2026, 10, 19, 10, 0, tzinfo=calls.IST)]
calls._now = lambda: clock[0]


def advance(**kw):
    clock[0] = clock[0] + timedelta(**kw)


SIMRAN, SUNNY = calls._VOICE[calls.DEFAULT_VOICE]["version"], calls._VOICE["sunny_enhi_customer"]["version"]


def place(*candidates) -> str:
    return asyncio.run(calls.place(list(candidates)))[0]


# As app/main.py:prepare_call builds it.
CANDIDATE = {
    "candidate_name": "Asha Rao", "phone_number": "+919876543210",
    "jd_role": "Data Analyst", "primary_location": "Pune",
    "questions": {"right_time": "Is this the right time to talk?",
                  "callback_time": "What time are you available?",
                  "current_ctc": "What is your current CTC?",
                  "expected_ctc": "What is your expected CTC?"},
    "jd_description": "Pune-based hybrid Data Analyst role.",
    "candidate_profile": "Asha Rao. Data analyst, 4 years, SQL and Python.",
}


def hook(client, session_id, **payload):
    token = placed[-1]["metadata"]["token"]
    body = {"attempt_id": placed[-1]["attempt_id"], "channel_info": {},
            "webhook_config": {"url": "x", "metadata": {"session_id": session_id, "token": token}},
            **payload}
    return client.post(calls.WEBHOOK_PATH, json=body)


def connected(outcome, answers, **extra):
    return {"status": "connected", "duration": 95.5, "interaction_id": "20261017/abc",
            "final_agent_variables": {"screening_outcome": outcome, "answers_json": answers,
                                      "communication_score": 82,
                                      "communication_summary": "Clear and direct.", **extra},
            "interaction_transcript": [{"role": "agent", "en_text": "Is this a good time?"},
                                       {"role": "user", "en_text": "Yes."}]}


# The frontend's own list of terminal call_status words. Read from source so a
# change on either side fails here instead of as a poll that never stops.
_api_ts = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "..", "frontend", "lib", "api.ts")).read()
CALL_ENDED = re.findall(r'"([^"]+)"', re.search(r"CALL_ENDED = \[([^\]]*)\]", _api_ts).group(1))
assert CALL_ENDED, "could not read CALL_ENDED from frontend/lib/api.ts"
for _sarvam, _wire in calls.WIRE_CALL_STATUS.items():
    assert (_wire in CALL_ENDED) == (_sarvam in ("connected", "no_answer", "busy", "failed")), _wire

# The voice roster: one committed agent version per voice, no two alike, and the
# default is the voice the repo's agent_config.json (the draft) is set to.
_ids = [v["id"] for v in calls.VOICES]
assert len(set(_ids)) == len(_ids) and len({v["version"] for v in calls.VOICES}) == len(_ids)
assert all(v["gender"] in ("female", "male") and v["name"] and v["tone"] for v in calls.VOICES)
_cfg = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_config.json")))
assert calls._VOICE[calls.DEFAULT_VOICE]["internal_id"] == _cfg["text_to_speech_config"]["internal_id"]
assert "agent_name" in _cfg["llm_config"]["agent_config"]["agent_variables"]
assert calls.voices()["default"] == calls.DEFAULT_VOICE
assert set(calls.voices()["voices"][0]) == {"id", "name", "gender", "tone"}, "Sarvam ids stay server-side"

# The HTTP surface, wired the way app/main.py wires it.
app = FastAPI()
app.include_router(calls.router)
app.middleware("http")(calls.tunnel_guard)


@app.get("/jds")
async def private_route():
    return {"resumes": "everyone's"}


def run():
    with TestClient(app) as client:
        # ── Through the tunnel: the webhook, nothing else ──
        assert client.get("/jds").status_code == 200, "local requests are untouched"
        tunnelled = {"host": "example.test"}
        assert client.get("/jds", headers=tunnelled).status_code == 404
        assert client.get("/jds", headers={"x-forwarded-host": "EXAMPLE.test:443"}).status_code == 404
        assert client.post("/interview/abc/cancel", headers=tunnelled).status_code == 404
        assert client.post(calls.WEBHOOK_PATH, headers=tunnelled, json={}).status_code == 403, \
            "the webhook itself is reachable (and then refused for its missing token)"

        # ── Not configured: refused with what to fix, and nothing dialled ──
        os.environ["SARVAM_CONNECTION_ID"] = ""
        try:
            place(CANDIDATE)
            raise AssertionError("placed a call with no connection configured")
        except HTTPException as exc:
            assert exc.status_code == 503 and "SARVAM_CONNECTION_ID" in exc.detail, exc.detail
        assert not placed
        os.environ["SARVAM_CONNECTION_ID"] = CONFIG["SARVAM_CONNECTION_ID"]

        # ── A batch with one unaskable candidate places nothing at all ──
        try:
            place(CANDIDATE, {**CANDIDATE, "questions": {"made_up": "?"}})
            raise AssertionError("accepted a candidate with no askable questions")
        except HTTPException as exc:
            assert exc.status_code == 400, exc.detail
        assert not placed and not calls.active()["sessions"], "a refused batch left sessions behind"

        # ── Placing a call ──
        sid = place(CANDIDATE)
        assert len(placed) == 1, placed
        call = placed[0]
        assert call["webhook_url"] == "https://example.test/api/sarvam/webhook"
        assert call["vars"]["call_script"].startswith("[right_time] START"), call["vars"]
        assert set(call["vars"]) == {"candidate_name", "jd_role", "primary_location", "jd_description",
                                     "candidate_profile", "call_script", "answers_so_far",
                                     "agent_name"}, call["vars"]
        assert call["vars"]["candidate_profile"] == CANDIDATE["candidate_profile"]
        assert call["vars"]["answers_so_far"] == "", "a first call has nothing answered yet"
        assert call["greeting"].endswith("Is this the right time to talk?"), call["greeting"]
        # No voice picked: the default voice's version, and its persona's name.
        assert call["version"] == SIMRAN and call["vars"]["agent_name"] == "Simran", call
        assert "this is Simran from" in call["greeting"], call["greeting"]

        # Every field app/main.py and interview_scoring.py read by name.
        s = calls.get(sid)
        for field in ("answers", "call_status", "scores", "queue_position", "call_error",
                      "gate_reason", "reschedule_at", "reschedule_scheduled", "status",
                      "no_answer_retry_at", "no_answer_retry_scheduled", "call_placed_count",
                      "call_seconds", "reschedule_count", "call_not_picked_count",
                      "call_callbacks", "call_cost"):
            assert field in s, field
        assert s["status"] == "in_progress" and s["call_placed_count"] == 1, s
        assert s["call_status"] == "in-progress" and s["call_status"] not in CALL_ENDED, s
        active = calls.active()["sessions"]
        for field in ("call_status", "queue_position", "status", "next_call_at", "call_attempts"):
            assert field in active[sid], field
        assert calls.get("nope") is None and calls.transcript_text(sid) is None
        assert asyncio.run(calls.recording(sid)) is None, "no recording before the call connects"

        # ── A forged webhook is refused ──
        bad = client.post(calls.WEBHOOK_PATH, json={
            "attempt_id": "att-1", "status": "connected",
            "webhook_config": {"metadata": {"session_id": sid, "token": "guess"}}})
        assert bad.status_code == 403

        # ── Callback: right_time no, agreed tomorrow 6pm ──
        res = hook(client, sid, **connected(
            "callback_requested",
            {"right_time": {"transcript": "Driving now", "value": "no"},
             "callback_time": {"transcript": "Tomorrow 6", "value": "2026-10-18T18:00:00+05:30"}},
            callback_at=(clock[0] + timedelta(days=1)).isoformat()))
        assert res.json()["applied"], res.text
        s = calls.get(sid)
        assert s["status"] == "rescheduled" and s["reschedule_scheduled"], s
        assert s["reschedule_at"].endswith("+05:30"), s["reschedule_at"]
        assert s["scores"]["status"] == "skipped", s["scores"]
        assert s["answers"]["right_time"]["extracted"] == {"value": "no"}
        # Delivered twice (Sarvam retries): applied once.
        assert not hook(client, sid, **connected("callback_requested", {})).json()["applied"]
        assert calls.get(sid)["reschedule_count"] == 1
        # The calendar has the call just made and the callback still to come.
        mine = [e for e in calls.schedule()["events"] if e["session_id"] == sid]
        assert [(e["kind"], e["status"]) for e in mine] == [("call", "connected"), ("rescheduled", "scheduled")], mine
        assert mine[1]["at"] == s["reschedule_at"] and mine[0]["candidate_name"] == "Asha Rao", mine

        # ── The redial fires on the SAME session when the time comes ──
        asyncio.run(calls.tick())
        assert len(placed) == 1, "redialled early"
        advance(days=1, minutes=1)
        asyncio.run(calls.tick())
        assert len(placed) == 2 and placed[1]["metadata"]["session_id"] == sid
        assert calls.get(sid)["status"] == "in_progress"

        # ── Second call completes; answers merge into the first call's ──
        hook(client, sid, **connected(
            "completed",
            {"right_time": {"transcript": "Yes now is fine", "value": "yes"},
             "current_ctc": {"transcript": "12 lakhs", "value": 1200000},
             "expected_ctc": {"transcript": "16 to 17 LPA", "value": 1700000, "volunteered": True}}))
        s = calls.get(sid)
        assert s["status"] == "completed", s
        assert s["call_status"] == "completed" and s["call_status"] in CALL_ENDED, "the modal must stop polling"
        assert s["answers"]["callback_time"]["transcript"] == "Tomorrow 6", "first call's answer kept"
        assert s["answers"]["right_time"]["extracted"] == {"value": "yes"}, "newer answer wins"
        assert s["answers"]["expected_ctc"]["volunteered"] is True
        assert s["scores"] == {"status": "done", "communication_score": 82,
                               "summary": "Clear and direct."}, s["scores"]
        assert s["call_seconds"] == 191 and s["call_placed_count"] == 2, s
        # Two 95.5s calls: 2 agent minutes and 4 telephony pulses each.
        assert s["call_cost"] == 15.6 and len(calls.load(sid)["calls"]) == 2, s
        assert sid not in calls.active()["sessions"]
        text = calls.transcript_text(sid)
        assert "Q1 [right_time]" in text and "(understood as: 1200000)" in text, text
        assert "Candidate: Yes." in text and "--- Call 2" in text, text
        # Every answer is in now, so a callback has nothing left to ask: it offers help.
        record = known[-1]
        assert record["name"] == f"talentai-{sid}" and record["vars"]["call_script"] == script.NOTHING_LEFT, record
        assert '"12 lakhs"' in record["vars"]["answers_so_far"], record["vars"]["answers_so_far"]
        assert record["greeting"].endswith("How can I help you today?"), record["greeting"]

        # ── A redial asks only what is still unanswered ──
        sid12 = place(CANDIDATE)
        hook(client, sid12, **connected("incomplete", {
            "right_time": {"transcript": "Yes", "value": "yes"},
            "current_ctc": {"transcript": "10 lakhs", "value": 1000000}}))
        assert calls.get(sid12)["status"] == "awaiting_retry"
        advance(minutes=calls.RETRY_FIRST_MINUTES + 1)
        asyncio.run(calls.tick())
        redial = placed[-1]
        assert redial["metadata"]["session_id"] == sid12, redial
        assert redial["vars"]["call_script"].startswith("[right_time] START"), "is now a good time: every call"
        assert "[current_ctc]" not in redial["vars"]["call_script"], redial["vars"]["call_script"]
        assert "next is [expected_ctc]" in redial["vars"]["call_script"], redial["vars"]["call_script"]
        assert '"10 lakhs" (understood as 1000000)' in redial["vars"]["answers_so_far"]
        assert "right_time" not in redial["vars"]["answers_so_far"] and "Is this the right time" not in \
            redial["vars"]["answers_so_far"], "per-call answers are not carried over"

        # ── Missed calls: retried soon, then next day, then given up ──
        sid2 = place(CANDIDATE)
        for n in range(1, calls.MAX_CALL_ATTEMPTS + 1):
            hook(client, sid2, status="no_answer", duration=None)
            s = calls.get(sid2)
            if n < calls.MAX_CALL_ATTEMPTS:
                assert s["status"] == "awaiting_retry", (n, s)
                advance(minutes=calls.RETRY_FIRST_MINUTES + 1) if n == 1 else advance(
                    hours=calls.RETRY_NEXT_HOURS, minutes=1)
                asyncio.run(calls.tick())
                assert placed[-1]["metadata"]["session_id"] == sid2, n
        assert s["status"] == "no_answer" and s["call_not_picked_count"] == 3, s
        assert s["call_cost"] == 0, "Sarvam bills only calls that connect"
        assert [c["status"] for c in calls.load(sid2)["calls"]] == ["no_answer"] * 3
        assert s["call_status"] in CALL_ENDED, s
        assert not s["no_answer_retry_scheduled"]

        # ── The voice HR picked is the version dialled, the name said, on every redial ──
        sid8 = place({**CANDIDATE, "speaker": "sunny_enhi_customer"})
        assert placed[-1]["version"] == SUNNY and placed[-1]["vars"]["agent_name"] == "Sunny", placed[-1]
        assert "this is Sunny from" in placed[-1]["greeting"], placed[-1]["greeting"]
        hook(client, sid8, status="no_answer", duration=None)
        advance(minutes=calls.RETRY_FIRST_MINUTES + 1)
        asyncio.run(calls.tick())
        assert placed[-1]["metadata"]["session_id"] == sid8 and placed[-1]["version"] == SUNNY, placed[-1]
        # An unknown voice is refused before anything is saved or dialled.
        dials = len(placed)
        try:
            place({**CANDIDATE, "speaker": "priya"})
            raise AssertionError("accepted a voice that is not in VOICES")
        except HTTPException as exc:
            assert exc.status_code == 400 and "priya" in exc.detail, exc.detail
        assert len(placed) == dials
        # A session saved before voices could be picked redials in the default.
        old = calls.load(sid8)
        del old["voice"]
        old.update(call_status="no_answer", no_answer_retry_scheduled=True,
                   no_answer_retry_at=calls._iso(clock[0]))
        calls.save(old)
        asyncio.run(calls.tick())
        assert placed[-1]["version"] == SIMRAN and placed[-1]["vars"]["agent_name"] == "Simran", placed[-1]

        # ── A cancelled session is never redialled ──
        sid7 = place(CANDIDATE)
        hook(client, sid7, status="busy", duration=None)
        assert client.post(f"/interview/{sid7}/cancel").json()["status"] == "cancelled"
        advance(hours=2)
        dials = len(placed)
        asyncio.run(calls.tick())
        assert len(placed) == dials, "redialled a cancelled session"

        # ── Callbacks: every candidate dialled becomes a known caller ──
        record = known[-1]
        assert record["name"] == f"talentai-{sid7}", record
        assert record["phone"] == CANDIDATE["phone_number"]
        # They rang us, so "is now a good time" is dropped and the greeting asks the first question.
        assert record["vars"]["call_script"].startswith("[current_ctc] START"), record["vars"]
        assert record["greeting"].endswith("What is your current CTC?"), record["greeting"]
        # The deployment answers in the default voice, so that is the persona named.
        assert record["vars"]["agent_name"] == "Simran" and "Thanks for calling back" in record["greeting"]
        # Without a deployment, nobody is added and callbacks are not looked up.
        os.environ["SARVAM_DEPLOYMENT_ID"] = ""
        before = len(known)
        place(CANDIDATE)
        assert len(known) == before
        os.environ["SARVAM_DEPLOYMENT_ID"] = "dep"
        # A failed upload costs the callback, never the call.
        async def broken(*a, **kw):
            raise calls.sarvam.SarvamError("Sarvam known-caller upload failed (500)")
        calls.sarvam.add_known_caller = broken
        sid9 = place(CANDIDATE)
        assert calls.get(sid9)["status"] == "in_progress"
        calls.sarvam.add_known_caller = fake_add_known_caller

        # ── A callback is filed under its session, once, and replaces the pending redial ──
        sid10 = place({**CANDIDATE, "phone_number": "+919111122222"})
        hook(client, sid10, status="no_answer", duration=None)
        assert calls.get(sid10)["status"] == "awaiting_retry"
        row = {"interaction_id": "20261017/cb1", "user_contact": "+91 91111 22222",
               "connectivity_status": "connected", "duration_in_seconds": 80,
               "agent_variables": {"screening_outcome": "completed", "communication_score": "75",
                                   "answers_json": "{'current_ctc': {'transcript': '9 lakhs', "
                                                   "'value': 900000, 'volunteered': False}}"}}
        inbound_rows[:] = [row,
                           {**row, "interaction_id": "20261017/cb2", "agent_variables": {}},  # not final
                           {**row, "interaction_id": "20261017/cb3", "user_contact": "+919000000001"}]  # stranger
        advance(minutes=2)
        asyncio.run(calls.tick())
        s = calls.get(sid10)
        assert s["status"] == "completed" and not s["no_answer_retry_scheduled"], s
        assert s["answers"]["current_ctc"]["extracted"] == {"value": "900000"}, s["answers"]
        assert s["scores"]["communication_score"] == 75 and s["call_seconds"] == 80, s
        assert "Callback from the candidate" in calls.transcript_text(sid10)
        assert calls.load(sid10)["inbound_ids"] == ["20261017/cb1"]
        # The missed dial costs nothing; the 80s callback is 2 minutes + 3 pulses.
        assert s["call_callbacks"] == 1 and s["call_cost"] == 7.6, s
        assert calls.load(sid10)["calls"][-1]["inbound"] is True
        dials = len(placed)
        advance(hours=2)
        asyncio.run(calls.tick())
        assert calls.load(sid10)["inbound_ids"] == ["20261017/cb1"], "filed twice"
        assert len(placed) == dials, "redialled a candidate who already called back"
        # A number called for two screenings: the callback belongs to the newest.
        sid11 = place({**CANDIDATE, "phone_number": "+919111122222"})
        inbound_rows[:] = [{**row, "interaction_id": "20261017/cb4"}]
        advance(minutes=2)
        asyncio.run(calls.tick())
        assert calls.load(sid11)["inbound_ids"] == ["20261017/cb4"]
        assert calls.load(sid10)["inbound_ids"] == ["20261017/cb1"]
        # ...unless it was made before the newest opened (filed late): then it is the
        # older screening's, and that one's record must not be re-uploaded over the newer.
        rang = calls._parse(calls.load(sid11)["created_at"]) - timedelta(minutes=1)
        inbound_rows[:] = [{**row, "interaction_id": "20261017/cb5",  # naive UTC, as Sarvam sends it
                            "start_datetime": rang.astimezone(timezone.utc).replace(tzinfo=None).isoformat()}]
        uploads = len(known)
        advance(minutes=2)
        asyncio.run(calls.tick())
        assert calls.load(sid10)["inbound_ids"] == ["20261017/cb1", "20261017/cb5"]
        assert calls.load(sid11)["inbound_ids"] == ["20261017/cb4"], "an old callback filed in a newer session"
        assert len(known) == uploads, "an older screening's record uploaded over the newer one's"
        inbound_rows[:] = []

        # ── A webhook that never arrives is recovered by polling ──
        sid3 = place(CANDIDATE)
        att = placed[-1]["attempt_id"]
        attempts[att] = {"connectivity_status": "connected", "agent_variables": {}}
        advance(minutes=4)
        asyncio.run(calls.tick())
        assert calls.get(sid3)["status"] == "in_progress", \
            "a connected row without post-call variables is not final yet"
        attempts[att] = {"connectivity_status": "connected", "duration_in_seconds": 60,
                         "interaction_id": "20261017/def", "failure_reason": "NO_FAILURE_REASON",
                         # answers_json exactly as the analytics API returns it: a Python repr.
                         "agent_variables": {"screening_outcome": "not_interested",
                                             "answers_json": "{'still_interested': {'transcript': "
                                                             "'No, I joined elsewhere', 'value': 'no', "
                                                             "'volunteered': False}}",
                                             "communication_score": "70"}}
        advance(minutes=2)
        asyncio.run(calls.tick())
        s = calls.get(sid3)
        assert s["status"] == "not_interested", s
        assert s["answers"]["still_interested"]["extracted"] == {"value": "no"}, s["answers"]
        assert s["scores"]["communication_score"] == 70, s["scores"]
        assert "Candidate: Hello" in calls.transcript_text(sid3)

        # ── Sarvam refuses the dial: HR sees why ──
        async def refuse(*a, **kw):
            raise calls.sarvam.SarvamError("Sarvam outbound call failed (422): bad number")
        calls.sarvam.place_call = refuse
        sid4 = place(CANDIDATE)
        s = calls.get(sid4)
        assert s["status"] == "failed" and "bad number" in s["call_error"], s
        assert s["call_status"] in CALL_ENDED, s
        calls.sarvam.place_call = fake_place_call

        # ── A provider failure on a placed call ──
        sid5 = place(CANDIDATE)
        hook(client, sid5, status="failed", failure_reason="exotel: number under TRAI NDNC")
        s = calls.get(sid5)
        assert s["status"] == "failed" and "NDNC" in s["call_error"], s

        # ── The real row from the 2026-10-17 test call, through the poll path ──
        # Sarvam filed the outbound id under job_id (no attempt_id field) and
        # answers_json as a Python repr. Verbatim except candidate fields.
        sid6 = place(CANDIDATE)
        att = placed[-1]["attempt_id"]
        attempts[att] = {
            "job_id": att, "interaction_id": "20261017/2b31c501-09:53:30-53329441",
            "connectivity_status": "connected", "failure_reason": "NO_FAILURE_REASON",
            "end_reason": "AGENT_ENDS", "duration_in_seconds": 198.64, "channel_direction": "outbound",
            "agent_variables": {
                "screening_outcome": "completed",
                "answers_json": "{'right_time': {'transcript': 'Yes.', 'value': 'yes', 'volunteered': False}, "
                                "'current_ctc': {'transcript': 'Sorry, in the previous question my current salary is 20 LPA.', "
                                "'value': 2000000, 'volunteered': False}, 'expected_ctc': {'transcript': "
                                "'My sure, my salary expectation is 25 LPA', 'value': 2500000, 'volunteered': False}, "
                                "'negotiable': {'transcript': 'this is not negotiable at all.', 'value': 'no', "
                                "'volunteered': False}, 'notice_days': {'transcript': 'My notice period is of 90 days.', "
                                "'value': 90, 'volunteered': False}, 'buyout': {'transcript': 'There is a payout option', "
                                "'value': 'yes', 'volunteered': False}}",
                "callback_at": "", "communication_score": "90",
                "communication_summary": "The candidate communicated clearly and directly."}}
        advance(minutes=4)
        asyncio.run(calls.tick())
        s = calls.get(sid6)
        assert s["status"] == "completed" and s["call_status"] == "completed", s
        assert s["answers"]["current_ctc"]["extracted"] == {"value": "2000000"}, s["answers"]
        assert s["answers"]["notice_days"]["extracted"] == {"value": "90"}
        assert s["answers"]["negotiable"]["extracted"] == {"value": "no"}
        assert s["scores"] == {"status": "done", "communication_score": 90,
                               "summary": "The candidate communicated clearly and directly."}, s["scores"]
        assert s["call_seconds"] == 199, s

    # ── find_attempt itself: the id is looked up as attempt_id, then job_id ──
    asked = []

    class FakeResponse:
        status_code = 200

        def __init__(self, items):
            self._items = items

        def json(self):
            return {"items": self._items}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, headers=None, params=None):
            field = json.loads(params["filter_conditions"])[0]["field"]
            asked.append(field)
            return FakeResponse([{"job_id": "a1"}] if field == "job_id" else [])

    saved_client = calls.sarvam._client
    calls.sarvam._client = FakeClient
    try:
        row = asyncio.run(real_find_attempt("a1", clock[0]))
    finally:
        calls.sarvam._client = saved_client
    assert row == {"job_id": "a1"} and asked == ["attempt_id", "job_id"], (row, asked)

    # A dial Sarvam turns away for now (429, 5xx) is tried again; a 422 never is.
    class Reply:
        def __init__(self, code):
            self.status_code, self.text = code, f"status {code}"

        def json(self):
            return {"attempt_id": "a9"}

    replies, posts, bodies = [], [], []

    class PostClient(FakeClient):
        async def post(self, url, headers=None, json=None):
            posts.append(url)
            bodies.append(json)
            return Reply(replies.pop(0))

    def dial_with(*codes):
        replies[:], posts[:] = list(codes), []
        try:
            return asyncio.run(real_place_call("+919876543210", 9, {}, "Hi", "", {}))
        except calls.sarvam.SarvamError as exc:
            return str(exc)

    saved = calls.sarvam._client, calls.sarvam.RETRY_WAITS
    calls.sarvam._client, calls.sarvam.RETRY_WAITS = PostClient, (0, 0)
    try:
        assert dial_with(503, 429, 200) == "a9" and len(posts) == 3, posts
        # The intro is "{{greeting}}": an outbound call ignores initial_bot_message
        # and opens with whatever the variable holds, the apology by default.
        sent = bodies[-1]["app_config"]
        assert sent["agent_variables"]["greeting"] == "Hi" == sent["app_overrides"]["initial_bot_message"], sent
        assert "(422)" in dial_with(422) and len(posts) == 1, "a 422 was retried"
        assert "(503)" in dial_with(503, 503, 503) and len(posts) == 3, posts
    finally:
        calls.sarvam._client, calls.sarvam.RETRY_WAITS = saved

    # Redials whose time we choose ring only in calling hours: a miss at 20:50 is tried at 9 the next morning.
    late = datetime(2026, 10, 19, 22, 30, tzinfo=calls.IST)
    assert calls._in_hours(late) == datetime(2026, 10, 20, 9, 0, tzinfo=calls.IST)
    assert calls._in_hours(late.replace(hour=3)) == late.replace(hour=9, minute=0)
    assert calls._in_hours(late.replace(hour=12)) == late.replace(hour=12)
    clock[0] = datetime(2026, 10, 19, 20, 50, tzinfo=calls.IST)
    s = {"call_placed_count": 1}
    calls._schedule_retry(s)
    assert s["no_answer_retry_at"] == "2026-10-20T09:00:00+05:30", s

    # Full numbers never reach a log line (Sarvam's Analytics docs, "Personal data").
    assert calls.masked("+91 98765 43210") == "******3210", calls.masked("+91 98765 43210")

    # ── What calls cost (docs.sarvam.ai/voice-agents/pricing) ──
    # 60s agent pulses at ₹3.50 + 30s telephony pulses at ₹0.20, each rounded up.
    assert calls.cost(45) == 3.5 + 2 * 0.2 and calls.cost(61) == 7 + 3 * 0.2
    assert calls.cost(0.3) == 3.5 + 0.2, "a connected call bills at least one pulse"
    assert calls.cost(61, phone=False) == 7, "a playground call has no telephony leg"
    assert round(calls.call_cost({"call_seconds": 61}), 2) == 7.6, "a session from before per-call rows"
    assert calls.call_cost({"call_seconds": 0}) == 0
    # Account usage: Sarvam bills only connected calls; the credit left is the
    # anchored balance less what was spent after the anchor.
    usage_rows = [
        {"connectivity_status": "connected", "duration_in_seconds": 45, "user_contact": "+919876543210",
         "start_datetime": "2026-10-18T04:00:00"},
        {"connectivity_status": "connected", "duration_in_seconds": 61, "user_contact": "hr@exl.com",
         "start_datetime": "2026-10-20T04:00:00"},
        {"connectivity_status": "no_answer", "duration_in_seconds": 0, "user_contact": "+919876543210",
         "attempted_at": "2026-10-20T05:00:00"},
    ]

    async def fake_all_attempts(since):
        return usage_rows
    calls.sarvam.all_attempts = fake_all_attempts
    # SARVAM_SPENT cleared: backend/.env holds the real bill, and it must not leak in here.
    os.environ.update(SARVAM_CREDIT_BALANCE="100", SARVAM_CREDIT_BALANCE_AT="2026-10-19T10:00:00+05:30",
                      SARVAM_SPENT="")
    u = asyncio.run(calls.usage())
    assert u["spent"] == 10.9 and u["connected_calls"] == 2 and u["attempts"] == 3, u
    assert u["credits_left"] == 93.0 and not u["billed_at"], u
    # Sarvam's own bill at the anchor replaces the estimate before it.
    os.environ["SARVAM_SPENT"] = "480.1"
    u = asyncio.run(calls.usage())
    assert u["spent"] == 487.1 and u["billed_at"] == "2026-10-19T10:00:00+05:30", u
    os.environ["SARVAM_SPENT"] = ""
    os.environ["SARVAM_CREDIT_BALANCE_AT"] = ""
    assert asyncio.run(calls.usage())["credits_left"] == 89.1, "no date: every credit ever added"
    os.environ["SARVAM_CREDIT_BALANCE"] = ""
    assert asyncio.run(calls.usage())["credits_left"] is None, "no balance: shown as unknown"

    print("PASS: AI phone call lifecycle, session contract and tunnel guard")


if __name__ == "__main__":
    script.demo()
    run()
