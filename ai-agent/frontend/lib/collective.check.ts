/**
 * Self-check for the collective analysis.
 *
 *   node --experimental-strip-types lib/collective.check.ts
 *
 * The things worth pinning: mean/median/mode on known inputs (including the
 * even-length median and the tie rule), that a candidate missing a metric is
 * *absent* rather than counted as a zero, and that the call rows and the
 * criteria rows keep their own separate denominators.
 */
import {
  stats,
  formatStat,
  formatDuration,
  formatMoney,
  formatBudget,
  durationBins,
  dialBins,
  radioBars,
  salaryBins,
  buildCollectiveAnalysis,
  callSpend,
  formatCredits,
} from "./collective.ts";
import type { CandidateEvaluation } from "./api.ts";

function assert(ok: boolean, msg: string) {
  if (!ok) {
    console.error("FAIL: " + msg);
    process.exit(1);
  }
}

// ─── stats ───────────────────────────────────────────────────────────────────

const empty = stats([]);
assert(empty.n === 0, "empty set has n 0");
assert(empty.mean === null && empty.median === null && empty.mode === null,
  "an empty set reports no figures rather than zeroes");

const one = stats([7]);
assert(one.n === 1 && one.mean === 7 && one.median === 7, "a single value is its own mean and median");
assert(one.mode === 7, "a lone value is trivially the mode");

// 2 4 4 6 -> mean 4, median 4, mode 4.
const s = stats([4, 2, 6, 4]);
assert(s.n === 4, "n counts every value");
assert(s.mean === 4, "mean of 2/4/4/6 is 4, got " + s.mean);
assert(s.median === 4, "median of 2/4/4/6 is 4, got " + s.median);
assert(s.mode === 4, "mode of 2/4/4/6 is 4, got " + s.mode);

// The median must NOT round: 1 and 2 sit either side of 1.5.
assert(stats([1, 2]).median === 1.5, "even-length median is the midpoint, not a rounded one");

// Nothing repeats, so there is no mode to report.
assert(stats([1, 2, 3]).mode === null, "no repeats means no mode");

// Tied frequencies resolve to the smaller value, whatever order they arrive in.
assert(stats([9, 3, 9, 3]).mode === 3, "a tie resolves to the smallest, got " + stats([9, 3, 9, 3]).mode);
assert(stats([3, 9, 3, 9]).mode === 3, "and does so regardless of input order");

// Mean is unrounded; formatting is the display layer's job.
assert(stats([1, 2]).mean === 1.5, "mean is not rounded");

// ─── formatting ──────────────────────────────────────────────────────────────

assert(formatStat(null, "count") === "—", "a missing figure is an em dash, never 0");
assert(formatDuration(45) === "45s", "under a minute stays in seconds");
assert(formatDuration(180) === "3m", "an exact minute drops the seconds");
assert(formatDuration(200) === "3m 20s", "past a minute reads m + s");
assert(formatDuration(92.5) === "1m 33s", "a fractional mean rounds to the second, got " + formatDuration(92.5));
assert(formatStat(78.25, "percent") === "78.3%", "percent keeps one decimal");
assert(formatStat(4, "percent") === "4%", "a whole percent drops the .0");
assert(formatStat(1, "years") === "1 yr", "one year is singular");
assert(formatStat(2.5, "years") === "2.5 yrs", "fractional years stay fractional");
assert(formatMoney(1500000) === "15L", "rupees read as lakhs, got " + formatMoney(1500000));
assert(formatMoney(1250000) === "12.5L", "a half lakh keeps its decimal, got " + formatMoney(1250000));
assert(formatMoney(1433333) === "14.3L", "a mean rounds to one decimal, got " + formatMoney(1433333));
assert(formatMoney(12000000) === "1.2Cr", "past a crore it says so, got " + formatMoney(12000000));
assert(formatStat(1500000, "rupees") === "15L", "the rupees unit uses that formatter");

assert(formatBudget({ min: 1200000, max: 1800000 }) === "12L–18L", "a full band");
assert(formatBudget({ max: 1800000 }) === "up to 18L", "a ceiling alone");
assert(formatBudget({ min: 1200000 }) === "from 12L", "a floor alone");
assert(formatBudget({}) === null, "a JD with no budget has no phrase, not an empty range");

