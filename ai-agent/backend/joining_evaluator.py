"""
joining_evaluator.py
--------------------
Deterministic joining-likelihood categorizer for the TalentAgent HR screening pipeline.

Runs POST-CALL on the collected + extracted answers (answers.json).
It does NOT talk to the LLM — extraction (fuzzy transcript -> structured values)
happens upstream. This module only applies fixed rules, so the result is
100% deterministic, auditable, and testable.

Output per candidate:
  - join_category : HIGH | MEDIUM | LOW | WITHDRAWN
  - red_flags     : criteria that did NOT meet the standard (with evidence)
  - matched_criteria : criteria that DID meet the standard (the "why more likely")
  - summary       : one-line human explanation

Category logic:
  - any HARD flag            -> LOW    (only hard flags can produce LOW)
  - no hard, but any SOFT    -> MEDIUM (soft flags never push to LOW)
  - no flags                 -> HIGH
  - candidate not interested -> WITHDRAWN (self-withdrawal, kept separate)

Criterion -> severity:
  location    : HARD  (mismatch + role not remote + won't relocate)
  work_model  : HARD  (not comfortable with required mode)
  ctc         : HARD if over budget and NOT negotiable, else SOFT   <- see below
  notice      : HARD  (notice > limit and no buyout; N/A if unemployed)
  documents   : SOFT  (employment/education verification docs not ready)
  competing_offers : SOFT (advanced-stage offer in hand -> renege risk)

LOCAL DIVERGENCE from the version circulated by the team: theirs makes any
over-budget CTC HARD and marks `willing_to_negotiate_ctc` unused. We ask the
negotiation question on every call because the manager's spec requires it, so
here it sets the severity instead of being ignored. `_eval_ctc` is the only
function changed; the rest of this file is theirs verbatim.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional, Union

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# Enums
# --------------------------------------------------------------------------- #
class JoinCategory(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    WITHDRAWN = "WITHDRAWN"


class Severity(str, Enum):
    HARD = "hard"   # dealbreaker -> forces LOW
    SOFT = "soft"   # risk -> caps the candidate at MEDIUM (never LOW)


class Criterion(str, Enum):
    LOCATION = "location"
    WORK_MODEL = "work_model"
    CTC = "ctc"
    NOTICE = "notice"
    DOCUMENTS = "documents"            # renamed from "bgc"
    COMPETING_OFFERS = "competing_offers"
    INTEREST = "interest"


# --------------------------------------------------------------------------- #
# INPUT SCHEMA  (contract for Rahul / Tarun)
# Optional fields that can be "unknown" -> unknown means "no flag" (never auto-reject on noise).
# --------------------------------------------------------------------------- #
class JDConfig(BaseModel):
    """Per-JD thresholds. Filled from the JD-fetched fields in the sheet."""
    primary_location: str
    role_is_remote: bool = False          # True -> location never blocks
    required_work_model: str = "hybrid"   # e.g. "onsite" | "hybrid" | "remote"
    budget_max_ctc: float                 # annual, same unit as expected_ctc
    notice_max_days: int = 60


class ScreeningAnswers(BaseModel):
    # Q2 - still interested?
    still_interested: bool = True

    # Q3 - location
    location_matches_primary: Optional[bool] = None
    willing_to_relocate: Optional[bool] = None

    # Q4 - work model
    comfortable_with_work_model: Optional[bool] = None

    # From resume - employment status (drives notice applicability)
    is_currently_employed: bool = True

    # Q5 / Q6 - notice period + buyout
    notice_days: Optional[int] = None
    buyout_available: Optional[bool] = None

    # Q7 - verification documents (employment + education)
    has_documents: Optional[bool] = None

    # Q8 - competing offers
    has_competing_offers: bool = False
    competing_offer_advanced: bool = False   # offer-in-hand / final round = True

    # Q9 / Q10 / Q11 - CTC
    expected_ctc: Optional[float] = None
    willing_to_negotiate_ctc: Optional[bool] = None   # currently unused (over budget = hard)

    # Optional raw transcript snippet per criterion (key = Criterion value)
    evidence: dict[str, str] = Field(default_factory=dict)


# --------------------------------------------------------------------------- #
# OUTPUT SCHEMA
# --------------------------------------------------------------------------- #
class Flag(BaseModel):
    criterion: Criterion
    severity: Severity
    reason: str
    evidence: Optional[str] = None


class Match(BaseModel):
    criterion: Criterion
    reason: str


class JoiningAssessment(BaseModel):
    candidate_id: str
    candidate_name: Optional[str] = None
    join_category: JoinCategory
    red_flags: list[Flag]
    matched_criteria: list[Match]
    summary: str


Result = Union[Flag, Match, None]


# --------------------------------------------------------------------------- #
# Per-criterion rules
# --------------------------------------------------------------------------- #
def _eval_location(a: ScreeningAnswers, jd: JDConfig, ev: dict) -> Result:
    c = Criterion.LOCATION
    if jd.role_is_remote:
        return Match(criterion=c, reason="Role is remote; location is not a constraint")
    if a.location_matches_primary is True:
        return Match(criterion=c, reason=f"Location matches primary work location ({jd.primary_location})")
    if a.location_matches_primary is False:
        if a.willing_to_relocate is True:
            return Match(criterion=c, reason=f"Location mismatch but willing to relocate to {jd.primary_location}")
        if a.willing_to_relocate is False:
            return Flag(criterion=c, severity=Severity.HARD,
                        reason=f"Location does not match {jd.primary_location}, role is not remote, "
                               f"and candidate will not relocate",
                        evidence=ev.get(c.value))
    return None


def _eval_work_model(a: ScreeningAnswers, jd: JDConfig, ev: dict) -> Result:
    c = Criterion.WORK_MODEL
    if a.comfortable_with_work_model is False:
        return Flag(criterion=c, severity=Severity.HARD,
                    reason=f"Not comfortable with the required work model ({jd.required_work_model})",
                    evidence=ev.get(c.value))
    if a.comfortable_with_work_model is True:
        return Match(criterion=c, reason=f"Comfortable with {jd.required_work_model} work model")
    return None


def _eval_ctc(a: ScreeningAnswers, jd: JDConfig, ev: dict) -> Result:
    c = Criterion.CTC
    if a.expected_ctc is None:
        return None
    if a.expected_ctc <= jd.budget_max_ctc:
        return Match(criterion=c, reason="Expected CTC within budget")

    # ---- THE ONE PLACE THIS FILE DIVERGES FROM THE VERSION SENT BY THE TEAM ----
    # Theirs returns HARD for any over-budget figure, with the comment that
    # `willing_to_negotiate_ctc` is "currently unused". We ask that question --
    # "is your expected CTC negotiable?" -- on every screening because the
    # manager's spec sheet requires it, so a rule that ignores the answer means
    # asking a question that can change nothing. Here the answer sets severity:
    #
    #   negotiable = no      -> HARD. They named a number and won't move off it.
    #   negotiable = yes     -> SOFT. Over budget, but there is a conversation.
    #   negotiable = unknown -> SOFT. Never escalate on an answer we don't have;
    #                           this file's own rule is that unknown must not
    #                           auto-reject on noise.
    #
    # Everything else in this file is theirs, unmodified. If the negotiation
    # question is ever dropped from the flow, delete this block and take theirs.
    if a.willing_to_negotiate_ctc is False:
        return Flag(criterion=c, severity=Severity.HARD,
                    reason=f"Expected CTC ({a.expected_ctc:,.0f}) exceeds budget "
                           f"({jd.budget_max_ctc:,.0f}) and is not negotiable",
                    evidence=ev.get(c.value))
    return Flag(criterion=c, severity=Severity.SOFT,
                reason=f"Expected CTC ({a.expected_ctc:,.0f}) exceeds budget "
                       f"({jd.budget_max_ctc:,.0f}) but is open to negotiation",
                evidence=ev.get(c.value))


def _eval_notice(a: ScreeningAnswers, jd: JDConfig, ev: dict) -> Result:
    c = Criterion.NOTICE
    if not a.is_currently_employed:
        return Match(criterion=c, reason="Currently unemployed; immediately available")
    if a.notice_days is None:
        return None
    if a.notice_days <= jd.notice_max_days:
        return Match(criterion=c, reason=f"Notice {a.notice_days}d within limit ({jd.notice_max_days}d)")
    if a.buyout_available is True:
        # buyout resolves the long notice -> not a flag
        return Match(criterion=c, reason=f"Notice {a.notice_days}d over limit but buyout available")
    # over limit and no buyout -> HARD (dealbreaker)
    return Flag(criterion=c, severity=Severity.HARD,
                reason=f"Notice period {a.notice_days}d exceeds limit ({jd.notice_max_days}d) with no buyout",
                evidence=ev.get(c.value))


def _eval_documents(a: ScreeningAnswers, ev: dict) -> Result:
    c = Criterion.DOCUMENTS
    if a.has_documents is True:
        return Match(criterion=c, reason="Has required employment/education documents ready")
    if a.has_documents is False:
        return Flag(criterion=c, severity=Severity.SOFT,
                    reason="Employment/education verification documents not ready",
                    evidence=ev.get(c.value))
    return None


def _eval_offers(a: ScreeningAnswers, ev: dict) -> Result:
    c = Criterion.COMPETING_OFFERS
    if not a.has_competing_offers:
        return Match(criterion=c, reason="No competing offers")
    if a.competing_offer_advanced:
        return Flag(criterion=c, severity=Severity.SOFT,
                    reason="Holds/expects an advanced-stage competing offer (renege risk)",
                    evidence=ev.get(c.value))
    return Match(criterion=c, reason="Only early-stage offers; low competition risk")


# --------------------------------------------------------------------------- #
# Main evaluator
# --------------------------------------------------------------------------- #
def _build_summary(category: JoinCategory, red_flags: list[Flag], matched: list[Match]) -> str:
    if category == JoinCategory.HIGH:
        return f"High likelihood — all {len(matched)} joining criteria met, no red flags."
    hard = [f.criterion.value for f in red_flags if f.severity == Severity.HARD]
    soft = [f.criterion.value for f in red_flags if f.severity == Severity.SOFT]
    parts = []
    if hard:
        parts.append(f"dealbreaker: {', '.join(hard)}")
    if soft:
        parts.append(f"risk: {', '.join(soft)}")
    label = "Low" if category == JoinCategory.LOW else "Medium"
    return f"{label} likelihood — " + " | ".join(parts)


def assess_joining(
    candidate_id: str,
    answers: ScreeningAnswers,
    jd: JDConfig,
    candidate_name: Optional[str] = None,
) -> JoiningAssessment:
    """Pure function: (answers, jd) -> JoiningAssessment. No side effects."""
    ev = answers.evidence

    # Self-withdrawal (Q2 = No) short-circuits everything.
    if not answers.still_interested:
        return JoiningAssessment(
            candidate_id=candidate_id,
            candidate_name=candidate_name,
            join_category=JoinCategory.WITHDRAWN,
            red_flags=[Flag(criterion=Criterion.INTEREST, severity=Severity.HARD,
                            reason="Candidate said they are no longer interested in the role",
                            evidence=ev.get(Criterion.INTEREST.value))],
            matched_criteria=[],
            summary="Withdrawn — candidate is no longer interested.",
        )

    results = [
        _eval_location(answers, jd, ev),
        _eval_work_model(answers, jd, ev),
        _eval_ctc(answers, jd, ev),
        _eval_notice(answers, jd, ev),
        _eval_documents(answers, ev),
        _eval_offers(answers, ev),
    ]

    red_flags = [r for r in results if isinstance(r, Flag)]
    matched = [r for r in results if isinstance(r, Match)]

    has_hard = any(f.severity == Severity.HARD for f in red_flags)
    has_soft = any(f.severity == Severity.SOFT for f in red_flags)

    if has_hard:
        category = JoinCategory.LOW          # only hard flags produce LOW
    elif has_soft:
        category = JoinCategory.MEDIUM       # any soft flag caps at MEDIUM
    else:
        category = JoinCategory.HIGH

    return JoiningAssessment(
        candidate_id=candidate_id,
        candidate_name=candidate_name,
        join_category=category,
        red_flags=red_flags,
        matched_criteria=matched,
        summary=_build_summary(category, red_flags, matched),
    )


# --------------------------------------------------------------------------- #
# Demo — run `python joining_evaluator.py`
# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    import json

    jd = JDConfig(
        primary_location="Pune",
        role_is_remote=False,
        required_work_model="hybrid",
        budget_max_ctc=1_800_000,
        notice_max_days=60,
    )

    samples = {
        "HIGH candidate": ScreeningAnswers(
            location_matches_primary=True,
            comfortable_with_work_model=True,
            is_currently_employed=True,
            notice_days=30,
            has_documents=True,
            expected_ctc=1_600_000,
        ),
        "MEDIUM candidate (soft flag only)": ScreeningAnswers(
            location_matches_primary=True,
            comfortable_with_work_model=True,
            notice_days=30,
            has_documents=False,                 # soft flag -> MEDIUM
            expected_ctc=1_700_000,
        ),
        "LOW candidate (CTC over budget = hard)": ScreeningAnswers(
            location_matches_primary=True,
            comfortable_with_work_model=True,
            notice_days=30,
            has_documents=True,
            expected_ctc=2_200_000,              # over budget -> HARD -> LOW
            evidence={"ctc": "22 lakh se kam pe main move nahi karunga"},
        ),
        "WITHDRAWN candidate": ScreeningAnswers(still_interested=False),
    }

    for name, ans in samples.items():
        res = assess_joining(f"demo_{name}", ans, jd, candidate_name=name)
        print("=" * 70)
        print(name, "->", res.join_category.value)
        print(json.dumps(res.model_dump(), indent=2, ensure_ascii=False))
