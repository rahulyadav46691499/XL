/**
 * The conditional HR screening flow — what the modal asks now.
 *
 * The questions, their order and every branch come from the manager's
 * spec: `TalentAgent_AI_Suite_enhancement_tracker.xlsx`, sheet
 * **"Questions (HR, Candidate)"**, section "Questions to be asked from
 * candidate on AI phone call". Do not add, reorder or reword a question
 * without that sheet changing first.
 *
 * A static decision tree, so it is a flat array with an `askIf` predicate per
 * question rather than a state machine. Two consumers, one list:
 *
 * 1. **The HR modal** evaluates the predicates against the answers so far and
 *    renders only what applies.
 * 2. **The AI phone call** gets the same tree as prompt text — `flow_rules()`
 *    in `backend/screening_questions.py`. The voice agent already walks a
 *    numbered list, tags each question `[Qk]` and hangs up on `[END]`, so
 *    branching is a matter of telling it when to skip, not of new machinery.
 *
 * Index-aligned with `FLOW_QUESTIONS` in `backend/screening_questions.py` —
 * same keys, same order, same question text. Append only, and change the two
 * together: a candidate's responses are keyed by `FLOW_INDEX_BASE + position`.
 *
 * The flow sits in its own reserved index range for the same reason the risk
 * questions do. Everything already saved under 0-9 (the old fixed list,
 * `screening-questions.ts`), 100-199 (per-resume risk questions) and 200-299
 * (the first flow, below) keeps meaning exactly what it meant — no migration,
 * nothing re-labelled.
 */
// Type-only, deliberately: this module has no runtime imports, so its self-check
// runs under `node --experimental-strip-types` without a bundler.
import type { RoleCriteria } from "./role-criteria";

/**
 * Must match `FLOW_INDEX_BASE` in `backend/screening_questions.py`.
 *
 * 300, not 200: the flow below is a *different set of questions* from the one
 * the app shipped with, so reusing 200 would have silently re-pointed every
 * saved response and tick at a question nobody was asked. The old list is kept
 * verbatim as `LEGACY_FLOW_QUESTIONS` purely so those stay resolvable.
 */
export const FLOW_INDEX_BASE = 300;

/** Where the first flow's responses live. Frozen — read, never written. */
export const LEGACY_FLOW_INDEX_BASE = 200;

/** The end of the risk-question range, so 200+ can't be mistaken for a risk. */
export const RISK_RANGE_END = LEGACY_FLOW_INDEX_BASE;

/**
 * One lakh, in rupees.
 *
 * HR states the budget in **lakhs** because that is how a salary band is
 * written here; a candidate's spoken CTC goes through `parseNumericAnswer()`
 * and comes out in **rupees** ("4 lakh" → 400000). The budget flag below is
 * the one place the two units meet. Miss the conversion and a CTC over budget
 * is never flagged, silently.
 */
export const BUDGET_LAKH = 100000;

export type FlowType = "yesno" | "number" | "text" | "date";

/** The answers so far, keyed by flow question key — what predicates read. */
export type FlowByKey = Record<string, string>;

export type FlowContext = {
  criteria: RoleCriteria;
  /** The JD's `primary_location` — drives the relocation branch. */
  jobLocation: string;
  /**
   * Is the candidate currently working somewhere? Read from their resume
   * (`currently_employed`), never asked.
   *
   * The sheet's step 3.5: a candidate who is not working anywhere skips the
   * notice-period, buyout and current-CTC questions — they have none of the
   * three. `undefined` means the resume did not say (every resume analyzed
   * before the field existed), and then everything is asked: a wrong *skip*
   * loses an answer, a wrong ask costs twenty seconds.
   */
  employed?: boolean;
};

export type FlowChoice = { value: string; label: string };

