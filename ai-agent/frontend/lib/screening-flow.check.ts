/**
 * Self-check for the conditional screening flow. Not imported by the app.
 *
 *   node --experimental-strip-types lib/screening-flow.check.ts
 *
 * Every case below is a condition written in the manager's spec —
 * `TalentAgent_AI_Suite_enhancement_tracker.xlsx`, sheet
 * "Questions (HR, Candidate)". If one of these fails, the app is asking
 * something the sheet does not.
 */
import assert from "node:assert";
import type { RoleCriteria } from "./role-criteria.ts";
import {
  ASK_ORDER,
  FLOW_INDEX_BASE,
  FLOW_QUESTIONS,
  LEGACY_FLOW_INDEX_BASE,
  LEGACY_FLOW_QUESTIONS,
  answersByKey,
  RESCHEDULE_INDICES,
  callableFlow,
  fillFlowQuestion,
  sameLocation,
  visibleFlow,
  addedSince,
  UNRECORDED_FLOW_SIZE,
} from "./screening-flow.ts";

const criteria: RoleCriteria = {
  min_experience: 5,
  max_experience: 8,
  min_budget: 15,
  max_budget: 20,
  min_notice: 30,
  max_notice: 60,
  workplace_mode: "Hybrid",
  buyout_offered: "no",
};
const ctx = { criteria, jobLocation: "Gurgaon" };
/** The step-3.5 context: what the resume said about a current employer. */
const employedCtx = { ...ctx, employed: true };
const joblessCtx = { ...ctx, employed: false };

/** Build an index-keyed response map from flow keys, the way the modal stores them. */
function responses(byKey: Record<string, string>): Record<number, string> {
  const out: Record<number, string> = {};
  FLOW_QUESTIONS.forEach((q, i) => {
    if (byKey[q.key] !== undefined) out[FLOW_INDEX_BASE + i] = byKey[q.key];
  });
  return out;
}
const keysOf = (r: Record<number, string>, c = ctx) =>
  visibleFlow(r, c).questions.map((q) => q.key);
const index = (key: string) => FLOW_INDEX_BASE + FLOW_QUESTIONS.findIndex((q) => q.key === key);

// Keys are unique — they are how the predicates address each other.
assert.equal(new Set(FLOW_QUESTIONS.map((q) => q.key)).size, FLOW_QUESTIONS.length);

// ── The spec's question set, in STORAGE order ────────────────────────────────
// Not ask order any more: `still_interested` and `self_intro` are asked second
// and third but live at the end of the array, because a saved response is keyed
// by position and inserting would re-point every later one. Ask order is
// ASK_ORDER, asserted just below.
assert.deepEqual(FLOW_QUESTIONS.map((q) => q.key), [
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
]);
// The two appended questions took the next free indices. If either of these
// moves, every response saved against a later question now means something
// else — the one unrecoverable mistake in this file.
assert.equal(index("join_reason"), FLOW_INDEX_BASE + 18);
assert.equal(index("still_interested"), FLOW_INDEX_BASE + 19);
assert.equal(index("self_intro"), FLOW_INDEX_BASE + 20);
assert.equal(index("r1_availability"), FLOW_INDEX_BASE + 21);
// Asked last on the call, as on screen.
assert.equal(ASK_ORDER.at(-1), "r1_availability");

// A screening saved before r1_availability existed has no opinion on it: it
// must come back ticked, or the modal leaves it off that candidate's call.
assert.equal(UNRECORDED_FLOW_SIZE, 21, "frozen: the flow's length before flow_size was saved");
assert.deepEqual(addedSince(undefined), [index("r1_availability")]);
assert.deepEqual(addedSince(0), [index("r1_availability")]);
// Saved since: every question was in front of HR, so a missing tick is an untick.
assert.deepEqual(addedSince(FLOW_QUESTIONS.length), []);

// ── ASK_ORDER is a permutation of the keys, and mirrors the call's graph ─────
assert.deepEqual(
  [...ASK_ORDER].sort(),
  FLOW_QUESTIONS.map((q) => q.key).sort(),
  "ASK_ORDER must list every flow question exactly once",
);
assert.deepEqual(ASK_ORDER.slice(0, 4), [
  "right_time", "callback_time", "still_interested", "self_intro",
]);
// Every `dependsOn` must be asked BEFORE the question naming it — the check
// that used to run against array position, and now has to run against ask
// order, which is what actually determines whether the answer exists yet.
const askPosition = Object.fromEntries(ASK_ORDER.map((key, i) => [key, i]));
for (const question of FLOW_QUESTIONS) {
  for (const dependency of question.dependsOn ?? []) {
    assert.ok(
      askPosition[dependency] < askPosition[question.key],
      `${question.key} depends on ${dependency}, which is asked later`,
    );
  }
}

