"use client";

/**
 * Chart primitives for the screening dashboard.
 *
 * Deliberately plain CSS/flex rather than a charting library: every form here
 * is a proportional bar, which a div already does. Marks follow the dataviz
 * spec — thin bars, 4px rounded data-ends, a 2px surface gap between fills,
 * recessive tracks, and values in text ink rather than the series colour.
 *
 * Add a real charting dependency only when a form appears that a div can't do
 * (a line/area over time, a scatter).
 */
import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
// The collective-analysis table renders whatever `lib/collective.ts` measured,
// in that module's own units — see `formatStat`.
import { formatStat, MetricRow } from "@/lib/collective";

/**
 * Score bands, for colour and commentary only — they decide nothing (see
 * DEFAULT_DECISION in lib/api.ts). Every score bar, histogram and progress
 * fill in the app reads them from here, so two screens can never disagree
 * about whether 78 is good.
 */
export const SCORE_THRESHOLDS = { interview: 75, hold: 60 };

export function scoreColor(s: number): string {
  if (s >= SCORE_THRESHOLDS.interview) return "var(--decision-interview)";
  if (s >= SCORE_THRESHOLDS.hold) return "var(--decision-hold)";
  return "var(--decision-rejected)";
}

/**
 * How a joining-likelihood category reads — the one place the four categories
 * from `backend/joining_evaluator.py` become words and a colour.
 *
 * Same rule as `scoreColor` above: two screens must never disagree, and the
 * dashboard cell and the HR modal panel both show this verdict.
 *
 * WITHDRAWN is grey, not red. The candidate took themselves out; that is a
 * different fact from us rating them unlikely, and painting it as a failure
 * would put "our worst outcome" on someone we never judged.
 */
export const JOINING_STYLE: Record<string, { label: string; color: string }> = {
  HIGH: { label: "High", color: "var(--decision-interview)" },
  MEDIUM: { label: "Medium", color: "var(--decision-hold)" },
  LOW: { label: "Low", color: "var(--danger)" },
  WITHDRAWN: { label: "Withdrawn", color: "var(--muted-foreground)" },
};

export function SectionHeading({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <p className="eyebrow-lg">{title}</p>
        {hint && <p className="text-[13px] text-foreground mt-0.5">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("bg-card border border-border rounded-2xl p-4", className)}>{children}</div>;
}

/**
 * A label and a single headline number. The `tone` carries meaning, so it
 * always ships beside the label — never colour alone.
 *
 * The caption that used to sit under the figure ("0 of 10 already screened",
 * "But only 9% requirement coverage…") was removed on request.
 */
export function StatTile({
  label, value, tone = "neutral", onClick, active, note,
}: {
  label: string;
  value: React.ReactNode;
  /** One muted line under the figure: what it covers, or how to get it. */
  note?: string;
  tone?: "neutral" | "brand" | "interview" | "hold" | "rejected";
  onClick?: () => void;
  active?: boolean;
}) {
  const toneVar = {
    neutral: "var(--foreground)",
    brand: "var(--brand)",
    interview: "var(--decision-interview)",
    hold: "var(--decision-hold)",
    rejected: "var(--decision-rejected)",
  }[tone];

  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "bg-card border rounded-2xl px-5 py-4 text-left w-full transition-all",
        onClick && "hover:border-[var(--brand)]/50 hover:shadow-sm active:scale-[0.99] cursor-pointer",
        active ? "border-[var(--brand)] shadow-sm" : "border-border"
      )}
    >
      <p className="eyebrow-lg truncate">{label}</p>
      <p className="readout text-[34px] mt-3" style={{ color: toneVar }}>{value}</p>
      {note && <p className="text-[11px] text-muted-foreground mt-1 truncate" title={note}>{note}</p>}
    </Tag>
  );
}

/**
 * Horizontal ranked bars — the form for "compare magnitude across a list of
 * names". Long labels stay horizontal and readable, which a vertical bar
 * chart cannot manage.
 */
