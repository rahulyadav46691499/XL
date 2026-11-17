/**
 * Collective analysis — the cohort read as one set of numbers rather than a
 * list of people.
 *
 * Three families of metric, deliberately kept apart because their denominators
 * differ and merging them would quietly average over people who were never
 * measured:
 *
 *   - **Call effort** — how long the AI phone screening ran, how many dials it
 *     took, how many callbacks were arranged, how many rang out. Only
 *     candidates with an archived call carry these.
 *   - **Criteria** — the scores the app already judges candidates on. Each has
 *     its own denominator too: everyone has a resume score, only graded calls
 *     have a comprehensive score.
 *   - **Compensation** — what the requisition offers, what candidates are on
 *     today, and what they are asking for, all in rupees a year so the three
 *     compare directly. Only screened candidates have said either figure.
 *
 * Each metric reports mean, median and mode over the candidates that actually
 * have it, plus `n` so the reader can see what the average is an average *of*.
 *
 * Pure, and **type-only imports on purpose** — same rule as `screening-flow.ts`
 * and `jd-search.ts`, so `collective.check.ts` runs under
 * `node --experimental-strip-types` with no bundler. Don't add a runtime
 * import: that is why `current_ctc` / `expected_ctc` are parsed in `api.ts` and
 * why the budget arrives already converted (`budgetRupees`, which owns the one
 * lakh→rupee conversion) rather than being worked out here.
 */
// Type-only, deliberately. A runtime import here breaks the self-check.
import type { CandidateEvaluation } from "./api";
// The same bin shape `Histogram` already renders for scores and experience —
// these charts are that component, not a second one.
import type { Bin } from "./insights";

/** How a metric's figures should read. */
export type Unit = "seconds" | "count" | "percent" | "years" | "rupees";

export type Stats = {
  /** How many candidates actually carry this metric — the denominator. */
  n: number;
  mean: number | null;
  median: number | null;
  /**
   * The most frequent value, or null when there isn't one.
   *
   * Ties resolve to the **smallest** tied value, so the figure is stable
   * whatever order the candidates arrived in. A set where every value occurs
   * once has **no** mode and reports null rather than naming an arbitrary
   * member — which is the honest answer for something like call duration in
   * seconds, where repeats are rare and "the mode is 47s" would read as a
   * finding rather than a coincidence.
   */
  mode: number | null;
};

export type MetricRow = {
  key: string;
  label: string;
  unit: Unit;
  stats: Stats;
};

export type CollectiveAnalysis = {
  /** Everyone in the cohort. */
  candidates: number;
  /** Candidates with an archived call — the denominator for every call row. */
  called: number;
  call: MetricRow[];
  criteria: MetricRow[];
  /**
   * The shape behind the call figures, which the averages cannot show: a mean
   * of 2m over four calls is the same number whether every call ran two
   * minutes or two ran ten seconds and two ran four minutes.
   *
   * Only the call metrics get charts. The criteria already have theirs in the
   * "Score distribution & experience mix" panel directly above this card —
   * drawing them again here would be two pictures of one thing.
   */
  durationBins: Bin[];
  dialBins: Bin[];
  /** Current and expected CTC, in rupees a year. */
  compensation: MetricRow[];
  /**
   * The requisition's own band, in rupees — the line the two rows above are
   * read against. Both ends are optional: a JD uploaded before role criteria
   * existed has neither, and the panel says so instead of implying a zero.
   */
  budget: Budget;
  /** How many candidates have stated an ask at all — the pay rows' denominator. */
  asking: number;
  /**
   * Of those, how many want more than the ceiling. `null` when the JD has no
   * ceiling to be over, which is not the same as nobody being over it.
   */
  aboveBudget: number | null;
};

/** A salary band in rupees a year. Ends the JD never set stay undefined. */
export type Budget = { min?: number; max?: number };

