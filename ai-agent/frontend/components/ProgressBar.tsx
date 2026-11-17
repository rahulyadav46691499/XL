"use client";

/**
 * The one progress bar.
 *
 * Two modes, and which one you get depends on whether the caller knows a
 * percentage:
 *
 * - **Determinate** (`percent` given): the fill is the real figure the backend
 *   reports — files stored, plus how far into the current stage it is. See
 *   `lib/upload-progress.ts` for what the number means and why it never runs
 *   backwards or reaches 100 early.
 * - **Indeterminate** (no `percent`): a travelling fill, for a wait nothing
 *   reports on — a JD switch, a session restore, or the moment before the first
 *   progress poll lands.
 */
export default function ProgressBar({
  label,
  percent,
  className = "",
  overlay = false,
}: {
  label?: string;
  /** 0-100. Omit for waits with nothing to measure. */
  percent?: number;
  className?: string;
  /**
   * Centre the bar on the screen over a dimmed page, with the percentage as
   * the headline figure. For an upload that blocks the work anyway — the wait
   * is the only thing happening, so it stops hiding under the button.
   */
  overlay?: boolean;
}) {
  const determinate = typeof percent === "number";
  const width = determinate ? Math.max(0, Math.min(100, percent)) : 0;
  const fill = "linear-gradient(90deg, var(--brand), var(--brand-strong))";

  if (overlay) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
        <div
          className="w-full max-w-sm mx-6 rounded-2xl border border-border bg-card px-7 py-6 shadow-xl text-center"
          role="progressbar"
          aria-valuenow={determinate ? Math.round(width) : undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
          aria-live="polite"
        >
          {determinate && (
            <p className="numeral text-[44px] leading-none font-bold text-foreground tracking-[-0.02em]">
              {Math.round(width)}%
            </p>
          )}
          {label && (
            <p className="text-[15px] font-medium text-muted-foreground mt-3">{label}</p>
          )}
          <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden mt-4">
            {determinate ? (
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{ width: width + "%", background: fill }}
              />
            ) : (
              <div className="progress-indeterminate h-full rounded-full" style={{ background: fill }} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={"w-full " + className}
      role="progressbar"
      aria-valuenow={determinate ? Math.round(width) : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      aria-live="polite"
    >
      {(label || determinate) && (
        <div className="flex items-baseline justify-between gap-3 mb-1.5">
          {label ? <p className="eyebrow truncate">{label}</p> : <span />}
          {determinate && (
            <span className="numeral text-[13px] font-semibold text-foreground flex-shrink-0">
              {Math.round(width)}%
            </span>
          )}
        </div>
      )}
      <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
        {determinate ? (
          // The width transition matters: the backend reports in steps (a stage
          // ends, a file lands), and without it the fill jumps in a way that
          // reads as flicker rather than progress.
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out"
            style={{ width: width + "%", background: fill }}
          />
        ) : (
          <div className="progress-indeterminate h-full rounded-full" style={{ background: fill }} />
        )}
      </div>
    </div>
  );
}