export function BarList({
  rows, onRowClick, selected, emptyLabel = "Nothing to show",
}: {
  /**
   * `flagged` marks a row as a problem. It is shown with an icon and an
   * amber caption, never by recolouring the bar: brand orange and status
   * amber measure ΔE 2.5 under deutan simulation, so a hue swap between
   * them is invisible to a large share of readers. Bar length already
   * carries the magnitude — the flag only has to carry the threshold.
   */
  rows: { key: string; label: string; value: number; caption: string; flagged?: boolean }[];
  onRowClick?: (key: string) => void;
  selected?: string[];
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-muted-foreground py-6 text-center">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const isSelected = selected?.includes(r.key);
        const Tag = onRowClick ? "button" : "div";
        return (
          <Tag
            key={r.key}
            onClick={onRowClick ? () => onRowClick(r.key) : undefined}
            title={r.label + " — " + r.caption}
            className={cn(
              "grid grid-cols-[minmax(90px,1.1fr)_2.2fr_auto] items-center gap-3 w-full text-left px-2 py-1.5 rounded-lg transition-colors",
              onRowClick && "hover:bg-secondary/60 cursor-pointer",
              isSelected && "bg-[var(--brand-wash)]"
            )}
          >
            <span
              className={cn(
                "flex items-center gap-1 text-[13px] min-w-0",
                isSelected ? "font-bold text-[var(--brand)]" : "font-medium text-foreground"
              )}
            >
              {r.flagged && (
                <AlertTriangle
                  size={11}
                  className="flex-shrink-0 text-[var(--decision-hold)]"
                  aria-label="Scarce"
                />
              )}
              <span className="truncate">{r.label}</span>
            </span>
            <span className="h-3 rounded-full overflow-hidden" style={{ background: "var(--chart-track)" }}>
              {/* Square where it grows from, 4px rounded at the data end — the
                  same mark spec the columns and histograms follow. */}
              <span
                className="block h-full rounded-r-full transition-[width] duration-500"
                style={{ width: Math.max(r.value, 1.5) + "%", background: "var(--brand)" }}
              />
            </span>
            <span
              className={cn(
                "numeral text-[13px] font-semibold w-[62px] text-right",
                r.flagged ? "text-[var(--decision-hold)]" : "text-muted-foreground"
              )}
            >
              {r.caption}
            </span>
          </Tag>
        );
      })}
    </div>
  );
}

/**
 * Vertical stacked columns — how a cohort answered a set of yes/no questions.
 *
 * **Counts, not percentages.** A screening cohort is five or six people, so a
 * 100%-stacked column would report "100% said yes" off one answer and make a
 * question three people answered look exactly like one nine people answered.
 * Column height IS the number who answered, so the denominator is visible and
 * the split sits inside it.
 *
 * Colour is **emphasis, not identity**: yes wears the brand accent, no wears the
 * neutral slate that already means "recessive" in this app. Deliberately NOT
 * green/red — "yes" is good news on "do you have the BGC documents" and bad news
 * on "do you hold another offer", and a palette that judged one would be lying
 * about the other. Anything that is neither (the one question with a "maybe")
 * takes amber, the app's look-at-this colour, and stacks last so it is not
 * touching the brand orange it is hard to tell from (measured ΔE 2.5 under
 * deutan simulation — the two must never share an edge).
 *
 * Marks follow the house chart spec: columns capped at 40px, a 4px rounded data
 * end with a square baseline, and a 2px surface gap doing the separating between
 * segments rather than a stroke.
 *
 * The pair was measured, not eyeballed, against both surfaces: brand↔slate is
 * ΔE 13.6 (protan) / 27.1 (normal vision) on the light card and 13.6 / 20.0 on
 * the dark one, both well clear of the floors, and both clear 3:1 against their
 * surface. Two checks are knowingly not met: slate sits below the chroma floor
 * (it reads gray — which is the point of an emphasis chart, and the floor is a
 * rule for palettes where every hue is an identity), and in dark mode both sit
 * ~0.03 above the lightness band. Those are the app's own tokens, shared with
 * every other chart here; a bespoke pair that passed would cost the consistency
 * that made this page worth redrawing.
 */