// ─── the cohort ──────────────────────────────────────────────────────────────

function candidate(over: Partial<CandidateEvaluation>): CandidateEvaluation {
  return {
    candidate_name: "X",
    candidate_id: Math.random().toString(36),
    overall_match_score: 50,
    shortlist_decision: "Rejected",
    matched_mandatory_skills: [],
    missing_mandatory_skills: [],
    red_flags_detected: [],
    green_flags: [],
    Transferable_skills: [],
    reasoning: "",
    ...over,
  };
}

const cohort = [
  candidate({
    overall_match_score: 80,
    years_experience: 5,
    interview_scores: { status: "done", communication_score: 70 },
    interview_call_stats: { seconds: 120, placed: 2, rescheduled: 1, not_picked: 1 },
  }),
  candidate({
    overall_match_score: 60,
    years_experience: 3,
    interview_scores: { status: "done", communication_score: 90 },
    interview_call_stats: { seconds: 60, placed: 1, rescheduled: 0, not_picked: 0 },
  }),
  // Never called, and no experience extracted: absent from those metrics, and
  // still one of the candidates.
  candidate({ overall_match_score: 40 }),
];

const a = buildCollectiveAnalysis(cohort);

assert(a.candidates === 3, "every candidate counts toward the headline, got " + a.candidates);
assert(a.called === 2, "only candidates with an archived call are 'called', got " + a.called);

const by = (rows: typeof a.call, key: string) => rows.find((r) => r.key === key)!;

// Call rows: denominator is the two called candidates, NOT the cohort of three.
// Averaging in the un-called candidate as a 0-second call would give 60s here.
const duration = by(a.call, "duration");
assert(duration.stats.n === 2, "call rows count only called candidates, got " + duration.stats.n);
assert(duration.stats.mean === 90, "mean duration of 120s/60s is 90s, got " + duration.stats.mean);
assert(duration.stats.median === 90, "median of two is their midpoint");
assert(duration.stats.mode === null, "two distinct durations have no mode");

assert(by(a.call, "placed").stats.mean === 1.5, "mean dials placed is 1.5");
// 1 and 0 each occur once — distinct values, so no mode. (The tie rule proper
// is covered above, where a value actually repeats.)
assert(by(a.call, "rescheduled").stats.mode === null, "two distinct reschedule counts have no mode");
assert(by(a.call, "not_picked").stats.n === 2, "not-picked shares the call denominator");

// Criteria rows: each carries its own denominator.
const match = by(a.criteria, "match");
assert(match.stats.n === 3, "everyone has a resume score, got " + match.stats.n);
assert(match.stats.mean === 60, "mean of 80/60/40 is 60, got " + match.stats.mean);
assert(match.stats.median === 60, "median of 80/60/40 is 60");

const comp = by(a.criteria, "comprehensive");
assert(comp.stats.n === 2, "only graded calls have a comprehensive score, got " + comp.stats.n);
assert(comp.stats.mean === 80, "mean of 70/90 is 80, got " + comp.stats.mean);

const exp = by(a.criteria, "experience");
assert(exp.stats.n === 2, "the candidate with no extracted experience is absent, got " + exp.stats.n);
assert(exp.stats.mean === 4, "mean of 5/3 is 4, got " + exp.stats.mean);

// A pending or skipped call carries no score, so it must not reach the average.
const ungraded = buildCollectiveAnalysis([
  candidate({ interview_scores: { status: "pending" } }),
  candidate({ interview_scores: { status: "skipped", reason: "asked to be called back" } }),
]);
assert(by(ungraded.criteria, "comprehensive").stats.n === 0,
  "pending and skipped calls are not scores");

// ─── compensation, against the JD's budget ───────────────────────────────────

// `current_ctc` / `expected_ctc` arrive already parsed — `api.ts` lifts them out
// of the screening answers, so this module only ever sees rupees or nothing.
const pay = (current?: number, expected?: number) =>
  candidate({ current_ctc: current, expected_ctc: expected });

