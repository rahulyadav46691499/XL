from typing import Literal

from pydantic import BaseModel, Field

# Green/red flags are capped rather than validated: a model that returns six
# would fail a pydantic max_length and sink the whole resume, where truncating
# to the first five costs nothing. The floor of one is asked for in the field
# descriptions and the agent prompt — it can't be manufactured here without
# inventing a finding.
MAX_FLAGS = 5

class JDOutput(BaseModel):
    skills: list[str] = Field(description="Skills from the job description")
    text:str = Field(description="The complete original job-description text.")

class ResumeOutput(BaseModel):
    name: str = Field(description="Name of the candidate")
    email: str = Field(description="Email of the candidate")
    phone: str = Field(description="Phone number of the candidate")
    skills: list[str] = Field(description="Skills of the candidate")
    years_experience: float = Field(
        description="Total years of work experience, summed from the resume's work "
                    "history. Count internship durations IN FULL toward the total — "
                    "never as zero and never ignored. Use 0 only for a genuine fresher "
                    "with no work or internship history, or when the resume gives no "
                    "way to tell."
    )
    # "unknown" rather than "" for the third case: some providers (Gemini among
    # them) reject an empty string as a member of a JSON-schema enum and fail the
    # whole request, so the blank has to be spelled out as a word.
    currently_employed: Literal["yes", "no", "unknown"] = Field(
        default="unknown",
        description=(
            "Is the candidate working somewhere RIGHT NOW? 'yes' when the most "
            "recent role in the work history has no end date, says 'present', "
            "'current', 'till date' or similar. 'no' when the latest role has "
            "clearly ended, or the resume shows no work history at all. "
            "'unknown' only when the resume genuinely gives no way to tell — "
            "never guess. The screening flow skips the notice-period, buyout and "
            "current-CTC questions when this is 'no', so a wrong 'no' loses "
            "three answers."
        ),
    )
    summary: str = Field(description="One-sentence summary of the candidate's fit for the job description")
    green_flags: list[str] = Field(
        description="The strongest positive signals in the resume relative to the job "
                    "description. Between 1 and 5 — always give at least one, never "
                    "more than five, keeping only the most decisive."
    )
    red_flags: list[str] = Field(
        description="The most serious concerns or gaps in the resume relative to the "
                    "job description. Between 1 and 5 — always give at least one, "
                    "never more than five, keeping only the most material."
    )
    risk_questions: list[str] = Field(
        default_factory=list,
        description=(
            "Questions to put to THIS candidate about verifiable risks visible in "
            "their resume: an unexplained gap between education dates, an unexplained "
            "gap between jobs, job hopping (several short stints), or another serious "
            "negative such as a demotion, an unexplained career change, or a missing "
            "employer. One question per distinct issue, at most 5, each naming the "
            "specific dates/companies so it can be read aloud on a phone call without "
            "further context. Phrase them politely and neutrally, as a recruiter would "
            "('I noticed... could you walk me through that?'). Return an empty list "
            "when the resume shows none of these — never invent an issue."
        ),
    )
    # screening_questions was here and made the model retype the eight fixed
    # Standard Recruitment & Eligibility Checks for every resume. They are the
    # same eight every time — see screening_questions.py.
    text:str = Field(description="The complete original resume text, verbatim and unabridged — including the email and phone number.")