// The frozen range must not reach into the live one, or an old answer would
// resolve to a question nobody was asked.
assert.ok(LEGACY_FLOW_INDEX_BASE + LEGACY_FLOW_QUESTIONS.length <= FLOW_INDEX_BASE);

// ── Nothing answered: the unconditional questions, no follow-ups, no gate ────
// Rendered in ASK_ORDER, so the two appended questions appear second and third
// rather than last, even though that is where they live in the array.
const fresh = visibleFlow({}, ctx);
assert.deepEqual(fresh.questions.map((q) => q.key), [
  "right_time", "still_interested", "self_intro",
  "current_location", "ok_workplace", "on_notice", "buyout",
  "bgc_documents", "interviewed_elsewhere", "current_ctc", "expected_ctc",
  "negotiable", "join_reason", "r1_availability",
]);
assert.equal(fresh.gate, "");
// Indices are position-based and stable.
assert.equal(fresh.questions[0].index, FLOW_INDEX_BASE);
assert.equal(answersByKey({ [FLOW_INDEX_BASE]: "yes" }).right_time, "yes");

// ── Q1 · not the right time: ask when to call back, then stop ────────────────
const badTime = visibleFlow(responses({ right_time: "no" }), ctx);
assert.deepEqual(badTime.questions.map((q) => q.key), ["right_time", "callback_time"]);
assert.match(badTime.gate, /call back/);
// A good time carries straight on, with no callback question.
assert.ok(!keysOf(responses({ right_time: "yes" })).includes("callback_time"));

// ── Q2 · relocation: only when they are elsewhere AND the role is not remote ─
assert.ok(!keysOf({}).includes("relocate"), "relocation must wait for a location");
assert.ok(!keysOf(responses({ current_location: "Gurgaon" })).includes("relocate"));
assert.ok(!keysOf(responses({ current_location: "gurgaon, haryana" })).includes("relocate"));
assert.ok(keysOf(responses({ current_location: "Pune" })).includes("relocate"));
// "Condition 2a: if role has remote work model → skip follow up questions".
const remoteCtx = { criteria: { ...criteria, workplace_mode: "WFH" }, jobLocation: "Gurgaon" };
assert.ok(
  !keysOf(responses({ current_location: "Pune" }), remoteCtx).includes("relocate"),
  "a remote role must never ask about relocation"
);
assert.equal(sameLocation("Bangalore, KA", "Bangalore"), true);
assert.equal(sameLocation("Gurugram", "Gurgaon"), false); // known ceiling: asks anyway

// A candidate who will not come to where the job is ends the screening there,
// and the reason names the location so it can be read out as one.
const wontMove = visibleFlow(responses({ current_location: "Pune", relocate: "no" }), ctx);
assert.match(wontMove.gate, /Gurgaon/);
assert.equal(wontMove.questions[wontMove.questions.length - 1].key, "relocate",
  "the gate must stop *after* the relocation question");
assert.equal(visibleFlow(responses({ current_location: "Pune", relocate: "yes" }), ctx).gate, "");

// ── Step 3.5 · not working anywhere skips notice period, buyout, current CTC ─
const jobless = keysOf({}, joblessCtx);
for (const key of ["on_notice", "notice_days_left", "willing_to_resign", "notice_days",
                   "buyout", "current_ctc"]) {
  assert.ok(!jobless.includes(key), `an unemployed candidate must not be asked "${key}"`);
}
// …and is still asked everything else.
for (const key of ["right_time", "current_location", "ok_workplace", "bgc_documents",
                   "interviewed_elsewhere", "expected_ctc", "negotiable", "join_reason",
                   "r1_availability"]) {
  assert.ok(jobless.includes(key), `"${key}" must be asked of an unemployed candidate too`);
}
// Employed, and unknown (an older resume), both ask the full set.
assert.ok(keysOf({}, employedCtx).includes("current_ctc"));
assert.ok(keysOf({}).includes("current_ctc"), "unknown employment must not skip anything");

// ── Q4 · the notice-period branches are exclusive ────────────────────────────
const onNotice = keysOf(responses({ on_notice: "yes" }));
assert.ok(onNotice.includes("notice_days_left"));
assert.ok(!onNotice.includes("willing_to_resign") && !onNotice.includes("notice_days"));

const offNotice = keysOf(responses({ on_notice: "no" }));
assert.ok(offNotice.includes("willing_to_resign"));
assert.ok(!offNotice.includes("notice_days_left"));
// The duration question only opens once they say they would resign.
assert.ok(!offNotice.includes("notice_days"), "notice duration must wait for the answer");
assert.ok(
  keysOf(responses({ on_notice: "no", willing_to_resign: "yes" })).includes("notice_days")
);

