/**
 * How a screening call's state is put into words for HR.
 *
 * Its own module, with no imports, so `lib/call-status.check.ts` can run it
 * under `node --experimental-strip-types` without dragging in the app graph.
 * `lib/api.ts` re-exports all of it, so callers need not know it moved.
 */
/**
 * The voice service's one-word verdict on a screening, computed there from
 * fields only it has — how many times it dialled, how the call ended, whether
 * a redial is armed. See `compute_status` in backend/voice/calls.py.
 *
 * Deliberately NOT re-derived here from `call_status`: that is one leg's view
 * (Sarvam's attempt status, in the words below), and the two answer different
 * questions. The leg says "completed" for
 * a line that dropped at question four, which is the case this whole distinction
 * exists for.
 */
export type CallStatus =
  | "queued" | "in_progress" | "rescheduled" | "awaiting_retry" | "completed"
  | "not_interested" | "disconnected" | "no_answer" | "failed" | "cancelled";

/** What HR reads, and the one-line explanation behind it. */
export const CALL_STATUS_LABELS: Record<CallStatus, { label: string; hint: string }> = {
  queued: { label: "Queued", hint: "Waiting its turn — calls are placed one at a time." },
  in_progress: { label: "On the call", hint: "The AI screening call is happening now." },
  rescheduled: {
    label: "Rescheduled",
    hint: "The candidate asked to be called back. The redial happens automatically and fills these same answers.",
  },
  awaiting_retry: {
    label: "Retrying",
    hint: "Not reached — the call is being placed again automatically.",
  },
  completed: { label: "Completed", hint: "The screening ran to the end." },
  not_interested: { label: "Not interested", hint: "The candidate declined the role." },
  disconnected: {
    label: "Disconnected",
    hint: "The candidate answered but the call ended before finishing — most likely the line dropped.",
  },
  no_answer: {
    label: "No answer",
    hint: "The candidate never picked up, and automatic retries are used up. Worth a call by hand.",
  },
  failed: { label: "Call failed", hint: "The call could not be placed — check the number." },
  cancelled: { label: "Cancelled", hint: "A pending redial was called off." },
};

/** The status as words, falling back to the raw string for one we don't know. */
export function callStatusLabel(status: string | undefined): string {
  return CALL_STATUS_LABELS[status as CallStatus]?.label ?? (status || "—");
}

export function callStatusHint(status: string | undefined): string {
  return CALL_STATUS_LABELS[status as CallStatus]?.hint ?? "";
}

/** An ISO time as something readable, or the raw string if it will not parse. */
export function formatCallTime(iso: string): string {
  const at = new Date(iso);
  return isNaN(at.getTime())
    ? iso
    : at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
