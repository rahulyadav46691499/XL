"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { CandidateEvaluation, CallUsage, getCallUsage } from "@/lib/api";
import {
  buildCollectiveAnalysis,
  callSpend,
  radioBars,
  salaryBins,
  formatBudget,
  formatCredits,
  formatDuration,
  formatMoney,
} from "@/lib/collective";
// The one place lakhs (how HR writes a band) become rupees (how a candidate
// says their CTC) — see role-criteria.ts. Never convert at a call site.
import { FLOW_QUESTIONS, answersByKey, budgetRupees } from "@/lib/screening-flow";
import { ChartPanel, MetricTable, StatTile, StackedColumns, Histogram } from "@/components/charts";
import JdBar from "@/components/JdBar";
import { cn } from "@/lib/utils";

/**
 * Collective analysis — the cohort read as one set of numbers rather than a
 * list of people.
 *
 * Its own page rather than a card on the Dashboard, because it answers a
 * different question: "what is this pool worth, and what did screening it
 * cost" versus "who is this person and what do we do about them". Every figure
 * comes from `lib/collective.ts` over the **whole** cohort — nothing here is
 * narrowed by the Dashboard's search box or filters, on purpose.
 *
 * The cohort is whichever JD is open (`exl_last_jd_uuid`). Switching JD stays
 * on the Dashboard, where the table it re-points is visible; this page follows
 * that choice rather than offering a second switcher that could disagree with
 * it.
 */
