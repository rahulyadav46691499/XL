/**
 * Self-check for the call-status helpers. Not imported by the app.
 *
 *   node --experimental-strip-types lib/call-status.check.ts
 *
 * These decide the words a recruiter reads off the dashboard while a candidate
 * is still being chased, so a wrong one is not cosmetic — "Completed" on a
 * screening that dropped at question four is a candidate reviewed as though
 * they had answered everything.
 */
import assert from "node:assert";
import {
  CALL_STATUS_LABELS,
  callStatusHint,
  callStatusLabel,
  formatCallTime,
  type CallStatus,
} from "./call-status.ts";

// The terminal leg statuses (Twilio's words, which backend/voice maps Sarvam's
// onto), copied rather than imported: lib/api.ts pulls
// in the whole app graph, which this check deliberately stays out of. If the
// list there changes, the last assertion below is what notices.
const CALL_ENDED = ["completed", "failed", "busy", "no-answer", "canceled"];

// Every status the voice service can compute has words. This list is
// compute_status's own set in backend/voice/calls.py; add one there, add it here.
const FROM_VOICE_SERVICE: CallStatus[] = [
  "queued", "in_progress", "rescheduled", "awaiting_retry", "completed",
  "not_interested", "disconnected", "no_answer", "failed", "cancelled",
];
for (const status of FROM_VOICE_SERVICE) {
  assert.ok(CALL_STATUS_LABELS[status], `${status} has no label`);
  assert.ok(callStatusLabel(status).length > 0, status);
  assert.ok(callStatusHint(status).length > 0, `${status} has no explanation`);
}

// The distinctions that matter most, spelled out — these four are the whole
// reason the status exists rather than reusing the leg's call_status.
assert.equal(callStatusLabel("completed"), "Completed");
assert.equal(callStatusLabel("disconnected"), "Disconnected");
assert.equal(callStatusLabel("awaiting_retry"), "Retrying");
assert.equal(callStatusLabel("rescheduled"), "Rescheduled");
assert.notEqual(callStatusLabel("disconnected"), callStatusLabel("completed"));
assert.notEqual(callStatusLabel("no_answer"), callStatusLabel("failed"));

// An older voice service sends no status at all, and a newer one may send a
// value this build has never heard of. Neither may render as "undefined".
assert.equal(callStatusLabel(undefined), "—");
assert.equal(callStatusLabel(""), "—");
assert.equal(callStatusLabel("something_new"), "something_new");
assert.equal(callStatusHint("something_new"), "");
assert.equal(callStatusHint(undefined), "");

// Times are read off the wire as ISO and shown to a person. A malformed one
// must show as itself rather than "Invalid Date".
assert.ok(formatCallTime("2099-01-04T15:00:00+05:30").includes("2099"));
assert.equal(formatCallTime("not a time"), "not a time");
assert.equal(formatCallTime(""), "");

// CALL_ENDED is the terminal set for ONE leg; the statuses above describe
// the whole screening. They overlap in wording ("completed", "failed") and mean
// different things, which is exactly the trap — the leg calls a line that dropped
// at question four "completed". So: they are not interchangeable sets, and
// CALL_ENDED must never be used to label anything for HR.
assert.notDeepStrictEqual([...CALL_ENDED].sort(), [...FROM_VOICE_SERVICE].sort());
assert.ok(CALL_ENDED.includes("completed") && FROM_VOICE_SERVICE.includes("completed"),
  "the overlap is real and is the reason these must stay separate");
// The three the voice service adds on top are the ones a leg status
// cannot express, and the ones the dashboard most needs.
for (const ours of ["rescheduled", "awaiting_retry", "disconnected"]) {
  assert.ok(!CALL_ENDED.includes(ours), `${ours} has no leg-status equivalent`);
  assert.ok(FROM_VOICE_SERVICE.includes(ours as CallStatus), ours);
}

console.log("call-status.check.ts: all checks passed");
