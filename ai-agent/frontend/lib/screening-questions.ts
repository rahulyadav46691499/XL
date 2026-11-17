/**
 * The Standard Recruitment & Eligibility Checks — the **old** screening list.
 *
 * Superseded by the conditional flow in `screening-flow.ts`, which is what the
 * HR modal asks now. This array is kept for one reason: responses saved against
 * its indices (0-9) are still in the database, and the modal's "Earlier
 * screening" block reads it to label them. Nothing writes them any more.
 *
 * Its per-requisition half is gone entirely — HR used to answer these eight in
 * free text at JD upload, but nothing ever compared the two sides, so the form
 * was dropped along with the backend's `QUESTION_KEYS` / `parse_answers`. JDs
 * that already carry `screening_answers` keep them, read-only, and the modal
 * shows them beside the historical candidate answers.
 *
 * Still **append-only** despite being frozen: the array order is what a saved
 * response is keyed by, so reordering silently re-labels every one of them.
 *
 * `parseNumericAnswer` / `parseYesNo` at the bottom are not historical — they
 * are what turns a phone transcript into a stored value for the live flow.
 */
export type ScreeningQuestion = {
  key: string;
  /** Short name for the field label. */
  label: string;
  /** The question as it is put to the candidate. */
  question: string;
  type: "text" | "number";
  /** What a `type: "number"` answer is measured in — the modal's input hint. */
  unit?: string;
};

export const SCREENING_QUESTIONS: ScreeningQuestion[] = [
  {
    key: "current_location",
    label: "Current Location & Mobility",
    question:
      "What is your current location, and are you willing to relocate if required?",
    type: "text",
  },
  {
    key: "work_model",
    label: "Work Model Flexibility",
    question:
      "Are you comfortable working in an Onsite, Hybrid, or Remote model, based on business requirements?",
    type: "text",
  },
  {
    key: "notice_period",
    label: "Notice Period",
    question:
      "What is your official notice period, and is it negotiable? If negotiable, on what basis and how confident are you in reducing it?",
    type: "number",
    unit: "Days",
  },
  {
    key: "buyout",
    label: "Buyout Availability",
    question:
      "Does your current organization offer a buyout option that could facilitate an earlier joining date?",
    type: "text",
  },
  {
    key: "bgc_readiness",
    label: "Background Verification (BGC) Readiness",
    question:
      "Do you have all the mandatory documents required for the background verification process available — employment documents (Offer/Joining Letters, Experience/Relieving Letters) and educational documents (Mark sheets, Degree Certificates and other relevant credentials)?",
    type: "text",
  },
  {
    key: "offer_status",
    label: "Offer & Interview Status",
    question:
      "Are you currently holding any offers, expecting offers, or actively participating in interview processes with other organizations?",
    type: "text",
  },
  {
    key: "offer_details",
    label: "Offer Details",
    question:
      "If holding or expecting other offers, what are the details regarding the organization, compensation, and stage of the competing offers?",
    type: "text",
  },
  {
    key: "interest_exl",
    label: "Interest in Joining EXL",
    question:
      "What is your motivation and intent to join EXL, including your career aspirations, reasons for considering this opportunity, and likelihood of accepting an offer if extended?",
    type: "text",
  },
  {
    key: "current_ctc",
    label: "Current CTC",
    question: "What is your current CTC?",
    type: "number",
    unit: "Annual CTC, e.g. 1200000",
  },
  {
    key: "expected_ctc",
    label: "Expected CTC",
    question: "What is your expected CTC?",
    type: "number",
    unit: "Annual CTC, e.g. 1500000",
  },
];

/**
 * First index reserved for a candidate's own AI-generated risk questions
 * (education/employment gaps, job hopping, other serious negatives). They are
 * ticked in the same modal as the fixed questions above and therefore share one
 * index space with them, but they differ per resume, so they get a reserved
 * range rather than continuing after the fixed list: `SCREENING_QUESTIONS` is
 * append-only, and anything numbered right after it would collide the first
 * time a standard question is added.
 *
 * Must match `RISK_INDEX_BASE` in `backend/screening_questions.py`.
 */
export const RISK_INDEX_BASE = 100;

/**
 * A JD's stored answers to the questions above, keyed by question key.
 *
 * Read-only: `JD_SCREENING_QUESTIONS`, `emptyScreeningAnswers()` and
 * `allScreeningAnswered()` were the JD form's half of this and went with it.
 */
export type ScreeningAnswers = Record<string, string>;

