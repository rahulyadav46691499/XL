/**
 * The requisition's hiring constraints — typed, unlike the screening answers.
 *
 * HR states them once per JD (Upload page, and the Edit dialog on each JD row)
 * and the candidate screening flow in `screening-flow.ts` branches on them: a
 * candidate under `min_experience` ends the interview there, an expected CTC
 * over `max_budget` triggers the negotiation question.
 *
 * The keys must match `CRITERIA_KEYS` in `backend/role_criteria.py`, which is
 * the storage contract. This file holds the copy.
 *
 * They are a **separate** field from `screening_answers` on purpose: adding
 * these keys to the backend's `QUESTION_KEYS` would make `parse_answers()`
 * demand them of every JD already stored, so editing an older requisition would
 * start failing with a 400.
 */

/** As the backend stores and returns it — numbers are numbers. */
export type RoleCriteria = {
  /** Years. */
  min_experience?: number;
  max_experience?: number;
  /**
   * Lakhs per annum — a candidate's CTC answer is in **rupees**. Every
   * comparison between the two goes through `BUDGET_LAKH` in
   * `screening-flow.ts`, which is the only place the two units meet.
   */
  min_budget?: number;
  max_budget?: number;
  /** Days. */
  min_notice?: number;
  max_notice?: number;
  workplace_mode?: "WFO" | "WFH" | "Hybrid";
  buyout_offered?: "yes" | "no";
};

/** What the form holds while HR is typing — every field a string. */
export type CriteriaDraft = Record<string, string>;

export type CriteriaRange = {
  minKey: string;
  maxKey: string;
  label: string;
  question: string;
  unit: string;
  minPlaceholder: string;
  maxPlaceholder: string;
};

/**
 * Experience was removed from this list on request, so HR is no longer asked
 * for it at upload. The keys stay on `RoleCriteria` above because JDs stored
 * before the removal still carry them, and the screening flow still honours
 * them when they are there — `screening-flow.ts` returns no gate when
 * `min_experience` is undefined, which is what every new JD now looks like.
 */
export const CRITERIA_RANGES: CriteriaRange[] = [
  {
    minKey: "min_budget",
    maxKey: "max_budget",
    label: "Budget",
    question: "What is the budget for this role?",
    unit: "lakhs p.a.",
    minPlaceholder: "Min, e.g. 15",
    maxPlaceholder: "Max, e.g. 20",
  },
  {
    minKey: "min_notice",
    maxKey: "max_notice",
    label: "Notice period",
    question: "What notice period is acceptable?",
    unit: "days",
    minPlaceholder: "Min, e.g. 30",
    maxPlaceholder: "Max, e.g. 60",
  },
];

export type CriteriaChoice = {
  key: string;
  label: string;
  question: string;
  options: { value: string; label: string }[];
};

export const CRITERIA_CHOICES: CriteriaChoice[] = [
  {
    key: "workplace_mode",
    label: "Workplace mode",
    question: "What is the workplace mode for this role?",
    options: [
      { value: "WFO", label: "WFO — work from office" },
      { value: "WFH", label: "WFH — work from home" },
      { value: "Hybrid", label: "Hybrid" },
    ],
  },
  {
    key: "buyout_offered",
    label: "Buyout compensation",
    question:
      "Will the company provide buyout compensation if the candidate has to buy out their notice period?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
];

/** Every numeric key, in form order. */
export const CRITERIA_NUMERIC_KEYS = CRITERIA_RANGES.flatMap((r) => [r.minKey, r.maxKey]);

/** Every key HR must set, in form order. */
export const CRITERIA_KEYS = [
  ...CRITERIA_NUMERIC_KEYS,
  ...CRITERIA_CHOICES.map((c) => c.key),
];

export function emptyCriteriaDraft(): CriteriaDraft {
  return Object.fromEntries(CRITERIA_KEYS.map((key) => [key, ""]));
}

/** Seed the form from what the backend stored (`{}` on older JDs). */
export function draftFromCriteria(criteria?: RoleCriteria): CriteriaDraft {
  const draft = emptyCriteriaDraft();
  for (const key of CRITERIA_KEYS) {
    const value = (criteria as Record<string, unknown> | undefined)?.[key];
    if (value !== undefined && value !== null && value !== "") {
      draft[key] = String(value);
    }
  }
  return draft;
}

/** How many criteria have a value — drives the "n / 6 set" counter. */
export function criteriaFilledCount(draft: CriteriaDraft): number {
  return CRITERIA_KEYS.filter((key) => (draft[key] || "").trim() !== "").length;
}

export function allCriteriaSet(draft: CriteriaDraft): boolean {
  return criteriaFilledCount(draft) === CRITERIA_KEYS.length;
}

/**
 * Per-field problems, keyed by the field they belong under.
 *
 * The same rules the backend enforces in `parse_criteria()`, run here so HR
 * sees "minimum is above the maximum" under the field rather than as a 400
 * after the file has uploaded. The backend still checks — this is the nicer
 * copy of the check, not the only one.
 */
export function criteriaErrors(draft: CriteriaDraft): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const key of CRITERIA_NUMERIC_KEYS) {
    const raw = (draft[key] || "").trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) errors[key] = "Must be a number";
    else if (value < 0) errors[key] = "Cannot be negative";
  }

  for (const range of CRITERIA_RANGES) {
    if (errors[range.minKey] || errors[range.maxKey]) continue;
    const min = Number(draft[range.minKey]);
    const max = Number(draft[range.maxKey]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
    if ((draft[range.minKey] || "").trim() === "" || (draft[range.maxKey] || "").trim() === "") continue;
    if (min > max) {
      errors[range.maxKey] = `Maximum is below the minimum (${min} ${range.unit})`;
    }
  }

  return errors;
}

/** True when the set is complete and internally consistent — the form's gate. */
export function criteriaValid(draft: CriteriaDraft): boolean {
  return allCriteriaSet(draft) && Object.keys(criteriaErrors(draft)).length === 0;
}

/** The form's strings as the backend wants them: numbers as numbers. */
export function criteriaFromDraft(draft: CriteriaDraft): RoleCriteria {
  const criteria: Record<string, unknown> = {};
  for (const key of CRITERIA_NUMERIC_KEYS) criteria[key] = Number(draft[key]);
  for (const choice of CRITERIA_CHOICES) criteria[choice.key] = draft[choice.key];
  return criteria as RoleCriteria;
}