// "Condition 2b: Maybe → close the conversation and end the call."
const maybe = visibleFlow(responses({ on_notice: "no", willing_to_resign: "maybe" }), ctx);
assert.match(maybe.gate, /not committing to resigning/);
assert.equal(maybe.questions.at(-1)!.key, "willing_to_resign",
  "the gate must stop *after* the question that tripped it");
// "No" is the same dead end; "yes" is not a dead end at all.
assert.notEqual(visibleFlow(responses({ on_notice: "no", willing_to_resign: "no" }), ctx).gate, "");
assert.equal(visibleFlow(responses({ on_notice: "no", willing_to_resign: "yes" }), ctx).gate, "");
// Three answers, because the sheet branches on three.
assert.deepEqual(
  FLOW_QUESTIONS.find((q) => q.key === "willing_to_resign")!.options!.map((o) => o.value),
  ["yes", "maybe", "no"]
);

// Over the acceptable notice is a warning, not a stop — on both branches.
const longNotice = visibleFlow(responses({ on_notice: "yes", notice_days_left: "90" }), ctx);
assert.equal(longNotice.gate, "");
assert.match(
  longNotice.questions.find((q) => q.key === "notice_days_left")!.flag!,
  /60-day maximum/
);
assert.equal(
  visibleFlow(responses({ on_notice: "yes", notice_days_left: "45" }), ctx)
    .questions.find((q) => q.key === "notice_days_left")!.flag,
  null
);

// ── Q7 · interviews elsewhere, offers, and the two mutually exclusive tails ──
assert.ok(!keysOf({}).includes("other_offer"), "offers must wait for the interview answer");
assert.ok(!keysOf(responses({ interviewed_elsewhere: "no" })).includes("other_offer"));
const interviewed = keysOf(responses({ interviewed_elsewhere: "yes" }));
assert.ok(interviewed.includes("other_offer"));
assert.ok(!interviewed.includes("offer_details") && !interviewed.includes("interview_stage"));

const withOffer = keysOf(responses({ interviewed_elsewhere: "yes", other_offer: "yes" }));
assert.ok(withOffer.includes("offer_details") && !withOffer.includes("interview_stage"));
const noOffer = keysOf(responses({ interviewed_elsewhere: "yes", other_offer: "no" }));
assert.ok(noOffer.includes("interview_stage") && !noOffer.includes("offer_details"));

// ── Q9/Q10 · budget is a flag, never a branch. "Is it negotiable?" is asked of
//    everyone, per the sheet — the old flow only asked it when over budget.
assert.ok(keysOf(responses({ expected_ctc: "1800000" })).includes("negotiable"));
assert.ok(keysOf({}).includes("negotiable"));
assert.match(
  visibleFlow(responses({ expected_ctc: "2500000" }), ctx)
    .questions.find((q) => q.key === "expected_ctc")!.flag!,
  /20 lakh budget/
);
// Lakhs vs rupees: 25 (read as rupees) is not over a 20-lakh budget.
assert.equal(
  visibleFlow(responses({ expected_ctc: "25" }), ctx)
    .questions.find((q) => q.key === "expected_ctc")!.flag,
  null
);
assert.equal(
  visibleFlow(responses({ expected_ctc: "1800000" }), ctx)
    .questions.find((q) => q.key === "expected_ctc")!.flag,
  null
);

// ── Placeholders are filled, never read out raw ──────────────────────────────
const workplace = visibleFlow({}, ctx).questions.find((q) => q.key === "ok_workplace")!.question;
assert.ok(!workplace.includes("{"), workplace);
assert.ok(workplace.includes("hybrid mode"), workplace);
const relocate = visibleFlow(responses({ current_location: "Pune" }), ctx)
  .questions.find((q) => q.key === "relocate")!.question;
assert.ok(relocate.includes("Gurgaon"), relocate);
// A JD with no criteria still yields a sayable sentence.
const bare = fillFlowQuestion(FLOW_QUESTIONS[4].question, { criteria: {}, jobLocation: "" });
assert.ok(!bare.includes("{"), bare);
// An unknown placeholder is left visible rather than silently blanked.
assert.equal(fillFlowQuestion("{nope}", ctx), "{nope}");

// parseYesNo lives with its own function, in screening-questions.check.ts. It
// used to be checked here for "first word wins", which is the behaviour that
// turned out to be the bug.

