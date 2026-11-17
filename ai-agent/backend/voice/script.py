"""The screening flow as data, rendered into the per-call script the Sarvam agent reads.

The call itself now runs on Sarvam Voice Agents (agent prompt in agent_prompt.md),
so the LLM there walks the questions. What stays in Python is everything that is
knowable before the phone rings: which questions apply (the key set the backend
sends, `backend/app/main.py:prepare_call`) and where each answer leads. Both are
resolved here into explicit "next" rules that only ever name a question that is
actually on this call's script, so the agent is never asked to apply a skip rule
itself -- the same split the old Twilio service had in questionnaire.py, whose
graph this is a port of.

A question already answered on an earlier call (a redial, or the candidate
ringing back) is never on the script again: render() steps over it the way its
answer leads, and answered() lists it for the agent instead.

Node ids are the flow keys in backend/screening_questions.py and
frontend/lib/screening-flow.ts, so answers travel back keyed the same way.

`python3 script.py` runs the self-check.
"""
import ast
import json
import re

# key -> (what the answer is, value format, {answer: next key}, default next key)
# A branch dict is consulted only for the answers it names; every other answer
# (and every kind without branches) goes to the default. None means "go to Closing".
# The default doubles as the skip target: a question not on the script is
# stepped over to its default, exactly as `skip_to` did in questionnaire.py.
YES_NO = "yes or no"
DAYS = "a whole number of days (weeks times 7, months times 30)"
RUPEES = ("a whole number of rupees per year (lakh or LPA times 100000, crore times "
          "10000000, a monthly figure times 12, the higher figure of a range)")
TEXT = "an empty string"
# Not TEXT: the dashboard prints this value on a Selected-for-R1 row, so it is
# kept short, and an unclear answer (no value) is asked again on the next call.
AVAILABILITY = ('the weekdays and times they gave, written briefly, for example '
                '"Mon to Wed, 2 pm to 5 pm" or "Any weekday, after 6 pm"')
# About the call in progress, not the candidate: asked afresh on every call.
PER_CALL = {"right_time", "callback_time"}
FLOW = {
    "right_time": ("whether now is a good time to talk", YES_NO, {"no": "callback_time"}, "still_interested"),
    "callback_time": ("when to call them back", "ISO 8601 date and time with the +05:30 offset", {}, None),
    "still_interested": ("whether they are still interested in the job", YES_NO, {}, "self_intro"),
    "self_intro": ("their introduction of themselves", TEXT, {}, "current_location"),
    # Branches on whether they already live where the job is, not on yes/no.
    "current_location": ("where they live now", "the town or city named", {}, "ok_workplace"),
    "relocate": ("whether they will relocate for the job", YES_NO, {}, "ok_workplace"),
    "ok_workplace": ("whether the workplace mode suits them", YES_NO, {}, "on_notice"),
    "on_notice": ("whether they are serving notice now", YES_NO,
                  {"yes": "notice_days_left", "no": "willing_to_resign"}, "buyout"),
    "notice_days_left": ("days left in their notice period", DAYS, {}, "buyout"),
    "willing_to_resign": ("whether they would resign if selected", "yes, maybe or no", {}, "notice_days"),
    "notice_days": ("the length of their notice period", DAYS, {}, "buyout"),
    "buyout": ("whether their company offers a notice buyout", YES_NO, {}, "bgc_documents"),
    "bgc_documents": ("whether they have their background-check documents", YES_NO, {}, "interviewed_elsewhere"),
    "interviewed_elsewhere": ("whether they have interviewed elsewhere", YES_NO, {"yes": "other_offer"}, "current_ctc"),
    "other_offer": ("whether they have or expect another offer", YES_NO,
                    {"yes": "offer_details", "no": "interview_stage"}, "current_ctc"),
    "offer_details": ("the other organisation, role and package", TEXT, {}, "current_ctc"),
    "interview_stage": ("what stage they are at elsewhere", TEXT, {}, "current_ctc"),
    "current_ctc": ("their current CTC", RUPEES, {}, "expected_ctc"),
    "expected_ctc": ("their expected CTC", RUPEES, {}, "negotiable"),
    "negotiable": ("whether their expected CTC is negotiable", YES_NO, {}, "join_reason"),
    "join_reason": ("why they want to join EXL", TEXT, {}, "r1_availability"),
    "r1_availability": ("which weekdays and at what time they are free for a next-round interview",
                        AVAILABILITY, {}, "risk_0"),
}
MAX_RISK_QUESTIONS = 5  # matches the ceiling asserted in backend/screening_questions.py
for _i in range(MAX_RISK_QUESTIONS):
    FLOW[f"risk_{_i}"] = (f"their answer to CV-specific question number {_i + 1} (a gap, a job change "
                          "or another point from their resume), in the order they were asked", TEXT, {},
                          f"risk_{_i + 1}" if _i + 1 < MAX_RISK_QUESTIONS else None)

