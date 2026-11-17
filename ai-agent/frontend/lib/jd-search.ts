/**
 * Finding one job description among two hundred.
 *
 * The switcher was a native `<select>`, which is fine at five JDs and unusable
 * at two hundred — the only way to a job is scrolling past the others. This is
 * the filter behind the search box that replaced it.
 *
 * Everything a recruiter knows a requisition by is searchable, not just its
 * name: the job id and the location match too, so "EXL0042", "pune" and
 * "senior analyst pune" all land. Terms are ANDed and matched as substrings —
 * order doesn't matter, and half a word is enough.
 *
 * No runtime imports (`import type` only), so `jd-search.check.ts` runs under
 * plain node. Keep it that way.
 */
import type { JDSummary } from "./api";

/** The one line the switcher shows for a JD — the job name, nothing else. */
export function jdLabel(jd: JDSummary): string {
  return jd.job_name || jd.source || "Untitled job description";
}

/** Job id · location, the second line that tells two same-named jobs apart. */
export function jdSubtitle(jd: JDSummary): string {
  return [jd.job_code, jd.primary_location].filter(Boolean).join(" · ");
}

/** The JDs matching every term in `query`, in the order they were given. */
export function matchJDs(jds: JDSummary[], query: string): JDSummary[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return jds;
  return jds.filter((jd) => {
    const hay = [jd.job_name, jd.source, jd.job_code, jd.primary_location]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
