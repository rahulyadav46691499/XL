/**
 * The pool-relative decision: how a called candidate compares with the others.
 *
 * Kept out of `api.ts` for the same reason `screening-flow.ts` is — type-only
 * imports, so `pool-decision.check.ts` runs under
 * `node --experimental-strip-types` without a bundler.
 */
// Type-only, deliberately. Adding a runtime import here breaks the self-check.
import type { CandidateEvaluation } from "./api";

/**
 * A candidate's combined standing: resume score and communication score,
 * equally weighted.
 *
 * Undefined until the call has been graded — half the number is missing before
 * then, and averaging a resume score against nothing would rank a candidate who
 * has never been called alongside ones who have.
 */
export function combinedScore(c: CandidateEvaluation): number | undefined {
  const communication = c.interview_scores?.status === "done"
    ? c.interview_scores.communication_score
    : undefined;
  if (communication === undefined) return undefined;
  return (c.overall_match_score + communication) / 2;
}

/**
 * Decide the graded candidates against each other.
 *
 * Once a candidate has both a resume score and a communication score, their
 * average is compared with the average across every graded candidate: above it
 * they are Selected for R1, at or below it they go On Hold.
 *
 * Two things this deliberately does not do:
 *
 * - It never touches a candidate who has not been graded. Their decision stays
 *   the default, because a pool average says nothing about someone who has not
 *   been measured against it.
 * - It never overrides HR. A saved decision outranks this exactly as it
 *   outranks everything else; the comparison is a starting position, not a
 *   verdict, and the Override dropdown remains the last word.
 *
 * Being relative, it is unstable by nature: grading one more call moves the
 * average and can move other candidates across the line. That is what "above
 * the pool" means, but it is worth knowing before reading a row as settled.
 * Note also that a single graded candidate *is* the average, so they land On
 * Hold until there is someone to be better than.
 */
export function applyPoolDecisions(evaluations: CandidateEvaluation[]): CandidateEvaluation[] {
  const scored = evaluations
    .map(combinedScore)
    .filter((v): v is number => v !== undefined);
  if (scored.length === 0) return evaluations;

  const poolAverage = scored.reduce((sum, v) => sum + v, 0) / scored.length;

  return evaluations.map((c) => {
    const mine = combinedScore(c);
    if (mine === undefined) return c;
    const decision = mine > poolAverage ? "Interview" : "On Hold";
    // Read HR's saved decision here rather than trusting whatever
    // `shortlist_decision` arrives as: this function must land on the same
    // answer wherever it is called from, not depend on a caller having already
    // applied the override.
    const hr = c.hr_screening?.decision;
    const hrOverride = hr === "Rejected" || hr === "On Hold" || hr === "Interview" ? hr : undefined;
    return {
      ...c,
      ai_decision: decision,
      shortlist_decision: hrOverride ?? decision,
      combined_score: Math.round(mine),
      pool_average: Math.round(poolAverage),
    };
  });
}