/**
 * One radio question, as the cohort answered it — one stacked column.
 *
 * `segments` is the column bottom-up: **yes first, no second, anything else
 * after**. That order is the chart's colour contract, not a display detail —
 * yes wears the brand accent and "anything else" wears the amber that means
 * *look at this*, and those two must not end up touching (see `StackedColumns`).
 *
 * Counts, not percentages. A cohort here is five or six people: "100% said yes"
 * off a single answer is a sentence this data cannot support, and a column whose
 * height IS the number of people who answered shows the denominator instead of
 * hiding it.
 *
 * The questions themselves are passed in (see `radioBars`) — this module stays
 * import-free.
 */
export type RadioBar = {
  key: string;
  label: string;
  /** Bottom-up: yes, no, then any other recorded answer. */
  segments: { value: string; count: number }[];
  /** Share who said yes, of those who answered — for sorting and the caption. */
  yesShare: number;
  /** "5 yes · 2 no" — every option that was actually chosen. */
  caption: string;
  /** The denominator, and the column's height. A question nobody answered is
   *  dropped, never drawn as an empty column. */
  answered: number;
};

/** The subset of a flow question `radioBars` reads. Structural on purpose: the
 *  caller passes `FLOW_QUESTIONS`, the self-check passes three of its own. */
export type RadioQuestion = {
  key: string;
  label: string;
  type: string;
  options?: { value: string; label: string }[];
};

const EMPTY: Stats = { n: 0, mean: null, median: null, mode: null };

/**
 * Mean, median and mode over the values given.
 *
 * The caller filters first: a metric a candidate does not have must be absent,
 * never zero. Counting an un-called candidate as a zero-second call would drag
 * every average toward a call that never happened.
 */
export function stats(values: number[]): Stats {
  if (values.length === 0) return EMPTY;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;

  // Unrounded on purpose: this is the statistic, and rounding belongs to
  // `formatStat`. (`median` in insights.ts rounds because it feeds a score
  // tile — a different contract, which is why this is not that function.)
  const mid = Math.floor(n / 2);
  const median = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  const frequency = new Map<number, number>();
  sorted.forEach((v) => frequency.set(v, (frequency.get(v) || 0) + 1));
  let mode: number | null = null;
  let best = 0;
  // Insertion order is `sorted`'s, so a strict `>` keeps the first — i.e. the
  // smallest — of any tied values.
  for (const [value, count] of [...frequency.entries()]) {
    if (count > best) {
      best = count;
      mode = value;
    }
  }
  // Nothing repeated across a set of several — no mode. A lone value is
  // trivially its own, which is worth showing.
  if (best === 1 && n > 1) mode = null;

  return { n, mean, median, mode };
}

/** One figure, written the way its unit reads. `null` is an em dash. */
export function formatStat(value: number | null, unit: Unit): string {
  if (value === null) return "—";
  switch (unit) {
    case "seconds":
      return formatDuration(value);
    case "percent":
      return trim(value) + "%";
    case "years":
      return trim(value) + (value === 1 ? " yr" : " yrs");
    case "rupees":
      return formatMoney(value);
    case "count":
      return trim(value);
  }
}

/** Seconds as "45s" / "3m" / "3m 20s" — never a bare count of seconds past a minute. */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return total + "s";
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? minutes + "m" : minutes + "m " + rest + "s";
}

