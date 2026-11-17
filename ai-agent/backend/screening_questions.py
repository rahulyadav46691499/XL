"""The screening questions the AI phone call reads out, by index.

The live set is `FLOW_QUESTIONS`. `CALL_QUESTIONS` and `LEGACY_FLOW_QUESTIONS`
below are the two lists it replaced, kept only so a response saved under one of
their indices still resolves to the question it was actually recorded against.

The question *text* is mirrored in the frontend
(`frontend/lib/screening-flow.ts`), which holds the branch predicates. The two
lists are index-aligned and must stay in step — append, never reorder.

**Branching is no longer described here.** It used to be: `flow_rules()`
rendered the tree into English and the voice agent was asked to follow it. The
voice service resolves the branches in code (`voice/script.py`), keyed
by the keys below, so this module's job on the call side is down
to two things — name the questions (`questions_map`) and say which apply, by
including or omitting a key.
"""

from role_criteria import CHOICES, NUMERIC_KEYS, fmt

# The old flat list, asked of every candidate in this order. Superseded by
# FLOW_QUESTIONS; still resolved so a call replayed against an already-screened
# candidate lands on the question they were actually asked. Its per-requisition
# counterpart (eight free-text answers HR typed at JD upload, `QUESTION_KEYS`
# and `parse_answers`) is gone entirely — nothing compared them against
# anything. JDs that already carry `screening_answers` keep them, read-only.
CALL_QUESTIONS = [
    ("current_location",
     "What is your current location, and are you willing to relocate if required?"),
    ("work_model",
     "Are you comfortable working in an Onsite, Hybrid, or Remote model, based on "
     "business requirements?"),
    ("notice_period",
     "What is your official notice period, and is it negotiable? If negotiable, on "
     "what basis and how confident are you in reducing it?"),
    ("buyout",
     "Does your current organization offer a buyout option that could facilitate an "
     "earlier joining date?"),
    ("bgc_readiness",
     "Do you have all the mandatory documents required for the background verification "
     "process available — employment documents such as offer letters, joining letters, "
     "experience and relieving letters, and educational documents such as mark sheets "
     "and degree certificates?"),
    ("offer_status",
     "Are you currently holding any offers, expecting offers, or actively participating "
     "in interview processes with other organizations?"),
    ("offer_details",
     "If holding or expecting other offers, what are the details regarding the "
     "organization, compensation, and stage of the competing offers?"),
    ("interest_exl",
     "What is your motivation and intent to join EXL, including your career aspirations, "
     "reasons for considering this opportunity, and likelihood of accepting an offer if "
     "extended?"),
    ("current_ctc", "What is your current CTC?"),
    ("expected_ctc", "What is your expected CTC?"),
]


# Per-candidate questions the resume parser generates (education/employment
# gaps, job hopping, other serious negatives) are ticked in the same modal and
# so share one index space with the fixed list above. They are numbered from
# this base instead of continuing at len(CALL_QUESTIONS) on purpose: the fixed
# list is append-only, so anything numbered right after it would collide the
# moment a standard question is added. Reserving a range keeps a candidate's
# saved responses stable no matter how the fixed list grows.
RISK_INDEX_BASE = 100


# The conditional screening flow — what the HR modal asks and what the AI phone
# call reads out. The questions, their order and every branch come from the
# manager's spec: TalentAgent_AI_Suite_enhancement_tracker.xlsx, sheet
# "Questions (HR, Candidate)". Don't add, reorder or reword one without that
# sheet changing first.
#
# Index-aligned with FLOW_QUESTIONS in `frontend/lib/screening-flow.ts`, which
# holds the branch predicates. Append only, and change the two lists together.
#
# 300, not 200: this is a *different set of questions* from the flow the app
# shipped with, so reusing that range would have silently re-pointed every
# saved response and tick at a question nobody was asked. LEGACY_FLOW_QUESTIONS
# below keeps the old list resolvable, exactly as CALL_QUESTIONS does for the
# list before it.
#
# `{...}` placeholders are filled from the JD's role criteria by fill() below —
# the same substitution runs on the frontend, so HR and the candidate hear the
# same sentence.
FLOW_INDEX_BASE = 300
LEGACY_FLOW_INDEX_BASE = 200