// A JD offering 12–18L, against a cohort where two of four ask over the top.
const pays = buildCollectiveAnalysis(
  [
    pay(1200000, 1500000),
    pay(1400000, 1500000),
    pay(1800000, 2400000),
    pay(2000000, 3000000),
    // Screened, but said nothing about pay — present in the cohort, absent here.
    pay(undefined, undefined),
  ],
  { min: 1200000, max: 1800000 }
);

const payRow = (key: string) => pays.compensation.find((r) => r.key === key)!;

assert(payRow("current_ctc").label === "Current CTC", "the modal's own label");
assert(payRow("expected_ctc").label === "Expected CTC", "likewise");

const nowOn = payRow("current_ctc").stats;
assert(nowOn.n === 4, "the candidate who said nothing is absent, got " + nowOn.n);
assert(nowOn.mean === 1600000, "mean of 12/14/18/20L is 16L, got " + nowOn.mean);
assert(nowOn.median === 1600000, "median of 12/14/18/20L is 16L");
assert(nowOn.mode === null, "four distinct packages have no mode");

const asked = payRow("expected_ctc").stats;
assert(asked.n === 4, "same denominator here");
assert(asked.mean === 2100000, "mean of 15/15/24/30L is 21L, got " + asked.mean);
assert(asked.median === 1950000, "median of 15/15/24/30L is 19.5L, got " + asked.median);
assert(asked.mode === 1500000, "15L is asked twice");
assert(formatStat(asked.mean, "rupees") === "21L", "and it reads as 21L");

// The comparison the card exists for: who wants more than the JD offers.
assert(pays.asking === 4, "four candidates stated an ask, got " + pays.asking);
assert(pays.aboveBudget === 2, "24L and 30L are over the 18L ceiling, got " + pays.aboveBudget);
assert(formatBudget(pays.budget) === "12L–18L", "the band reads back");

// Exactly at the ceiling is within budget, not over it.
const onTheLine = buildCollectiveAnalysis([pay(0, 1800000)], { max: 1800000 });
assert(onTheLine.aboveBudget === 0, "asking exactly the ceiling is not over it");

// A JD with no budget cannot say anyone is over it — null, never 0.
const noBudget = buildCollectiveAnalysis([pay(1200000, 9900000)]);
assert(noBudget.aboveBudget === null, "no ceiling means no verdict, got " + noBudget.aboveBudget);
assert(noBudget.asking === 1, "the ask is still counted");
assert(formatBudget(noBudget.budget) === null, "and the band has nothing to show");

// A cohort nobody has been screened on reports no pay figures, not zeroes.
const unscreened = buildCollectiveAnalysis([candidate({}), candidate({})]);
assert(unscreened.compensation.every((r) => r.stats.n === 0 && r.stats.mean === null),
  "an unscreened cohort has no asking price");
assert(unscreened.asking === 0, "and nobody has asked");

// ─── the charts ──────────────────────────────────────────────────────────────

// The bars must account for every called candidate — a chart whose bars do not
// sum to the `n` printed beside it is the quiet kind of wrong.
const at = (bins: typeof a.durationBins, label: string) => bins.find((b) => b.label === label)!;

assert(a.durationBins.reduce((n, b) => n + b.count, 0) === a.called, "duration bars total the called count");
assert(a.dialBins.reduce((n, b) => n + b.count, 0) === a.called, "dial bars total the called count");
assert(a.durationBins.length === 6, "six duration bands, so Histogram labels every one");