export default function AnalysisPage() {
  const appState = useAppState();
  const evaluations = appState.evaluations;
  const [restoring, setRestoring] = useState(evaluations.length === 0);

  // The same two calls the Dashboard makes on mount, from the same place: on a
  // reload, or when this page is opened first, the in-memory cohort is gone but
  // the backend still has it. `restoring` is this page's own spinner.
  useEffect(() => {
    appState.refreshJds();
    appState.openLastJd().finally(() => setRestoring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentJd = useMemo(
    () => appState.jds.find((j) => j.jd_uuid === appState.selectedJd) ?? null,
    [appState.jds, appState.selectedJd]
  );

  const budget = useMemo(() => budgetRupees(currentJd?.role_criteria), [currentJd?.role_criteria]);
  const collective = useMemo(
    () => buildCollectiveAnalysis(evaluations, budget),
    [evaluations, budget]
  );

  /** How the cohort answered every yes/no screening question. */
  const radios = useMemo(
    () =>
      radioBars(evaluations, FLOW_QUESTIONS, (c: CandidateEvaluation) =>
        answersByKey(c.hr_screening?.responses ?? {})
      ),
    [evaluations]
  );

  /** What they are asking for, on the same axis as what the role pays. */
  const salary = useMemo(() => salaryBins(evaluations, budget), [evaluations, budget]);

  /** Every called candidate's dials and credits, for the spend table. */
  const spend = useMemo(() => callSpend(evaluations), [evaluations]);

  // The account's spend and credit left. Account-wide, so it does not wait on
  // or follow the cohort; null shows as a dash when Sarvam can't be read.
  const [usage, setUsage] = useState<CallUsage | null>(null);
  useEffect(() => {
    getCallUsage().then(setUsage);
  }, []);

  const budgetPhrase = formatBudget(collective.budget);

  /** What the middle candidate wants — the tile, and the figure `askVsCeiling`
   *  reads against the requisition's ceiling. */
  const medianAsk = collective.compensation.find((r) => r.key === "expected_ctc")?.stats.median
    ?? null;

  /**
   * The median ask read against the ceiling — the one line that says whether
   * this requisition is priced for the people applying to it. A count of who is
   * over the line says how many; this says by how much.
   */
  const askVsCeiling = useMemo(() => {
    const ceiling = collective.budget.max;
    if (medianAsk == null || ceiling === undefined) return null;
    const gap = medianAsk - ceiling;
    if (gap === 0) return "level with it";
    return gap > 0 ? formatMoney(gap) + " over it" : formatMoney(-gap) + " under it";
  }, [collective, medianAsk]);

  if (restoring || evaluations.length === 0) {
    return (
      <div className="p-6 space-y-5 bg-background min-h-full">
        <JdBar />
        {restoring ? (
          <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-[15px]">Loading the cohort…</span>
          </div>
        ) : (
          <div className="text-center py-24">
            <p className="text-[15px] text-foreground">Nothing to analyse yet.</p>
            <p className="text-[13px] text-muted-foreground mt-1.5">
              {currentJd
                ? "Nothing has been screened against this job description yet. Add resumes above, or pick another."
                : "Screen some candidates against a job description and their collective figures appear here."}
            </p>
            <Link
              href="/dashboard"
              className="inline-block mt-4 px-4 py-2 rounded-xl text-[15px] font-semibold border border-[var(--brand)]/40 text-[var(--brand)] hover:bg-[var(--brand-wash)] transition-colors"
            >
              Go to the Dashboard
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 bg-background min-h-full">
      <JdBar />

      {/* No page title and no job name: the switcher directly above names the
          requisition, and repeating it here is the block that was taken off the
          Dashboard for the same reason. The tiles are the opening statement. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 rise">
        <StatTile label="Candidates" value={collective.candidates} />
        <StatTile
          label="Screened by call"
          value={collective.called}
          tone={collective.called > 0 ? "brand" : "neutral"}
        />
        {/* The account, not this JD: the Sarvam credits every call has used,
            and what is left of them. Per-candidate spend for this JD is the
            table further down. */}
        <StatTile
          label="Total spent"
          value={usage ? formatCredits(usage.spent) : "—"}
          note={
            !usage
              ? "Sarvam's usage could not be read"
              : usage.billed_at
                ? `Sarvam bill to ${new Date(usage.billed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, plus calls since`
                : `${usage.connected_calls} connected calls to date, all JDs`
          }
        />
        <StatTile
          label="Credits left"
          value={formatCredits(usage?.credits_left)}
          tone={usage?.credits_left != null && usage.credits_left < 100 ? "hold" : "neutral"}
          note={
            usage && usage.credits_left === null
              ? "Set SARVAM_CREDIT_BALANCE in backend/.env"
              : "In the Sarvam account"
          }
        />
      </div>

      {/* Every yes/no question as one picture. Reading down a column of stacked
          bars answers "what is this pool actually like" in a glance, which fifty
          fields across six modals do not. */}
      <ChartPanel title="Response analysis">
        <StackedColumns columns={radios} />
      </ChartPanel>

      {/* Asking price against the offered band — the two put on one axis, which
          is the only way "we are priced under this market" is visible rather
          than inferred from two averages in different places. */}
      <ChartPanel title="Salary expectation vs budget">
        {salary.length === 0 ? (
          <p className="text-[13px] text-muted-foreground py-4">
            Nobody has stated an asking package yet. This chart fills in from the Expected CTC
            answer, once a screening has been saved.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6 items-start">
            <div className="min-w-0">
              <Histogram
                bins={salary}
                // Amber marks the bands that sit above the ceiling. Bar length
                // already carries the count, so colour is free to carry the
                // one threshold that matters when reading an ask.
                barColor={(bin) =>
                  collective.budget.max !== undefined && bin.from >= collective.budget.max
                    ? "var(--decision-hold)"
                    : "var(--brand)"
                }
                markers={
                  budgetPhrase
                    ? [{
                        at: budgetPhrase,
                        label: "This role offers",
                        // Slate, not green: this is the reference the bars are
                        // read against, not a verdict on them.
                        color: "var(--decision-rejected)",
                      }]
                    : []
                }
              />
            </div>

            {/* The reading of the chart beside it. Three rows on one grid, so
                the figures line up in a column and the sentences stay out of
                each other's way — an average asking price means little until it
                is put next to the ceiling it has to fit under. */}
            <div className="min-w-0">
              <p className="eyebrow mb-3">Against this JD</p>
              {budgetPhrase ? (
                <dl className="space-y-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-[13px] text-muted-foreground">This role offers</dt>
                    <dd className="numeral text-[15px] font-semibold text-foreground">
                      {budgetPhrase} a year
                    </dd>
                  </div>

                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-[13px] text-muted-foreground">Asking above the ceiling</dt>
                    <dd
                      className="numeral text-[15px] font-semibold"
                      style={{
                        color: collective.aboveBudget
                          ? "var(--decision-hold)"
                          : "var(--foreground)",
                      }}
                    >
                      {collective.asking === 0
                        ? "—"
                        : `${collective.aboveBudget ?? 0} of ${collective.asking}`}
                    </dd>
                  </div>

                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-[13px] text-muted-foreground">Median ask</dt>
                    <dd className="numeral text-[15px] font-semibold text-foreground">
                      {medianAsk ? formatMoney(medianAsk) : "—"}
                    </dd>
                  </div>

                  <p className="text-[11px] text-muted-foreground pt-1 leading-relaxed">
                    {collective.asking === 0
                      ? "Nobody has stated an asking package yet, so there is nothing to compare the band with."
                      : askVsCeiling
                        ? `The median ask is ${askVsCeiling}.`
                        : "This JD has no ceiling, so nothing here is over it."}
                  </p>
                </dl>
              ) : (
                <p className="text-[13px] text-muted-foreground py-4 leading-relaxed">
                  This JD has no budget set, so there is no band to read the packages against. Add
                  one from Upload JD.
                </p>
              )}
            </div>
          </div>
        )}
      </ChartPanel>

      {/* The shape the averages cannot carry: a 2m mean is the same number
          whether every call ran two minutes or half ran ten seconds. Hidden
          until a call exists, rather than showing empty bands that read as
          "every call was zero seconds". */}
      {collective.called > 0 && (
        <ChartPanel title="Call effort">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6 items-start">
            {/* Both charts on one baseline: same heading treatment, same bar
                height, so the axes line up across the pair. */}
            <div className="min-w-0">
              <p className="eyebrow mb-3">Call length spread</p>
              <Histogram bins={collective.durationBins} />
            </div>

            <div className="min-w-0">
              <p className="eyebrow mb-3">Dials taken to connect</p>
              <Histogram bins={collective.dialBins} />
            </div>
          </div>
        </ChartPanel>
      )}

      {/* Who was called how often, and what each cost in Sarvam credits — this
          JD's share of the "Spent on calls" tile. Live off each candidate's
          call session, so a bulk call shows here the moment it ends. */}
      <ChartPanel title="Calls and credits per candidate">
        {spend.rows.length === 0 ? (
          <p className="text-[13px] text-muted-foreground py-4">
            Nobody for this JD has been called yet. Each AI phone call adds its candidate here,
            with what it cost.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              {[{ ...spend.total, id: "head" }, ...spend.rows, spend.total].map((r, i, all) => {
                const head = i === 0;
                const foot = i === all.length - 1;
                // The header row is MetricTable's: 11px bold, right-aligned over figures.
                const cell = head
                  ? "text-[11px] font-semibold text-foreground text-right"
                  : "numeral text-[13px] text-right";
                return (
                  <div
                    key={r.id + i}
                    className={cn(
                      "grid grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] gap-4 px-2 items-center",
                      head ? "pb-1.5 border-b border-border" : "py-2",
                      foot && "border-t border-border font-semibold",
                      !head && !foot && "rounded-lg hover:bg-secondary/30 transition-colors"
                    )}
                  >
                    <span className={cn("truncate", head ? "text-[11px] font-semibold" : "text-[13px] text-foreground")}>
                      {head ? "Candidate" : r.name}
                    </span>
                    <span className={cell}>{head ? "Times called" : r.dials}</span>
                    <span className={cell}>{head ? "Callbacks" : r.callbacks}</span>
                    <span className={cell}>{head ? "Talk time" : formatDuration(r.seconds)}</span>
                    <span className={cell}>{head ? "Credits spent" : formatCredits(r.cost)}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
              Times called counts every dial, answered or not; callbacks are the candidate ringing
              back. Credits are estimated per call from Sarvam&apos;s published rates (each started
              minute of talk plus each started 30 seconds of telephony, connected calls only), which
              run a little above the actual bill; the Total spent tile is the bill itself.
            </p>
          </div>
        )}
      </ChartPanel>

      {/* Three tables rather than one, because their denominators differ: every
          candidate has a resume score, only the ones actually called have a call
          duration, only the screened have said a salary. Averaging those
          together would report on people who were never measured. */}
      <ChartPanel title="Mean, median and mode">
        {/* Three columns at desk width, so the three tables sit side by side and
            the fourth cell is never a hole. Each keeps its own `n`. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-6 items-start">
          <MetricTable
            title="Call effort, per candidate"
            rows={collective.call}
            empty="No calls recorded yet. These figures are archived when HR saves the screening for a candidate who was called."
          />
          <MetricTable title="Criteria" rows={collective.criteria} />
          <MetricTable
            title="Compensation, per candidate"
            rows={collective.compensation}
            empty="No pay figures yet. Current and expected CTC come from the HR screening, once one has been saved."
          />
        </div>
      </ChartPanel>
    </div>
  );
}
