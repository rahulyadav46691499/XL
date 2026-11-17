/**
 * Self-check for the JD switcher's search.
 *
 *   node --experimental-strip-types lib/jd-search.check.ts
 *
 * What matters: a recruiter can reach a JD by job id or location and not only
 * by name, two terms narrow instead of widen, and an empty box shows the lot.
 */
import { jdLabel, jdSubtitle, matchJDs } from "./jd-search.ts";
import type { JDSummary } from "./api.ts";

function assert(ok: boolean, msg: string) {
  if (!ok) {
    console.error("FAIL: " + msg);
    process.exit(1);
  }
}

function jd(job_name: string, job_code?: string, primary_location?: string): JDSummary {
  return { jd_uuid: job_code || job_name, source: null, skills: [], job_name, job_code, primary_location };
}

const jds = [
  jd("Senior Data Analyst", "EXL000042", "Pune"),
  jd("Senior Data Analyst", "EXL000043", "Noida"),
  jd("Claims Processor", "EXL000101", "Pune"),
  { jd_uuid: "legacy-1", source: "old_posting.pdf", skills: [] } as JDSummary,
];

const names = (list: JDSummary[]) => list.map((j) => j.jd_uuid).join(",");

assert(names(matchJDs(jds, "")) === names(jds), "an empty query is every JD");
assert(names(matchJDs(jds, "   ")) === names(jds), "whitespace is an empty query");
assert(names(matchJDs(jds, "claims")) === "EXL000101", "matches on name, case-insensitively");
assert(names(matchJDs(jds, "EXL000043")) === "EXL000043", "matches on the job id");
assert(names(matchJDs(jds, "0042")) === "EXL000042", "half a job id is enough");
assert(names(matchJDs(jds, "pune")) === "EXL000042,EXL000101", "matches on location");
assert(names(matchJDs(jds, "analyst pune")) === "EXL000042", "two terms narrow, in any order");
assert(names(matchJDs(jds, "pune analyst")) === "EXL000042", "term order doesn't matter");
assert(names(matchJDs(jds, "old_posting")) === "legacy-1", "a JD with no job name matches on its file");
assert(matchJDs(jds, "chennai").length === 0, "no match is no rows, not every row");

assert(jdLabel(jds[0]) === "Senior Data Analyst", "the label is the job name");
assert(jdLabel(jds[3]) === "old_posting.pdf", "no job name falls back to the file");
assert(jdLabel(jd("")) === "Untitled job description", "neither one still names something");
assert(jdSubtitle(jds[0]) === "EXL000042 · Pune", "id and location, joined");
assert(jdSubtitle(jd("x", undefined, "Pune")) === "Pune", "no job id, no dangling separator");
assert(jdSubtitle(jds[3]) === "", "nothing to say, nothing shown");

console.log("jd-search.check.ts: all assertions passed");
