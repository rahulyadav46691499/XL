"use client";

import { useState } from "react";
import { Info, Loader2, Upload, Download, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppState } from "@/lib/app-state";
import { downloadEvaluationsExcel, jdFileUrl, stageLabel, UploadProgress } from "@/lib/api";
import JdPicker from "@/components/JdPicker";
import ProgressBar from "@/components/ProgressBar";

/** What the progress bar says while a resume batch is being analyzed: the
 *  backend's current stage once it reports one, the file count until then. */
function analyzingLabel(count: number, step: UploadProgress | null): string {
  return stageLabel(step, count === 1 ? "Analyzing 1 resume" : `Analyzing ${count} resumes`);
}

/**
 * The requisition bar: which JD is open, the two controls that change it, and
 * the export.
 *
 * Sticky, because it names the thing every figure below it is about — on the
 * Dashboard that is a long candidate table, on Collective analysis a column of
 * charts, and on both the answer to "which job is this?" has to stay on screen.
 * `main` in `(app)/layout.tsx` is the scroller, so `top-0` is under the header,
 * and the negative margins let it paint over the page's own `p-6` gutter —
 * without them content would show through the 24px above it.
 *
 * Everything it does lives in `lib/app-state.tsx`, not here: switching JD and
 * adding resumes both end in `setEvaluations`, and two pages showing this bar
 * must not each keep their own idea of which JD is open. Only the transient
 * "this button is busy" flag for the export is local.
 */
export default function JdBar({
  onSwitched,
  actions,
}: {
  onSwitched?: () => void;
  /** Page-specific buttons, beside Export — the Dashboard's calendar. */
  actions?: React.ReactNode;
}) {
  const app = useAppState();
  const [downloading, setDownloading] = useState(false);

  const currentJd = app.jds.find((j) => j.jd_uuid === app.selectedJd) ?? null;

  async function handleDownload() {
    if (app.evaluations.length === 0) return;
    setDownloading(true);
    try {
      await downloadEvaluationsExcel(app.evaluations);
    } catch (err) {
      console.error("[JdBar] Download failed:", err);
      alert(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <div className="sticky top-0 z-30 -mx-6 -mt-6 px-6 pt-6 pb-4 bg-background border-b border-border flex items-center justify-between gap-4 rise">
        <div className="flex items-end gap-2 flex-wrap">
          {app.jds.length > 0 && (
            /* The switcher is the only thing naming the job on the page, so it
               says what it is picking rather than leaving an unlabelled box. */
            <div className="flex flex-col gap-1">
              <label htmlFor="jd-switcher" className="eyebrow-lg">Job description</label>
              <JdPicker
                id="jd-switcher"
                jds={app.jds}
                value={app.selectedJd}
                onChange={async (uuid) => {
                  await app.openJd(uuid);
                  onSwitched?.();
                }}
                disabled={app.switchingJd}
              />
            </div>
          )}

          {/* See the JD itself. A link only when the backend kept the file —
              same rule as the Upload JD rows, so it never opens a tab on a 404. */}
          {currentJd && (
            jdFileUrl(currentJd) ? (
              <a
                href={jdFileUrl(currentJd)}
                target="_blank"
                rel="noopener noreferrer"
                title="Open this job description in a new tab"
                aria-label="View job description"
                className="w-9 h-9 flex items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:text-[var(--brand)] hover:border-[var(--brand)]/40 transition-colors"
              >
                <Info size={15} />
              </a>
            ) : (
              <span
                title="The original file for this job description was not kept"
                className="w-9 h-9 flex items-center justify-center rounded-xl border border-border bg-card text-muted-foreground/30"
              >
                <Info size={15} />
              </span>
            )
          )}
          {app.switchingJd && <Loader2 size={16} className="animate-spin text-[var(--brand)]" />}

          {/* Add more resumes to the JD on screen — the backend already has the
              JD, so no JD file is needed here. */}
          <label
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-[17px] font-semibold text-white transition-all active:scale-95",
              app.uploading ? "opacity-60 cursor-wait" : "cursor-pointer hover:opacity-90"
            )}
            style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))", boxShadow: "0 4px 14px var(--brand-wash)" }}
            title="Upload more resumes for this job description"
          >
            {app.uploading ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} />}
            {app.uploading ? "Analyzing…" : "Add Resumes"}
            <input
              type="file"
              accept=".pdf,.docx,.ppt,.pptx"
              multiple
              disabled={app.uploading}
              className="hidden"
              onChange={(e) => {
                // Snapshot before clearing: the live FileList empties with the
                // input, and clearing it is what lets the same file be picked
                // again after a failure.
                const picked = Array.from(e.target.files ?? []);
                e.target.value = "";
                app.uploadMore(picked);
              }}
            />
          </label>
        </div>

        {/* Export sits on the right, away from the two controls that change what
            is on screen. Secondary weight: exporting is a side errand, not the
            main act — two full-orange buttons gave neither one priority. */}
        <div className="flex-shrink-0 flex items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            title="Export every candidate in this screening to Excel"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[17px] font-semibold border border-border bg-card text-foreground hover:bg-secondary transition-all active:scale-95 disabled:opacity-60"
          >
            {downloading ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
            {downloading ? "Preparing…" : "Export in Excel"}
          </button>
        </div>
      </div>

      {/* Feedback for Add Resumes sits under the button that caused it. It used
          to render down beside the candidate table, well below the fold, so a
          batch with unreadable files looked like it had simply worked. */}
      {app.uploadError && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[var(--decision-hold)]/10 border border-[var(--decision-hold)]/30 rise">
          <AlertTriangle size={14} className="text-[var(--decision-hold)] mt-px flex-shrink-0" />
          <p className="text-[13px] text-foreground flex-1 leading-relaxed">{app.uploadError}</p>
          <button
            type="button"
            onClick={() => app.setUploadError("")}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Analysis runs long — a JD switch re-reads a whole screening, a resume
          batch goes through the parser and the LLM — so the wait gets a bar, not
          just a spinning icon. A resume batch takes the centred overlay (nothing
          else on the page is usable while it runs); a JD switch keeps the inline
          bar under the switcher that started it. */}
      {(app.uploading || app.switchingJd) && (
        <ProgressBar
          overlay={app.uploading}
          className="rise"
          label={app.uploading
            ? analyzingLabel(app.uploadCount, app.uploadStep)
            : "Loading this job description"}
          // A JD switch is a single read with nothing to report on, so it keeps
          // the travelling fill; only the upload has a real figure.
          percent={app.uploading ? app.uploadStep?.percent : undefined}
        />
      )}
    </>
  );
}
