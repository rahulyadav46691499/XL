"""The requisition's hiring constraints — typed, unlike the screening answers.

HR states these once per JD and they are what the candidate screening flow
branches on (`frontend/lib/screening-flow.ts`): a candidate under
`min_experience` ends the interview there, an expected CTC over `max_budget`
triggers the negotiation question, a location other than the JD's triggers the
relocation question.

They are a **separate** metadata field from `screening_answers` on purpose.
Adding these keys to `QUESTION_KEYS` would make `parse_answers()` demand them of
every JD already in Chroma, so editing any older requisition would start failing
with a 400.

The keys below are the storage contract; the labels and help text are copy and
live in `frontend/lib/role-criteria.ts`. Append, never reorder or rename.

Units matter and are not interchangeable: budget is in **lakhs** here because
that is what HR types, while a candidate's CTC answer is parsed into **rupees**.
Every comparison between the two multiplies by 1e5 — see `flow_rules()` in
screening_questions.py and `screening-flow.ts`.
"""

import json

from fastapi import HTTPException

# (min key, max key, label, unit) — every range is required and min must not
# exceed max.
# Experience was removed on request: HR is no longer asked for it at upload, so
# it is no longer required or validated here. JDs stored before the removal keep
# whatever they had — this list only governs what a *new* payload must contain,
# and unknown keys are dropped rather than rejected, so an old JD still edits
# cleanly. Anything reading the criteria must treat experience as optional
# (`flow_rules()` in screening_questions.py does).
RANGES = [
    ("min_budget", "max_budget", "Budget", "lakhs"),
    ("min_notice", "max_notice", "Notice period", "days"),
]

# Single-choice fields. The stored value is exactly one of these strings, which
# is what the flow's predicates compare against — matching is case-insensitive
# on the way in and normalised to the spelling here.
CHOICES = {
    "workplace_mode": ["WFO", "WFH", "Hybrid"],
    "buyout_offered": ["yes", "no"],
}

NUMERIC_KEYS = [key for entry in RANGES for key in entry[:2]]
CRITERIA_KEYS = NUMERIC_KEYS + list(CHOICES)


def fmt(value: float | int | str) -> str:
    """A number as HR would write it — no trailing '.0' on whole numbers."""
    number = float(value)
    return str(int(number)) if number.is_integer() else str(number)


def parse_criteria(raw: str | dict | None, required: bool = True) -> dict:
    """Validate the JD's role criteria and return them as a clean dict.

    Arrives as a JSON string from the multipart upload form and as a dict from
    the JSON edit endpoint, so both are accepted — the same deal as
    `parse_answers()`. Unknown keys are dropped rather than stored.

    Numbers come back as floats, not strings: they are compared against a
    candidate's answers, and re-parsing them at every comparison site is how the
    lakhs/rupees mix-up gets in.

    `required=False` allows an empty payload through (nothing to update);
    anything non-empty is still validated in full, so a JD can never end up with
    a half-set of criteria.
    """
    if not raw:
        if required:
            raise HTTPException(
                status_code=400,
                detail="The role criteria (experience, budget, workplace mode, "
                       "notice period, buyout) are required.",
            )
        return {}

    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="role_criteria is not valid JSON")

    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="role_criteria must be an object")

    criteria: dict = {}
    missing: list[str] = []

    for key in NUMERIC_KEYS:
        value = str(raw.get(key, "")).strip()
        if not value:
            missing.append(key)
            continue
        try:
            number = float(value)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"{key} must be a number, got {value!r}"
            )
        if number < 0:
            raise HTTPException(status_code=400, detail=f"{key} cannot be negative")
        criteria[key] = number

    for key, allowed in CHOICES.items():
        value = str(raw.get(key, "")).strip()
        if not value:
            missing.append(key)
            continue
        match = next((option for option in allowed if option.lower() == value.lower()), None)
        if match is None:
            raise HTTPException(
                status_code=400,
                detail=f"{key} must be one of {', '.join(allowed)}, got {value!r}",
            )
        criteria[key] = match

    if missing:
        raise HTTPException(
            status_code=400,
            detail="Set every role criterion before uploading. Missing: " + ", ".join(missing),
        )

    # Only reachable once every key is present, so the lookups below are safe.
    for min_key, max_key, label, unit in RANGES:
        if criteria[min_key] > criteria[max_key]:
            raise HTTPException(
                status_code=400,
                detail=f"{label}: the minimum ({fmt(criteria[min_key])} {unit}) is above "
                       f"the maximum ({fmt(criteria[max_key])} {unit}).",
            )

    return criteria


def demo() -> None:
    filled = {
        "min_budget": 15, "max_budget": 20,
        "min_notice": 30, "max_notice": 60,
        "workplace_mode": "Hybrid", "buyout_offered": "no",
    }
    expected = {**filled, **{key: float(filled[key]) for key in NUMERIC_KEYS}}

    assert parse_criteria(filled) == expected
    assert parse_criteria(json.dumps(filled)) == expected
    # Numbers come back as numbers, not the strings an HTML form sends.
    assert parse_criteria({**filled, "min_budget": "15"})["min_budget"] == 15.0
    # Fractions are real: 12.5 lakhs.
    assert parse_criteria({**filled, "min_budget": "12.5"})["min_budget"] == 12.5
    # Experience is no longer asked for: absent is fine, and a JD that still
    # carries it from before the removal is not rejected for it either.
    assert "min_experience" not in parse_criteria(filled)
    assert "min_experience" not in parse_criteria({**filled, "min_experience": 5})
    # Enum spelling is normalised, not merely accepted.
    assert parse_criteria({**filled, "workplace_mode": "hybrid"})["workplace_mode"] == "Hybrid"
    assert parse_criteria({**filled, "buyout_offered": "YES"})["buyout_offered"] == "yes"
    # Unknown keys dropped; nothing to update is fine only when the caller says so.
    assert "junk" not in parse_criteria({**filled, "junk": "x"})
    assert parse_criteria("", required=False) == {}

    for bad in [
        "", None, "{", "[]", "null",
        {key: value for key, value in filled.items() if key != "max_budget"},
        {**filled, "min_notice": ""},
        {**filled, "min_notice": "sixty"},
        {**filled, "min_notice": -1},
        {**filled, "workplace_mode": "Remote-ish"},
        {**filled, "buyout_offered": "maybe"},
        # A range the wrong way round is the mistake HR actually makes.
        {**filled, "min_budget": 25},
        {**filled, "max_notice": 15},
    ]:
        try:
            parse_criteria(bad)
        except HTTPException:
            continue
        raise AssertionError(f"accepted bad criteria: {bad!r}")

    assert fmt(60.0) == "60" and fmt(2.5) == "2.5" and fmt("8") == "8"

    print("role_criteria: all checks passed")


if __name__ == "__main__":
    demo()
