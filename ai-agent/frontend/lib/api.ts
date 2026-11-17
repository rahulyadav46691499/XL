import { applyPoolDecisions } from "./pool-decision";
import type { RoleCriteria } from "./role-criteria";
import type { ScreeningAnswers } from "./screening-questions";
import { RISK_INDEX_BASE } from "./screening-questions";
import { answersByKey } from "./screening-flow";
import { uploadPercent } from "./upload-progress";

// The pool-relative decision lives in its own module so its self-check can run
// without a bundler; re-exported here so callers keep one import site.
export { applyPoolDecisions, combinedScore } from "./pool-decision";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (typeof window !== "undefined"
    ? (() => {
        const hostname = window.location.hostname;
        const backendHost = hostname.replace(/^\d+-/, "8000-");
        if (backendHost !== hostname) {
          // Cloudspace: port is encoded in subdomain (e.g. 8000-xxxxx.cloudspaces.litng.ai)
          return `https://${backendHost}`;
        }
        // Standard hostname: append port
        return `http://${hostname}:8000`;
      })()
    : "http://localhost:8000");

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// HR screening answers recorded against a resume, persisted in the backend.
export type HrScreening = {
  responses: Record<number, string>;
  selected_questions: number[];
  comment: string;
  decision?: "Rejected" | "On Hold" | "Interview" | "";
  /**
   * What the candidate actually said, for the questions whose field cannot hold
   * it: a number input shows `400000` and a radio pair shows Yes, so without
   * this the sentence they were parsed from ("only 4LPA, it's negotiable") was
   * visible until the modal closed and then gone for good.
   */
  heard?: Record<number, string>;
  /** How many flow questions existed when this was saved — see `addedSince`.
   *  Absent on every screening saved before it was recorded. */
  flow_size?: number;
};

/**
 * How likely a screened candidate is to actually join, worked out from their
 * screening answers against the requisition — `backend/joining_evaluator.py`.
 *
 * **Not a model output.** It is a fixed set of rules over answers already on
 * the record, so the same answers always give the same verdict and every
 * verdict comes with the criteria behind it. Nothing here touches the
 * candidate's decision: it is evidence for the Override dropdown, the same way
 * a screening `gate` is.
 *
 * `undefined` for anyone whose screening has not answered a single question a
 * criterion measures — the backend withholds a verdict rather than reporting
 * "no red flags" about a conversation that never happened.
 */
export type JoiningCategory = "HIGH" | "MEDIUM" | "LOW" | "WITHDRAWN";

export type JoiningFlag = {
  /** The criterion that was not met — "location", "ctc", "notice", … */
  criterion: string;
  /** `hard` forces LOW on its own; `soft` counts towards the tier. */
  severity: "hard" | "soft";
  reason: string;
  /** What the candidate said, when the answer was a sentence worth quoting. */
  evidence?: string | null;
};

export type JoiningAssessment = {
  candidate_id: string;
  candidate_name?: string | null;
  join_category: JoiningCategory;
  red_flags: JoiningFlag[];
  matched_criteria: { criterion: string; reason: string }[];
  summary: string;
};

/**
 * What one candidate's AI phone screening cost in dials.
 *
 * A reschedule redials the **same** session, so every field here counts across
 * that candidate's whole attempt history, not just the last dial — three rings
 * and a twelve-minute conversation is `placed: 4`, `not_picked: 3`.
 *
 * Archived onto the resume when HR saves the screening
 * (`backend/interview_scoring.py`), so they stay with the candidate whatever
 * happens to the voice service's session files. `undefined` for a candidate
 * never called, and for a call whose screening nobody has saved yet — which is
 * why the collective analysis counts its own denominator rather than assuming
 * every called candidate has one.
 */
export type CallStats = {
  /** Connected time summed across every dial, in seconds. */
  seconds: number;
  /** Dials placed — the first call plus every reschedule redial. */
  placed: number;
  /** Callbacks the candidate arranged. */
  rescheduled: number;
  /** Dials that rang out, hit a busy line, or reached voicemail. */
  not_picked: number;
  /** Times the candidate rang the agent's number back. Absent on stats archived before it. */
  callbacks?: number;
  /** Rupees (= Sarvam credits) every call of the session cost, at the plan's
   *  published rate. Absent on stats archived before it. */
  cost?: number;
};

/** What the AI calls have cost the Sarvam account (`GET /interviews/usage`). */
export type CallUsage = {
  /** Rupees spent to date: Sarvam's own bill at `billed_at` plus calls since, or,
   *  with no bill copied in, the agent's connected calls at the published rate. */
  spent: number;
  connected_calls: number;
  /** When the bill in SARVAM_SPENT was read; "" when `spent` is all estimate. */
  billed_at: string;
  /** null until SARVAM_CREDIT_BALANCE is set in backend/.env — Sarvam has no balance API. */
  credits_left: number | null;
};

/** One entry on the dashboard calendar (`GET /interviews/schedule`). */
export type CallEvent = {
  session_id: string;
  candidate_name: string;
  jd_role: string;
  /** IST ISO time: when the dial went out, the callback rang, or the redial is due. */
  at: string;
  seconds: number;
  /** A Sarvam attempt status, or "in_progress" / "scheduled". */
  status: string;
  kind: "call" | "callback" | "rescheduled" | "retry";
};