START = "right_time"
# Ask order, for the forward-only check below. Routing never reads it.
ASK_ORDER = list(FLOW)


def known_answers(answers: dict) -> dict[str, str]:
    """{key: value} for each question a session already has an answer to.
    A text question counts once there is a transcript; the others need the value
    the conversation branched on, so an unclear yes/no is asked again."""
    out = {}
    for key, answer in (answers or {}).items():
        if key not in FLOW or key in PER_CALL or not str(answer.get("transcript") or "").strip():
            continue
        value = str((answer.get("extracted") or {}).get("value") or "").strip()
        if FLOW[key][1] != TEXT and not value:
            continue
        out[key] = value
    return out


def _after(key: str, asked: dict, known: dict) -> str | None:
    """Where an already-answered question leads: the branch its answer took."""
    _, _, branches, default = FLOW[key]
    if key == "current_location" and "relocate" in asked and "relocate" not in known:
        return "relocate"  # only the agent can judge whether where they live is near the job
    return branches.get(known[key].lower(), default)


def resolve(target: str | None, asked: dict, known: dict | None = None) -> str | None:
    """Follow `target` past every question this call does not ask: one not on
    the script goes to its default, one already answered goes where its answer led."""
    known = known or {}
    while target is not None and (target not in asked or target in known):
        target = _after(target, asked, known) if target in known else FLOW[target][3]
    return target


def first_key(asked: dict, known: dict | None = None) -> str | None:
    return resolve(START, asked, known)


def _goto(target: str | None) -> str:
    return f"[{target}]" if target else "Closing"


def _targets(key: str, asked: dict, known: dict) -> list[str | None]:
    """Every question this one can lead to, already past the skips."""
    _, _, branches, default = FLOW[key]
    extra = ["relocate"] if key == "current_location" else list(branches.values())
    return [resolve(t, asked, known) for t in [default, *extra]]


def reachable(asked: dict, known: dict | None = None) -> set[str]:
    """The questions a call can actually arrive at. `relocate` without
    `current_location` is on the script but unreachable -- the old graph never
    asked it either -- and a line nothing points to only invites the agent to
    ask it anyway."""
    known = known or {}
    seen, todo = set(), [first_key(asked, known)]
    while todo:
        key = todo.pop()
        if key is None or key in seen:
            continue
        seen.add(key)
        todo.extend(_targets(key, asked, known))
    return seen


# What `call_script` holds when there is no script to read. Spelled out, never
# empty: told "if the call script is empty, apologise and end", the agent read
# straight past the empty section and improvised questions (text tests of v14
# and v20, 2026-10-21). NO_SCRIPT is the variable's default on the Sarvam agent
# (agent_config.json), so it is what a caller TalentAI never dialled gets.
# NOTHING_LEFT is what calls.py sends when every question is answered, so a
# callback never carries an empty cell that might read as missing and fall back
# to NO_SCRIPT.
NO_SCRIPT = ("NO SCRIPT. Ask nothing and answer nothing. On your first turn, end the call "
             "with a short goodbye: this is the EXL hiring team, and a recruiter will call "
             "them back.")
