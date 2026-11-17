"""Wire `joining_evaluator.py` onto a screened candidate in this app.

`joining_evaluator.py` is the rules, and is deliberately app-agnostic: hand it a
`ScreeningAnswers` and a `JDConfig` and it returns HIGH / MEDIUM / LOW /
WITHDRAWN with the criteria behind it. It knows nothing about Chroma, about
question indices, or about which sheet the questions came from — which is what
keeps it auditable on its own. This module is the only thing that knows those
answers arrive as an HR screening saved against a resume, so all the app-shaped
mess lives here and the rules stay boring.

Four jobs, and nothing else:

  1. **Re-key.** A screening stores answers by index (`FLOW_INDEX_BASE +
     position`, see `screening_questions.py`); the evaluator wants named fields.
  2. **Convert.** `role_criteria.max_budget` is in **lakhs** and a candidate's
     expected CTC is parsed into **rupees**. This is the one unit trap in the
     codebase — `screening-flow.ts` and `flow_rules()` both call it out — and
     `budget_max_ctc` below is the third place the two units meet.
  3. **Withhold a criterion the requisition never stated.** A JD uploaded before
     `role_criteria` existed has no budget and no notice ceiling, so the answer
     is fed in as `None`: no threshold, no verdict, rather than a verdict
     against a made-up threshold.
  4. **Refuse to judge a screening that has not happened.** Every field the
     evaluator reads is Optional and unknown means "no flag", so an *empty*
     screening produces zero flags and lands on HIGH — "we asked nothing,
     therefore they are very likely to join". Returning None instead is the
     whole reason step 4 exists.

And `with_call` fills the fields HR has not saved from the candidate's AI
call, so a verdict exists the moment the call ends rather than after HR opens
the form and saves it.

Called on read (`GET /jd/{id}/resumes`), not stored. `assess_joining` is a pure
function of data already in the row, so recomputing is free, and a rule that
changes tomorrow can never leave yesterday's verdict cached next to a candidate.

`python3 joining_assessment.py` runs its self-check.
"""

from __future__ import annotations

import json

from joining_evaluator import (
    Criterion,
    JDConfig,
    ScreeningAnswers,
    assess_joining,
)
from screening_questions import (
    EMPLOYMENT,
    FLOW_INDEX_BASE,
    FLOW_QUESTIONS,
    WORKPLACE_WORDS,
)
from voice import script

# Flow question key -> the index its answer is stored under. Derived from
# FLOW_QUESTIONS rather than written out, so appending a question can never
# leave this table pointing one place to the left.
INDEX = {key: FLOW_INDEX_BASE + position for position, (key, _) in enumerate(FLOW_QUESTIONS)}

# The answers the evaluator actually reads. At least one of them must have been
# answered before there is anything to assess — see job 4 in the docstring.
# "right_time", "callback_time", "current_ctc" and "join_reason" are deliberately
# absent: they are real questions but no criterion is measured against them, so
# a screening holding only those has still told us nothing about joining.
ASSESSABLE = frozenset({
    "still_interested",
    "current_location", "relocate", "ok_workplace",
    "on_notice", "notice_days_left", "willing_to_resign", "notice_days", "buyout",
    "bgc_documents",
    "interviewed_elsewhere", "other_offer",
    "expected_ctc", "negotiable",
})

# What the candidate said, per criterion, quoted back under the verdict — the
# evaluator carries it through to `Flag.evidence`. First answered key wins, so
# the most specific question for a criterion is listed first.
EVIDENCE = {
    Criterion.LOCATION.value: ["relocate", "current_location"],
    Criterion.WORK_MODEL.value: ["ok_workplace"],
    Criterion.CTC.value: ["expected_ctc", "negotiable"],
    Criterion.NOTICE.value: ["notice_days", "notice_days_left", "buyout"],
    # Their criterion renamed bgc -> documents; our flow key stays `bgc_documents`.
    Criterion.DOCUMENTS.value: ["bgc_documents"],
    Criterion.COMPETING_OFFERS.value: ["offer_details", "interview_stage", "other_offer"],
    # INTEREST is deliberately absent: its evidence is written out below rather
    # than quoted, because the question behind it is not the one the evaluator's
    # stock reason names. See `resigning`.
}

# What a JD that predates `role_criteria` says its work model is. Not "hybrid"
# (JDConfig's own default), which would put a mode the requisition never stated
# into a sentence HR reads as fact.
UNSPECIFIED_MODE = "unspecified"