const STACK_FILL: Record<string, string> = {
  yes: "var(--brand)",
  no: "var(--decision-rejected)",
};
const STACK_FILL_OTHER = "var(--decision-hold)";

/** White on brand and slate, ink on amber — set by the fill's luminance, so an
 *  inline count always clears contrast against the segment it sits in. */
const STACK_INK: Record<string, string> = {
  yes: "#ffffff",
  no: "#ffffff",
};

export function StackedColumns({
  columns, height = 168,
}: {
  columns: {
    key: string;
    label: string;
    answered: number;
    segments: { value: string; count: number }[];
    /** The tally as one phrase, for the tooltip. Built from `segments` if absent. */
    caption?: string;
  }[];
  height?: number;
}) {
  if (columns.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground py-6 text-center">
        No screening answers saved yet. These fill in as HR saves each screening.
      </p>
    );
  }

  const max = Math.max(1, ...columns.map((c) => c.answered));
  // Every option anyone chose, in stack order, for the legend.
  const legend: string[] = [];
  for (const column of columns) {
    for (const seg of column.segments) if (!legend.includes(seg.value)) legend.push(seg.value);
  }
  const fillFor = (value: string) => STACK_FILL[value] ?? STACK_FILL_OTHER;

  return (
    <div>
      {/* Legend first: with two or more series identity is never carried by
          colour alone, and the reader meets the key before the marks. */}
      <div className="flex items-center gap-4 mb-4">
        {legend.map((value) => (
          <span key={value} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: fillFor(value) }} />
            {value}
          </span>
        ))}
      </div>

      {/* Plot and axis scroll as one. They are two rows so the baseline can be a
          single hairline rather than a dashed one broken by every gap between
          columns — but a narrow screen that scrolled the columns and left their
          names behind would put every label under the wrong bar. `min-w-max`
          keeps the columns spread across a desk-width panel and lets them keep
          their 52px on a phone, where the panel scrolls instead of the page. */}
      <div className="overflow-x-auto">
      <div className="min-w-max">
      <div className="flex items-end gap-2" style={{ minHeight: height }}>
        {columns.map((column) => (
          <div
            key={column.key}
            className="flex-1 min-w-[52px] flex flex-col justify-end items-center group relative"
            style={{ height }}
            // The whole tally, for anyone not using a pointer: every value is
            // reachable without hovering and without seeing the colours.
            aria-label={`${column.label}: ${column.segments.map((seg) => `${seg.count} ${seg.value}`).join(", ")}, of ${column.answered} answered`}
            tabIndex={0}
          >
            {/* The total rides the cap of its own column, not the top of the
                plot: a fixed-position label detaches from a short column and
                reads as belonging to the one beside it. */}
            <span className="numeral text-[11px] font-semibold text-foreground mb-1 leading-none">
              {column.answered}
            </span>

            {/* Rendered top-down, so the segments are reversed: **yes sits on
                the baseline**, which is the edge a reader compares across
                columns, and the rest stack above it. */}
            {[...column.segments].reverse().map((seg, i) => {
              const px = (seg.count / max) * (height - 18);
              return (
                <div
                  key={seg.value}
                  className="w-full max-w-[40px] grid place-items-center transition-[height] duration-500"
                  style={{
                    height: Math.max(6, px),
                    background: fillFor(seg.value),
                    // 4px rounded data end on the cap, square where it meets the
                    // segment below and square at the baseline.
                    borderRadius: i === 0 ? "4px 4px 0 0" : 0,
                    // A 2px gap in the surface colour does the separating —
                    // never a stroke drawn round the mark.
                    marginBottom: i === column.segments.length - 1 ? 0 : 2,
                  }}
                >
                  {/* Inline only when it fits with room to breathe; otherwise
                      the cap, the legend and the tooltip carry it. Never
                      clipped to make it fit. */}
                  {px >= 20 && (
                    <span
                      className="numeral text-[11px] font-semibold leading-none"
                      style={{ color: STACK_INK[seg.value] ?? "var(--decision-hold-ink)" }}
                    >
                      {seg.count}
                    </span>
                  )}
                </div>
              );
            })}

            <div className="absolute bottom-full mb-1 hidden group-hover:block group-focus:block z-20 whitespace-nowrap left-1/2 -translate-x-1/2">
              <span className="text-[11px] px-2 py-1 rounded-md bg-foreground text-background font-medium">
                {column.caption ?? column.segments.map((seg) => `${seg.count} ${seg.value}`).join(" · ")}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* The axis: one hairline, and two lines of label at most under each
          column it names. */}
      <div className="flex gap-2 border-t border-border pt-2">
        {columns.map((column) => (
          <span
            key={column.key}
            className="flex-1 min-w-[52px] text-[11px] leading-tight text-muted-foreground text-center line-clamp-2"
          >
            {column.label}
          </span>
        ))}
      </div>
      </div>
      </div>
    </div>
  );
}