NOTHING_LEFT = "NOTHING LEFT. Every screening question is already answered: ask none."
# The agent's intro is "{{greeting}}" and this is that variable's default
# (agent_config.json), so the apology is said before the model says anything:
# the prompt alone did not stop it answering "who is this?" and carrying on.
# Every call TalentAI places or expects sends greeting() as the `greeting`
# variable, so only a caller with no script hears this. A variable, not just
# initial_bot_message: on an outbound call Sarvam speaks the intro's
# per-language copies and ignores that override (trace of 2026-10-21: override
# set, default spoken, and every outbound call opened with this apology), but it
# fills variables into them. Plain text: a {{name}} inside a variable's value
# is not known to be filled in.
UNKNOWN_CALLER_GREETING = (
    "Hello, you've reached EXL's hiring team. Thank you for calling. I'm sorry, I don't have "
    "your details in front of me right now, so a recruiter from our team will call you back.")


def render(asked: dict, primary_location: str = "", known: dict | None = None) -> str:
    """The `call_script` agent variable: one line per question still to ask, in
    ask order. "" when nothing is left.

    `asked` is the backend's `{key: question text}`, placeholders already filled;
    `known` is known_answers() of the session, empty on a first call.
    """
    known = known or {}
    start = first_key(asked, known)
    live = reachable(asked, known)
    place = primary_location or "the job location"
    lines = []
    for key in ASK_ORDER:
        if key not in live:
            continue
        _, _, branches, default = FLOW[key]
        nxt = resolve(default, asked, known)
        relocate = resolve("relocate", asked, known)
        if key == "relocate" and "current_location" in known:
            rule = (f"ask this only if {known['current_location']} is not in or near {place}, "
                    f"otherwise skip it; either way, next is {_goto(nxt)}")
        elif key == "current_location" and relocate != nxt:
            rule = (f"if they already live in or near {place}, "
                    f"next is {_goto(nxt)}; otherwise next is {_goto(relocate)}")
        elif key == "callback_time":
            rule = "read the agreed day and time back, then next is Closing"
        elif branches:
            parts = [f"if {answer}, next is {_goto(resolve(t, asked, known))}" for answer, t in branches.items()]
            rule = "; ".join(parts) + f"; otherwise next is {_goto(nxt)}"
        else:
            rule = f"next is {_goto(nxt)}"
        tag = " START" if key == start else ""
        lines.append(f"[{key}]{tag} {asked[key].strip()} ({rule})")
    return "\n".join(lines)


def answered(questions: dict, answers: dict) -> str:
    """The `answers_so_far` agent variable: what the candidate already told us,
    one line per question, so the agent neither asks it again nor contradicts it."""
    known = known_answers(answers)
    lines = []
    for key in ASK_ORDER:
        if key in known:
            line = (f"- {(questions.get(key) or FLOW[key][0]).strip()} They said: "
                    f"\"{answers[key]['transcript'].strip()}\"")
            lines.append(line + (f" (understood as {known[key]})" if known[key] else ""))
    return "\n".join(lines)


def greeting(candidate_name: str, jd_role: str, asked: dict, agent_name: str,
             callback: bool = False, known: dict | None = None) -> str:
    """The agent's opening line for this call, ending on the START question.
    `agent_name` is the persona of the call's voice (calls.VOICES); `callback`
    is the candidate ringing us back rather than us calling them. With nothing
    left to ask, it ends on an offer of help instead."""
    start = first_key(asked, known)
    opener = (f"Hi {candidate_name}, this is {agent_name} from EXL's hiring team. Thanks for "
              f"calling back about your application for the {jd_role} role." if callback else
              f"Hi {candidate_name}, this is {agent_name} from EXL's hiring team, "
              f"calling about your application for the {jd_role} role.")
    if start:
        lead = " I just have a few questions left." if callback and known else ""
        return f"{opener}{lead} {asked[start].strip()}"
    return f"{opener} {'How can I help you today?' if callback else 'Do you have any questions about it?'}"


