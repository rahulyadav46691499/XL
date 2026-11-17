/**
 * Cohort-level insight derivation for the screening dashboard.
 *
 * Every number the dashboard shows about a *group* of candidates is computed
 * here — the page renders, it does not calculate. Keeping this pure means the
 * self-check at the bottom actually covers the logic (`npx tsx lib/insights.ts`).
 *
 * The framing throughout is the hiring manager's question, not the data's shape:
 * "which requirement is starving my pipeline", "are my cut-offs calibrated",
 * "where is HR overruling the model".
 */
import type { CandidateEvaluation } from "./api";

export type Decision = "Interview" | "On Hold" | "Rejected";

export type SkillCoverage = {
  skill: string;
  have: number;
  pct: number;
  /** Scarce = fewer than a quarter of the pool has it. The hiring-manager alarm. */
  scarce: boolean;
};

export type Bin = { label: string; count: number; from: number; to: number };

export type Insights = {
  total: number;
  byDecision: Record<Decision, number>;
  medianScore: number;
  /** Coverage of each JD skill across the pool, scarcest first. */
  skillCoverage: SkillCoverage[];
  scarceSkills: SkillCoverage[];
  scoreBins: Bin[];
  communicationBins: Bin[];
  experienceBins: Bin[];
  /** Candidates carrying at least one red flag. */
  atRisk: number;
  /** HR has recorded a screening for this many candidates. */
  hrReviewed: number;
  /** HR's decision differs from the model's. High = thresholds need tuning. */
  overrides: number;
  /** Interview-bucket candidates HR has not screened yet — the actual to-do. */
  awaitingScreening: number;
};

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * Every JD skill, with how much of the pool actually has it. Ascending, so the
 * requirements nobody meets sit at the top — that is the row worth acting on
 * (relax the requirement, widen sourcing, or plan to train).
 *
 * The JD skill universe is the union of each candidate's matched + missing
 * lists, which is exactly how `toEvaluation()` splits the JD's skills.
 */
export function skillCoverage(evaluations: CandidateEvaluation[]): SkillCoverage[] {
  const universe = new Map<string, string>(); // lowercase -> original casing
  evaluations.forEach((c) => {
    [...c.matched_mandatory_skills, ...c.missing_mandatory_skills].forEach((s) => {
      const key = s.toLowerCase();
      if (!universe.has(key)) universe.set(key, s);
    });
  });

  const total = evaluations.length || 1;
  return [...universe.entries()]
    .map(([key, label]) => {
      const have = evaluations.filter((c) =>
        c.matched_mandatory_skills.some((s) => s.toLowerCase() === key)
      ).length;
      const pct = Math.round((have / total) * 100);
      return { skill: label, have, pct, scarce: pct < 25 };
    })
    .sort((a, b) => a.pct - b.pct || a.skill.localeCompare(b.skill));
}

/** Match scores bucketed into tens, so the shape of the pool is visible. */
export function scoreBins(evaluations: CandidateEvaluation[]): Bin[] {
  return binsOf(evaluations.map((c) => c.overall_match_score));
}

/**
 * The same buckets for communication scores.
 *
 * Only graded calls are counted, so the two histograms legitimately hold
 * different totals — a pool of 30 with 4 calls placed shows 30 bars' worth of
 * resume scores and 4 of communication. Filling the gap with zeroes would
 * invent a cliff at the bottom of the chart that no candidate is in.
 */
export function communicationBins(evaluations: CandidateEvaluation[]): Bin[] {
  return binsOf(
    evaluations
      .map((c) => (c.interview_scores?.status === "done"
        ? c.interview_scores.communication_score
        : undefined))
      .filter((v): v is number => v !== undefined)
  );
}

