"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CallEvent, getCallSchedule } from "@/lib/api";
import {
  addDays, byDay, eventOutcome, eventTitle, eventTone, hourRange, layoutDay, sameDay, weekStart,
} from "@/lib/call-calendar";
import { formatDuration } from "@/lib/collective";

/** One hour of grid, in px: a half-hour block (the smallest) holds two lines. */
const HOUR_PX = 60;

/** The four kinds of block, each a token family — never a raw colour. Missed
 *  is amber, the app's "look at this"; a call that happened is slate, the
 *  reference colour, so what is still to come is what stands out. */
const TONE = {
  scheduled: { bg: "var(--brand-wash)", bar: "var(--brand)", ink: "var(--foreground)", label: "Scheduled" },
  live: { bg: "var(--decision-interview)", bar: "var(--decision-interview)", ink: "var(--decision-interview-ink)", label: "On the call" },
  done: { bg: "var(--decision-rejected-wash)", bar: "var(--decision-rejected)", ink: "var(--foreground)", label: "Called" },
  missed: { bg: "var(--decision-hold-wash)", bar: "var(--decision-hold)", ink: "var(--foreground)", label: "Not reached" },
} as const;

const TIME = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });
const WHEN = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const WEEKDAY = new Intl.DateTimeFormat("en-IN", { weekday: "short" });
const RANGE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" });

/**
 * The dashboard's calendar button, and the week view it opens: every AI call
 * placed or taken, and every redial still to come (a callback the candidate
 * asked for, a retry after a missed call), laid out like a Teams week.
 *
 * Read from `GET /interviews/schedule`, which is every voice session — not
 * just this JD's — because the phone line is shared and so is the diary.
 */
