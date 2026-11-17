// node --experimental-strip-types lib/upload-progress.check.ts
import { uploadPercent } from "./upload-progress.ts";

function eq(actual: number, expected: number, what: string) {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

// One file: the stage is the only thing moving the bar.
eq(uploadPercent("parsing", 0, 1), 8, "one file, parsing");
eq(uploadPercent("analyzing", 0, 1), 35, "one file, analyzing");
eq(uploadPercent("storing", 0, 1), 92, "one file, storing");
eq(uploadPercent("done", 1, 1), 100, "one file, stored");

// Many files: finished files carry the bar, the stage fills the gap between.
eq(uploadPercent("parsing", 0, 4), 2, "four files, first one parsing");
eq(uploadPercent("analyzing", 2, 4), 59, "four files, two done");
eq(uploadPercent("done", 4, 4), 100, "four files, all done");

// The stage credit is worth at most one file, so the bar can never claim a file
// that has not been stored.
for (const stage of ["parsing", "checking", "analyzing", "embedding", "storing"]) {
  const value = uploadPercent(stage, 2, 3);
  if (value > 100 / 3 * 3) throw new Error("credit overflowed");
  if (value > Math.round(((2 + 1) / 3) * 100)) {
    throw new Error(`${stage} claimed more than three of three files`);
  }
}

// Only the backend saying "every file is stored" fills the bar. A late stage on
// the last file must still leave something to run.
if (uploadPercent("storing", 0, 1) >= 100) throw new Error("storing must not read 100%");
eq(uploadPercent("embedding", 9, 10), 98, "nine of ten done, last one embedding");

// Degenerate inputs must not produce NaN or a negative width.
eq(uploadPercent("parsing", 0, 0), 0, "no files at all");
eq(uploadPercent("who-knows", 1, 2), 50, "unknown stage still counts finished files");
eq(uploadPercent("parsing", 5, 2), 100, "more done than total");

console.log("upload-progress: all checks passed");
