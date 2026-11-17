"""The job id is a JD's identity: the fixed prefix EXL plus six digits.

It replaces the generated uuid as the primary key, so every JD carries the same
id HR quotes in a requisition — and two JDs can never share one.
"""

import re

PREFIX = "EXL"
_SIX_DIGITS = re.compile(r"^\d{6}$")


def normalize_job_id(raw: str) -> str:
    """'267432' or 'exl267432' -> 'EXL267432'. Raises ValueError on anything else.

    HR types only the digits (the form shows EXL as a fixed prefix), but an id
    pasted from elsewhere arrives with the prefix already on it — both are the
    same job, so both normalize to one key.
    """
    value = re.sub(r"\s+", "", raw or "").upper()

    if value.startswith(PREFIX):
        value = value[len(PREFIX):]

    if not _SIX_DIGITS.match(value):
        raise ValueError("Job ID must be exactly 6 digits, for example EXL267432")

    return PREFIX + value


def demo() -> None:
    assert normalize_job_id("267432") == "EXL267432"
    assert normalize_job_id("EXL267432") == "EXL267432"
    assert normalize_job_id(" exl 267 432 ") == "EXL267432"
    assert normalize_job_id("000000") == "EXL000000"

    for bad in ["", "12345", "1234567", "26743a", "EXL", "EXLEXL267432", "-26743", None]:
        try:
            normalize_job_id(bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted a bad job id: {bad!r}")

    print("job_id: all checks passed")


if __name__ == "__main__":
    demo()