/** At most one decimal, and no trailing ".0" — means need it, medians rarely do. */
function trim(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * Rupees the way a salary is actually said here — "15L", "12.5L", "1.2Cr".
 *
 * `Intl` in the `en-IN` locale already knows the lakh/crore grouping, so there
 * is no arithmetic to get wrong and a package that runs past a crore does not
 * need a special case. A plain "1500000" in a table column is unreadable, and
 * the requisition's band was written in lakhs to begin with.
 */
const MONEY = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

export function formatMoney(rupees: number): string {
  return MONEY.format(rupees);
}

/** The requisition's band as one phrase — "12L–18L", "up to 18L", "from 12L". */
export function formatBudget(budget: Budget): string | null {
  const { min, max } = budget;
  if (min !== undefined && max !== undefined) return formatMoney(min) + "–" + formatMoney(max);
  if (max !== undefined) return "up to " + formatMoney(max);
  if (min !== undefined) return "from " + formatMoney(min);
  return null;
}

/** The comprehensive score, but only from a call that was actually graded. */
function comprehensive(c: CandidateEvaluation): number | undefined {
  return c.interview_scores?.status === "done"
    ? c.interview_scores.communication_score
    : undefined;
}

/** Values for one metric, with the candidates that lack it dropped. */
function pick(
  evaluations: CandidateEvaluation[],
  of: (c: CandidateEvaluation) => number | undefined
): number[] {
  return evaluations
    .map(of)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

/**
 * Where each minute band starts, in seconds. The last one is open-ended: a
 * screening call has no natural ceiling, and a fixed top band would drop the
 * long conversations out of the chart entirely rather than pile them up where
 * they can be seen.
 */
const DURATION_BANDS = [0, 60, 120, 180, 240, 300];

/** Per-candidate call length, bucketed by the minute. Six bands, so
 *  `Histogram` labels every one rather than ticking every other. */
export function durationBins(called: CandidateEvaluation[]): Bin[] {
  const values = pick(called, (c) => c.interview_call_stats?.seconds);

  return DURATION_BANDS.map((from, i) => {
    const last = i === DURATION_BANDS.length - 1;
    const to = last ? Infinity : DURATION_BANDS[i + 1];
    return {
      label: last ? "5m+" : from / 60 + "–" + to / 60 + "m",
      from,
      to,
      count: values.filter((v) => v >= from && v < to).length,
    };
  });
}

/** How many dials each candidate took, 1 / 2 / 3 / 4+. */
export function dialBins(called: CandidateEvaluation[]): Bin[] {
  // Every candidate with an archived call was dialled at least once, so a
  // recorded 0 can only come from a call archived before dials were counted.
  // Clamping keeps the bars summing to `n` instead of quietly losing that row.
  const values = pick(called, (c) => c.interview_call_stats?.placed).map((v) => Math.max(1, v));

  return [1, 2, 3, 4].map((from) => {
    const last = from === 4;
    const to = last ? Infinity : from + 1;
    return {
      label: last ? "4+" : String(from),
      from,
      to,
      count: values.filter((v) => v >= from && v < to).length,
    };
  });
}

/**
 * How the cohort answered every radio question, most-answered first.
 *
 * `answers` are keyed by flow key, which is why the caller hands over both the
 * questions and a reader: this module must not import `screening-flow.ts` (its
 * self-check runs under `node --experimental-strip-types`, where a runtime
 * import would have to carry a `.ts` specifier the bundler then rejects).
 *
 * Only `yesno` questions, minus `OFF_CHART`, and only candidates who actually
 * answered one: a question the flow never reached for anybody is absent rather
 * than a 0% bar, which would read as "everybody said no".
 */
/**
 * Questions kept off the chart. All three are call hygiene rather than anything
 * that distinguishes one candidate from another: "right time to talk" is about
 * the phone, and near enough everybody says yes to the other two, so they draw
 * three near-solid columns that push the questions worth reading off to one
 * side. They are still asked, still recorded, and still in the HR form — this
 * only decides what the cohort chart plots.
 */
const OFF_CHART = new Set(["right_time", "bgc_documents", "still_interested"]);

export function radioBars(
  evaluations: CandidateEvaluation[],
  questions: RadioQuestion[],
  /** Answers for one candidate, keyed by flow key — pass `answersByKey`. */
  answersOf: (c: CandidateEvaluation) => Record<string, string>
): RadioBar[] {
  const rows: RadioBar[] = [];

  for (const question of questions) {
    if (question.type !== "yesno") continue;
    if (OFF_CHART.has(question.key)) continue;

    const tally = new Map<string, number>();
    for (const c of evaluations) {
      const value = (answersOf(c)[question.key] || "").trim().toLowerCase();
      if (!value) continue;
      tally.set(value, (tally.get(value) || 0) + 1);
    }

    const answered = [...tally.values()].reduce((n, v) => n + v, 0);
    if (answered === 0) continue;

    // Yes and no first, in that order, then anything else a form has stored —
    // "maybe" on the one question that offers it, or a value from an older
    // build. Unknown answers are counted and named rather than dropped: a
    // column that does not add up to its own denominator is a lie.
    const rest = [...tally.keys()].filter((v) => v !== "yes" && v !== "no").sort();
    const segments = ["yes", "no", ...rest]
      .filter((v) => tally.get(v))
      .map((v) => ({ value: v, count: tally.get(v)! }));

    rows.push({
      key: question.key,
      label: question.label,
      segments,
      yesShare: ((tally.get("yes") || 0) / answered) * 100,
      caption: segments.map((seg) => seg.count + " " + seg.value).join(" · "),
      answered,
    });
  }

  return rows.sort((a, b) => b.answered - a.answered);
}

/**
 * What candidates are asking for, in six bands — and, through `barColor` at the
 * call site, which of those bands sit above what the role pays.
 *
 * The bands are cut from the data, not from a fixed ladder: asks for one
 * requisition cluster inside a few lakhs of each other, so fixed 0-5-10L bands
 * would draw four empty bars and pile everybody into the fifth. Rounded to
 * whole lakhs because that is the unit a salary is discussed in, and the top
 * band is open-ended so one outlier ask is visible rather than off-chart.
 *
 * `budget` only widens the range — the offered band is drawn on the same axis
 * as the asks, so "everyone is asking above what we pay" is a picture rather
 * than a paragraph.
 */
const LAKH = 100000;

export function salaryBins(
  evaluations: CandidateEvaluation[],
  budget: Budget = {},
  of: (c: CandidateEvaluation) => number | undefined = (c) => c.expected_ctc
): Bin[] {
  const values = pick(evaluations, of);
  if (values.length === 0) return [];

  const ends = [...values, ...[budget.min, budget.max].filter((v): v is number => v !== undefined)];
  const low = Math.floor(Math.min(...ends) / LAKH) * LAKH;
  const high = Math.ceil(Math.max(...ends) / LAKH) * LAKH;
  const step = Math.max(LAKH, Math.ceil((high - low) / 6 / LAKH) * LAKH);

  return Array.from({ length: 6 }, (_, i) => {
    const from = low + i * step;
    const last = i === 5;
    const to = last ? Infinity : from + step;
    return {
      label: last
        ? formatMoney(from) + "+"
        : formatMoney(from) + "–" + formatMoney(to),
      from,
      to,
      count: values.filter((v) => v >= from && v < to).length,
    };
  });
}

/**
 * Rupees to the paisa — "₹15.60", "₹1,234.50". Not `formatMoney`'s compact
 * "15L": a call costs a few rupees, and Sarvam bills one credit per rupee, so
 * the exact figure is the one that matches the billing page.
 */
const CREDITS = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

export function formatCredits(rupees: number | null | undefined): string {
  return rupees == null ? "—" : CREDITS.format(rupees);
}

/** One candidate's calls and what they cost — a row of the spend table. */
export type CallSpendRow = {
  id: string;
  name: string;
  /** Times the agent dialled them, answered or not. */
  dials: number;
  /** Times they rang the agent's number back. */
  callbacks: number;
  /** Connected time across every call, in seconds. */
  seconds: number;
  /** Rupees (= Sarvam credits). null on stats archived before cost was recorded. */
  cost: number | null;
};

/**
 * Every called candidate's dials and spend, costliest first, plus the total.
 * A candidate never called is absent rather than a row of zeros.
 */
export function callSpend(
  evaluations: CandidateEvaluation[]
): { rows: CallSpendRow[]; total: CallSpendRow } {
  const rows: CallSpendRow[] = evaluations
    .filter((c) => c.interview_call_stats)
    .map((c) => {
      const s = c.interview_call_stats!;
      return {
        id: c.candidate_id,
        name: c.candidate_name,
        dials: s.placed,
        callbacks: s.callbacks ?? 0,
        seconds: s.seconds,
        cost: s.cost ?? null,
      };
    })
    .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || a.name.localeCompare(b.name));

  const total = rows.reduce<CallSpendRow>(
    (t, r) => ({
      ...t,
      dials: t.dials + r.dials,
      callbacks: t.callbacks + r.callbacks,
      seconds: t.seconds + r.seconds,
      // Paise, then back: summing floats drifts (0.1 + 0.2).
      cost: (Math.round((t.cost ?? 0) * 100) + Math.round((r.cost ?? 0) * 100)) / 100,
    }),
    { id: "total", name: "Total", dials: 0, callbacks: 0, seconds: 0, cost: 0 }
  );
  return { rows, total };
}

function row(
  key: string,
  label: string,
  unit: Unit,
  evaluations: CandidateEvaluation[],
  of: (c: CandidateEvaluation) => number | undefined
): MetricRow {
  return { key, label, unit, stats: stats(pick(evaluations, of)) };
}

/**
 * Every collective figure the dashboard shows, from the cohort it is given.
 *
 * Labels follow the app's wording, not the field names: the stored field is
 * `communication_score` and the label HR reads is **Comprehensive** — see
 * `frontend/AGENTS.md`.
 */
export function buildCollectiveAnalysis(
  evaluations: CandidateEvaluation[],
  /**
   * The requisition's band, **already in rupees** — pass
   * `budgetRupees(jd.role_criteria)`. Taking it converted keeps the lakh→rupee
   * rule in the one module that owns it, and keeps this one bundler-free.
   */
  budget: Budget = {}
): CollectiveAnalysis {
  const called = evaluations.filter((c) => c.interview_call_stats);
  const asks = pick(evaluations, (c) => c.expected_ctc);

  return {
    candidates: evaluations.length,
    called: called.length,
    call: [
      // Short labels: the table's own heading already says "the call, per
      // candidate", and a narrow column has to leave these readable rather than
      // clipping three rows that all begin "Times the call was…".
      row("duration", "Call duration", "seconds", called, (c) => c.interview_call_stats?.seconds),
      row("placed", "Times placed", "count", called, (c) => c.interview_call_stats?.placed),
      row("rescheduled", "Times rescheduled", "count", called, (c) => c.interview_call_stats?.rescheduled),
      row("not_picked", "Times not picked", "count", called, (c) => c.interview_call_stats?.not_picked),
    ],
    criteria: [
      row("match", "Candidate score", "percent", evaluations, (c) => c.overall_match_score),
      row("comprehensive", "Comprehensive score", "percent", evaluations, comprehensive),
      row("combined", "Resume + call combined", "percent", evaluations, (c) => c.combined_score),
      row("experience", "Years of experience", "years", evaluations, (c) => c.years_experience),
    ],
    durationBins: durationBins(called),
    dialBins: dialBins(called),
    // "Current CTC" / "Expected CTC" are the modal's own labels for these two
    // questions — same rule as Comprehensive score, the wording follows the app
    // rather than the field name.
    compensation: [
      row("current_ctc", "Current CTC", "rupees", evaluations, (c) => c.current_ctc),
      row("expected_ctc", "Expected CTC", "rupees", evaluations, (c) => c.expected_ctc),
    ],
    budget,
    asking: asks.length,
    // null, not 0: "nobody is over the ceiling" and "this JD has no ceiling"
    // are different answers, and only one of them is about the candidates.
    aboveBudget: budget.max === undefined
      ? null
      : asks.filter((v) => v > budget.max!).length,
  };
}