export type CandidateEvaluation = {
  candidate_name: string;
  candidate_id: string;
  overall_match_score: number;
  shortlist_decision: "Rejected" | "On Hold" | "Interview";
  ai_decision?: "Rejected" | "On Hold" | "Interview";
  hr_screening?: HrScreening;
  years_experience?: number; // undefined for resumes analyzed before this was extracted
  matched_mandatory_skills: string[];
  missing_mandatory_skills: string[];
  red_flags_detected: string[];
  green_flags: string[];
  /**
   * Questions generated from THIS resume about education/employment gaps, job
   * hopping or another serious negative. Unlike the fixed standard questions
   * they differ per candidate, so they are ticked in the modal under indices
   * offset by RISK_INDEX_BASE — see lib/screening-questions.ts.
   */
  risk_questions?: string[];
  /**
   * Whether the resume says they are working somewhere right now — "yes",
   * "no", "unknown" when it did not say, or "" on every resume analyzed before
   * the field existed. The HR screening flow skips the notice-period, buyout and
   * current-CTC questions on "no"; anything but "yes"/"no" asks everything.
   */
  currently_employed?: "yes" | "no" | "unknown" | "";
  // screening_questions was here: the LLM was asked to reproduce the eight fixed
  // standard questions per resume. They live in lib/screening-questions.ts now.
  Transferable_skills: string[];
  reasoning: string;
  contact_email?: string;
  contact_phone?: string;
  resume_file_name?: string;
  resume_url?: string;
  /** The AI phone screening call, playable in the dashboard row. */
  interview_recording_url?: string;
  /** The same call's Q&A transcript, downloadable beside the play button. */
  interview_transcript_url?: string;
  /** How the candidate came across on the call — graded after it ends. */
  interview_scores?: InterviewScores;
  /** Rule-based joining likelihood from the screening answers. Advisory only. */
  joining_assessment?: JoiningAssessment;
  /** The voice-service session for this candidate's call, if one was placed. */
  interview_session_id?: string;
  /** What the call cost in dials — see `CallStats`. Set once HR has saved. */
  interview_call_stats?: CallStats;
  /**
   * What the candidate is on now, and what they are asking for — **rupees a
   * year**, lifted out of their saved screening answers by `ctcFrom()`.
   *
   * Derived here rather than read in a component for the usual reason: the raw
   * answer is a string in a map keyed by position, and every reader would
   * otherwise repeat the same parse and the same index arithmetic. The
   * requisition's budget is in *lakhs*, so anything comparing the two goes
   * through `budgetRupees()` — see `role-criteria.ts`.
   *
   * `undefined` when they were not screened, not asked, or said something that
   * is not a number.
   */
  current_ctc?: number;
  expected_ctc?: number;
  /**
   * When they can sit the next round ("Mon to Wed, 2 pm to 5 pm"), from their
   * saved screening. Asked of everyone; the dashboard shows it only on a row
   * that reads Selected for R1. `undefined` when not saved yet.
   */
  r1_availability?: string;
  /** Resume and communication scores averaged — only once the call is graded. */
  combined_score?: number;
  /** The average that `combined_score` was judged against, for the hover card. */
  pool_average?: number;
  category_scores?: Record<string, number>;
  scoring_weights?: Record<string, number>;
  projects?: string[];
  education?: string[];
  achievements?: string[];
};

export type JDRubric = {
  role_domain: string;
  hard_knockouts: string[];
  soft_knockouts: string[];
  required_skills: string[];
  preferred_skills: string[];
  soft_skills: string[];
  domains: string[];
};

export type ChatResponse = {
  session_id: string;
  response: string;
  sources: string[];
  timestamp: string;
};

// ─── JD upload ───────────────────────────────────────────────────────────────
type UploadedJD = { jd_uuid: string; skills: string[] };
let lastJD: UploadedJD | null = null;

// ─── Upload progress ─────────────────────────────────────────────────────────
/**
 * What the backend is doing right now, for the progress bar's label.
 *
 * An upload is one blocking POST, so the only way to see inside it is to ask:
 * the browser mints an `upload_id`, sends it with the files, and polls
 * `GET /upload/{id}/progress` (backend/progress.py) until the POST returns.
 * `stage` is one of the backend's `STAGES`; the words HR reads live in
 * `stageLabel()` below, not in Python.
 */
export type UploadProgress = {
  stage: string;
  done: number;
  total: number;
  /** 0-99 while work remains, 100 only when every file is stored. Monotonic —
   *  see the clamp in `watchProgress`. */
  percent: number;
};

/** The current step, as a line to put under a progress bar. */
export function stageLabel(p: UploadProgress | null, fallback: string): string {
  if (!p || !p.stage) return fallback;
  // Plain stage names — the "AI is …" wording was removed on request.
  const words: Record<string, string> = {
    parsing: "Reading the document",
    checking: "Checking the document type",
    analyzing: "Extracting details",
    embedding: "Computing score",
    storing: "Saving to database",
    done: "Finishing up",
  };
  const step = words[p.stage] || p.stage;
  return p.total > 1 ? `${step} · ${p.done} of ${p.total} done` : step;
}

/**
 * Poll an upload's progress until `stop()` is called.
 *
 * Failures are swallowed on purpose: this watches a request that is going
 * fine, so a missed poll must never surface as an error next to it.
 */
function watchProgress(uploadId: string, onProgress: (p: UploadProgress) => void): () => void {
  // Files are processed in parallel and the reported stage is whichever one
  // moved last, so a raw reading can go from `storing` back to `parsing` when a
  // second file starts. The percentage is the running maximum: a bar that slides
  // backwards reads as a bug, whatever the number underneath it is doing.
  let highest = 0;
  const timer = setInterval(async () => {
    try {
      const res = await fetch(API_BASE + "/upload/" + uploadId + "/progress");
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.stage) return;
      highest = Math.max(highest, uploadPercent(data.stage, data.done, data.total));
      onProgress({ ...data, percent: highest } as UploadProgress);
    } catch {
      /* the upload itself reports its own failure */
    }
    // 400ms, not a second: `checking` is over in about a second on a small
    // file, and a stage nobody sees may as well not be reported.
  }, 400);
  return () => clearInterval(timer);
}

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return typeof data.detail === "string" ? data.detail : JSON.stringify(data);
  } catch {
    return res.statusText;
  }
}