# Where "Is this the right time to talk?" sits in the list below. The phone
# agent's greeting already asks it, so the call endpoint drops this one index
# rather than have it asked twice; HR still answers it in the form.
RIGHT_TIME_POSITION = 0

FLOW_QUESTIONS = [
    # 1
    ("right_time", "Is this the right time to talk?"),
    ("callback_time", "What time are you available?"),
    # 2
    ("current_location", "What's your current location?"),
    ("relocate", "Would you be willing to relocate to {location}?"),
    # 3
    ("ok_workplace",
     "Are you comfortable working in {mode} mode, based on business requirements?"),
    # 4 — asked only of a candidate who is currently working somewhere
    ("on_notice", "Are you on notice period right now in your current organisation?"),
    ("notice_days_left", "How many days are left in your notice period?"),
    ("willing_to_resign",
     "Are you willing to resign at your current company should you get selected?"),
    ("notice_days", "What is the duration of your notice period?"),
    # 5
    ("buyout", "Does your company offer buyout option for the notice period?"),
    # 6
    ("bgc_documents",
     "Do you have all the employment and education documents for Background check?"),
    # 7
    ("interviewed_elsewhere", "Have you given any job interview elsewhere?"),
    ("other_offer",
     "Do you have or expecting any offer letter from any other organisation?"),
    ("offer_details",
     "Can you tell me about that organisation, what role and package they are "
     "offering you?"),
    ("interview_stage", "What stage are you at in those hiring processes?"),
    # 8
    ("current_ctc", "What is your current CTC?"),
    # 9, 10, 11
    ("expected_ctc", "What is your expected CTC?"),
    ("negotiable", "Is it negotiable?"),
    ("join_reason", "Why do you want to join EXL?"),
    # ── Appended, NOT inserted ─────────────────────────────────────────────
    # These two come from the workbook's second sheet ("HR-based agent
    # questionnaire"), which was previously not implemented. They belong at
    # positions 2 and 3 in the *conversation* — and that is where the call asks
    # them, because ask order now lives in the voice service's flow table
    # (`voice/script.py`). It does NOT live in this array any
    # more, which is what frees the array to stay strictly append-only: a saved
    # response is keyed by `FLOW_INDEX_BASE + position`, so inserting here would
    # silently re-point every answer already stored against every later index.
    ("still_interested", "Are you still interested in this job?"),
    ("self_intro",
     "Before we go further, could you briefly introduce yourself — your "
     "background and what you're currently doing?"),
    # Asked last, of everyone; the dashboard shows the answer only on rows
    # Selected for R1, which is when HR has a round to book.
    ("r1_availability",
     "If you are selected for the next round, on which weekdays and at what time "
     "would you be available for the interview?"),
]

# Flow key -> the index its answer is stored under, and back again.
#
# Derived, never written out: appending a question above cannot leave this
# pointing one place to the left. The voice service keys its answers by flow
# key, so this is the single place a call's answers become modal indices —
# which is what removed the old `int(position)` mapping and the whole class of
# bug that came with it.
INDEX = {key: FLOW_INDEX_BASE + position for position, (key, _) in enumerate(FLOW_QUESTIONS)}
KEY_AT = {index: key for key, index in INDEX.items()}

# The first conditional flow, verbatim and frozen. Nothing asks these any more;
# they exist so a response saved under 200-299 still resolves to the question it
# was actually recorded against. Never edit, never reorder, never extend.
LEGACY_FLOW_QUESTIONS = [
    ("right_time", "Is this a good time to talk?"),
    ("callback_time", "No problem at all — what time would suit you better for a call back?"),
    ("current_location", "What is your current location?"),
    ("current_company", "What is the name of your current company?"),
    ("experience", "How many years of total work experience do you have?"),
    ("ok_workplace",
     "This role is {mode}, based in {location}. Are you comfortable with that?"),
    ("relocate",
     "Since the role is based in {location}, would you be willing to relocate?"),
    ("switch_reason", "What is the main reason you are looking to switch?"),
    ("on_notice", "Are you currently serving your notice period?"),
    ("last_working_day", "What is your last working day?"),
    ("notice_days", "What is your notice period, in days?"),
    ("buyout",
     "Does your current organization offer a buyout option, so you could join earlier?"),
    ("current_ctc", "What is your current CTC?"),
    ("expected_ctc", "What is your expected CTC?"),
    ("negotiable",
     "That is above the budget we have for this role. Would you be open to negotiating?"),
    ("other_offer", "Are you holding any other offer letter at the moment?"),
    ("offer_details",
     "Which organization is that with, and what compensation have they offered?"),
]