// 120s sits at a band edge: bands are [from, to), so it belongs to 2–3m.
const spread = durationBins([
  candidate({ interview_call_stats: { seconds: 0, placed: 1, rescheduled: 0, not_picked: 0 } }),
  candidate({ interview_call_stats: { seconds: 59, placed: 1, rescheduled: 0, not_picked: 0 } }),
  candidate({ interview_call_stats: { seconds: 120, placed: 1, rescheduled: 0, not_picked: 0 } }),
  candidate({ interview_call_stats: { seconds: 299, placed: 1, rescheduled: 0, not_picked: 0 } }),
  candidate({ interview_call_stats: { seconds: 300, placed: 1, rescheduled: 0, not_picked: 0 } }),
  candidate({ interview_call_stats: { seconds: 3600, placed: 1, rescheduled: 0, not_picked: 0 } }),
]);
assert(at(spread, "0–1m").count === 2, "0s and 59s are both under a minute");
assert(at(spread, "1–2m").count === 0, "nothing in 1–2m");
assert(at(spread, "2–3m").count === 1, "120s belongs to the band it opens, not the one it closes");
assert(at(spread, "4–5m").count === 1, "299s is still under five minutes");
assert(at(spread, "5m+").count === 2, "300s and an hour both land in the open top band");
assert(spread.reduce((n, b) => n + b.count, 0) === 6, "a long call is piled up, never dropped");

// Dials: the top band is open, and a 0 that should not exist is not lost.
const dials = dialBins([
  candidate({ interview_call_stats: { seconds: 1, placed: 0, rescheduled: 0, not_picked: 0 } }),
  candidate({ interview_call_stats: { seconds: 1, placed: 1, rescheduled: 0, not_picked: 0 } }),
  candidate({ interview_call_stats: { seconds: 1, placed: 3, rescheduled: 0, not_picked: 0 } }),
  candidate({ interview_call_stats: { seconds: 1, placed: 9, rescheduled: 0, not_picked: 0 } }),
]);
assert(at(dials, "1").count === 2, "a stat row with no dial recorded counts as the one call it was");
assert(at(dials, "3").count === 1, "3 dials");
assert(at(dials, "4+").count === 1, "9 dials pile into the open band");
assert(dials.reduce((n, b) => n + b.count, 0) === 4, "dial bars lose nobody");

// An empty cohort must not divide by zero or throw.
const none = buildCollectiveAnalysis([]);
assert(none.candidates === 0 && none.called === 0, "empty cohort");
assert(none.call.every((r) => r.stats.n === 0 && r.stats.mean === null), "empty cohort reports no call figures");
assert(none.criteria.every((r) => r.stats.n === 0), "empty cohort reports no criteria figures");
assert(none.durationBins.every((b) => b.count === 0), "empty cohort draws empty bands, not no bands");
assert(none.dialBins.every((b) => b.count === 0), "same for dials");

// ─── radio questions ─────────────────────────────────────────────────────────

const RADIO = [
  { key: "relocate", label: "Willing to relocate", type: "yesno" },
  { key: "notice_days", label: "Notice period", type: "number" },
  {
    key: "willing_to_resign",
    label: "Willing to resign",
    type: "yesno",
    options: [{ value: "yes", label: "Yes" }, { value: "maybe", label: "Maybe" }, { value: "no", label: "No" }],
  },
  { key: "buyout", label: "Buyout option", type: "yesno" },
];

// Answers keyed by flow key, exactly as `answersByKey` hands them over.
const ANSWERS: Record<string, Record<string, string>> = {
  a: { relocate: "yes", willing_to_resign: "maybe", notice_days: "60" },
  b: { relocate: "yes", willing_to_resign: "yes" },
  c: { relocate: "no", willing_to_resign: "" },
};
const screened = ["a", "b", "c"].map((id) => candidate({ candidate_id: id }));
const bars = radioBars(screened, RADIO, (c) => ANSWERS[c.candidate_id] ?? {});

assert(bars.length === 2, "only the two yesno questions anybody answered, got " + bars.length);
assert(bars.every((b) => b.key !== "notice_days"), "a number question is not a radio bar");
assert(bars.every((b) => b.key !== "buyout"), "a question nobody answered is dropped, not drawn at 0%");
const relocate = bars.find((b) => b.key === "relocate")!;
assert(relocate.answered === 3 && Math.round(relocate.yesShare) === 67, "2 of 3 said yes, got " + relocate.yesShare);
assert(relocate.caption === "2 yes · 1 no", "caption tallies every option chosen, got " + relocate.caption);
// The stack, bottom-up. Its order is the colour contract: yes, no, then the rest.
assert(
  JSON.stringify(relocate.segments) === JSON.stringify([
    { value: "yes", count: 2 }, { value: "no", count: 1 },
  ]),
  "segments are yes-then-no, got " + JSON.stringify(relocate.segments)
);
const resign = bars.find((b) => b.key === "willing_to_resign")!;
assert(resign.answered === 2, "an empty string is not an answer");
assert(resign.caption === "1 yes · 1 maybe", "a third option is named after yes/no, got " + resign.caption);
assert(resign.segments[resign.segments.length - 1].value === "maybe", "anything but yes/no stacks last");