def _loads(value, default):
    """A metadata field that is a JSON string in Chroma and a dict in a test."""
    if isinstance(value, str):
        try:
            return json.loads(value) if value else default
        except json.JSONDecodeError:
            return default
    return value if value is not None else default


def _at(mapping: dict, index: int) -> str:
    """One index out of a responses/heard map, whichever way its keys are typed.

    JSON object keys are strings, so a map that has been through Chroma comes
    back keyed by `"305"` while the same map in memory is keyed by `305`.
    """
    value = mapping.get(str(index), mapping.get(index, ""))
    return str(value or "").strip()


def _yes_no(value: str) -> bool | None:
    """A radio answer as a tri-state. "maybe" is neither — see `still_interested`."""
    return True if value == "yes" else False if value == "no" else None


def _number(value: str) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def same_location(candidate: str, job: str) -> bool:
    """Is the candidate already where the job is?

    Mirrors `sameLocation()` in `frontend/lib/screening-flow.ts` exactly, so the
    relocation question the modal decides to ask and the location verdict this
    module reaches can never disagree about the same pair of strings. Substring
    either way: "Bangalore" matches "Bangalore, KA", while "Gurgaon" and
    "Gurugram" read as different — which errs towards a harmless extra
    relocation question rather than a wrongly skipped one.
    """
    a, b = candidate.strip().lower(), job.strip().lower()
    if not a or not b:
        return False
    return a in b or b in a


def _quotable(value: str) -> bool:
    """Is this answer worth showing as evidence, or is it just the parsed value?

    A radio stores "yes" and a number input stores "400000" — quoting either
    back at HR under "the candidate said" adds nothing. `heard` (the sentence
    those were parsed out of) is preferred wherever it exists; this is the
    fallback for the free-text questions, whose answer *is* the sentence.
    """
    return len(value) > 3 and _number(value) is None


def _config(jd: dict, criteria: dict) -> JDConfig:
    mode = str(criteria.get("workplace_mode", ""))
    return JDConfig(
        primary_location=str(jd.get("primary_location", "") or ""),
        # A remote role never blocks on location, exactly as the screening flow
        # never asks about relocation for one.
        role_is_remote=mode == "WFH",
        required_work_model=WORKPLACE_WORDS.get(mode, UNSPECIFIED_MODE),
        # Lakhs -> rupees. Miss this and every expected CTC looks astronomical.
        # Infinity for a JD with no stated budget: nothing can exceed it, and
        # the answer itself is withheld below so the sentence never renders.
        budget_max_ctc=criteria["max_budget"] * 1e5 if "max_budget" in criteria else float("inf"),
        notice_max_days=int(criteria["max_notice"]) if "max_notice" in criteria else 10 ** 6,
    )