export type FlowQuestion = {
  key: string;
  /** Short name for the field label. */
  label: string;
  /** As put to the candidate. May carry `{mode}` / `{location}` placeholders. */
  question: string;
  type: FlowType;
  /** What a `number` answer is measured in — the input hint and the parse scale. */
  unit?: string;
  /**
   * Overrides the Yes/No pair a `yesno` question renders by default.
   *
   * Exists for one question the sheet spells out with three answers — willing
   * to resign: Yes / Maybe / No — where "maybe" ends the call. Two radios
   * could not record the answer the spec branches on.
   */
  options?: FlowChoice[];
  /**
   * A precondition read from the requisition or the resume — never from an
   * answer. Enforced identically in the modal and on the call, because it is
   * knowable before the phone rings: a candidate who is not working is not
   * asked about notice periods on either.
   *
   * Kept separate from `askIf` for exactly that reason. `askIf` is subject to
   * the "branch not determined yet" allowance that `callableFlow` needs; a
   * `requires` must never be, or an unemployed candidate would be read the
   * notice-period questions the moment their branch was merely unanswered.
   */
  requires?: (ctx: FlowContext) => boolean;
  /** Asked only when this returns true. Absent means always asked. */
  askIf?: (answers: FlowByKey, ctx: FlowContext) => boolean;
  /**
   * Which answers `askIf` reads. Required whenever `askIf` reads an answer.
   *
   * `askIf` alone cannot tell "this branch is closed" from "we do not know
   * yet" — it returns false for both. That distinction does not matter while
   * HR types (an unanswered branch simply has not appeared yet) but it matters
   * enormously for the phone call, which is placed *before* any answer exists:
   * see `callableFlow`. A condition on the requisition or the resume is not an
   * `askIf` at all — it goes in `requires`, which needs no `dependsOn`.
   */
  dependsOn?: string[];
  /** Non-null ends the screening here, with this reason. */
  gate?: (answers: FlowByKey, ctx: FlowContext) => string | null;
  /** Non-null shows a warning under the field, but the flow carries on. */
  flag?: (answers: FlowByKey, ctx: FlowContext) => string | null;
};

/** How a workplace mode is said out loud — "WFO" is a filing code, not speech. */
export const WORKPLACE_WORDS: Record<string, string> = {
  WFO: "onsite",
  WFH: "remote",
  Hybrid: "hybrid",
};

/**
 * Is the candidate already where the job is?
 *
 * ponytail: substring either way, so "Bangalore" matches "Bangalore, KA" but
 * "Gurugram" and "Gurgaon" read as different and the candidate gets a harmless
 * extra relocation question. Add an alias table only if that misfires in
 * practice — a wrong *skip* would be the expensive direction, and this errs the
 * other way.
 */