/**
 * Upload a job description under its job id.
 *
 * The job id (EXL + 6 digits) is the JD's identity — it is what the returned
 * `jd_uuid` contains, and what resumes are screened against. The backend
 * refuses a job id that already exists with a 409 whose message is written for
 * HR to read, so callers can surface `err.message` verbatim.
 *
 * Nothing is stored until this call: the job id and location travel with the
 * file, so a JD never lands in the database unlabelled.
 */
export async function uploadJD(
  file: File,
  jobId: string,
  primaryLocation: string,
  jobName: string,
  roleCriteria: RoleCriteria,
  onProgress?: (p: UploadProgress) => void
): Promise<{ jd_uuid: string; skills: string[]; text: string }> {
  lastJD = null; // never keep a previous JD's id if this upload fails

  const uploadId = crypto.randomUUID();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("job_id", jobId);
  formData.append("primary_location", primaryLocation);
  formData.append("job_name", jobName);
  // The typed constraints the HR screening flow branches on (experience,
  // budget, workplace mode, notice period, buyout). The backend rejects the
  // upload if the set is partial, so the form gates on it too.
  formData.append("role_criteria", JSON.stringify(roleCriteria));
  formData.append("upload_id", uploadId);

  const stopWatching = onProgress ? watchProgress(uploadId, onProgress) : () => {};
  let res: Response;
  try {
    res = await fetch(API_BASE + "/jd/upload", {
      method: "POST",
      body: formData,
    });
  } finally {
    stopWatching();
  }

  if (!res.ok) {
    // 400 (bad job id / missing location), 409 (job id taken) and 422 (this
    // file is not a job description) already read as sentences written for HR;
    // only unexpected failures need the status code.
    const detail = await readError(res);
    throw new Error(
      res.status === 400 || res.status === 409 || res.status === 422
        ? detail
        : "JD upload failed (" + res.status + "): " + detail
    );
  }

  const data = await res.json();
  lastJD = { jd_uuid: data.jd_uuid, skills: data.skills || [] };
  console.log("[API] JD uploaded as", lastJD.jd_uuid, "with", lastJD.skills.length, "skills");
  return { jd_uuid: data.jd_uuid, skills: lastJD.skills, text: data.text || "" };
}

// Fetch a stored JD straight from the database — no file upload, no parsing.
export async function loadJD(
  jdUuid: string
): Promise<{ jd_uuid: string; skills: string[]; text: string } | null> {
  const res = await fetch(API_BASE + "/jd/" + jdUuid);
  if (!res.ok) return null;
  const data = await res.json();
  lastJD = { jd_uuid: data.jd_uuid, skills: data.skills || [] };
  console.log("[API] loaded JD from db:", jdUuid);
  return { jd_uuid: data.jd_uuid, skills: lastJD.skills, text: data.text || "" };
}

/**
 * Build a skills rubric for the word cloud from the backend-extracted JD
 * skills (populated by the preceding uploadJD / loadJD call).
 * The backend returns a flat skill list, so only required_skills is filled.
 * Returns null when no JD has been uploaded yet so the caller falls back to
 * local text parsing.
 */
export async function extractJDSkills(): Promise<JDRubric | null> {
  if (!lastJD || lastJD.skills.length === 0) return null;
  return {
    role_domain: "",
    hard_knockouts: [],
    soft_knockouts: [],
    required_skills: lastJD.skills,
    preferred_skills: [],
    soft_skills: [],
    domains: [],
  };
}

/**
 * Every candidate starts as Interview and stays there until HR says otherwise.
 *
 * The decision used to be derived from the embedding-similarity score
 * (>=75 Interview, >=60 On Hold, else Rejected). That auto-rejected people on a
 * heuristic number, and — because the screening modal only opened for
 * Interview — it also locked HR out of the form for anyone it had decided
 * against. The score is still shown and still colours the Match column; it just
 * no longer decides anything on HR's behalf.
 */
const DEFAULT_DECISION = "Interview" as const;

/**
 * "Interview" is the value stored everywhere (backend metadata, filters,
 * Excel); HR reads it as the round the candidate has been moved to. One place
 * so the dropdown, the row pill and the hover card can't drift apart.
 */
export function decisionLabel(decision: string): string {
  return decision === "Interview" ? "Selected for R1" : decision;
}

type BackendResume = {
  resume_uuid: string;
  jd_uuid: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  skills: string[];
  years_experience?: number | null;
  summary?: string;
  green_flags?: string[];
  red_flags?: string[];
  risk_questions?: string[];
  /** "yes" / "no" / "unknown" — "" on every resume analyzed before this existed. */
  currently_employed?: "yes" | "no" | "unknown" | "";
  /** Only on resumes analyzed while the LLM still generated them — see migrateScreening(). */
  screening_questions?: string[];
  similarity_score: number;
  source: string | null;
  has_file?: boolean;
  /** Set once an AI phone screening has been placed against this resume. */
  interview_session_id?: string | null;
  interview_scores?: InterviewScores | null;
  /** Archived when HR saved the screening — null for a call nobody has saved. */
  interview_call_stats?: CallStats | null;
  hr_screening?: HrScreening | null;
  /** Recomputed by the backend on every read — never stored, never stale. */
  joining_assessment?: JoiningAssessment | null;
};

/**
 * The voice service's read on how the candidate handled the call, graded by
 * the Sarvam agent's post-call extraction once the call ends.
 *
 * `status` is the part to branch on, not the numbers: it is "skipped" for a
 * candidate who asked to be called back rather than sitting the interview, and
 * those carry no scores at all. Treating a missing score as 0 would rank a
 * candidate who was simply busy below one who interviewed badly.
 */