# What the resume said about whether the candidate is currently working, as the
# flow reads it. The stored value is a string because Chroma metadata is
# scalars-only. Anything else — "unknown", or the "" every resume analyzed
# before the field existed — misses the dict and gives None, "nobody knows",
# which asks everything rather than guessing.
EMPLOYMENT = {"yes": True, "no": False}

# How a workplace mode is said out loud. The stored value ("WFO") is a filing
# code, not something to read down a phone line. Mirrors WORKPLACE_WORDS in
# `frontend/lib/screening-flow.ts`.
WORKPLACE_WORDS = {
    "WFO": "onsite",
    "WFH": "remote",
    "Hybrid": "hybrid",
}


def fill(text: str, criteria: dict | None = None, job_location: str = "") -> str:
    """Substitute the `{...}` placeholders in a flow question.

    Plain string replacement rather than str.format: the question text is copy,
    and a stray brace in it should not blow up a call that is being placed.
    """
    criteria = criteria or {}
    values = {
        "location": job_location.strip() or "the job location",
        "mode": WORKPLACE_WORDS.get(criteria.get("workplace_mode", ""), "the required"),
    }
    for key in NUMERIC_KEYS:
        values[key] = fmt(criteria[key]) if key in criteria else "?"
    for key in CHOICES:
        values.setdefault(key, str(criteria.get(key, "?")))

    for key, value in values.items():
        text = text.replace("{" + key + "}", value)
    return text


def questions_for(
    indices: list[int],
    risk_questions: list[str] | None = None,
    criteria: dict | None = None,
    job_location: str = "",
) -> list[str]:
    """The question text to read out, for the indices HR ticked in the modal.

    Four reserved ranges, none of which can collide: below RISK_INDEX_BASE the
    legacy fixed CALL_QUESTIONS; from RISK_INDEX_BASE this candidate's own
    `risk_questions` (supplied by the caller, since they differ per resume);
    from LEGACY_FLOW_INDEX_BASE the first conditional flow, frozen; from
    FLOW_INDEX_BASE the live one.

    Out-of-range indices are dropped rather than raising: a browser holding an
    older build shouldn't be able to 500 the call endpoint.
    """
    risk_questions = risk_questions or []
    out = []
    for i in indices:
        if 0 <= i < len(CALL_QUESTIONS):
            out.append(CALL_QUESTIONS[i][1])
        elif 0 <= i - FLOW_INDEX_BASE < len(FLOW_QUESTIONS):
            out.append(fill(FLOW_QUESTIONS[i - FLOW_INDEX_BASE][1], criteria, job_location))
        elif 0 <= i - LEGACY_FLOW_INDEX_BASE < len(LEGACY_FLOW_QUESTIONS):
            out.append(fill(
                LEGACY_FLOW_QUESTIONS[i - LEGACY_FLOW_INDEX_BASE][1], criteria, job_location
            ))
        elif 0 <= i - RISK_INDEX_BASE < len(risk_questions):
            out.append(risk_questions[i - RISK_INDEX_BASE])
    return out


def questions_map(
    indices: list[int],
    risk_questions: list[str] | None = None,
    criteria: dict | None = None,
    job_location: str = "",
) -> dict[str, str]:
    """The call's script as `{node_id: question text}`, from the ticked indices.

    This is what `POST /api/interviews` now takes instead of a list of sentences
    plus a paragraph of branch rules. Its **key set is the contract**: the voice
    service asks exactly these and nothing else, and its decision graph steps
    over any key that is absent.

    That is why every "should we ask this at all" rule has to be settled here,
    before dialing — HR's ticks, the WFH rule that makes relocation moot, and
    the employment gate. All three are knowable without hearing a word from the
    candidate, all three already live in `requires` in screening-flow.ts, and
    the caller applies them by leaving keys out. Shipping them as separate flags
    would be a second place deciding the same branch.

    Only the live flow and this candidate's risk questions can be sent: the two
    frozen ranges (the old fixed list and the first conditional flow) exist to
    resolve *saved* answers and are not askable any more. Out-of-range indices
    are dropped rather than raising, so a browser on an older build cannot 500
    the call endpoint.
    """
    risk_questions = risk_questions or []
    out: dict[str, str] = {}
    for i in indices:
        position = i - FLOW_INDEX_BASE
        if 0 <= position < len(FLOW_QUESTIONS):
            key, text = FLOW_QUESTIONS[position]
            out[key] = fill(text, criteria, job_location)
            continue
        risk = i - RISK_INDEX_BASE
        if 0 <= risk < len(risk_questions):
            out[f"risk_{risk}"] = risk_questions[risk]
    return out