function binsOf(values: number[]): Bin[] {
  const bins: Bin[] = [];
  for (let from = 0; from < 100; from += 10) {
    const to = from + 10;
    bins.push({
      label: from + "–" + to,
      from,
      to,
      // Top bin is inclusive of 100 so a perfect score is never dropped.
      count: values.filter((v) => v >= from && (to === 100 ? v <= to : v < to)).length,
    });
  }
  return bins;
}

/**
 * Bands are half-open [from, to) and contiguous, because parsed experience is
 * fractional — 2.5 years is common. Inclusive integer bands (0–2, 3–5, …) drop
 * everyone who lands between them.
 */
const EXPERIENCE_BANDS: { label: string; from: number; to: number }[] = [
  { label: "0–2", from: 0, to: 3 },
  { label: "3–5", from: 3, to: 6 },
  { label: "6–8", from: 6, to: 9 },
  { label: "9–12", from: 9, to: 13 },
  { label: "13+", from: 13, to: Infinity },
];

/** Seniority mix. Candidates with no parsed experience are excluded, not zeroed. */
export function experienceBins(evaluations: CandidateEvaluation[]): Bin[] {
  return EXPERIENCE_BANDS.map((b) => ({
    label: b.label,
    from: b.from,
    to: b.to === Infinity ? 99 : b.to,
    count: evaluations.filter(
      (c) => c.years_experience !== undefined && c.years_experience >= b.from && c.years_experience < b.to
    ).length,
  }));
}

export function buildInsights(evaluations: CandidateEvaluation[]): Insights {
  const byDecision: Record<Decision, number> = { Interview: 0, "On Hold": 0, Rejected: 0 };
  evaluations.forEach((c) => {
    if (c.shortlist_decision in byDecision) byDecision[c.shortlist_decision as Decision]++;
  });

  const coverage = skillCoverage(evaluations);
  const reviewed = evaluations.filter((c) => hasScreening(c));

  return {
    total: evaluations.length,
    byDecision,
    medianScore: median(evaluations.map((c) => c.overall_match_score)),
    skillCoverage: coverage,
    scarceSkills: coverage.filter((s) => s.scarce),
    scoreBins: scoreBins(evaluations),
    communicationBins: communicationBins(evaluations),
    experienceBins: experienceBins(evaluations),
    atRisk: evaluations.filter((c) => c.red_flags_detected.length > 0).length,
    hrReviewed: reviewed.length,
    overrides: evaluations.filter(
      (c) => c.ai_decision !== undefined && c.ai_decision !== c.shortlist_decision
    ).length,
    awaitingScreening: evaluations.filter(
      (c) => c.shortlist_decision === "Interview" && !hasScreening(c)
    ).length,
  };
}

/** A screening counts as done once HR has answered anything or left a note. */
function hasScreening(c: CandidateEvaluation): boolean {
  const hr = c.hr_screening;
  if (!hr) return false;
  return Object.keys(hr.responses || {}).length > 0 || Boolean(hr.comment) || Boolean(hr.decision);
}