def extraction_prompt() -> str:
    """The `answers_json` post-call prompt on the Sarvam agent, generated from FLOW.

    The key list is spelled out rather than left to the model: told only to
    "use the script's keys", Sarvam's extractor invented its own ("interested",
    "hybrid_comfortable") and every answer missed the HR form. agent_config.json
    holds the copy pushed to Sarvam, and demo() fails if the two drift apart.
    """
    lines = [f"- {key}: {meaning}. value: {fmt}" for key, (meaning, fmt, _, _) in FLOW.items()]
    return (
        "Return ONLY a JSON object, with no prose and no code fence. Add one entry for each "
        "question below that the candidate answered on this call, keyed exactly as written "
        "here and never renamed: \"key\": {\"transcript\": \"...\", \"value\": \"...\", "
        "\"volunteered\": false}. transcript is the candidate's own words for that answer, in "
        "English, quoted rather than paraphrased. value is in the format given for the key, "
        "or an empty string when the answer is unclear. volunteered is true only when the "
        "candidate gave that answer before the question was put to them. Leave out questions "
        "the candidate never answered. If nothing was answered, return {}.\n"
        "Keys:\n" + "\n".join(lines)
    )


def parse_answers(raw) -> dict:
    """`answers_json` off the webhook -> `{key: {transcript, extracted, ...}}`.

    The shape a session's answers have always had: backend/app/main.py
    reads `transcript`, `transcript_status`, `volunteered`, and the structured
    value out of `extracted["answer"|"value"|"location"]`. Anything malformed is
    dropped rather than raised -- one bad extraction must not lose the rest.
    """
    if isinstance(raw, str):
        text = raw.strip()
        # Models sometimes wrap JSON in a fence despite being told not to.
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
        try:
            raw = json.loads(text) if text else {}
        except ValueError:
            # Sarvam's analytics API hands the same variable back as a Python
            # repr -- single quotes, True/False -- not JSON. Seen live; reading
            # it as JSON lost every answer on the polling path. literal_eval
            # parses literals only, never code.
            try:
                raw = ast.literal_eval(text)
            except (ValueError, SyntaxError):
                return {}
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key, entry in raw.items():
        if key not in FLOW or not isinstance(entry, dict):
            continue
        value = entry.get("value")
        value = "" if value is None else str(value).strip()
        out[key] = {
            "transcript": str(entry.get("transcript") or "").strip(),
            "transcript_status": "done",
            "volunteered": entry.get("volunteered") is True,
            "extracted": {"value": value} if value else {},
        }
    return out