/**
 * The score ruler — the one bold element on the page.
 *
 * Every candidate row plots its score on the SAME axis, with the shortlisting
 * thresholds drawn as fixed ticks in every row. That makes the column readable
 * vertically: you can scan down it and see who clears the bar and by how much
 * without reading a single digit, which is the actual job of this screen.
 *
 * The previous treatment — a 48px bar filled to `score%` — could not do this,
 * because each bar was its own scale with no reference mark on it.
 */
/** Track width. The header scale that used to align to this is gone. */
const RULER_TRACK_PX = 104;

export function ScoreRuler({
  value, color,
}: {
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-6 flex-shrink-0" style={{ width: RULER_TRACK_PX }}>
        {/* Axis */}
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[5px] rounded-full"
          style={{ background: "var(--chart-track)" }}
        />

        {/* The reading, drawn from zero */}
        <div
          className="absolute top-1/2 -translate-y-1/2 left-0 h-[5px] rounded-full transition-[width] duration-500"
          style={{ width: value + "%", background: color }}
        />

        {/* The 60/75 threshold ticks that used to sit on the fill were removed on
            request. The bar is a plain 0–100 reading now; the decision pill in the
            same row is what says which side of the cut-off a candidate is on. */}
      </div>

      <span className="numeral text-[15px] font-semibold w-[26px] text-right" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

export type SkillChip = {
  word: string;
  /** Relative emphasis in the JD — drives type size. */
  weight: number;
  /** Candidates in the pool who have this skill. */
  have: number;
  total: number;
  pct: number;
  category: "tech" | "soft" | "other";
  scarce: boolean;
};

const CATEGORY_COLOR: Record<SkillChip["category"], string> = {
  tech: "var(--cat-tech)",
  soft: "var(--cat-soft)",
  other: "var(--cat-other)",
};

export const CATEGORY_LABEL: Record<SkillChip["category"], string> = {
  tech: "Technical",
  soft: "Soft skills",
  other: "Domain & other",
};

/**
 * The skill cloud. Type size is JD emphasis (how much the posting leans on a
 * skill); the fill sweeping across each chip is pool coverage (how many
 * candidates actually have it). Those are two different questions and the old
 * cloud only answered the first — a big chip could mean "critical requirement"
 * or "nobody has this" and you could not tell which.
 *
 * Four independent channels, one job each:
 *   size   → JD emphasis
 *   fill   → coverage across the pool
 *   colour → category
 *   icon   → scarce (under 25%), so scarcity never rests on colour alone
 */
export function SkillCloud({
  chips, selected, onToggle,
}: {
  chips: SkillChip[];
  selected: string[];
  onToggle: (word: string) => void;
}) {
  const maxWeight = Math.max(1, ...chips.map((c) => c.weight));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => {
        const isSelected = selected.includes(chip.word);
        const color = CATEGORY_COLOR[chip.category];
        // 12–17px: enough spread to read as a hierarchy, not so much that the
        // long labels in a real JD start wrapping unpredictably.
        const size = 14 + (chip.weight / maxWeight) * 5;

        return (
          <button
            key={chip.word}
            type="button"
            onClick={() => onToggle(chip.word)}
            aria-pressed={isSelected}
            title={`${chip.word} — ${chip.have} of ${chip.total} candidates (${chip.pct}%)${chip.scarce ? " · scarce" : ""}`}
            className={cn(
              "group relative flex items-center gap-1.5 rounded-full border pl-2.5 pr-1.5 py-1 overflow-hidden",
              "transition-all active:scale-95 hover:-translate-y-0.5 hover:shadow-sm"
            )}
            style={{
              fontSize: size + "px",
              fontWeight: isSelected ? 700 : 500,
              borderColor: isSelected ? "var(--brand)" : color + "40",
              background: isSelected ? "var(--brand)" : "transparent",
              color: isSelected ? "#fff" : color,
            }}
          >
            {/* Coverage fill. Sits behind the label and is clipped by the
                chip's own radius, so the chip reads as a tiny progress bar. */}
            {!isSelected && (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 transition-[width] duration-500"
                style={{ width: chip.pct + "%", background: color, opacity: 0.16 }}
              />
            )}

            {chip.scarce && !isSelected && (
              <AlertTriangle
                size={Math.round(size * 0.75)}
                className="relative flex-shrink-0 text-[var(--decision-hold)]"
                aria-label="Scarce"
              />
            )}

            <span className="relative">{chip.word}</span>

            <span
              className="relative rounded-full px-1.5 py-px numeral text-[11px] font-bold leading-none"
              style={{
                background: isSelected ? "#ffffff33" : color + "1f",
                color: isSelected ? "#fff" : color,
              }}
            >
              {chip.have}/{chip.total}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Vertical histogram for a distribution. `markers` draw the decision
 * thresholds onto the axis so the cut-offs can be read against the actual
 * shape of the pool — the whole point of showing the distribution.
 */
export function Histogram({
  bins, markers = [], barColor, height = 88,
}: {
  bins: { label: string; count: number; from: number; to: number }[];
  /** `at` is a percentage when it is a number; pass a preformatted string for
   *  any other unit (the salary chart's band is in rupees). */
  markers?: { at: number | string; label: string; color: string }[];
  barColor?: (bin: { from: number; to: number }) => string;
  height?: number;
}) {
  const max = Math.max(1, ...bins.map((b) => b.count));

  return (
    <div>
      {/* The key sits ABOVE the plot, the same place `StackedColumns` puts its
          legend: the reader meets what the colours mean before the marks, and
          the two charts read as one instrument rather than two conventions. The
          swatch mirrors the mark — a rect for bars, never a dot. */}
      {markers.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
          {markers.map((m) => (
            <span key={m.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: m.color }} />
              {m.label} <span className="numeral font-semibold text-foreground">
                {typeof m.at === "number" ? m.at + "%" : m.at}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-[2px]" style={{ height }}>
        {bins.map((b) => (
          <div key={b.label} className="flex-1 flex flex-col justify-end items-center group relative h-full">
            {b.count > 0 && (
              <span className="numeral text-[11px] font-semibold text-muted-foreground mb-0.5">{b.count}</span>
            )}
            {/* Capped at 40px rather than filling the slot: the leftover is air,
                which is what keeps a five-bin chart from reading as a wall of
                colour beside a stacked column of the same data. Same cap as
                `StackedColumns`, so every bar in the app is one thickness. */}
            <div
              className="w-full max-w-[40px] rounded-t transition-[height] duration-500"
              style={{
                height: b.count === 0 ? 2 : Math.max(4, (b.count / max) * (height - 16)),
                background: b.count === 0 ? "var(--chart-track)" : barColor ? barColor(b) : "var(--brand)",
              }}
            />
            <div className="absolute bottom-full mb-1 hidden group-hover:block z-20 whitespace-nowrap">
              <span className="text-[11px] px-2 py-1 rounded-md bg-foreground text-background font-medium">
                {b.count} in {b.label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* A short axis labels every band; a long one (the 10-bin score
          histogram) would collide, so it ticks every other bin instead. */}
      <div className="flex gap-[2px] mt-2 border-t border-border pt-2">
        {bins.map((b, i) => (
          <span key={b.label} className="numeral flex-1 text-[11px] text-muted-foreground text-center truncate">
            {bins.length <= 6 ? b.label : i % 2 === 0 ? b.from : ""}
          </span>
        ))}
      </div>

    </div>
  );
}

/**
 * A chart that starts collapsed to its heading and expands on click.
 *
 * This was a native `<details>`, which is the right element — but its summary
 * would not toggle back shut here, so the open state is explicit. The chevron
 * is the only thing that changes when closed; the chart itself isn't mounted.
 *
 * There is no description line: closed, the title is the whole card; open, the
 * charts speak for themselves. Removed on request — don't add a `hint` back.
 */
export function ChartPanel({
  title, children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  // Open by default: the charts are the point of the card, and collapsing it is
  // the exception rather than the arrival state.
  const [open, setOpen] = useState(true);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "Hide this chart" : "Show this chart"}
        className="flex items-center justify-between gap-3 w-full text-left"
      >
        <p className="eyebrow-lg">{title}</p>
        <ChevronDown
          size={14}
          className={cn(
            "flex-shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && <div className="mt-3">{children}</div>}
    </Card>
  );
}

/**
 * The five tracks every collective-analysis row shares with its header.
 *
 * The label track is the one that gives (`minmax(0,…)`), because the figures
 * are what the table is for. It wraps rather than truncating: at a narrow width
 * three rows clipped to "Times…" are indistinguishable, which is worse than a
 * label on two lines.
 */
const METRIC_COLUMNS = "grid grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(44px,0.7fr))] gap-2";

/**
 * Mean, median and mode for a set of metrics, one row each.
 *
 * **The `Total` column ships beside every row on purpose.** The call rows and
 * the criteria rows legitimately have different denominators — everyone has a resume score,
 * only the candidates actually called have a call duration — so an average
 * without the count behind it is the figure that gets misread. A metric nobody
 * has reads as an em dash rather than 0, for the same reason.
 */
export function MetricTable({
  title, rows, empty,
}: {
  title: string;
  rows: MetricRow[];
  /** Shown instead of the table when not one row has a single value. */
  empty?: string;
}) {
  if (empty && rows.every((r) => r.stats.n === 0)) {
    return (
      <div className="min-w-0">
        <p className="eyebrow mb-2">{title}</p>
        <p className="text-[13px] text-muted-foreground py-4">{empty}</p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <p className="eyebrow mb-2">{title}</p>

      <div className={cn(METRIC_COLUMNS, "px-2 pb-1.5 border-b border-border")}>
        <span className="text-[11px] font-semibold text-foreground">Metric</span>
        {["Mean", "Median", "Mode", "Total"].map((heading) => (
          <span key={heading} className="text-[11px] font-semibold text-foreground text-right">
            {heading}
          </span>
        ))}
      </div>

      {rows.map((r) => (
        <div
          key={r.key}
          className={cn(METRIC_COLUMNS, "px-2 py-2 items-center rounded-lg hover:bg-secondary/30 transition-colors")}
        >
          <span className="text-[13px] text-foreground leading-snug">{r.label}</span>
          <span className="numeral text-[13px] text-right">{formatStat(r.stats.mean, r.unit)}</span>
          <span className="numeral text-[13px] text-right">{formatStat(r.stats.median, r.unit)}</span>
          <span className="numeral text-[13px] text-right">{formatStat(r.stats.mode, r.unit)}</span>
          <span className="numeral text-[13px] text-right text-muted-foreground">{r.stats.n}</span>
        </div>
      ))}
    </div>
  );
}