# `flow_rules()` used to live here: ~90 lines rendering this same branch tree
# into English for the voice agent's system prompt, because the agent decided
# which question to ask next and had to be *told* the rules. It is gone with
# that design. The branches are now the FLOW table in
# `voice/script.py`, resolved in Python before the call, and the
# questions that apply are expressed as the key set of `questions_map()` above.
# Don't reintroduce a prompt-side copy of the rules: two places deciding one
# branch is exactly what this replaced.

def demo() -> None:
    assert questions_for([1, 9]) == [CALL_QUESTIONS[1][1], CALL_QUESTIONS[9][1]]
    assert questions_for([99, -1]) == []

    # `right_time` is the graph's first node and is sent like any other
    # question — the greeting used to duplicate it and the endpoint stripped
    # this index, which it no longer does. The constant survives as an ordering
    # pin: reorder the list and anything still reading it moves silently.
    assert FLOW_QUESTIONS[RIGHT_TIME_POSITION][0] == "right_time"

    # Per-candidate risk questions live in their own reserved index range, so
    # they survive the fixed list growing and never shadow a standard question.
    risks = ["Why the 2019-2021 gap?", "Three roles in two years — why?"]
    assert questions_for([RISK_INDEX_BASE + 1], risks) == [risks[1]]
    assert questions_for([0, RISK_INDEX_BASE], risks) == [CALL_QUESTIONS[0][1], risks[0]]
    # A ticked risk question on a candidate that has none is dropped, not fatal.
    assert questions_for([RISK_INDEX_BASE], []) == []
    assert questions_for([RISK_INDEX_BASE + 9], risks) == []
    assert RISK_INDEX_BASE > len(CALL_QUESTIONS), "reserved range must clear the fixed list"

    # ── The conditional flow ────────────────────────────────────────────────
    criteria = {
        "min_experience": 5.0, "max_experience": 8.0,
        "min_budget": 15.0, "max_budget": 20.0,
        "min_notice": 30.0, "max_notice": 60.0,
        "workplace_mode": "Hybrid", "buyout_offered": "no",
    }

    # Four ranges, none of which can grow into the next: the resume parser is
    # asked for at most 5 risk questions, and the frozen flow is 17 long.
    assert RISK_INDEX_BASE + 5 < LEGACY_FLOW_INDEX_BASE, "risk range must clear the legacy flow"
    assert LEGACY_FLOW_INDEX_BASE + len(LEGACY_FLOW_QUESTIONS) <= FLOW_INDEX_BASE, (
        "the frozen flow must not reach into the live one"
    )
    assert questions_for([FLOW_INDEX_BASE], criteria=criteria) == [FLOW_QUESTIONS[0][1]]
    assert questions_for([FLOW_INDEX_BASE + len(FLOW_QUESTIONS)]) == []
    # All four ranges resolve in one call, in the order they were ticked.
    assert questions_for(
        [0, RISK_INDEX_BASE, LEGACY_FLOW_INDEX_BASE, FLOW_INDEX_BASE], risks, criteria
    ) == [
        CALL_QUESTIONS[0][1], risks[0], LEGACY_FLOW_QUESTIONS[0][1], FLOW_QUESTIONS[0][1],
    ]
    # A response saved under the old flow still resolves to the question it was
    # actually recorded against — that is the whole reason the list is kept.
    assert questions_for([LEGACY_FLOW_INDEX_BASE + 4]) == [
        "How many years of total work experience do you have?"
    ]

    # The flow is the sheet's, in the sheet's order.
    keys = [key for key, _ in FLOW_QUESTIONS]
    # STORAGE order, which is not ask order any more — the last two are appended
    # so existing responses keep their indices, while the call asks them second
    # and third. Ask order lives in voice/script.py.
    assert keys == [
        "right_time", "callback_time",
        "current_location", "relocate",
        "ok_workplace",
        "on_notice", "notice_days_left", "willing_to_resign", "notice_days",
        "buyout",
        "bgc_documents",
        "interviewed_elsewhere", "other_offer", "offer_details", "interview_stage",
        "current_ctc",
        "expected_ctc", "negotiable", "join_reason",
        "still_interested", "self_intro",
        "r1_availability",
    ], keys
    assert len(set(keys)) == len(keys), "duplicate flow key"

    # Placeholders are filled from the criteria, not read out raw.
    workplace = questions_for([FLOW_INDEX_BASE + 4], criteria=criteria, job_location="Gurgaon")[0]
    assert "{" not in workplace, workplace
    assert "hybrid mode" in workplace, workplace
    relocate = questions_for([FLOW_INDEX_BASE + 3], criteria=criteria, job_location="Gurgaon")[0]
    assert "Gurgaon" in relocate, relocate
    # A JD with no criteria still produces a sayable sentence, never "{mode}".
    assert "{" not in questions_for([FLOW_INDEX_BASE + 4])[0]
    assert fill("{min_notice} to {max_notice}", criteria) == "30 to 60"

    # ── The key/index table ─────────────────────────────────────────────────
    # Derived from FLOW_QUESTIONS, so these pin the positions that saved
    # responses are keyed by. If one of these fails, something was INSERTED
    # rather than appended and every stored answer after it now means something
    # else — the one unrecoverable mistake in this file.
    assert INDEX["right_time"] == 300
    assert INDEX["join_reason"] == 318
    assert INDEX["still_interested"] == 319, "appended, never inserted"
    assert INDEX["self_intro"] == 320, "appended, never inserted"
    assert INDEX["r1_availability"] == 321, "appended, never inserted"
    assert KEY_AT[INDEX["buyout"]] == "buyout"
    assert len(INDEX) == len(FLOW_QUESTIONS), "duplicate flow key"

    # ── questions_map: what the call is actually placed with ────────────────
    script = questions_map(
        [INDEX["right_time"], INDEX["relocate"], INDEX["ok_workplace"]],
        criteria=criteria, job_location="Gurgaon",
    )
    assert set(script) == {"right_time", "relocate", "ok_workplace"}, script
    # Placeholders are filled before the text leaves here — the voice service
    # never sees a `{mode}` and has no criteria to resolve one with.
    assert "Gurgaon" in script["relocate"]
    assert "hybrid mode" in script["ok_workplace"]
    assert not any("{" in text for text in script.values()), script

    # The key set IS the "which questions apply" contract: leaving a key out is
    # how HR's untick, the WFH rule and the employment gate all reach the call.
    employed_only = {"on_notice", "notice_days_left", "willing_to_resign",
                     "notice_days", "buyout", "current_ctc"}
    jobless_script = questions_map(
        [i for key, i in INDEX.items() if key not in employed_only],
        criteria=criteria, job_location="Gurgaon",
    )
    assert not (employed_only & set(jobless_script)), jobless_script
    assert "bgc_documents" in jobless_script

    # Risk questions ride in the same map under their own key space.
    with_risk = questions_map([INDEX["right_time"], RISK_INDEX_BASE + 1], risks)
    assert with_risk == {"right_time": FLOW_QUESTIONS[0][1], "risk_1": risks[1]}, with_risk

    # The frozen ranges are resolvable but not askable — nothing may put a
    # question from a list this candidate was never screened against.
    assert questions_map([0, LEGACY_FLOW_INDEX_BASE, 9999, -1]) == {}
    # A ticked risk question on a candidate that has none is dropped, not fatal.
    assert questions_map([RISK_INDEX_BASE], []) == {}

    # A JD with no criteria still produces sayable sentences, never "{mode}".
    bare = questions_map([INDEX["ok_workplace"], INDEX["relocate"]])
    assert not any("{" in text for text in bare.values()), bare

    print("screening_questions: all checks passed")


if __name__ == "__main__":
    demo()