def assess(resume: dict, jd: dict) -> dict | None:
    """The joining verdict for one screened candidate, or None if there isn't one.

    `resume` and `jd` are the Chroma metadata dicts as they come out of the
    vector store. None means "nothing to show" — nobody has screened this
    candidate, or nothing they answered is measured against a criterion — and
    the UI renders a dash rather than a verdict nobody earned.
    """
    screening = _loads(resume.get("hr_screening"), {}) or {}
    responses = _loads(screening.get("responses"), {}) or {}
    heard = _loads(screening.get("heard"), {}) or {}

    answers = {key: _at(responses, index) for key, index in INDEX.items()}
    if not any(answers[key] for key in ASSESSABLE):
        return None

    criteria = _loads(jd.get("role_criteria"), {}) or {}
    config = _config(jd, criteria)

    evidence = {}
    for criterion, keys in EVIDENCE.items():
        for key in keys:
            said = _at(heard, INDEX[key]) or (answers[key] if _quotable(answers[key]) else "")
            if said:
                evidence[criterion] = said
                break

    # The candidate's own location against the requisition's. None — "we don't
    # know" — whenever either side is blank, which is never a flag.
    location = answers["current_location"]
    matches_location = (
        same_location(location, config.primary_location)
        if location and config.primary_location
        else None
    )

    # The flow asks the notice period down one of two branches: how many days
    # are *left* (already serving) or what the duration *would be* (would resign
    # if selected). Either is the number the requisition's ceiling is measured
    # against, so take whichever arm the candidate went down.
    notice = _number(answers["notice_days"])
    if notice is None:
        notice = _number(answers["notice_days_left"])
    if "max_notice" not in criteria:
        notice = None  # no stated ceiling, so no verdict — see job 3.

    expected_ctc = _number(answers["expected_ctc"]) if "max_budget" in criteria else None

    # Two different ways a candidate takes themselves out, both WITHDRAWN — the
    # bucket the evaluator deliberately keeps separate from LOW, because they
    # left rather than us rejecting them.
    #
    # `still_interested` is the direct question, and it is new: it comes from the
    # workbook's second sheet, which had not been implemented when this module
    # was written. Until it existed, interest could only be *inferred* from the
    # resign gate — flagged at the time as the one place this file guessed
    # rather than mapped. It no longer has to.
    #
    # `willing_to_resign` stays alongside it, because it is a genuinely separate
    # refusal: a candidate can want the job and still not commit to leaving
    # their current employer, and our flow ends the screening on either.
    interested = answers["still_interested"]
    resigning = answers["willing_to_resign"]
    withdrew = interested == "no" or resigning in ("no", "maybe")

    if interested == "no":
        spoken = _at(heard, INDEX["still_interested"])
        evidence[Criterion.INTEREST.value] = (
            "Answered no when asked whether they are still interested in this job."
            + (f' On the call: "{spoken}"' if spoken else "")
        )
    elif resigning in ("no", "maybe"):
        # Here the evaluator's stock reason ("no longer interested in the role")
        # is NOT the question that was put, so the evidence spells out the one
        # that was — HR must never read a verdict against a question nobody asked.
        spoken = _at(heard, INDEX["willing_to_resign"])
        evidence[Criterion.INTEREST.value] = (
            f'Answered "{resigning}" when asked whether they would resign at their '
            f'current company if selected.'
            + (f' On the call: "{spoken}"' if spoken else "")
        )

    screening_answers = ScreeningAnswers(
        still_interested=not withdrew,
        location_matches_primary=matches_location,
        willing_to_relocate=_yes_no(answers["relocate"]),
        comfortable_with_work_model=_yes_no(answers["ok_workplace"]),
        # Read off the resume, never asked — the same source the flow's step-3.5
        # employment gate uses, so an unemployed candidate is not judged on a
        # notice period they were never asked about.
        is_currently_employed=EMPLOYMENT.get(str(resume.get("currently_employed", "")), True),
        notice_days=int(notice) if notice is not None else None,
        buyout_available=_yes_no(answers["buyout"]),
        has_documents=_yes_no(answers["bgc_documents"]),
        # "Have you interviewed elsewhere" is the competition; "do you have or
        # expect an offer letter" is what makes it advanced-stage, and therefore
        # a renege risk. `other_offer` is only ever asked when the first is yes.
        has_competing_offers=answers["interviewed_elsewhere"] == "yes" or answers["other_offer"] == "yes",
        competing_offer_advanced=answers["other_offer"] == "yes",
        expected_ctc=expected_ctc,
        # Tri-state, NOT coerced to False. This used to read `or False`, which was
        # harmless while both branches of the CTC rule were SOFT. It is not
        # harmless now: `False` is the branch that makes an over-budget candidate
        # a dealbreaker, so collapsing "never asked" into "not negotiable" would
        # rate someone LOW on a question nobody put to them.
        willing_to_negotiate_ctc=_yes_no(answers["negotiable"]),
        evidence=evidence,
    )

    result = assess_joining(
        candidate_id=str(resume.get("uuid", "")),
        answers=screening_answers,
        jd=config,
        candidate_name=resume.get("candidate_name") or None,
    )

    # `has_competing_offers` is a plain bool with no "unknown", so a candidate
    # nobody asked about other processes is scored as having none and credited
    # with "No competing offers" — a criterion they were never measured on.
    # Dropping the match is cosmetic and only cosmetic: the category is decided
    # by flags, and an unasked question cannot produce one.
    if not (answers["interviewed_elsewhere"] or answers["other_offer"]):
        result.matched_criteria = [
            match for match in result.matched_criteria
            if match.criterion != Criterion.COMPETING_OFFERS
        ]
        if result.summary.startswith("High likelihood"):
            result.summary = (
                f"High likelihood — all {len(result.matched_criteria)} joining criteria "
                f"met, no red flags."
            )

    return result.model_dump(mode="json")


