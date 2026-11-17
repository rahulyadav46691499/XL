/**
 * Self-check for the pool-relative decision.
 *
 *   node --experimental-strip-types lib/pool-decision.check.ts
 *
 * The boundaries are what matter: exactly-average goes On Hold, an ungraded
 * candidate is left alone entirely, and a saved HR decision always wins.
 */
import { applyPoolDecisions, combinedScore } from "./pool-decision.ts";
import type { CandidateEvaluation } from "./api.ts";

function assert(ok: boolean, msg: string) {
  if (!ok) {
    console.error("FAIL: " + msg);
    process.exit(1);
  }
}

/** A candidate with only the fields this logic reads. */
function candidate(
  id: string,
  resume: number,
  communication?: number,
  hrDecision?: string
): CandidateEvaluation {
  return {
    candidate_name: id,
    candidate_id: id,
    overall_match_score: resume,
    shortlist_decision: "Interview",
    matched_mandatory_skills: [],
    missing_mandatory_skills: [],
    red_flags_detected: [],
    green_flags: [],
    Transferable_skills: [],
    reasoning: "",
    interview_scores: communication === undefined
      ? undefined
      : { status: "done", communication_score: communication },
    hr_screening: hrDecision
      ? ({ responses: {}, selected_questions: [], comment: "", decision: hrDecision } as never)
      : undefined,
  } as CandidateEvaluation;
}

const by = (list: CandidateEvaluation[]) =>
  Object.fromEntries(list.map((c) => [c.candidate_id, c.shortlist_decision]));

// ── combinedScore ────────────────────────────────────────────────────────────
assert(combinedScore(candidate("a", 80, 60)) === 70, "average of resume and communication");
assert(combinedScore(candidate("a", 80)) === undefined, "ungraded has no combined score");
assert(
  combinedScore({ ...candidate("a", 80), interview_scores: { status: "skipped" } }) === undefined,
  "a rescheduled call is not a grade"
);

// ── above / below the pool ───────────────────────────────────────────────────
// averages 80, 60, 40 -> pool average 60
let out = applyPoolDecisions([
  candidate("high", 90, 70),   // 80
  candidate("mid", 60, 60),    // 60  <- exactly the average
  candidate("low", 50, 30),    // 40
]);
let d = by(out);
assert(d.high === "Interview", "above the pool average is Selected for R1");
assert(d.mid === "On Hold", "exactly the pool average goes On Hold");
assert(d.low === "On Hold", "below the pool average goes On Hold");

// The numbers behind the decision are exposed for the UI.
const high = out.find((c) => c.candidate_id === "high")!;
assert(high.combined_score === 80 && high.pool_average === 60, "combined and pool exposed");

// ── ungraded candidates are untouched ────────────────────────────────────────
out = applyPoolDecisions([
  candidate("graded", 90, 70),
  candidate("never_called", 10),
]);
d = by(out);
assert(d.never_called === "Interview", "an ungraded candidate keeps the default decision");
assert(
  out.find((c) => c.candidate_id === "never_called")!.combined_score === undefined,
  "an ungraded candidate gets no combined score"
);

// ── HR always wins ───────────────────────────────────────────────────────────
out = applyPoolDecisions([
  candidate("high", 90, 90, "Rejected"),   // would be Interview on score alone
  candidate("low", 20, 20),
]);
d = by(out);
assert(d.high === "Rejected", "a saved HR decision outranks the pool comparison");
assert(
  out.find((c) => c.candidate_id === "high")!.ai_decision === "Interview",
  "the model's own opinion is still recorded alongside HR's"
);

// ── degenerate pools ─────────────────────────────────────────────────────────
// Nobody graded: nothing to compare against, so nothing changes.
out = applyPoolDecisions([candidate("a", 90), candidate("b", 10)]);
assert(by(out).a === "Interview" && by(out).b === "Interview", "no grades, no changes");

// One graded candidate IS the average, so they cannot be above it.
out = applyPoolDecisions([candidate("only", 90, 90), candidate("other", 50)]);
assert(by(out).only === "On Hold", "a lone graded candidate equals the average, so On Hold");

// Everyone identical: all equal to the average, all On Hold.
out = applyPoolDecisions([candidate("a", 70, 70), candidate("b", 70, 70)]);
assert(by(out).a === "On Hold" && by(out).b === "On Hold", "an identical pool is all On Hold");

assert(applyPoolDecisions([]).length === 0, "empty pool does not throw");

console.log("pool-decision: all checks passed");
