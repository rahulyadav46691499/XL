/**
 * Self-check for the dashboard calendar's arithmetic.
 *
 *   node --experimental-strip-types lib/call-calendar.check.ts
 *
 * Pins the week (Sunday first), which day an event lands on, and the lane
 * layout: a bulk call dials everyone in one minute, and those blocks must sit
 * side by side rather than on top of each other.
 */
import { weekStart, addDays, byDay, layoutDay, hourRange, eventTone, MIN_BLOCK_MINUTES } from "./call-calendar.ts";
import type { CallEvent } from "./api.ts";

function assert(ok: boolean, msg: string) {
  if (!ok) {
    console.error("FAIL: " + msg);
    process.exit(1);
  }
}

const ev = (at: string, over: Partial<CallEvent> = {}): CallEvent => ({
  session_id: "s", candidate_name: "X", jd_role: "", at, seconds: 60,
  status: "connected", kind: "call", ...over,
});
// Local-time strings (no offset), so the check means the same in any timezone.
const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();

// ─── the week ───────────────────────────────────────────────────────────────

const thu = new Date(2026, 10, 5, 15, 30); // Thursday 5 Nov 2026
const sun = weekStart(thu);
assert(sun.getDay() === 0 && sun.getDate() === 1 && sun.getHours() === 0, "the week starts Sunday 00:00");
assert(weekStart(sun).getTime() === sun.getTime(), "a Sunday is its own week start");
assert(addDays(sun, 7).getDate() === 8, "next week");
assert(weekStart(new Date(2026, 10, 1)).getMonth() === 10 && weekStart(new Date(2026, 9, 31)).getDate() === 25,
  "Saturday 31 Oct belongs to the week of Sunday 25 Oct");

const days = byDay([ev(local(1, 10)), ev(local(5, 9)), ev(local(5, 20)), ev(local(8, 10))], sun);
assert(days.length === 7 && days[0].length === 1 && days[4].length === 2, "events land on their day");
assert(days.flat().length === 3, "an event in the next week is not drawn in this one");

// ─── lanes ──────────────────────────────────────────────────────────────────

// A bulk call: three dials at 19:20, and a callback a minute later.
const bulk = layoutDay([ev(local(3, 19, 20)), ev(local(3, 19, 20)), ev(local(3, 19, 20)), ev(local(3, 19, 21))]);
assert(bulk.every((p) => p.lanes === 4), "four overlapping blocks share one width");
assert(new Set(bulk.map((p) => p.lane)).size === 4, "and each has its own lane");
assert(bulk[0].end - bulk[0].start === MIN_BLOCK_MINUTES, "a one-minute call is drawn as a half-hour block");

// Calls far apart keep the full width.
const apart = layoutDay([ev(local(3, 10)), ev(local(3, 14))]);
assert(apart.every((p) => p.lanes === 1 && p.lane === 0), "calls hours apart take the full column");

// A lane frees up once its block ends: A 10:00-10:30, B 10:10-10:40, C 10:35.
const reuse = layoutDay([ev(local(3, 10)), ev(local(3, 10, 10)), ev(local(3, 10, 35))]);
assert(reuse[2].lane === 0 && reuse.every((p) => p.lanes === 2), "C reuses A's lane; the group is two wide");

// A long call is drawn at its length.
const long = layoutDay([ev(local(3, 10), { seconds: 50 * 60 })])[0];
assert(long.end - long.start === 50, "a 50-minute call is a 50-minute block");

// ─── hours shown ────────────────────────────────────────────────────────────

assert(hourRange([[]]).join() === "9,21", "calling hours when nothing is outside them");
assert(hourRange([layoutDay([ev(local(3, 22, 43))])]).join() === "9,24", "a late call widens the grid");
assert(hourRange([layoutDay([ev(local(3, 7, 5))])]).join() === "7,21", "an early one too");

// ─── tone ───────────────────────────────────────────────────────────────────

assert(eventTone(ev("", { status: "scheduled", kind: "retry" })) === "scheduled", "a redial still to come");
assert(eventTone(ev("", { status: "busy" })) === "missed" && eventTone(ev("")) === "done", "past calls");

console.log("call-calendar: all checks passed");