export type InterviewScores = {
  status: "pending" | "done" | "skipped" | "error";
  communication_score?: number;
  summary?: string;
  reason?: string;
};

/**
 * Re-key screening responses saved back when the modal rendered the LLM's
 * duplicate copy of the standard questions *above* the standard block.
 *
 * Responses are keyed by the question's position in the modal, so removing the
 * duplicate block moves every surviving question up by `shift`. The duplicates'
 * own answers are dropped — they were answers to the same eight questions.
 *
 * Per-candidate risk questions (index >= RISK_INDEX_BASE) are left alone: they
 * sit in a reserved range precisely so no re-keying of the standard block can
 * reach them.
 */
function migrateScreening(screening: HrScreening, shift: number): HrScreening {
  if (shift <= 0) return screening;

  const responses: Record<number, string> = {};
  for (const [key, value] of Object.entries(screening.responses || {})) {
    const original = Number(key);
    if (original >= RISK_INDEX_BASE) {
      responses[original] = value;
      continue;
    }
    const index = original - shift;
    if (index >= 0) responses[index] = value;
  }

  return {
    ...screening,
    responses,
    selected_questions: (screening.selected_questions || [])
      .map((index) => (index >= RISK_INDEX_BASE ? index : index - shift))
      .filter((index) => index >= 0),
  };
}

/**
 * One CTC answer out of a saved screening, in rupees a year.
 *
 * `answersByKey` rather than a hardcoded index: responses are keyed by
 * `FLOW_INDEX_BASE + position` and the flow is **append-only**, so an index
 * written here would silently re-point the day a question is added.
 *
 * A stored `0` is dropped along with the blanks and the unparseable, because
 * nobody's package is nothing — it is a field that was reached and left empty,
 * and averaging it in would pull the cohort's figure toward zero.
 */
