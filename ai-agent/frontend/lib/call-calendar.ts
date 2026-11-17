/**
 * The dashboard calendar's arithmetic: which week a day is in, which day an
 * event falls on, and how a day's events sit side by side when they overlap.
 * `components/CallCalendar.tsx` only draws what this returns.
 *
 * Type-only imports, like `collective.ts`, so `call-calendar.check.ts` runs
 * under `node --experimental-strip-types` with no bundler.
 */
import type { CallEvent } from "./api";

/** Sunday 00:00 of the week holding `day`, local time — the week Teams shows. */
export function weekStart(day: Date): Date {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function addDays(day: Date, n: number): Date {
  const d = new Date(day);
  d.setDate(d.getDate() + n);
  return d;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** The week's events, one list per day, Sunday first. Events outside it are dropped. */
export function byDay(events: CallEvent[], start: Date): CallEvent[][] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return days.map((day) => events.filter((e) => sameDay(new Date(e.at), day)));
}

/**
 * A call lasts seconds, but a block that short cannot hold a name, so every
 * block is drawn at least half an hour long — Teams' smallest slot — and
 * overlap is judged on the drawn length, or two calls a minute apart would sit
 * on top of each other.
 */
export const MIN_BLOCK_MINUTES = 30;

/** An event placed on its day: minutes past midnight, its lane, and how many
 *  lanes its overlapping group needs (its width is 1/lanes of the column). */
export type Placed = { event: CallEvent; start: number; end: number; lane: number; lanes: number };

/**
 * One day's events, side by side wherever their blocks overlap — the way Teams
 * lays out a double-booked slot. A bulk call dials everyone in the same minute,
 * so this is the common case, not an edge.
 */
export function layoutDay(events: CallEvent[]): Placed[] {
  const placed: Placed[] = events
    .map((event) => {
      const at = new Date(event.at);
      const start = at.getHours() * 60 + at.getMinutes();
      const length = Math.max(MIN_BLOCK_MINUTES, Math.ceil(event.seconds / 60));
      return { event, start, end: Math.min(24 * 60, start + length), lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  // A group is a run of blocks that overlap one another transitively; every
  // block in it shares the group's lane count, so the widths line up.
  let group: Placed[] = [];
  let groupEnd = -1;
  const closeGroup = () => {
    const lanes = group.reduce((n, p) => Math.max(n, p.lane + 1), 1);
    group.forEach((p) => (p.lanes = lanes));
    group = [];
  };
  for (const p of placed) {
    if (p.start >= groupEnd) closeGroup();
    // The first lane free at this block's start.
    const busy = new Set(group.filter((q) => q.end > p.start).map((q) => q.lane));
    while (busy.has(p.lane)) p.lane++;
    group.push(p);
    groupEnd = Math.max(groupEnd, p.end);
  }
  closeGroup();
  return placed;
}

/**
 * The hours the grid shows: calling hours (9 to 21, `CALL_HOURS` in
 * backend/voice/calls.py), widened to take in anything outside them — a call
 * placed by hand at 22:40 must not fall off the bottom.
 */
export function hourRange(placed: Placed[][]): [number, number] {
  const all = placed.flat();
  const first = Math.min(9, ...all.map((p) => Math.floor(p.start / 60)));
  const last = Math.max(21, ...all.map((p) => Math.ceil(p.end / 60)));
  return [first, Math.min(24, last)];
}

/** What a block says it is. */
export function eventTitle(e: CallEvent): string {
  switch (e.kind) {
    case "rescheduled":
      return "Callback they asked for";
    case "retry":
      return "Retry after a missed call";
    case "callback":
      return "They called back";
    default:
      return e.status === "in_progress" ? "On the call now" : "AI call";
  }
}

/** How it went, for a call that has happened; empty for one still to come. */
export function eventOutcome(e: CallEvent): string {
  return (
    {
      no_answer: "Not answered",
      busy: "Line busy",
      failed: "Failed",
    } as Record<string, string>
  )[e.status] ?? "";
}

/** The colour family a block wears: what is coming, what is live, what happened, what was missed. */
export function eventTone(e: CallEvent): "scheduled" | "live" | "done" | "missed" {
  if (e.status === "scheduled") return "scheduled";
  if (e.status === "in_progress") return "live";
  return e.status === "connected" ? "done" : "missed";
}
