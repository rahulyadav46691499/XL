/**
 * How far along an upload is, as a percentage.
 *
 * The backend reports two things (see `backend/progress.py`): how many files it
 * has finished, and which stage it is on right now. Neither is a percentage on
 * its own — `done / total` sits at 0% through the whole of a single-file upload,
 * and the stage says nothing about how many files are left. This combines them.
 *
 * Two things it must not do, both of which look broken on screen:
 *
 * - **Run ahead.** The stage credit is worth at most one file, so the bar can
 *   never claim more than "everything done, plus the file in hand".
 * - **Go backwards.** Files are processed in parallel and the reported stage is
 *   whichever one moved last, so it can legitimately go from `storing` (file A)
 *   to `parsing` (file B). `watchProgress` in `api.ts` keeps the running maximum
 *   — this file only has to be honest about a single reading.
 *
 * No runtime imports, so `upload-progress.check.ts` runs without a bundler.
 */

/** Roughly how much of one file's work is behind it when a stage begins. */
const STAGE_DONE: Record<string, number> = {
  parsing: 0.08,
  checking: 0.2,
  // The LLM extraction is the long one — most of the wait lives here, which is
  // why the bar sits at ~35% for a while rather than sprinting to 90%.
  analyzing: 0.35,
  embedding: 0.8,
  storing: 0.92,
  done: 1,
};

export function uploadPercent(stage: string, done: number, total: number): number {
  if (total <= 0) return 0;
  if (done >= total) return 100;

  const fraction = STAGE_DONE[stage];
  // An unknown stage name (a backend ahead of this build) still counts the
  // files it finished rather than reporting nothing.
  const credit = fraction === undefined ? 0 : fraction;

  const value = ((done + credit) / total) * 100;
  // Never a full bar until the backend says every file is stored: a bar that
  // reads 100% while the page is still waiting is worse than one that reads 99.
  return Math.max(0, Math.min(99, Math.round(value)));
}