// ── callableFlow: what the phone call is actually placed with ────────────────
// The regression this guards: a call is placed before the candidate has said
// anything, so every branch predicate is false. Sending only the *visible*
// questions handed the agent a fraction of the list and silently dropped every
// follow-up, so they were never asked on any call.
{
  const callKeys = (r: Record<number, string>, c = ctx) =>
    callableFlow(r, c).questions.map((q) => q.key);

  const all = callKeys({});
  assert.equal(all.length, FLOW_QUESTIONS.length,
    `a fresh call must carry every question, got ${all.length}: ${all.join(",")}`);
  for (const key of ["callback_time", "relocate", "notice_days_left", "willing_to_resign",
                     "notice_days", "other_offer", "offer_details", "interview_stage"]) {
    assert.ok(all.includes(key), `follow-up "${key}" missing from a fresh call`);
  }

  // A dependency must sit earlier in the array than the question naming it —
  // `walk` reads its "kept" set as it goes, so a forward reference would be
  // silently treated as dropped.
  const position = (key: string) => FLOW_QUESTIONS.findIndex((q) => q.key === key);
  for (const q of FLOW_QUESTIONS) {
    for (const dep of q.dependsOn ?? []) {
      assert.ok(position(dep) < position(q.key),
        `"${q.key}" depends on "${dep}", which comes after it`);
    }
  }

  // Every question whose predicate reads an *answer* must declare it, or it
  // silently vanishes from calls again the moment someone adds one. Conditions
  // on the requisition or the resume belong in `requires`, which is enforced
  // in both walks and so needs no dependsOn.
  for (const q of FLOW_QUESTIONS) {
    assert.ok(!q.askIf || (q.dependsOn && q.dependsOn.length > 0),
      `"${q.key}" has askIf but no dependsOn`);
    for (const dep of q.dependsOn ?? []) {
      assert.ok(FLOW_QUESTIONS.some((other) => other.key === dep),
        `"${q.key}" depends on unknown key "${dep}"`);
    }
  }

  // The employment gate IS known up front, so those three never reach the call.
  const joblessCall = callKeys({}, joblessCtx);
  for (const key of ["on_notice", "notice_days_left", "willing_to_resign", "notice_days",
                     "buyout", "current_ctc"]) {
    assert.ok(!joblessCall.includes(key),
      `"${key}" must not be read to a candidate who is not working`);
  }

  // Once HR's own answers close a branch, it IS excluded.
  const serving = callKeys({ [index("on_notice")]: "yes" });
  assert.ok(serving.includes("notice_days_left"));
  assert.ok(!serving.includes("willing_to_resign") && !serving.includes("notice_days"));

  const local = callKeys({ [index("current_location")]: "Gurgaon" });
  assert.ok(!local.includes("relocate"), "a local candidate must not be asked to relocate");
  const away = callKeys({ [index("current_location")]: "Chennai" });
  assert.ok(away.includes("relocate"), "a non-local candidate must be asked to relocate");

  // A gate HR has already tripped still stops the list.
  const stopped = callKeys({ [FLOW_INDEX_BASE]: "no" });
  assert.deepEqual(stopped, ["right_time", "callback_time"],
    `a bad time must stop after the callback question, got ${stopped.join(",")}`);

  // …but only for the call it was said on. A redial drops those two answers
  // (HrScreeningModal, via RESCHEDULE_INDICES) and asks the whole script again.
  assert.deepEqual(RESCHEDULE_INDICES, [index("right_time"), index("callback_time")]);
  const rescheduled: Record<number, string> = {
    [index("right_time")]: "no",
    [index("callback_time")]: "after 2 minutes",
    [index("current_location")]: "Chennai",
  };
  for (const i of RESCHEDULE_INDICES) delete rescheduled[i];
  const redial = callKeys(rescheduled);
  assert.ok(redial.includes("right_time") && redial.includes("join_reason"),
    `a redial must ask the whole script again, got ${redial.join(",")}`);

  // Indices are what the backend keys answers by, so they must line up. Sorted
  // on both sides: the walk emits them in ASK_ORDER now, and the two appended
  // questions are asked third and fourth while holding the last two indices.
  // What matters is that the *set* is exactly one index per question.
  assert.deepEqual(
    callableFlow({}, ctx).questions.map((q) => q.index).sort((a, b) => a - b),
    FLOW_QUESTIONS.map((_, i) => FLOW_INDEX_BASE + i),
    "callable indices must be FLOW_INDEX_BASE + position"
  );
  // …and each one still resolves to the question it names.
  for (const question of callableFlow({}, ctx).questions) {
    assert.equal(question.index, index(question.key), question.key);
  }
}

console.log("screening-flow: all checks passed");
