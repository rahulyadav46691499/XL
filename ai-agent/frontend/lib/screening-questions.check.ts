/**
 * Self-check for parseNumericAnswer and parseYesNo. Not imported by the app.
 *
 *   node --experimental-strip-types lib/screening-questions.check.ts
 */
import assert from "node:assert";
import { parseNumericAnswer, parseYesNo } from "./screening-questions.ts";

const CTC = "Annual CTC, e.g. 1200000";
const DAYS = "Days";

// The reported bug: a whole sentence with the figure buried in it.
assert.equal(parseNumericAnswer("actually its quit low only 4LPA", CTC), "400000");

// Money, spoken every which way.
assert.equal(parseNumericAnswer("4 lakh", CTC), "400000");
assert.equal(parseNumericAnswer("4.5 lpa", CTC), "450000");
assert.equal(parseNumericAnswer("around 12,00,000", CTC), "1200000");
assert.equal(parseNumericAnswer("1200000", CTC), "1200000");
assert.equal(parseNumericAnswer("45k", CTC), "45000");
assert.equal(parseNumericAnswer("1.2 crore", CTC), "12000000");

// A scale word beats a bare number that came earlier in the sentence.
assert.equal(parseNumericAnswer("in Pune for 3 years, CTC is 4 lakh", CTC), "400000");

// Notice period.
assert.equal(parseNumericAnswer("60 days", DAYS), "60");
assert.equal(parseNumericAnswer("two months", DAYS), "");      // words, not digits
assert.equal(parseNumericAnswer("2 months", DAYS), "60");
assert.equal(parseNumericAnswer("I can join immediately", DAYS), "0");
assert.equal(parseNumericAnswer("90", DAYS), "90");
// "years" is not a notice scale, so the bare 5 is skipped for the real answer.
assert.equal(parseNumericAnswer("5 years experience, notice is 60 days", DAYS), "60");

// Nothing numeric — the field stays blank and the modal shows the sentence.
assert.equal(parseNumericAnswer("I'd rather not say", CTC), "");
assert.equal(parseNumericAnswer("", CTC), "");

// An answer to a DIFFERENT question must not fill this field. This parser
// only runs when the call's own extraction (Sarvam's post-call answers_json)
// came back empty, so if it
// guesses where the server declined to, the server-side guard is pointless.
assert.equal(parseNumericAnswer("my current package is 12 LPA", DAYS), "");
assert.equal(parseNumericAnswer("I'm 28 years old", DAYS), "");
assert.equal(parseNumericAnswer("I'm based in Pune 411001", DAYS), "");  // pincode
assert.equal(parseNumericAnswer("I joined back in 2019", DAYS), "");     // a year
assert.equal(parseNumericAnswer("my notice is 60 days", CTC), "");       // days aren't a salary
assert.equal(parseNumericAnswer("twelve", CTC), "");                     // spoken, not digits
assert.equal(parseNumericAnswer("12", CTC), "", "₹12 is not a salary");
// ...but a bare figure that IS plausible for the field still lands.
assert.equal(parseNumericAnswer("1200000", CTC), "1200000");
assert.equal(parseNumericAnswer("60", DAYS), "60");

// parseYesNo. A bare phrase still reads; a sentence is left for HR.
assert.equal(parseYesNo("yes"), "yes");
assert.equal(parseYesNo("Yes!"), "yes");
assert.equal(parseYesNo("nope"), "no");
assert.equal(parseYesNo("Not really."), "no");
assert.equal(parseYesNo("of course"), "yes");
assert.equal(parseYesNo(""), "");

// The four this parser used to get WRONG, by taking whichever keyword came
// first. Every one is now blank, and the modal shows the sentence instead.
assert.equal(parseYesNo("right now is not a good time"), "", "was 'yes'");
assert.equal(parseYesNo("no worries, this works for me"), "", "was 'no'");
assert.equal(parseYesNo("I have no problem with that"), "", "was 'no'");
assert.equal(parseYesNo("absolutely not"), "", "was 'yes'");

// Still blank, as before — a hedge is not a side.
assert.equal(parseYesNo("I don't have a buyout option"), "");
assert.equal(parseYesNo("it depends on the offer"), "");
assert.equal(parseYesNo("maybe"), "", "a yes/no field has no third answer");

console.log("parseNumericAnswer + parseYesNo: all checks passed");