# The call answers whose form field holds the sentence itself. Every other flow
# answer is a parsed value ("yes", "400000") taken only from the call's own
# reading: a raw sentence there would count as answered yet parse as unknown,
# which is the empty-screening-reads-HIGH trap of job 4.
_SENTENCE_FORMATS = {script.TEXT, script.AVAILABILITY, script.FLOW["current_location"][1]}
UNPROMPTED = "Mentioned unprompted: "  # the modal's mark on a volunteered sentence


def with_call(screening, call_answers: dict) -> dict:
    """HR's saved screening with the call's answers filling only the fields HR
    left empty: what the modal shows on open (answersFromCall in
    HrScreeningModal.tsx), so whatever HR saved still wins.

    `screening` is the stored `hr_screening` (JSON string, dict or None);
    `call_answers` is `{index: {"transcript", "status", "volunteered", "value"}}`
    as GET /interview/{id} serves it.
    """
    screening = _loads(screening, {}) or {}
    responses = dict(_loads(screening.get("responses"), {}) or {})
    spoken = {}
    for index, answer in call_answers.items():
        transcript = str(answer.get("transcript") or "")
        if answer.get("status") != "done" or not transcript:
            continue
        position = int(index) - FLOW_INDEX_BASE
        key = FLOW_QUESTIONS[position][0] if 0 <= position < len(FLOW_QUESTIONS) else ""
        sentence = key not in script.FLOW or script.FLOW[key][1] in _SENTENCE_FORMATS
        value = answer.get("value") or (transcript if sentence else "")
        if not sentence or answer.get("value") or answer.get("volunteered"):
            spoken[str(index)] = (UNPROMPTED if answer.get("volunteered") else "") + transcript
        if value and not _at(responses, int(index)):
            responses[str(index)] = value
    saved_heard = _loads(screening.get("heard"), {}) or {}
    heard = {**spoken, **{str(k): v for k, v in saved_heard.items()}}
    return {**screening, "responses": responses, "heard": heard}