// The three questions kept off the chart. Everybody answers them the same way,
// so they would draw near-solid columns beside the ones worth reading — but
// they are still asked and still recorded, which is why this is a chart rule
// and not a flow one.
const HYGIENE = [
  { key: "right_time", label: "Right time to talk", type: "yesno" },
  { key: "bgc_documents", label: "BGC documents", type: "yesno" },
  { key: "still_interested", label: "Still interested", type: "yesno" },
];
const withHygiene = radioBars(
  screened,
  [...RADIO, ...HYGIENE],
  () => ({ relocate: "yes", right_time: "yes", bgc_documents: "yes", still_interested: "yes" })
);
assert(
  withHygiene.every((b) => !["right_time", "bgc_documents", "still_interested"].includes(b.key)),
  "right_time / bgc_documents / still_interested never reach the chart, got "
    + withHygiene.map((b) => b.key).join(", ")
);
assert(withHygiene.some((b) => b.key === "relocate"), "…and the rest are untouched");
assert(
  bars.every((b) => b.segments.reduce((n, seg) => n + seg.count, 0) === b.answered),
  "a column always adds up to its own denominator"
);
assert(bars[0].answered >= bars[1].answered, "most-answered question first");

// ─── expected salary bands ───────────────────────────────────────────────────

assert(salaryBins([]).length === 0, "no asks, no chart");

const asks = [1_200_000, 1_400_000, 1_500_000, 2_500_000].map((expected_ctc) =>
  candidate({ expected_ctc })
);
const bands = salaryBins(asks, { min: 1_000_000, max: 1_800_000 });
assert(bands.length === 6, "six bands");
assert(bands[0].from === 1_000_000, "the band floor takes in the budget, not just the asks");
assert(bands.reduce((n, b) => n + b.count, 0) === 4, "every ask lands in a band");
assert(bands[bands.length - 1].to === Infinity, "the top band is open, so a high ask is visible");
// A cohort all asking the same figure must still produce readable bands rather
// than six zero-width ones.
const flat = salaryBins([candidate({ expected_ctc: 1_200_000 }), candidate({ expected_ctc: 1_200_000 })]);
assert(flat.every((b, i) => i === 0 || b.from > flat[i - 1].from), "bands always widen, even on one value");
assert(flat.reduce((n, b) => n + b.count, 0) === 2, "identical asks are still counted");

// ─── calls and spend per candidate ──────────────────────────────────────────

const callStats = (placed: number, cost?: number, callbacks?: number) =>
  ({ seconds: 60, placed, rescheduled: 0, not_picked: 0, cost, callbacks });
const spend = callSpend([
  candidate({ candidate_name: "Asha", interview_call_stats: callStats(2, 0.1, 1) }),
  candidate({ candidate_name: "Ravi", interview_call_stats: callStats(3, 0.2) }),
  candidate({ candidate_name: "Old", interview_call_stats: callStats(1) }),
  candidate({ candidate_name: "Never called" }),
]);
assert(spend.rows.length === 3, "a candidate never called is absent, not a row of zeros");
assert(spend.rows.map((r) => r.name).join() === "Ravi,Asha,Old", "costliest first, unknown cost last");
assert(spend.rows[2].cost === null, "stats archived before cost was recorded show a dash, not ₹0");
assert(spend.total.cost === 0.3, "the total is summed in paise, so 0.1 + 0.2 is 0.3, got " + spend.total.cost);
assert(spend.total.dials === 6 && spend.total.callbacks === 1, "dials and callbacks are totalled");
assert(formatCredits(15.6) === "₹15.60" && formatCredits(null) === "—", "rupees to the paisa: " + formatCredits(15.6));

console.log("collective: all checks passed");