function ctcFrom(
  screening: HrScreening | undefined,
  key: "current_ctc" | "expected_ctc"
): number | undefined {
  if (!screening?.responses) return undefined;
  const value = Number(answersByKey(screening.responses)[key]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function toEvaluation(r: BackendResume, jdSkills: string[]): CandidateEvaluation {
  const resumeSkillsLower = new Set(r.skills.map((s) => s.toLowerCase()));
  const jdSkillsLower = new Set(jdSkills.map((s) => s.toLowerCase()));

  const matched = jdSkills.filter((s) => resumeSkillsLower.has(s.toLowerCase()));
  const missing = jdSkills.filter((s) => !resumeSkillsLower.has(s.toLowerCase()));
  const transferable = r.skills.filter((s) => !jdSkillsLower.has(s.toLowerCase()));

  const score = Math.round(r.similarity_score);
  const decision = DEFAULT_DECISION;
  const name = r.name || r.source || "Unknown";
  const screening = r.hr_screening
    ? migrateScreening(r.hr_screening, r.screening_questions?.length ?? 0)
    : undefined;
  // A saved HR override outranks the score-based decision.
  const hrDecision = r.hr_screening?.decision;
  const finalDecision = hrDecision === "Rejected" || hrDecision === "On Hold" || hrDecision === "Interview"
    ? hrDecision
    : decision;

  return {
    candidate_name: name,
    candidate_id: r.resume_uuid,
    overall_match_score: score,
    shortlist_decision: finalDecision,
    ai_decision: decision,
    hr_screening: screening,
    matched_mandatory_skills: matched,
    missing_mandatory_skills: missing,
    red_flags_detected: r.red_flags || [],
    risk_questions: r.risk_questions || [],
    currently_employed: r.currently_employed || "",
    green_flags: r.green_flags || [],
    Transferable_skills: transferable,
    reasoning:
      r.summary ||
      name + " matches " + matched.length + " of " + jdSkills.length +
      " JD skills with a " + score + "% similarity score. Suggested outcome: " + decision + ".",
    contact_email: r.email || undefined,
    contact_phone: r.phone || undefined,
    resume_file_name: r.source || undefined,
    // Only resumes whose original file was kept can be downloaded; the UI
    // hides the button when this is undefined.
    resume_url: r.has_file ? API_BASE + "/resume/" + r.resume_uuid + "/download" : undefined,
    // Same rule as resume_url: only offered when there is something to play, so
    // the dashboard's play button never points at a 404. The recording itself
    // lands a minute or two after the call ends (Sarvam processing), and the
    // endpoint says so until then.
    interview_recording_url: r.interview_session_id ? interviewUrls(r.resume_uuid).recording : undefined,
    interview_transcript_url: r.interview_session_id ? interviewUrls(r.resume_uuid).transcript : undefined,
    interview_scores: r.interview_scores ?? undefined,
    interview_call_stats: r.interview_call_stats ?? undefined,
    current_ctc: ctcFrom(screening, "current_ctc"),
    expected_ctc: ctcFrom(screening, "expected_ctc"),
    r1_availability: String(answersByKey(screening?.responses ?? {}).r1_availability).trim() || undefined,
    joining_assessment: r.joining_assessment ?? undefined,
    interview_session_id: r.interview_session_id || undefined,
    years_experience: r.years_experience ?? undefined,
  };
}

/**
 * Where a candidate's AI interview recording and transcript live.
 *
 * `toEvaluation()` only fills those fields for a resume that has been called,
 * so the UI never links to a 404. The HR modal needs the same two urls for a
 * call placed *inside* it — that candidate's evaluation was fetched before the
 * call existed — which is why this is a function rather than two strings.
 */
export function interviewUrls(resumeUuid: string): { recording: string; transcript: string } {
  return {
    recording: API_BASE + "/resume/" + resumeUuid + "/interview/recording",
    transcript: API_BASE + "/resume/" + resumeUuid + "/interview/transcript",
  };
}

/** One Bulbul v4 voice the AI interviewer can speak in. */
export type Voice = {
  id: string;
  /** The persona's first name, which the agent also introduces itself by. */
  name: string;
  gender: "male" | "female";
  /** One-line character note, shown beside the name in the picker. */
  tone: string;
};

/**
 * The voices HR can choose between, from `VOICES` in `backend/voice/calls.py`
 * rather than a copy kept here. Each is a committed version of the Sarvam agent
 * in that voice, so the one picked is the one the candidate hears.
 */
export async function listVoices(): Promise<{ voices: Voice[]; default: string }> {
  const res = await fetch(API_BASE + "/interview/voices");
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return res.json();
}

/** A few seconds of one voice reading the call's greeting. */
export function voicePreviewUrl(speaker: string): string {
  return API_BASE + "/interview/voices/" + encodeURIComponent(speaker) + "/preview";
}

const VOICE_KEY = "talentai.interviewVoice";

/**
 * The voice the next call goes out in — remembered in the browser rather than
 * per candidate, because it is a preference of whoever is recruiting, not a
 * fact about the person being called. "" means the service's default.
 *
 * Both call paths default to it (the modal's button and the dashboard's bulk
 * call), so the picker only has to be somewhere HR can reach, not on every
 * screen that dials.
 */
export function selectedVoice(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(VOICE_KEY) || "";
}

export function setSelectedVoice(speaker: string): void {
  if (typeof window === "undefined") return;
  if (speaker) {
    window.localStorage.setItem(VOICE_KEY, speaker);
  } else {
    window.localStorage.removeItem(VOICE_KEY);
  }
}

/** A file the backend could not turn into a candidate, and why. */
export type ResumeFailure = { source: string; error: string };

export type ResumeUploadResult = {
  /** Every evaluation for this JD, previously analyzed ones included. */
  evaluations: CandidateEvaluation[];
  /** Files in *this* batch that failed. Empty on a clean run. */
  failures: ResumeFailure[];
};

/**
 * Send resumes to an already-stored JD.
 *
 * The backend processes each file independently and reports per-file errors, so
 * a batch is routinely part-successful — an unreadable PDF, a duplicate, an LLM
 * timeout. Those failures used to be read only when *every* file failed, so
 * uploading five and getting three back looked like a clean run. Callers get
 * them now and must show them.
 */
export async function uploadResumesForJD(
  jdUuid: string,
  resumeFiles: File[],
  jdSkills?: string[],
  onProgress?: (p: UploadProgress) => void
): Promise<ResumeUploadResult> {
  console.log("[API] uploading", resumeFiles.length, "resume(s) for jd:", jdUuid);

  const uploadId = crypto.randomUUID();
  const formData = new FormData();
  resumeFiles.forEach((file) => {
    formData.append("files", file);
  });
  formData.append("jd_uuid", jdUuid);
  formData.append("upload_id", uploadId);

  const stopWatching = onProgress ? watchProgress(uploadId, onProgress) : () => {};
  let uploadRes: Response;
  try {
    uploadRes = await fetch(API_BASE + "/resume/upload", {
      method: "POST",
      body: formData,
    });
  } finally {
    stopWatching();
  }

  if (!uploadRes.ok) {
    const detail = await readError(uploadRes);
    throw new Error(
      uploadRes.status === 400
        ? detail
        : "Resume upload failed (" + uploadRes.status + "): " + detail
    );
  }

  const upload = await uploadRes.json().catch(() => null);
  const failures: ResumeFailure[] = (upload?.results || [])
    .filter((r: ResumeFailure) => r.error)
    .map((r: ResumeFailure) => ({ source: r.source || "A file", error: r.error }));

  const skills = jdSkills ?? (await loadJD(jdUuid))?.skills ?? [];

  // Fetch all stored resumes for this JD (includes previously uploaded ones,
  // and duplicates within this batch resolve to their stored copy).
  const listRes = await fetch(API_BASE + "/jd/" + jdUuid + "/resumes");
  if (!listRes.ok) {
    throw new Error("Fetching evaluations failed (" + listRes.status + "): " + (await readError(listRes)));
  }

  const data = await listRes.json();
  const resumes: BackendResume[] = data.resumes || [];
  console.log("[API] backend returned", resumes.length, "evaluated resume(s):", resumes);

  if (resumes.length === 0) {
    throw new Error(failures[0]?.error || "No resumes could be processed.");
  }

  localStorage.setItem("exl_last_jd_uuid", jdUuid);
  return { evaluations: applyPoolDecisions(resumes.map((r) => toEvaluation(r, skills))), failures };
}

/**
 * One line naming the files that failed and why, for the UI to show as-is.
 *
 * "not analyzed" rather than "could not be read": a file rejected for being a
 * payslip rather than a resume was read perfectly well — the point is that
 * nothing was scored or stored from it.
 */
export function describeFailures(failures: ResumeFailure[], attempted: number): string {
  if (failures.length === 0) return "";
  const detail = failures.map((f) => `${f.source} — ${f.error}`).join("; ");
  const verb = failures.length === 1 ? "was" : "were";
  return `${failures.length} of ${attempted} file${attempted === 1 ? "" : "s"} ${verb} not analyzed: ${detail}`;
}

export type JDSummary = {
  /** The job id (EXL + 6 digits) for JDs uploaded since job ids existed. */
  jd_uuid: string;
  source: string | null;
  skills: string[];
  job_name?: string;
  job_code?: string;
  primary_location?: string;
  /**
   * The requisition's answers to the eight free-text screening questions that
   * used to be collected at upload. **Read-only now** — nothing writes them, and
   * the only reader left is the HR modal's "Earlier screening" block, which uses
   * them to label answers recorded while the questions were still asked.
   */
  screening_answers?: ScreeningAnswers;
  /**
   * The typed constraints the HR screening flow branches on. Empty for JDs
   * uploaded before they were collected, which simply means that JD's
   * candidates get every question asked, ungated.
   */
  role_criteria?: RoleCriteria;
  /** Whether the backend still has the uploaded file — see `jdFileUrl()`. */
  has_file?: boolean;
  /** How many resumes are screened against this JD. */
  resume_count: number;
};

/**
 * Where to open a JD's original file, or `undefined` when the backend never kept
 * it (JDs uploaded before it did). Served with `Content-Disposition: inline`, so
 * a PDF opens in the tab; a docx still downloads. Only link when this is set —
 * otherwise the tab lands on a 404.
 */
export function jdFileUrl(jd: Pick<JDSummary, "jd_uuid" | "has_file">): string | undefined {
  return jd.has_file ? API_BASE + "/jd/" + jd.jd_uuid + "/download" : undefined;
}

export async function listJDs(): Promise<JDSummary[]> {
  // no-store: resume_count changes on every upload, so never serve a cached copy.
  const res = await fetch(API_BASE + "/jds", { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return data.jds || [];
}

/**
 * Delete a JD and every resume screened against it.
 *
 * Before this existed the UI only forgot the JD locally, so it stayed in the
 * database and came back in the dashboard's picker. Callers must treat this as
 * destructive and confirm first.
 */
export async function deleteJD(jdUuid: string): Promise<{ deleted_resumes: number }> {
  const res = await fetch(API_BASE + "/jd/" + jdUuid, { method: "DELETE" });
  if (!res.ok) {
    throw new Error("Deleting the job description failed (" + res.status + "): " + (await readError(res)));
  }
  const data = await res.json();
  console.log("[API] deleted JD:", jdUuid, "with", data.deleted_resumes, "resume(s)");
  return data;
}

export async function loadSession(jdUuid: string): Promise<{
  evaluations: CandidateEvaluation[];
  jdText: string;
  rubric: JDRubric | null;
} | null> {
  const [jdRes, listRes] = await Promise.all([
    fetch(API_BASE + "/jd/" + jdUuid),
    fetch(API_BASE + "/jd/" + jdUuid + "/resumes"),
  ]);
  if (!jdRes.ok || !listRes.ok) return null;

  const jd = await jdRes.json();
  const data = await listRes.json();
  const resumes: BackendResume[] = data.resumes || [];
  if (resumes.length === 0) return null;

  const skills: string[] = jd.skills || [];
  lastJD = { jd_uuid: jdUuid, skills };
  console.log("[API] restored session for jd:", jdUuid, "with", resumes.length, "resume(s)");

  return {
    evaluations: applyPoolDecisions(resumes.map((r) => toEvaluation(r, skills))),
    jdText: jd.text || "",
    rubric: await extractJDSkills(),
  };
}

/**
 * Re-fetch an analyzed session from the backend so the dashboard survives
 * page reloads: the last analyzed JD first, then any JD in the database
 * that has resumes. Returns null when there is nothing to restore.
 */
export async function restoreLastSession(): Promise<{
  evaluations: CandidateEvaluation[];
  jdText: string;
  rubric: JDRubric | null;
} | null> {
  const stored = localStorage.getItem("exl_last_jd_uuid");

  // The stored id can be stale — that JD may have been deleted, or moved to a
  // new job id. It used to be the *only* thing tried, so one deleted JD left
  // the dashboard empty even with other screenings sitting in the database.
  // Fall back to the JDs that actually have resumes, skipping the ones /jds
  // already says are empty rather than probing each with two round trips.
  const withResumes = (await listJDs())
    .filter((jd) => jd.resume_count > 0)
    .map((jd) => jd.jd_uuid);
  const uuids = stored ? [stored, ...withResumes.filter((id) => id !== stored)] : withResumes;

  for (const jdUuid of uuids) {
    const session = await loadSession(jdUuid);
    if (session) {
      localStorage.setItem("exl_last_jd_uuid", jdUuid);
      return session;
    }
  }
  return null;
}

/**
 * Edit a stored JD's title, location, or job id.
 *
 * Passing a different `jobId` **moves** the JD: it is the document's key, so the
 * backend re-keys it and repoints every resume screened against it. That is why
 * this returns the JD's id — it may not be the one you passed in, and callers
 * must use the returned value from then on.
 */
export async function saveJDInfo(
  jdUuid: string,
  primaryLocation: string,
  jobName: string,
  jobId?: string,
  roleCriteria?: RoleCriteria
): Promise<string> {
  const res = await fetch(API_BASE + "/jd/" + jdUuid + "/info", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      primary_location: primaryLocation,
      job_name: jobName,
      ...(jobId ? { job_id: jobId } : {}),
      // Omitted rather than sent empty: the backend replaces the whole set when
      // this is present, and only accepts a complete one.
      ...(roleCriteria ? { role_criteria: roleCriteria } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await readError(res);
    throw new Error(
      res.status === 400 || res.status === 409
        ? detail
        : "Saving JD info failed (" + res.status + "): " + detail
    );
  }
  const data = await res.json();
  const id: string = data.jd_uuid || jdUuid;

  // The JD moved, so anything pointing at the old id is now a 404.
  if (id !== jdUuid && localStorage.getItem("exl_last_jd_uuid") === jdUuid) {
    localStorage.setItem("exl_last_jd_uuid", id);
  }
  console.log("[API] saved JD info:", jdUuid, id !== jdUuid ? "-> " + id : "");
  return id;
}

// Persist HR screening responses/comment/decision for a resume.
export async function saveScreening(
  resumeUuid: string,
  screening: HrScreening
): Promise<void> {
  const res = await fetch(API_BASE + "/resume/" + resumeUuid + "/screening", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(screening),
  });
  if (!res.ok) {
    throw new Error("Saving screening failed (" + res.status + "): " + (await readError(res)));
  }
  console.log("[API] saved screening for:", resumeUuid);
}

// ─── AI phone screening ──────────────────────────────────────────────────────
// The backend places the call (via the Sarvam Voice Agents service) and owns the
// question text; the modal only says which questions are ticked and then polls
// for the transcripts, which land in the same `responses` map HR types into.

export type PhoneInterview = {
  session_id: string;
  phone: string;
  /** Call order → screening-question index. Pass it back when polling. */
  question_indices: number[];
  /** Where this call sits in the dial queue; 0 once it is ringing or done. */
  queue_position?: number;
};

export type PhoneInterviewStatus = {
  call_status: string;
  /** Keyed by screening-question index, ready for the screening form. */
  answers: Record<number, {
    transcript: string;
    status: string;
    /**
     * What the call itself understood and **branched on** — "yes", "400000",
     * a cleaned place name. Prefer it over re-reading the transcript here: the
     * browser's own parse can land somewhere else, and then HR is shown a
     * value the conversation was not actually routed by. "" when the call
     * understood nothing, which is when our parse is the sensible fallback.
     */
    value?: string;
    /**
     * True when this question was never actually put: the candidate volunteered
     * the answer while answering a different one and the call filed it here
     * (`record_volunteered` in the voice service). It still fills the field —
     * that is the point — but the sentence under it says where it came from,
     * because a figure nobody asked for is one HR should read before saving.
     */
    volunteered?: boolean;
  }>;
  /** Graded once the call ends; "pending" for the whole call before that. */
  scores: InterviewScores;
  /** Position in the dial queue — calls are placed strictly one at a time. */
  queue_position?: number;
  /**
   * Why a dial failed: Sarvam refused it, or the call failed on the line. A
   * failure on a redial has nowhere else to show up.
   */
  call_error?: string;
  /** Set when the *call* ended early on a rule (won't relocate, won't resign). */
  gate_reason?: string;
  /**
   * ISO time of an armed callback. The redial runs on **this same session** and
   * fills these same answers, so while this is set the screening is still
   * running even though `call_status` says the call completed.
   */
  callback_at?: string;
  /**
   * The voice service's folded verdict on this screening — see CallStatus.
   * Prefer it over `call_status` for anything shown to HR.
   */
  status?: CallStatus;
  /**
   * An automatic retry the service armed itself after a missed or dropped
   * call. Like `callback_at`, the redial runs on **this same session** and
   * fills these same answers — so while this is set the screening is still
   * running. Separate from `callback_at` because HR reads them differently:
   * one is a time the candidate chose, this one is us trying again.
   */
  retry_at?: string;
  /** Dials made on this session, the first call and every redial. */
  call_attempts?: number;
};

/** One candidate's slot in a bulk call request. */
export type BulkInterviewResult = {
  resume_uuid: string;
  session_id?: string;
  phone?: string;
  question_indices?: number[];
  queue_position?: number;
  /** Set instead of a session when this candidate could not be queued. */
  error?: string;
};

/** A call leg that has ended — stop polling on these. backend/voice maps Sarvam's
 *  statuses onto these words; its check.py reads this list. */
export const CALL_ENDED = ["completed", "failed", "busy", "no-answer", "canceled"];

// The call-status vocabulary lives in its own import-free module so its
// self-check can run standalone; re-exported here because this is where
// every caller already looks for it.
export {
  CALL_STATUS_LABELS,
  callStatusLabel,
  callStatusHint,
  formatCallTime,
} from "./call-status";
export type { CallStatus } from "./call-status";
// Re-exporting a type does not bring it into scope here; the shapes below
// annotate their own fields with it.
import type { CallStatus } from "./call-status";


export async function startPhoneInterview(
  resumeUuid: string,
  questionIndices: number[],
  speaker: string = selectedVoice()
): Promise<PhoneInterview> {
  const res = await fetch(API_BASE + "/resume/" + resumeUuid + "/interview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question_indices: questionIndices, speaker }),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const data = await res.json();
  console.log("[API] interview started:", data.session_id, "->", data.phone);
  return data;
}

/**
 * Call several candidates at once. Sarvam dials them concurrently;
 * `queue_position` is kept on the wire and is always 0.
 *
 * A candidate whose number is undialable comes back with `error` and is left
 * out of the batch rather than failing it: one bad CV must not block nine calls.
 */
export async function startBulkInterviews(
  resumeUuids: string[],
  questionIndices: number[] = [],
  speaker: string = selectedVoice()
): Promise<BulkInterviewResult[]> {
  const res = await fetch(API_BASE + "/interviews/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resume_uuids: resumeUuids,
      question_indices: questionIndices,
      speaker,
    }),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const data = await res.json();
  console.log("[API] bulk interviews queued:", data.queued, "skipped:", data.skipped);
  return data.results || [];
}

/**
 * Poll a call. Pass `resumeUuid` so the backend persists the communication
 * score onto the candidate as soon as grading finishes — that is what keeps it
 * on the dashboard row after the modal closes.
 */
/** A call the voice service still has in hand: waiting in the queue, dialing,
 *  or connected. `queue_position` 0 means it is not waiting — it is the call
 *  happening right now. */
export type ActiveCall = {
  call_status: string;
  queue_position: number;
  /** The folded status — see CallStatus. Absent from an older voice service. */
  status?: CallStatus;
  /** ISO time of the next automatic dial, when one is armed. "" otherwise. */
  next_call_at?: string;
  /** Dials made on this session so far, the first call and every redial. */
  call_attempts?: number;
};

/**
 * Every outstanding call, keyed by session id — one request for the whole
 * table, rather than one poll per called candidate.
 *
 * Returns {} rather than throwing when the backend is unreachable: this
 * decorates the dashboard, and a table that renders is worth more than a
 * precise answer about the queue.
 */
export async function activeInterviews(): Promise<Record<string, ActiveCall>> {
  try {
    const res = await fetch(API_BASE + "/interviews/active");
    if (!res.ok) return {};
    const data = await res.json();
    return data.sessions ?? {};
  } catch {
    return {};
  }
}

/** Account spend and credit left, or null when Sarvam can't be read right now. */
export async function getCallUsage(): Promise<CallUsage | null> {
  try {
    const res = await fetch(API_BASE + "/interviews/usage");
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Every call made, taken and still to come, oldest first. */
export async function getCallSchedule(): Promise<CallEvent[]> {
  const res = await fetch(API_BASE + "/interviews/schedule");
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()).events ?? [];
}

export async function getPhoneInterview(
  sessionId: string,
  resumeUuid?: string
): Promise<PhoneInterviewStatus> {
  const res = await fetch(
    API_BASE + "/interview/" + sessionId +
      (resumeUuid ? "?resume_uuid=" + encodeURIComponent(resumeUuid) : "")
  );
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const data = await res.json();
  // Older voice services don't grade at all; give the UI one shape to handle.
  return { ...data, scores: data.scores ?? { status: "pending" } };
}

export async function deleteResume(resumeUuid: string): Promise<void> {
  const res = await fetch(API_BASE + "/resume/" + resumeUuid, { method: "DELETE" });
  if (!res.ok) {
    throw new Error("Delete failed (" + res.status + "): " + (await readError(res)));
  }
  console.log("[API] deleted resume:", resumeUuid);
}

// jdRubric and evaluations used to be parameters here and were never read: the
// backend loads the JD and resumes itself from the resume uuid. Callers were
// passing whole candidate objects into a black hole.
export async function chatWithAI(
  sessionId: string,
  message: string,
  candidateId?: string
): Promise<ChatResponse> {
  // candidateId (the resume uuid) scopes the bot to that one candidate; the
  // dashboard chat omits it and gets every resume.
  let url =
    API_BASE + "/chatbot?user_input=" + encodeURIComponent(message) +
    "&thread_id=" + encodeURIComponent(sessionId);
  if (candidateId) url += "&resume_uuid=" + encodeURIComponent(candidateId);

  const res = await fetch(url);

  if (!res.ok) {
    // 502 means the chat provider itself rejected us (bad key, quota) and the
    // backend has already written a sentence for the user — pass it through
    // rather than burying it behind a status code.
    const detail = await readError(res);
    throw new Error(res.status === 502 ? detail : "Chat failed (" + res.status + "): " + detail);
  }

  const data = await res.json();
  return {
    session_id: sessionId,
    response: data.response,
    sources: [],
    timestamp: new Date().toISOString(),
  };
}

export async function downloadEvaluationsExcel(
  evaluations: CandidateEvaluation[]
): Promise<void> {
  const XLSX = await import("xlsx");

  const rows = evaluations.map((e) => ({
    Name: e.candidate_name,
    "Candidate ID": e.candidate_id,
    "Years of Experience": e.years_experience ?? "",
    "Match Score (%)": e.overall_match_score,
    Decision: e.shortlist_decision,
    "Matched Skills": e.matched_mandatory_skills.join(", "),
    "Missing Skills": e.missing_mandatory_skills.join(", "),
    "Transferable Skills": e.Transferable_skills.join(", "),
    "Green Flags": e.green_flags.join("; "),
    "Red Flags": e.red_flags_detected.join("; "),
    // Blank rather than "HIGH" for an unscreened candidate: the backend
    // withholds a verdict for them, and a spreadsheet is exactly where a
    // default would get read as a finding.
    "Joining Likelihood": e.joining_assessment?.join_category || "",
    "Joining Red Flags": (e.joining_assessment?.red_flags || [])
      .map((f) => f.reason)
      .join("; "),
    Email: e.contact_email || "",
    Phone: e.contact_phone || "",
    "Resume File": e.resume_file_name || "",
    Reasoning: e.reasoning,
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Evaluations");
  XLSX.writeFile(workbook, "candidate_evaluations.xlsx");
}

// ─── LLM Config ─────────────────────────────────────────────────────────────

export type LlmProvider = {
  id: string;
  name: string;
  apiKey: string;
  models: { id: string; name: string }[];
};

export type LlmConfig = {
  providers: LlmProvider[];
  activeParseProvider: string;
  activeParseModel: string;
  activeChatProvider: string;
  activeChatModel: string;
};

export async function getLlmConfig(): Promise<LlmConfig> {
  const res = await fetch(API_BASE + "/api/config/llm");
  if (!res.ok) throw new Error("Failed to fetch LLM config");
  return res.json();
}

export async function saveLlmConfig(config: LlmConfig): Promise<LlmConfig> {
  const res = await fetch(API_BASE + "/api/config/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error("Failed to save LLM config");
  return res.json();
}

export async function deleteLlmProvider(providerId: string): Promise<LlmConfig> {
  const res = await fetch(API_BASE + "/api/config/llm/" + encodeURIComponent(providerId), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete LLM provider");
  return res.json();
}

// setActiveLlm() lived here and called POST /api/config/llm/active, but nothing
// ever used it — Header.tsx sets the active provider/model as part of the whole
// config through saveLlmConfig(). The backend route is still there if you want
// to switch models without rewriting the provider list.