export function sameLocation(candidate: string, job: string): boolean {
  const a = candidate.trim().toLowerCase();
  const b = job.trim().toLowerCase();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/** The requisition's budget ceiling in rupees, or NaN — see BUDGET_LAKH. */
function budgetCeiling(ctx: FlowContext): number {
  return budgetRupees(ctx.criteria).max ?? NaN;
}

/**
 * The requisition's salary band converted from lakhs to **rupees a year**, so
 * it can be compared with a candidate's CTC answer.
 *
 * Here rather than at the call site because `BUDGET_LAKH` is the one place the
 * two units are allowed to meet — see `role-criteria.ts`. Fields the JD never
 * set stay undefined rather than becoming 0, which would read as "this role
 * offers nothing" instead of "nobody said".
 */
export function budgetRupees(
  criteria?: RoleCriteria
): { min?: number; max?: number } {
  return {
    min: criteria?.min_budget === undefined ? undefined : criteria.min_budget * BUDGET_LAKH,
    max: criteria?.max_budget === undefined ? undefined : criteria.max_budget * BUDGET_LAKH,
  };
}

function answered(value: string | undefined): boolean {
  return (value || "").trim() !== "";
}

/** Is the candidate working somewhere? Unknown counts as yes — see `employed`. */
function isEmployed(ctx: FlowContext): boolean {
  return ctx.employed !== false;
}

/** Days over the requisition's maximum notice, as a warning. Shared by the two
 *  notice-period questions, which are the same measurement on two branches. */
function noticeFlag(value: string, ctx: FlowContext): string | null {
  const max = ctx.criteria?.max_notice;
  const days = Number(value);
  if (max === undefined || !answered(value) || !Number.isFinite(days)) return null;
  return days > max ? `Over the ${max}-day maximum for this role.` : null;
}

export const FLOW_QUESTIONS: FlowQuestion[] = [
  // ── 1 ───────────────────────────────────────────────────────────────────
  {
    key: "right_time",
    label: "Right time to talk",
    question: "Is this the right time to talk?",
    type: "yesno",
  },
  {
    key: "callback_time",
    label: "Call back at",
    question: "What time are you available?",
    type: "text",
    askIf: (a) => a.right_time === "no",
    dependsOn: ["right_time"],
    // The gate lives on the *last* question of the branch, not on right_time
    // itself, so the call-back time is still asked before the screening stops.
    gate: (a) =>
      a.right_time === "no"
        ? "Not the right time — the candidate was asked when to call back, and the call is rescheduled from their answer. Nothing further was asked."
        : null,
  },

  // ── 2 ───────────────────────────────────────────────────────────────────
  {
    key: "current_location",
    label: "Current location",
    question: "What's your current location?",
    type: "text",
  },
  {
    key: "relocate",
    label: "Willing to relocate",
    question: "Would you be willing to relocate to {location}?",
    type: "yesno",
    // Sheet: skipped when they are already at a work location, and skipped
    // again when the role is remote — relocation is moot either way. The
    // remote half is a property of the requisition, so it gates the question
    // outright; the location half waits for their answer.
    requires: (ctx) => String(ctx.criteria?.workplace_mode ?? "") !== "WFH",
    askIf: (a, ctx) =>
      answered(a.current_location) && !sameLocation(a.current_location, ctx.jobLocation),
    dependsOn: ["current_location"],
    // Nothing after this matters if they will not come to where the job is —
    // and the candidate is told that is why the conversation is ending, rather
    // than being thanked out of the blue.
    gate: (a, ctx) =>
      a.relocate === "no"
        ? `The role is based in ${ctx.jobLocation?.trim() || "the job location"} and the candidate will not relocate. The conversation closes here.`
        : null,
  },

  // ── 3 ───────────────────────────────────────────────────────────────────
  {
    key: "ok_workplace",
    label: "Comfortable with work model",
    question:
      "Are you comfortable working in {mode} mode, based on business requirements?",
    type: "yesno",
  },

  // ── 4 · asked only of a candidate who is currently working (step 3.5) ────
  {
    key: "on_notice",
    label: "Serving notice",
    question: "Are you on notice period right now in your current organisation?",
    type: "yesno",
    requires: isEmployed,
  },
  {
    key: "notice_days_left",
    label: "Days left in notice",
    question: "How many days are left in your notice period?",
    type: "number",
    unit: "Days",
    requires: isEmployed,
    askIf: (a) => a.on_notice === "yes",
    dependsOn: ["on_notice"],
    flag: (a, ctx) => noticeFlag(a.notice_days_left, ctx),
  },
  {
    key: "willing_to_resign",
    label: "Willing to resign",
    question:
      "Are you willing to resign at your current company should you get selected?",
    type: "yesno",
    // Three answers, because the sheet branches on three: Yes continues, Maybe
    // ends the call, and No is the same dead end as Maybe.
    options: [
      { value: "yes", label: "Yes" },
      { value: "maybe", label: "Maybe" },
      { value: "no", label: "No" },
    ],
    requires: isEmployed,
    askIf: (a) => a.on_notice === "no",
    dependsOn: ["on_notice"],
    gate: (a) =>
      answered(a.willing_to_resign) && a.willing_to_resign !== "yes"
        ? `The candidate is not committing to resigning if selected (answered "${a.willing_to_resign}"). The conversation closes here.`
        : null,
  },
  {
    key: "notice_days",
    label: "Notice period",
    question: "What is the duration of your notice period?",
    type: "number",
    unit: "Days",
    requires: isEmployed,
    askIf: (a) => a.willing_to_resign === "yes",
    dependsOn: ["willing_to_resign"],
    flag: (a, ctx) => noticeFlag(a.notice_days, ctx),
  },

  // ── 5 · also employed-only ──────────────────────────────────────────────
  {
    key: "buyout",
    label: "Buyout option",
    question: "Does your company offer buyout option for the notice period?",
    type: "yesno",
    requires: isEmployed,
  },

  // ── 6 ───────────────────────────────────────────────────────────────────
  {
    key: "bgc_documents",
    label: "BGC documents",
    question:
      "Do you have all the employment and education documents for Background check?",
    type: "yesno",
  },

  // ── 7 ───────────────────────────────────────────────────────────────────
  {
    key: "interviewed_elsewhere",
    label: "Interviewed elsewhere",
    question: "Have you given any job interview elsewhere?",
    type: "yesno",
  },
  {
    key: "other_offer",
    label: "Offer in hand or expected",
    question:
      "Do you have or expecting any offer letter from any other organisation?",
    type: "yesno",
    askIf: (a) => a.interviewed_elsewhere === "yes",
    dependsOn: ["interviewed_elsewhere"],
  },
  {
    key: "offer_details",
    label: "Offer details",
    question:
      "Can you tell me about that organisation, what role and package they are offering you?",
    type: "text",
    askIf: (a) => a.other_offer === "yes",
    dependsOn: ["other_offer"],
  },
  {
    key: "interview_stage",
    label: "Stage of those processes",
    question: "What stage are you at in those hiring processes?",
    type: "text",
    askIf: (a) => a.interviewed_elsewhere === "yes" && a.other_offer === "no",
    dependsOn: ["interviewed_elsewhere", "other_offer"],
  },

  // ── 8 · employed-only: someone not working has no current CTC ───────────
  {
    key: "current_ctc",
    label: "Current CTC",
    question: "What is your current CTC?",
    type: "number",
    unit: "Annual CTC, e.g. 1200000",
    requires: isEmployed,
  },

  // ── 9, 10, 11 ───────────────────────────────────────────────────────────
  {
    key: "expected_ctc",
    label: "Expected CTC",
    question: "What is your expected CTC?",
    type: "number",
    unit: "Annual CTC, e.g. 1500000",
    // A warning for HR, not a branch: the sheet asks the negotiation question
    // of everyone, so this never changes which questions are asked.
    flag: (a, ctx) => {
      const ceiling = budgetCeiling(ctx);
      const expected = Number(a.expected_ctc);
      if (!Number.isFinite(ceiling) || !answered(a.expected_ctc) || !Number.isFinite(expected)) {
        return null;
      }
      return expected > ceiling
        ? `Above the ${ctx.criteria.max_budget} lakh budget for this role.`
        : null;
    },
  },
  {
    key: "negotiable",
    label: "Negotiable",
    question: "Is it negotiable?",
    type: "yesno",
  },
  {
    key: "join_reason",
    label: "Why EXL",
    question: "Why do you want to join EXL?",
    type: "text",
  },

  // ── Appended, NOT inserted ───────────────────────────────────────────────
  // From the workbook's second sheet ("HR-based agent questionnaire"), which
  // this app had previously not implemented. They are asked *second and third*
  // on the call — see ASK_ORDER below, which is what the modal renders by too.
  // They sit at the end of this array because a saved response is keyed by
  // `FLOW_INDEX_BASE + position`: inserting them in conversational order would
  // silently re-point every answer already stored against every later question.
  {
    key: "still_interested",
    label: "Still interested",
    question: "Are you still interested in this job?",
    type: "yesno",
    // Nothing else is worth asking someone who has withdrawn, and the candidate
    // is thanked rather than marched through eleven more questions.
    gate: (a) =>
      a.still_interested === "no"
        ? "The candidate said they are no longer interested in this role. The conversation closes here."
        : null,
  },
  {
    key: "self_intro",
    label: "Self-introduction",
    question:
      "Before we go further, could you briefly introduce yourself — your background and what you're currently doing?",
    type: "text",
    // No `askIf`: it is asked of everyone who has not withdrawn, and
    // `still_interested`'s gate already truncates everything after it on a "no".
    // A predicate here would say the same thing twice.
  },
  // Asked last, of everyone. The dashboard shows the answer only on rows
  // Selected for R1 — the call extracts it short ("Mon to Wed, 2 pm to 5 pm")
  // for exactly that line.
  {
    key: "r1_availability",
    label: "Available for next round",
    question:
      "If you are selected for the next round, on which weekdays and at what time would you be available for the interview?",
    type: "text",
  },
];

/**
 * The order questions are put to the candidate — which is no longer the order
 * of the array above.
 *
 * Ask order now belongs to the voice service's flow table
 * (`backend/voice/script.py`), and this list mirrors it so the modal
 * reads in the same sequence the candidate hears. Keeping the two concerns
 * apart is what lets `FLOW_QUESTIONS` stay strictly append-only while the
 * conversation still runs in spec order.
 *
 * Must remain a permutation of the flow keys — asserted in the self-check.
 */
export const ASK_ORDER: string[] = [
  "right_time", "callback_time",
  "still_interested", "self_intro",
  "current_location", "relocate",
  "ok_workplace",
  "on_notice", "notice_days_left", "willing_to_resign", "notice_days",
  "buyout",
  "bgc_documents",
  "interviewed_elsewhere", "other_offer", "offer_details", "interview_stage",
  "current_ctc",
  "expected_ctc", "negotiable", "join_reason",
  "r1_availability",
];

/**
 * The first conditional flow, verbatim and frozen.
 *
 * Nothing asks these any more. They exist so a response or a tick saved under
 * 200-299 still resolves to the question it was actually recorded against —
 * the same job `SCREENING_QUESTIONS` (0-9) does for the list before it.
 * Never edit, never reorder, never extend.
 */
export const LEGACY_FLOW_QUESTIONS: { key: string; question: string }[] = [
  { key: "right_time", question: "Is this a good time to talk?" },
  { key: "callback_time", question: "No problem at all — what time would suit you better for a call back?" },
  { key: "current_location", question: "What is your current location?" },
  { key: "current_company", question: "What is the name of your current company?" },
  { key: "experience", question: "How many years of total work experience do you have?" },
  { key: "ok_workplace", question: "This role is {mode}, based in {location}. Are you comfortable with that?" },
  { key: "relocate", question: "Since the role is based in {location}, would you be willing to relocate?" },
  { key: "switch_reason", question: "What is the main reason you are looking to switch?" },
  { key: "on_notice", question: "Are you currently serving your notice period?" },
  { key: "last_working_day", question: "What is your last working day?" },
  { key: "notice_days", question: "What is your notice period, in days?" },
  { key: "buyout", question: "Does your current organization offer a buyout option, so you could join earlier?" },
  { key: "current_ctc", question: "What is your current CTC?" },
  { key: "expected_ctc", question: "What is your expected CTC?" },
  { key: "negotiable", question: "That is above the budget we have for this role. Would you be open to negotiating?" },
  { key: "other_offer", question: "Are you holding any other offer letter at the moment?" },
  { key: "offer_details", question: "Which organization is that with, and what compensation have they offered?" },
];

/**
 * Substitute the `{...}` placeholders in a question.
 *
 * The same substitution runs in `fill()` on the backend, so HR reads the
 * sentence the candidate hears. An unknown placeholder is left alone rather
 * than blanked — a visible `{typo}` is easier to spot than a hole.
 */
export function fillFlowQuestion(text: string, ctx: FlowContext): string {
  const criteria = (ctx.criteria || {}) as Record<string, unknown>;
  const values: Record<string, string> = {
    location: ctx.jobLocation?.trim() || "the job location",
    mode: WORKPLACE_WORDS[String(criteria.workplace_mode ?? "")] || "the required",
  };
  for (const [key, value] of Object.entries(criteria)) {
    if (values[key] === undefined) values[key] = value === undefined ? "?" : String(value);
  }
  return text.replace(/\{(\w+)\}/g, (whole, key) => values[key] ?? whole);
}

/**
 * What the requisition says about this question, shown under it in the modal.
 *
 * Only the questions that are actually measured against a criterion have one —
 * "what's your current location" has no requisition counterpart. Returns "" for
 * the rest, and for JDs stored before the criteria existed.
 */
export function requisitionNote(key: string, criteria: RoleCriteria): string {
  switch (key) {
    case "ok_workplace":
      return criteria.workplace_mode ? WORKPLACE_WORDS[criteria.workplace_mode] : "";
    case "notice_days":
    case "notice_days_left":
      return criteria.max_notice === undefined ? "" : `up to ${criteria.max_notice} days`;
    case "buyout":
      return criteria.buyout_offered === undefined
        ? ""
        : criteria.buyout_offered === "yes"
          ? "the company will reimburse a buyout"
          : "the company does not reimburse a buyout";
    case "expected_ctc":
      return criteria.max_budget === undefined
        ? ""
        : `budget ${criteria.min_budget}–${criteria.max_budget} lakhs`;
    default:
      return "";
  }
}

/** Flow key -> its position in FLOW_QUESTIONS, hence its stored index. */
const POSITION_OF: Record<string, number> = Object.fromEntries(
  FLOW_QUESTIONS.map((question, position) => [question.key, position])
);

/**
 * The two answers that describe *a call* rather than the candidate.
 *
 * A redial asks "is this the right time?" again from the top, so the answers a
 * previous call left behind must be dropped before the script is built —
 * `callback_time` gates, so leaving them in truncates every second call to
 * these two questions and the candidate is dialed only to be read the CV
 * questions. Everything else a call recorded is still a fact about them and
 * still shapes the next one.
 */
export const RESCHEDULE_INDICES = ["right_time", "callback_time"].map(
  (key) => FLOW_INDEX_BASE + POSITION_OF[key]
);

/**
 * The flow's length for a screening saved before `flow_size` was (it is now,
 * on every save): 21, the flow as it stood until `r1_availability` was
 * appended. Frozen — never bump it when a question is added.
 */
export const UNRECORDED_FLOW_SIZE = 21;

/**
 * Flow indices appended after a screening was saved with `flowSize` questions.
 *
 * HR never saw these, so their absence from the saved ticks is not an untick.
 * Read as one, a question added to the flow was silently left off every call
 * to a candidate screened before it existed — the modal only sends ticked ones.
 */
export function addedSince(flowSize: number | undefined): number[] {
  const seen = flowSize || UNRECORDED_FLOW_SIZE;
  return FLOW_QUESTIONS.slice(seen).map((_, i) => FLOW_INDEX_BASE + seen + i);
}

/** The index-keyed responses re-read by flow question key. */
export function answersByKey(responses: Record<number, string>): FlowByKey {
  const answers: FlowByKey = {};
  FLOW_QUESTIONS.forEach((question, position) => {
    answers[question.key] = responses[FLOW_INDEX_BASE + position] ?? "";
  });
  return answers;
}

export type VisibleFlowQuestion = {
  /** Where this answer is stored — `FLOW_INDEX_BASE + position`. */
  index: number;
  key: string;
  label: string;
  /** Placeholders already filled. */
  question: string;
  type: FlowType;
  unit?: string;
  /** The answer buttons for a `yesno`, when it is not a plain Yes/No. */
  options?: FlowChoice[];
  /** A warning to show under the field, or null. */
  flag: string | null;
};

/** One walk of the tree. `strict` is the modal's reading (a branch nobody has
 *  answered yet is closed); the call's reading keeps undetermined branches —
 *  see `callableFlow` for why that distinction is the whole point. */
function walk(
  responses: Record<number, string>,
  ctx: FlowContext,
  strict: boolean
): { questions: VisibleFlowQuestion[]; gate: string } {
  const answers = answersByKey(responses);
  const questions: VisibleFlowQuestion[] = [];
  // Which questions this walk has actually kept. A dependency that was itself
  // dropped takes its follow-ups with it: "how long is your notice period"
  // hangs off "would you resign", so a candidate already serving notice — who
  // is never asked either — must not be read the follow-up on a call just
  // because its dependency has no answer. Every `dependsOn` key sits earlier in
  // the array than the question that names it (asserted in the self-check), so
  // this set is complete by the time it is read.
  const kept = new Set<string>();
  let gate = "";

  // Walked in ASK_ORDER, not array order: the two questions appended last are
  // asked second and third. The stored index still comes from the array
  // position, which is what keeps saved responses where they were.
  for (const key of ASK_ORDER) {
    const position = POSITION_OF[key];
    const question = FLOW_QUESTIONS[position];
    // A precondition is knowable up front, so it is never waived — not even
    // for a call, where an unanswered branch is otherwise kept open.
    if (question.requires && !question.requires(ctx)) continue;
    const undetermined =
      !strict &&
      (question.dependsOn ?? []).some((key) => kept.has(key) && !answered(answers[key]));
    if (question.askIf && !question.askIf(answers, ctx) && !undetermined) continue;
    kept.add(question.key);

    questions.push({
      index: FLOW_INDEX_BASE + position,
      key: question.key,
      label: question.label,
      question: fillFlowQuestion(question.question, ctx),
      type: question.type,
      unit: question.unit,
      options: question.options,
      flag: question.flag?.(answers, ctx) ?? null,
    });

    const stop = question.gate?.(answers, ctx);
    if (stop) {
      gate = stop;
      break;
    }
  }

  return { questions, gate };
}

/**
 * Which questions apply, given the answers so far, and why the flow stopped.
 *
 * Walks the tree in order: skip what does not apply, and stop at the first
 * tripped gate — *after* including the question that tripped it, so HR can see
 * the answer that ended the screening.
 *
 * A gate never changes the candidate's decision. It says why the questions
 * stopped; the override dropdown is still HR's.
 */
export function visibleFlow(
  responses: Record<number, string>,
  ctx: FlowContext
): { questions: VisibleFlowQuestion[]; gate: string } {
  return walk(responses, ctx, true);
}

/**
 * Which questions the AI phone call should be placed with.
 *
 * `visibleFlow` is the wrong list for this, and the difference is the whole
 * point of this function. A call is placed *before* the candidate has said
 * anything, so every branch predicate is false — not because the branch is
 * closed, but because nothing is known yet. Handing the agent only what is
 * visible would silently drop every follow-up: relocation, days left in
 * notice, willingness to resign, offer details, the lot. The agent cannot ask
 * what it was never given.
 *
 * So a question is callable when it is unconditional, when its branch is
 * already open, **or when its branch is still undetermined** — the last being
 * the case `askIf` alone cannot express, which is what `dependsOn` is for.
 * Anything genuinely ruled out is still excluded: HR's own answers, and the
 * employment gate, which is read from the resume and so is known before the
 * phone rings.
 *
 * The agent does the actual branching live: it receives these as a numbered
 * list plus `flow_rules()` telling it when to skip, and questions it skips come
 * back as `no_answer`.
 */
export function callableFlow(
  responses: Record<number, string>,
  ctx: FlowContext
): { questions: VisibleFlowQuestion[]; gate: string } {
  return walk(responses, ctx, false);
}