/**
 * Scale words that may follow a spoken figure, per kind of question.
 *
 * `year` is deliberately absent from the notice-period table: nobody serves a
 * notice period in years, but "I have 5 years experience, notice is 60 days"
 * is a normal thing to say — treating "5 years" as a scale would return 1825.
 */
const DAY_SCALES: Record<string, number> = {
  day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30,
};
const MONEY_SCALES: Record<string, number> = {
  k: 1e3, thousand: 1e3, thousands: 1e3,
  l: 1e5, lpa: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5,
  cr: 1e7, crore: 1e7, crores: 1e7,
};

/**
 * Pull a usable figure out of a spoken answer to a `type: "number"` question.
 *
 * Phone answers arrive as whole sentences — "actually it's quite low, only
 * 4LPA" — and `<input type="number">` renders anything non-numeric as blank,
 * so the answer looked like it had vanished. The raw sentence is still shown
 * under the field by the modal, so a figure we get wrong (or miss entirely)
 * is always visible to correct.
 *
 * A figure carrying a recognised scale word wins over a bare number earlier in
 * the sentence, so "I'm in Pune for 3 years, current CTC 4 lakh" reads 400000
 * rather than 3. Returns "" when there is no number to find.
 *
 * Two rules keep it from answering a question the candidate didn't answer. This
 * runs only when the call's own extraction came back empty, so it must not
 * guess where the server declined to:
 *
 *  - A number qualified by a word that is NOT a scale for this question belongs
 *    to something else. "My current package is 12 LPA" asked as a notice period
 *    is not 12 days, and "I'm 28 years old" is not 28 of anything we asked for.
 *  - A bare unqualified number has to be plausible for the field: ₹12 is not a
 *    salary and 411001 is not a notice period, they are a spoken "twelve" and a
 *    pincode.
 */
const BARE_RUPEE_FLOOR = 10_000;  // below this, a bare figure isn't a salary
const BARE_DAY_CEILING = 365;     // above this, a bare figure isn't a notice period

export function parseNumericAnswer(text: string, unit?: string): string {
  const isDays = /day/i.test(unit || "");
  const scales = isDays ? DAY_SCALES : MONEY_SCALES;
  const cleaned = text.toLowerCase().replace(/,/g, "");

  // "I can join immediately" is a notice period, just not a numeric one.
  if (isDays && /immediat|right away|asap/.test(cleaned)) return "0";

  let bare: number | null = null;
  for (const match of cleaned.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)?/g)) {
    const value = parseFloat(match[1]);
    const word = match[2];
    const scale = scales[word || ""];
    if (scale !== undefined) return String(Math.round(value * scale));
    if (bare === null && !word) bare = value;
  }
  if (bare === null) return "";
  const plausible = isDays ? bare <= BARE_DAY_CEILING : bare >= BARE_RUPEE_FLOOR;
  return plausible ? String(Math.round(bare)) : "";
}

const YES_PHRASES = new Set([
  "yes", "yeah", "yep", "yup", "sure", "correct", "right", "definitely",
  "of course", "absolutely", "ya", "affirmative", "yes please", "i am",
  "i do", "i have",
]);
const NO_PHRASES = new Set([
  "no", "nope", "nah", "not really", "no not really", "negative",
  "not at all", "no im not", "no i am not", "i dont", "i do not",
]);

/**
 * Read a yes or no out of a spoken answer, for the conditional flow's branches.
 *
 * Only when the WHOLE reply is one of those phrases. Anything else — a sentence,
 * a hedge, a phrase not on the list — returns "", which leaves the radio blank
 * and shows HR the sentence underneath it to resolve.
 *
 * This used to search for a yes-word and a no-word and let whichever appeared
 * first win, which reads a sentence by its first keyword and is wrong more often
 * than it looks: "right now is not a good time" was a yes, "no worries, this
 * works for me" was a no, "absolutely not" was a yes. A wrong radio button HR
 * cannot see is worse than a blank one they can, and this only runs when the
 * call's own extraction came back empty (Sarvam's post-call `answers_json`,
 * which reads the whole conversation) — so guessing here overrules a server
 * that declined to.
 *
 * ponytail: a fixed phrase table, fail-closed. It can fail to fire; it cannot
 * fire wrongly.
 */
export function parseYesNo(text: string): "yes" | "no" | "" {
  const phrase = text.replace(/[^\w\s]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
  if (NO_PHRASES.has(phrase)) return "no";
  if (YES_PHRASES.has(phrase)) return "yes";
  return "";
}