def demo() -> None:
    jd = {
        "primary_location": "Pune",
        "role_criteria": json.dumps({
            "min_budget": 15.0, "max_budget": 18.0,
            "min_notice": 30.0, "max_notice": 60.0,
            "workplace_mode": "Hybrid", "buyout_offered": "no",
        }),
    }

    def screened(**by_key) -> dict:
        """A resume whose HR screening answered exactly these flow questions."""
        employed = by_key.pop("_employed", "yes")
        return {
            "uuid": "r1",
            "candidate_name": "Test Candidate",
            "currently_employed": employed,
            "hr_screening": json.dumps({
                "responses": {str(INDEX[key]): value for key, value in by_key.items()},
                "heard": {},
            }),
        }

    # Every flow key this module names must exist, or a rename upstream would
    # silently start reading "" for a question that is still being asked.
    for key in ASSESSABLE | {"right_time", "callback_time", "current_ctc", "join_reason"}:
        assert key in INDEX, key
    for keys in EVIDENCE.values():
        for key in keys:
            assert key in INDEX, key
    # `self_intro` is deliberately not assessable: it is a free-text warm-up with
    # no criterion behind it, so an intro on its own is not a screening.
    assert set(INDEX) == ASSESSABLE | {
        "right_time", "callback_time", "self_intro", "offer_details",
        "interview_stage", "current_ctc", "join_reason",
        # When they can sit the next round: scheduling, not likelihood to join.
        "r1_availability",
    }, "a flow question was added — decide whether a criterion measures it"

    # ── Nothing to assess ───────────────────────────────────────────────────
    assert assess({"uuid": "r1"}, jd) is None, "never screened"
    assert assess(screened(), jd) is None, "screening saved with no answers"
    # The single most important case in this file: a candidate who was reached,
    # said it was a bad time and answered nothing else must not read HIGH.
    assert assess(screened(right_time="no", callback_time="after 6pm"), jd) is None

    # ── HIGH ────────────────────────────────────────────────────────────────
    high = assess(screened(
        current_location="Pune", ok_workplace="yes",
        on_notice="yes", notice_days_left="30",
        buyout="no", bgc_documents="yes",
        interviewed_elsewhere="no",
        expected_ctc="1600000", negotiable="yes",
    ), jd)
    assert high["join_category"] == "HIGH", high
    assert high["red_flags"] == []
    assert high["candidate_name"] == "Test Candidate"
    matched = {m["criterion"] for m in high["matched_criteria"]}
    assert matched == {"location", "work_model", "notice", "documents", "ctc", "competing_offers"}, matched
    assert f"all {len(high['matched_criteria'])} joining" in high["summary"], high["summary"]

    # ── MEDIUM: exactly one soft flag ───────────────────────────────────────
    # Documents not ready. This used to use a 90-day notice, which is no longer
    # soft — the team's v2 made an over-limit notice with no buyout a
    # dealbreaker, and that is asserted below under "notice ... now a
    # dealbreaker".
    medium = assess(screened(
        current_location="Pune", ok_workplace="yes",
        on_notice="no", willing_to_resign="yes", notice_days="30",
        bgc_documents="no", interviewed_elsewhere="no",
        expected_ctc="1600000", negotiable="yes",
    ), jd)
    assert medium["join_category"] == "MEDIUM", medium
    assert [f["criterion"] for f in medium["red_flags"]] == ["documents"]
    assert medium["red_flags"][0]["severity"] == "soft", medium["red_flags"][0]

    # ── The requisition's own ceiling is what HR is quoted, not a default ───
    over_notice = assess(screened(
        current_location="Pune", ok_workplace="yes",
        on_notice="no", willing_to_resign="yes", notice_days="90", buyout="no",
        bgc_documents="yes", interviewed_elsewhere="no",
        expected_ctc="1600000", negotiable="yes",
    ), jd)
    assert [f["criterion"] for f in over_notice["red_flags"]] == ["notice"]
    assert "60" in over_notice["red_flags"][0]["reason"], over_notice["red_flags"][0]

    # ── LOW: one hard flag is enough on its own ─────────────────────────────
    low_hard = assess(screened(
        current_location="Chennai", relocate="no", ok_workplace="yes",
        on_notice="yes", notice_days_left="15", buyout="no",
        bgc_documents="yes", interviewed_elsewhere="no",
        expected_ctc="1600000", negotiable="yes",
    ), jd)
    assert low_hard["join_category"] == "LOW", low_hard
    hard = [f for f in low_hard["red_flags"] if f["severity"] == "hard"]
    assert [f["criterion"] for f in hard] == ["location"], low_hard["red_flags"]
    assert "Pune" in hard[0]["reason"]

    # ── WITHDRAWN via the direct question ───────────────────────────────────
    # The one this module used to have no source for. Saying no to "are you
    # still interested" is a withdrawal on its own, whatever else was answered.
    out = assess(screened(
        still_interested="no",
        current_location="Pune", ok_workplace="yes", bgc_documents="yes",
    ), jd)
    assert out["join_category"] == "WITHDRAWN", out
    assert "still interested" in out["red_flags"][0]["evidence"], out["red_flags"][0]
    # …and a plain yes is not a withdrawal, nor does it flag anything.
    assert assess(screened(
        still_interested="yes",
        current_location="Pune", ok_workplace="yes", bgc_documents="yes",
        interviewed_elsewhere="no", _employed="no",
    ), jd)["join_category"] == "HIGH"
    # An intro alone is not a screening — no criterion measures it.
    assert assess(screened(self_intro="I'm a data engineer with six years"), jd) is None

    # ── WITHDRAWN: the candidate ruled themselves out ───────────────────────
    for answer in ("no", "maybe"):
        out = assess(screened(
            current_location="Pune", ok_workplace="yes",
            on_notice="no", willing_to_resign=answer,
        ), jd)
        assert out["join_category"] == "WITHDRAWN", (answer, out)
        # …and the evidence names the question that was actually put, since the
        # evaluator's stock reason says "no longer interested in the role".
        assert f'"{answer}"' in out["red_flags"][0]["evidence"], out["red_flags"][0]
        assert "resign" in out["red_flags"][0]["evidence"], out["red_flags"][0]
    # "yes" is not a withdrawal.
    assert assess(screened(
        current_location="Pune", ok_workplace="yes",
        on_notice="no", willing_to_resign="yes", notice_days="30",
    ), jd)["join_category"] == "HIGH"

    # ── Units: budget is lakhs, the answer is rupees ────────────────────────
    over = assess(screened(
        current_location="Pune", ok_workplace="yes", bgc_documents="yes",
        interviewed_elsewhere="no", expected_ctc="2200000", negotiable="no",
        _employed="no",
    ), jd)
    assert [f["criterion"] for f in over["red_flags"]] == ["ctc"], over
    assert "1,800,000" in over["red_flags"][0]["reason"], over["red_flags"][0]
    # 18 lakhs read as 18 rupees would flag this one too — the trap this guards.
    assert assess(screened(
        current_location="Pune", ok_workplace="yes", bgc_documents="yes",
        interviewed_elsewhere="no", expected_ctc="1700000", negotiable="yes",
        _employed="no",
    ), jd)["red_flags"] == []

    # ── Over budget: the negotiation answer sets the severity ───────────────
    # The local divergence in joining_evaluator._eval_ctc. Without these three
    # cases nothing catches a silent revert to "any over-budget CTC is LOW",
    # which would make the negotiation question unable to change any outcome.
    def ctc_case(**kw):
        return assess(screened(
            current_location="Pune", ok_workplace="yes", bgc_documents="yes",
            interviewed_elsewhere="no", expected_ctc="1900000", _employed="no", **kw,
        ), jd)

    firm = ctc_case(negotiable="no")
    assert firm["join_category"] == "LOW", firm
    assert firm["red_flags"][0]["severity"] == "hard", firm["red_flags"][0]
    assert "not negotiable" in firm["red_flags"][0]["reason"], firm["red_flags"][0]

    open_to_talk = ctc_case(negotiable="yes")
    assert open_to_talk["join_category"] == "MEDIUM", open_to_talk
    assert open_to_talk["red_flags"][0]["severity"] == "soft", open_to_talk["red_flags"][0]

    # Never asked must not read as "not negotiable" — unknown never escalates.
    assert ctc_case()["join_category"] == "MEDIUM", ctc_case()

    # ── Adopted from the team's v2: two soft flags no longer make LOW ───────
    # Paperwork not ready plus another offer in play is two risks, not a
    # dealbreaker. It used to rate the same as refusing to relocate.
    two_soft = assess(screened(
        current_location="Pune", ok_workplace="yes", bgc_documents="no",
        interviewed_elsewhere="yes", other_offer="yes", expected_ctc="1600000",
        _employed="no",
    ), jd)
    assert {f["severity"] for f in two_soft["red_flags"]} == {"soft"}, two_soft
    assert len(two_soft["red_flags"]) == 2, two_soft
    assert two_soft["join_category"] == "MEDIUM", two_soft

    # ── Adopted from the team's v2: notice over the limit is now a dealbreaker
    long_notice = assess(screened(
        current_location="Pune", ok_workplace="yes", bgc_documents="yes",
        on_notice="yes", notice_days_left="90", buyout="no",
        interviewed_elsewhere="no", expected_ctc="1600000",
    ), jd)
    assert long_notice["join_category"] == "LOW", long_notice
    # …unless the candidate can buy it out, which is why we ask.
    bought_out = assess(screened(
        current_location="Pune", ok_workplace="yes", bgc_documents="yes",
        on_notice="yes", notice_days_left="90", buyout="yes",
        interviewed_elsewhere="no", expected_ctc="1600000",
    ), jd)
    assert bought_out["join_category"] == "HIGH", bought_out

    # ── An unemployed candidate is not judged on a notice period ────────────
    jobless = assess(screened(
        current_location="Pune", ok_workplace="yes", bgc_documents="yes",
        interviewed_elsewhere="no", expected_ctc="1600000", _employed="no",
    ), jd)
    assert jobless["join_category"] == "HIGH", jobless
    assert any(m["criterion"] == "notice" and "unemployed" in m["reason"]
               for m in jobless["matched_criteria"]), jobless["matched_criteria"]

    # ── Competing offers ────────────────────────────────────────────────────
    base = dict(
        current_location="Pune", ok_workplace="yes", bgc_documents="yes",
        expected_ctc="1600000", _employed="no",
    )
    # Interviewing but no offer yet is competition, not a renege risk.
    early = assess(screened(**base, interviewed_elsewhere="yes", other_offer="no",
                            interview_stage="first round with two firms"), jd)
    assert early["join_category"] == "HIGH", early
    assert any(m["criterion"] == "competing_offers" for m in early["matched_criteria"])
    # An offer in hand or expected is.
    advanced = assess(screened(**base, interviewed_elsewhere="yes", other_offer="yes",
                               offer_details="Infosys, 19 LPA, offer in hand"), jd)
    assert [f["criterion"] for f in advanced["red_flags"]] == ["competing_offers"], advanced
    assert advanced["join_category"] == "MEDIUM"
    assert advanced["red_flags"][0]["evidence"] == "Infosys, 19 LPA, offer in hand"
    # Nobody asked -> no flag *and* no unearned credit for having no offers.
    unasked = assess(screened(**base), jd)
    assert not any(m["criterion"] == "competing_offers" for m in unasked["matched_criteria"])
    assert unasked["join_category"] == "HIGH"
    assert "all 5 joining criteria" in unasked["summary"], unasked["summary"]

    # ── A remote role never blocks on location ──────────────────────────────
    remote_jd = {**jd, "role_criteria": json.dumps({
        **json.loads(jd["role_criteria"]), "workplace_mode": "WFH",
    })}
    remote = assess(screened(current_location="Chennai", relocate="no", ok_workplace="yes",
                             bgc_documents="yes", _employed="no"), remote_jd)
    assert remote["join_category"] == "HIGH", remote
    assert any("remote" in m["reason"] for m in remote["matched_criteria"])

    # ── A JD from before role_criteria: no threshold, no verdict ────────────
    bare = {"primary_location": "Pune"}
    legacy = assess(screened(
        current_location="Pune", ok_workplace="yes", bgc_documents="yes",
        on_notice="no", willing_to_resign="yes", notice_days="180",
        interviewed_elsewhere="no", expected_ctc="9000000", negotiable="no",
    ), bare)
    assert legacy["red_flags"] == [], legacy
    assert not any(m["criterion"] in ("notice", "ctc") for m in legacy["matched_criteria"]), legacy
    # …and the work model it never stated is not reported as one.
    refused = assess(screened(current_location="Pune", ok_workplace="no"), bare)
    assert refused["join_category"] == "LOW"
    assert UNSPECIFIED_MODE in refused["red_flags"][0]["reason"], refused["red_flags"][0]

    # ── The stored shapes: string keys out of Chroma, dicts in memory ───────
    as_dicts = {
        "uuid": "r1",
        "currently_employed": "no",
        "hr_screening": {
            "responses": {INDEX["current_location"]: "Pune", INDEX["ok_workplace"]: "no"},
            "heard": {INDEX["ok_workplace"]: "honestly no, I can't come to office"},
        },
    }
    from_dicts = assess(as_dicts, jd)
    assert from_dicts["join_category"] == "LOW", from_dicts
    assert from_dicts["red_flags"][0]["evidence"] == "honestly no, I can't come to office"
    # Corrupt metadata is "nothing screened", never a traceback in a listing.
    assert assess({"uuid": "r1", "hr_screening": "{not json"}, jd) is None

    # ── Straight off the call, before HR has saved anything ─────────────────
    def heard_on_call(value, transcript, volunteered=False):
        return {"transcript": transcript, "status": "done", "volunteered": volunteered, "value": value}

    call = {
        INDEX["current_location"]: heard_on_call("Pune", "I live in Pune"),
        INDEX["ok_workplace"]: heard_on_call("no", "no, I can't come to office"),
        # Understood nothing: a parsed field stays empty rather than holding a sentence.
        INDEX["expected_ctc"]: heard_on_call("", "quite a lot honestly"),
        INDEX["notice_days"]: {"transcript": "sixty", "status": "pending", "value": "60"},
    }
    unsaved = with_call(None, call)
    assert unsaved["responses"] == {str(INDEX["current_location"]): "Pune",
                                    str(INDEX["ok_workplace"]): "no"}, unsaved
    called = assess({"uuid": "r1", "currently_employed": "no", "hr_screening": unsaved}, jd)
    assert called["join_category"] == "LOW", called
    assert called["red_flags"][0]["evidence"] == "no, I can't come to office", called
    # What HR saved outranks the call, field by field.
    saved = with_call(screened(ok_workplace="yes")["hr_screening"], call)
    assert saved["responses"][str(INDEX["ok_workplace"])] == "yes", saved
    assert saved["responses"][str(INDEX["current_location"])] == "Pune", saved
    # A sentence with nothing parsed out of it is not a screening (job 4).
    assert assess({"uuid": "r1", "hr_screening": with_call(None, {
        INDEX["still_interested"]: heard_on_call("", "hmm let me think")})}, jd) is None
    assert with_call(None, {INDEX["join_reason"]: heard_on_call("", "great AI work", True)})[
        "heard"][str(INDEX["join_reason"])] == UNPROMPTED + "great AI work"

    print("joining_assessment: all checks passed")


if __name__ == "__main__":
    demo()