export default function CallCalendar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Scheduled calls"
        aria-label="Scheduled calls"
        className="self-stretch flex items-center px-3.5 rounded-xl border border-border bg-card text-foreground hover:bg-secondary transition-all active:scale-95"
      >
        <CalendarDays size={19} />
      </button>
      {/* Portalled: this button lives in the sticky JdBar, whose backdrop blur
          makes it the containing block for `fixed`, so an in-place dialog
          rendered inside the bar instead of over the page. */}
      {open && createPortal(<CalendarDialog onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function CalendarDialog({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<CallEvent[] | null>(null);
  const [error, setError] = useState("");
  const [start, setStart] = useState(() => weekStart(new Date()));

  useEffect(() => {
    getCallSchedule()
      .then(setEvents)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the calls."));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const now = new Date();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const placed = useMemo(() => byDay(events ?? [], start).map(layoutDay), [events, start]);
  const [first, last] = hourRange(placed);
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const nowTop = ((now.getHours() * 60 + now.getMinutes() - first * 60) / 60) * HOUR_PX;

  // Open each week at its first call (an hour above it), the way Teams opens
  // on working hours: evening calls otherwise sit below the fold.
  const scroller = useRef<HTMLDivElement>(null);
  const earliest = Math.min(...placed.flat().map((p) => p.start), 24 * 60);
  useEffect(() => {
    if (scroller.current && earliest < 24 * 60) {
      scroller.current.scrollTop = Math.max(0, (earliest / 60 - first - 1) * HOUR_PX);
    }
  }, [earliest, first]);

  // What is still to come, whichever week it is in — the header says so and
  // jumps there, since a callback is often next week and this opens on today.
  const upcoming = (events ?? []).filter((e) => e.status === "scheduled");
  const inView = placed.flat().length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Scheduled calls"
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-[1200px] h-[88vh] flex flex-col overflow-hidden"
      >
        {/* Teams' toolbar: Today, back, forward, the range, then the key. */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border">
          <CalendarDays size={17} className="text-[var(--brand)]" />
          <p className="eyebrow-lg mr-2">Scheduled calls</p>
          <button
            type="button"
            onClick={() => setStart(weekStart(new Date()))}
            className="px-3 py-1.5 rounded-lg text-[13px] font-semibold border border-border hover:bg-secondary transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setStart(addDays(start, -7))}
            aria-label="Previous week"
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
          >
            <ChevronLeft size={17} />
          </button>
          <button
            type="button"
            onClick={() => setStart(addDays(start, 7))}
            aria-label="Next week"
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
          >
            <ChevronRight size={17} />
          </button>
          <p className="text-[15px] font-semibold text-foreground numeral">
            {RANGE.formatRange(days[0], days[6])}
          </p>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            {Object.values(TONE).map((t) => (
              <span key={t.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: t.bar }} />
                {t.label}
              </span>
            ))}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Where the next scheduled call is, or that there is none. */}
        <div className="px-4 py-2 border-b border-border text-[13px] text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
          {error ? (
            <span className="text-[var(--danger)]">{error}</span>
          ) : events === null ? (
            <span className="flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Loading calls…</span>
          ) : (
            <>
              <span>
                {upcoming.length === 0
                  ? "No calls scheduled."
                  : `${upcoming.length} call${upcoming.length === 1 ? "" : "s"} scheduled.`}
              </span>
              {upcoming.map((e) => (
                <button
                  key={e.session_id + e.at}
                  type="button"
                  onClick={() => setStart(weekStart(new Date(e.at)))}
                  className="text-[var(--brand)] font-semibold hover:underline"
                >
                  {WHEN.format(new Date(e.at))} · {e.candidate_name}
                </button>
              ))}
              {inView === 0 && <span>Nothing on the calendar this week.</span>}
            </>
          )}
        </div>

        <div ref={scroller} className="flex-1 overflow-auto">
          <div className="min-w-[760px]">
            {/* Day headers stay put while the hours scroll under them. */}
            <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] sticky top-0 z-10 bg-card border-b border-border">
              <div />
              {days.map((d) => {
                const today = sameDay(d, now);
                return (
                  <div key={d.toISOString()} className="px-2 py-2 border-l border-border">
                    <p
                      className={cn(
                        "numeral text-[21px] leading-none w-9 h-9 flex items-center justify-center rounded-full",
                        today ? "bg-[var(--brand)] text-white font-semibold" : "text-foreground"
                      )}
                    >
                      {d.getDate()}
                    </p>
                    <p className={cn("text-[11px] mt-1", today ? "text-[var(--brand)] font-semibold" : "text-muted-foreground")}>
                      {WEEKDAY.format(d)}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
              <div>
                {hours.map((h) => (
                  <div key={h} style={{ height: HOUR_PX }} className="pr-2 text-right">
                    {/* Centred on its line, except the top one, which would clip. */}
                    <span className={cn("text-[11px] text-muted-foreground relative", h !== first && "-top-2")}>
                      {TIME.format(new Date(2000, 0, 1, h)).replace(":00", "")}
                    </span>
                  </div>
                ))}
              </div>

              {placed.map((dayEvents, i) => (
                <div key={i} className="relative border-l border-border" style={{ height: hours.length * HOUR_PX }}>
                  {hours.map((h) => (
                    <div key={h} className="border-t border-border/70" style={{ height: HOUR_PX }} />
                  ))}

                  {/* Now, as a line across today — where Teams draws it. */}
                  {sameDay(days[i], now) && nowTop >= 0 && nowTop <= hours.length * HOUR_PX && (
                    <div className="absolute left-0 right-0 z-[5] pointer-events-none" style={{ top: nowTop }}>
                      <div className="h-[2px] bg-[var(--brand)]" />
                      <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-[var(--brand)]" />
                    </div>
                  )}

                  {dayEvents.map((p) => {
                    const e = p.event;
                    const tone = TONE[eventTone(e)];
                    const at = new Date(e.at);
                    const outcome = eventOutcome(e);
                    const said = [eventTitle(e), outcome, e.seconds ? formatDuration(e.seconds) : ""]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <div
                        key={e.session_id + e.at + e.kind}
                        title={`${e.candidate_name}${e.jd_role ? " — " + e.jd_role : ""}\n${said}\n${WHEN.format(at)}`}
                        className="absolute rounded-md border-l-[3px] px-1.5 py-0.5 overflow-hidden text-[11px] leading-[13px]"
                        style={{
                          top: ((p.start - first * 60) / 60) * HOUR_PX + 1,
                          height: ((p.end - p.start) / 60) * HOUR_PX - 2,
                          left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`,
                          width: `calc(${100 / p.lanes}% - 4px)`,
                          background: tone.bg,
                          borderLeftColor: tone.bar,
                          color: tone.ink,
                        }}
                      >
                        <p className="font-semibold truncate">{e.candidate_name}</p>
                        <p className="truncate opacity-80">{TIME.format(at)} · {said}</p>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
