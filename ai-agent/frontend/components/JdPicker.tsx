"use client";

import { useState, useRef, useEffect, useMemo, useId } from "react";
import { Search, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { jdLabel, jdSubtitle, matchJDs } from "@/lib/jd-search";
import { JDSummary } from "@/lib/api";

/**
 * The JD switcher: pick the job description this page is about.
 *
 * This was a native `<select>` until an account had a hundred-odd open
 * requisitions and the only way to a job was scrolling past the rest. Same
 * control, plus a search box — type any part of the name, job id or location
 * (`matchJDs` in `lib/jd-search.ts`) and the list narrows.
 *
 * Keyboard behaviour matches the `<select>` it replaced, because losing it
 * would be a real regression: ↑/↓ walk the list, Enter picks, Esc closes.
 *
 * The closed control still shows the **job name only** — that rule hasn't
 * changed. The job id and location appear on the rows inside the open list,
 * where they are what tells two identically-named requisitions apart.
 */
export default function JdPicker({
  jds,
  value,
  onChange,
  disabled,
  id,
}: {
  jds: JDSummary[];
  value: string;
  onChange: (uuid: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = jds.find((jd) => jd.jd_uuid === value) ?? null;
  const matches = useMemo(() => matchJDs(jds, query), [jds, query]);

  // A popover that isn't a real <select> has to close itself: a click anywhere
  // else, same as the native one.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the keyboard cursor on screen — at two hundred rows it walks out of
  // the scroll box within a few presses.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, matches]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    // Open on the current job rather than at the top, so ↓ moves from where
    // you already are.
    setQuery("");
    setActive(Math.max(0, jds.findIndex((jd) => jd.jd_uuid === value)));
    setOpen(true);
  }

  function pick(uuid: string) {
    setOpen(false);
    if (uuid !== value) onChange(uuid);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) =>
        Math.min(matches.length - 1, Math.max(0, e.key === "ArrowDown" ? i + 1 : i - 1))
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[active]) pick(matches[active].jd_uuid);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch job description"
        className="flex items-center gap-2 px-4 py-2.5 text-[17px] font-semibold rounded-xl border border-border bg-card text-foreground max-w-[300px] focus:outline-none focus:border-[var(--brand)] disabled:opacity-60 cursor-pointer"
      >
        <span className="truncate">
          {selected ? jdLabel(selected) : "Select a JD…"}
        </span>
        <ChevronDown size={15} className="flex-shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-[340px] max-w-[85vw] rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          <div className="relative border-b border-border">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={matches[active] ? listId + "-" + active : undefined}
              placeholder="Search job, ID or location…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="w-full pl-9 pr-3 h-[42px] text-[15px] bg-transparent text-foreground focus:outline-none"
            />
          </div>

          <ul id={listId} ref={listRef} role="listbox" className="max-h-[320px] overflow-y-auto py-1">
            {matches.map((jd, i) => (
              <li key={jd.jd_uuid} id={listId + "-" + i} role="option" aria-selected={jd.jd_uuid === value}>
                <button
                  type="button"
                  onClick={() => pick(jd.jd_uuid)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "w-full flex items-start gap-2 px-3 py-2 text-left",
                    i === active && "bg-secondary"
                  )}
                >
                  <Check
                    size={14}
                    className={cn(
                      "mt-1 flex-shrink-0",
                      jd.jd_uuid === value ? "text-[var(--brand)]" : "opacity-0"
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold text-foreground truncate">
                      {jdLabel(jd)}
                    </span>
                    {jdSubtitle(jd) && (
                      <span className="block text-[13px] text-muted-foreground truncate numeral">
                        {jdSubtitle(jd)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                No job description matches “{query.trim()}”
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