def demo() -> None:
    # Every default points forward, so resolve() cannot loop on a live call.
    pos = {k: i for i, k in enumerate(ASK_ORDER)}
    for key, (_, _, branches, default) in FLOW.items():
        for target in [default, *branches.values()]:
            assert target is None or pos[target] > pos[key], (key, target)

    everything = {k: f"Q {k}?" for k in FLOW if not k.startswith("risk_")}
    script = render(everything, "Gurgaon")
    assert script.splitlines()[0].startswith("[right_time] START "), script
    assert "if no, next is [callback_time]" in script
    assert "already live in or near Gurgaon, next is [ok_workplace]; otherwise next is [relocate]" in script
    assert "[join_reason] Q join_reason? (next is [r1_availability])" in script
    assert "[r1_availability] Q r1_availability? (next is Closing)" in script
    # Last on the script, and an unclear answer (no value) is asked again.
    assert script.splitlines()[-1].startswith("[r1_availability] "), script
    assert "r1_availability" not in known_answers(
        {"r1_availability": {"transcript": "umm let me see", "extracted": {}}})
    assert known_answers({"r1_availability": {"transcript": "Monday after 3",
                                              "extracted": {"value": "Mon, after 3 pm"}}}) == {
        "r1_availability": "Mon, after 3 pm"}

    # The employment gate drops the notice block: on_notice's absence must route
    # ok_workplace straight to the next question that IS asked, never to a key
    # the script does not contain.
    unemployed = {k: v for k, v in everything.items()
                  if k not in {"on_notice", "notice_days_left", "willing_to_resign",
                               "notice_days", "buyout", "current_ctc"}}
    s = render(unemployed)
    assert "[ok_workplace] Q ok_workplace? (next is [bgc_documents])" in s, s
    assert "if yes, next is [other_offer]; otherwise next is [expected_ctc]" in s, s
    named = set(re.findall(r"\[([a-z_0-9]+)\]", s))
    assert named <= set(unemployed), named - set(unemployed)

    # HR unticked right_time: the greeting asks the next question instead, and
    # the script marks that one START.
    no_rt = {"current_ctc": "What is your current CTC?", "expected_ctc": "What is your expected CTC?"}
    assert render(no_rt).startswith("[current_ctc] START")
    assert greeting("Asha", "Data Analyst", no_rt, "Sunny").endswith("What is your current CTC?")
    assert "this is Sunny from" in greeting("Asha", "Data Analyst", no_rt, "Sunny")
    assert "Thanks for calling back" in greeting("Asha", "Data Analyst", no_rt, "Simran", callback=True)
    assert greeting("Asha", "Data Analyst", no_rt, "Simran", callback=True).endswith("current CTC?")
    # right_time "no" with no callback_time on the script closes the call.
    assert "if no, next is Closing" in render({"right_time": "Is this the right time to talk?"})

    # Remote role: relocate is never sent, so location leads straight on.
    wfh = {k: v for k, v in everything.items() if k != "relocate"}
    assert "[current_location] Q current_location? (next is [ok_workplace])" in render(wfh)
    # relocate without current_location is unreachable, so it is not rendered.
    assert "[relocate]" not in render({"relocate": "Relocate?", "ok_workplace": "Hybrid ok?"})

    # Risk questions chain and the last one closes.
    risks = {"risk_0": "Why the gap?", "risk_1": "Why three roles?"}
    r = render(risks)
    assert "[risk_0] START Why the gap? (next is [risk_1])" in r
    assert r.endswith("next is Closing)")

    # A later call steps over what is already answered, the way the answers led.
    answers = {"still_interested": {"transcript": "Yes", "extracted": {"value": "yes"}},
               "self_intro": {"transcript": "I am a data analyst", "extracted": {}},
               "current_location": {"transcript": "Pune", "extracted": {"value": "Pune"}},
               "on_notice": {"transcript": "Yes I am", "extracted": {"value": "Yes"}},
               "ok_workplace": {"transcript": "hmm", "extracted": {}},  # unclear: asked again
               "right_time": {"transcript": "Yes", "extracted": {"value": "yes"}}}  # per call
    known = known_answers(answers)
    assert set(known) == {"still_interested", "self_intro", "current_location", "on_notice"}, known
    later = render(everything, "Gurgaon", known)
    keys = re.findall(r"^\[([a-z_0-9]+)\]", later, re.M)
    assert keys[0] == "right_time" and later.startswith("[right_time] START"), later
    assert not {"still_interested", "self_intro", "current_location", "on_notice"} & set(keys), keys
    # on_notice was yes: its yes branch stays, its no branch is gone.
    assert "notice_days_left" in keys and not {"willing_to_resign", "notice_days"} & set(keys), keys
    assert "if no, next is [callback_time]; otherwise next is [relocate]" in later, later
    assert "ask this only if Pune is not in or near Gurgaon, otherwise skip it; either way, next is [ok_workplace]" in later
    assert "[ok_workplace] Q ok_workplace? (next is [notice_days_left])" in later, later
    assert set(re.findall(r"\[([a-z_0-9]+)\]", later)) <= set(keys) | {"callback_time"}
    told = answered(everything, answers)
    assert told.splitlines()[0] == '- Q still_interested? They said: "Yes" (understood as yes)', told
    assert '- Q self_intro? They said: "I am a data analyst"' in told and "ok_workplace" not in told
    # Everything answered: no script, and a callback opens with an offer of help.
    done = {k: {"transcript": "x", "extracted": {"value": "no"}} for k in everything}
    assert render(everything, "Gurgaon", known_answers(done)).startswith("[right_time] START")
    no_per_call = {k: v for k, v in everything.items() if k not in PER_CALL}
    assert render(no_per_call, "Gurgaon", known_answers(done)) == ""
    assert greeting("Asha", "Data Analyst", no_per_call, "Simran", callback=True,
                    known=known_answers(done)).endswith("How can I help you today?")
    assert "role. I just have a few questions left. Q relocate?" in greeting(
        "Asha", "Data Analyst", no_per_call, "Simran", callback=True, known=known)

    # Answers come back in the shape the backend has always read.
    parsed = parse_answers('```json\n{"current_ctc": {"transcript": "12 lakhs", "value": 1200000},'
                           ' "self_intro": {"transcript": "I am a data analyst", "value": ""},'
                           ' "nonsense": {"value": "x"}, "relocate": "bad"}\n```')
    assert parsed["current_ctc"]["extracted"] == {"value": "1200000"}, parsed
    assert parsed["self_intro"]["extracted"] == {} and parsed["self_intro"]["transcript_status"] == "done"
    assert set(parsed) == {"current_ctc", "self_intro"}, parsed
    assert parse_answers("not json") == {} and parse_answers(None) == {}
    # Verbatim shape of answers_json in Sarvam's analytics attempts report.
    repr_form = ("{'right_time': {'transcript': 'Yes, I have time now.', 'value': 'yes', "
                 "'volunteered': False}, 'notice_days': {'transcript': 'Sixty days.', 'value': 60, "
                 "'volunteered': True}}")
    got = parse_answers(repr_form)
    assert got["right_time"]["extracted"] == {"value": "yes"}, got
    assert got["notice_days"]["extracted"] == {"value": "60"} and got["notice_days"]["volunteered"] is True
    assert parse_answers("__import__('os').system('true')") == {}, "literal_eval must refuse code"
    # The prompt pushed to Sarvam must be the one generated here, or answers come
    # back under keys the backend does not know and never reach the HR form.
    import os
    cfg = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_config.json")))
    pushed = cfg["llm_config"]["agent_config"]["agent_variables"]["answers_json"]["post_interaction_prompt"]
    assert pushed == extraction_prompt(), "agent_config.json answers_json prompt is stale: re-push it"
    for key in FLOW:
        assert f"- {key}: " in pushed, key
    # A caller with no script reads NO_SCRIPT (the variable's default on the
    # agent), and the prompt must name both markers by the words sent.
    script_var = cfg["llm_config"]["agent_config"]["agent_variables"]["call_script"]
    assert script_var["value"] == NO_SCRIPT, "agent_config.json call_script default is not NO_SCRIPT"
    assert cfg["intro_message_config"]["audio"] == "{{greeting}}", \
        "agent_config.json intro must be exactly {{greeting}}, or outbound calls speak the default"
    greeting_var = cfg["llm_config"]["agent_config"]["agent_variables"]["greeting"]
    assert greeting_var["value"] == UNKNOWN_CALLER_GREETING and "{{" not in UNKNOWN_CALLER_GREETING, \
        "agent_config.json greeting default is not UNKNOWN_CALLER_GREETING"
    # TalentAI always sends its own greeting: none it sends is ever empty.
    assert greeting("Asha", "Data Analyst", {}, "Simran") and greeting(
        "Asha", "Data Analyst", {}, "Simran", callback=True)
    prompt = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_prompt.md"),
                  encoding="utf-8").read()
    assert prompt.startswith("## Before anything else\nLook at the call script further down before "
                             "you reply. If it reads NO SCRIPT"), \
        "the no-script rule must stay first in agent_prompt.md"
    assert NO_SCRIPT.split(".")[0] in prompt and NOTHING_LEFT.split(".")[0] in prompt
    assert "is empty" not in prompt, "an empty call_script is never sent; refer to the markers"
    print("script self-checks passed")


if __name__ == "__main__":
    demo()