// ─── self-check ──────────────────────────────────────────────────────────────
// Run with: npx tsx lib/insights.ts
export function demo() {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAILED: " + msg);
  };

  const mk = (over: Partial<CandidateEvaluation>): CandidateEvaluation => ({
    candidate_name: "X", candidate_id: Math.random().toString(36),
    overall_match_score: 50, shortlist_decision: "Rejected",
    matched_mandatory_skills: [], missing_mandatory_skills: [],
    red_flags_detected: [], green_flags: [], Transferable_skills: [],
    reasoning: "", ...over,
  });

  const pool = [
    mk({ overall_match_score: 90, shortlist_decision: "Interview", years_experience: 7,
         matched_mandatory_skills: ["Python", "AWS"], missing_mandatory_skills: ["Kubernetes"] }),
    mk({ overall_match_score: 70, shortlist_decision: "On Hold", years_experience: 4,
         matched_mandatory_skills: ["Python"], missing_mandatory_skills: ["AWS", "Kubernetes"],
         red_flags_detected: ["Job hopping"] }),
    mk({ overall_match_score: 40, shortlist_decision: "Rejected", years_experience: 1,
         matched_mandatory_skills: [], missing_mandatory_skills: ["Python", "AWS", "Kubernetes"] }),
  ];

  const i = buildInsights(pool);

  assert(i.total === 3, "total");
  assert(i.medianScore === 70, "median of 40/70/90 is 70, got " + i.medianScore);
  assert(i.byDecision.Interview === 1 && i.byDecision.Rejected === 1, "decision split");
  assert(i.atRisk === 1, "one red-flagged candidate");

  // Scarcest first: Kubernetes 0%, AWS 33%, Python 67%.
  assert(i.skillCoverage[0].skill === "Kubernetes", "scarcest skill first, got " + i.skillCoverage[0].skill);
  assert(i.skillCoverage[0].pct === 0, "kubernetes 0%");
  assert(i.skillCoverage[2].skill === "Python" && i.skillCoverage[2].pct === 67, "python 67%");
  assert(i.scarceSkills.length === 1, "only Kubernetes is under 25%");

  // Bins must account for every candidate, and place them in the right bucket.
  assert(i.scoreBins.reduce((n, b) => n + b.count, 0) === 3, "score bins total");
  assert(i.scoreBins.find((b) => b.label === "90–100")!.count === 1, "90 lands in top bin");
  assert(i.scoreBins.find((b) => b.label === "70–80")!.count === 1, "70 lands in 70–80");
  assert(i.experienceBins.find((b) => b.label === "6–8")!.count === 1, "7 yrs in 6–8 band");
  assert(i.experienceBins.reduce((n, b) => n + b.count, 0) === 3, "exp bins total");

  // Fractional experience must not fall between bands — real resumes parse to
  // things like 2.5 years, and inclusive integer bands silently dropped them.
  const fractional = [2.5, 5.5, 8.5, 12.5, 13.5].map((y) => mk({ years_experience: y }));
  const fracBins = experienceBins(fractional);
  assert(
    fracBins.reduce((n, b) => n + b.count, 0) === fractional.length,
    "every fractional year lands in a band, got " + fracBins.map((b) => b.label + ":" + b.count).join(" ")
  );
  assert(fracBins.find((b) => b.label === "0–2")!.count === 1, "2.5 yrs sits in the first band");
  assert(fracBins.find((b) => b.label === "13+")!.count === 1, "13.5 yrs sits in the open top band");

  // Band edges belong to exactly one band.
  assert(experienceBins([mk({ years_experience: 3 })])[1].count === 1, "3 yrs starts the 3–5 band");
  assert(experienceBins([mk({ years_experience: 3 })])[0].count === 0, "3 yrs is not also in 0–2");

  // Score 100 must not fall out of the histogram.
  assert(scoreBins([mk({ overall_match_score: 100 })])[9].count === 1, "100 stays in the top bin");

  // HR state.
  assert(i.awaitingScreening === 1, "the Interview candidate is unscreened");
  assert(i.hrReviewed === 0, "nobody screened yet");

  const overridden = [mk({ shortlist_decision: "Interview", ai_decision: "Rejected",
                          hr_screening: { responses: { 0: "Yes" }, selected_questions: [], comment: "" } })];
  assert(buildInsights(overridden).overrides === 1, "HR override counted");
  assert(buildInsights(overridden).hrReviewed === 1, "answered screening counts as reviewed");
  assert(buildInsights(overridden).awaitingScreening === 0, "screened candidate is not awaiting");

  // Empty pool must not divide by zero or throw.
  const empty = buildInsights([]);
  assert(empty.total === 0 && empty.medianScore === 0 && empty.skillCoverage.length === 0, "empty pool");

  console.log("insights.ts: all checks passed");
}

// Runs only when this file is the entrypoint, never when Next imports it.
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("insights.ts")) {
  demo();
}
