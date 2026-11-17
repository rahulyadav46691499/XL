"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Users, CheckCircle2, AlertTriangle, CheckSquare, Square, PhoneCall,
  Search, Loader2, Eye, Trash2, Upload, X, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppState } from "@/lib/app-state";
import VoicePicker from "@/components/VoicePicker";
import { loadSession, deleteResume, decisionLabel, stageLabel, startBulkInterviews, activeInterviews, ActiveCall, callStatusLabel, callStatusHint, formatCallTime, CandidateEvaluation, InterviewScores, JDRubric, JoiningAssessment, UploadProgress } from "@/lib/api";

/** What the progress bar says while a resume batch is being analyzed: the
 *  backend's current stage once it reports one, the file count until then. */
function analyzingLabel(count: number, step: UploadProgress | null): string {
  return stageLabel(step, count === 1 ? "Analyzing 1 resume" : `Analyzing ${count} resumes`);
}
import { buildInsights } from "@/lib/insights";
import ProgressBar from "@/components/ProgressBar";
import JdPicker from "@/components/JdPicker";
import JdBar from "@/components/JdBar";
import CallCalendar from "@/components/CallCalendar";
import { ChartPanel, StatTile, BarList, Histogram, SkillCloud, CATEGORY_LABEL, SkillChip, SCORE_THRESHOLDS, scoreColor, JOINING_STYLE } from "@/components/charts";
import HrScreeningModal from "./HrScreeningModal";

/**
 * Decision colours resolve to the tokens in globals.css, so light and dark are
 * defined in one place and the palette stays the validated one. Never hardcode
 * a decision colour at a call site.
 */
const decisionColor: Record<string, string> = {
  Interview: "var(--decision-interview)",
  "On Hold": "var(--decision-hold)",
  Rejected: "var(--decision-rejected)",
};

const decisionWash: Record<string, string> = {
  Interview: "var(--decision-interview-wash)",
  "On Hold": "var(--decision-hold-wash)",
  Rejected: "var(--decision-rejected-wash)",
};

/** Text colour for a label sitting on the decision fill — see globals.css. */
const decisionInk: Record<string, string> = {
  Interview: "var(--decision-interview-ink)",
  "On Hold": "var(--decision-hold-ink)",
  Rejected: "var(--decision-rejected-ink)",
};

function initialsOf(name: string): string {
  if (!name) return "??";
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Builds a 4-5 line decision summary for a candidate, using their real
 * evaluation data — reasoning, score, matched/missing skills, and flags.
 */
function buildDecisionSummary(c: CandidateEvaluation): string[] {
  const lines: string[] = [];

  lines.push(c.reasoning || "No detailed reasoning provided.");

  lines.push("Match score: " + c.overall_match_score + "%.");

  if (c.matched_mandatory_skills.length > 0) {
    lines.push("Matched skills: " + c.matched_mandatory_skills.slice(0, 4).join(", ") + ".");
  }

  if (c.missing_mandatory_skills.length > 0) {
    lines.push("Missing skills: " + c.missing_mandatory_skills.slice(0, 4).join(", ") + ".");
  }

  if (c.red_flags_detected.length > 0) {
    lines.push("Red flags: " + c.red_flags_detected.length + " detected.");
  } else if (c.green_flags.length > 0) {
    lines.push("Green flags: " + c.green_flags.length + " positive signal(s).");
  }

  return lines.slice(0, 5);
}

/**
 * Score rows for the hover card — the overall match plus any per-category
 * scores, each rendered as a bar. Projects / education / achievements are
 * deliberately left out; they belong in the full screening modal.
 */
/**
 * The Comprehensive score cell: how the candidate came across on the AI phone
 * screening, graded by the Sarvam agent's post-call extraction once the call ends.
 *
 * One number, on request: the speaking score was removed everywhere, grader
 * included, so this is the whole verdict on the call.
 *
 * "Comprehensive" is the label only — the value is `communication_score` on the
 * wire, everywhere from the grader to the stored metadata. Same rule as
 * Interview / "Selected for R1": never rename the field to match the label.
 *
 * Every non-scored state gets words rather than a number, because the states
 * mean genuinely different things to a recruiter — never called, called but
 * rescheduled, graded. Rendering any of them as 0 or "—" would flatten that
 * into "this candidate did badly".
 */
/**
 * What the voice service is doing with this candidate *right now*, shown in
 * place of the score for as long as the call is outstanding.
 *
 * These mean genuinely different things to a recruiter waiting on a result —
 * ringing, talking, and the two "we are not done with this
 * candidate" states that used to be invisible here: a callback the candidate
 * asked for, and an automatic retry after nobody picked up. Both redial on the
 * same session and fill the same answers, so a row that reads as finished
 * during them is simply wrong.
 *
 * The dot is decoration — the words carry the state on their own, so this still
 * reads with colour off, with motion off, and to a screen reader. Only a call
 * actually happening pulses; a redial hours away has nothing to animate about.
 */
function CallProgressCell({ call }: { call: ActiveCall }) {
  const armed = call.status === "rescheduled" || call.status === "awaiting_retry";
  const ringing = ["created", "queued", "initiated", "ringing"].includes(call.call_status);

  const label = armed
    ? callStatusLabel(call.status)
    : ringing
      ? "Ringing…"
      : "On the call";

  const when = armed && call.next_call_at ? formatCallTime(call.next_call_at) : "";
  const attempts = call.call_attempts ?? 0;
  const title = armed
    ? [
        callStatusHint(call.status),
        when && `Next call: ${when}.`,
        attempts > 1 && `Dialled ${attempts} times so far.`,
      ].filter(Boolean).join(" ")
    : "The AI screening call for this candidate is happening now";

  return (
    <div className="text-[13px] font-semibold text-[var(--brand)]" title={title}>
      <p className="flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full bg-[var(--brand)] flex-shrink-0${
            armed ? "" : " animate-pulse"
          }`}
          aria-hidden="true"
        />
        {label}
      </p>
      {when && (
        // Just the time: the label above already says which of the two this is,
        // and repeating it ("Retrying / Retrying 16 Sept…") burned a line in a
        // column narrow enough to wrap to three.
        <p className="pl-3 text-[11px] font-normal text-muted-foreground">{when}</p>
      )}
    </div>
  );
}

function ComprehensiveScoreCell({ scores, called }: { scores?: InterviewScores; called: boolean }) {
  if (!scores || scores.status === "pending") {
    return (
      <p className="text-[13px] text-muted-foreground">
        {called ? "Grading…" : "Not called"}
      </p>
    );
  }
  if (scores.status === "skipped") {
    return (
      <div className="group/cs relative">
        <p className="text-[13px] font-semibold text-muted-foreground cursor-default">Rescheduled</p>
        {scores.reason && (
          <div className="absolute bottom-full left-0 mb-2 w-[220px] opacity-0 invisible group-hover/cs:opacity-100 group-hover/cs:visible transition-all z-50 pointer-events-none">
            <p className="text-[11px] leading-relaxed rounded-xl bg-card border border-border shadow-lg px-3 py-2 text-muted-foreground">
              {scores.reason}
            </p>
          </div>
        )}
      </div>
    );
  }
  if (scores.status === "error" || scores.communication_score === undefined) {
    return <p className="text-[13px] text-muted-foreground">Not graded</p>;
  }

  const score = scores.communication_score;
  return (
    <div className="group/cs relative">
      <div className="flex items-baseline gap-1 cursor-default">
        <span className="text-[17px] font-bold tabular-nums text-foreground">
          {score}
        </span>
        <span className="text-[11px] text-muted-foreground">/ 100</span>
      </div>

      {scores.summary && (
        <div className="absolute bottom-full left-0 mb-2 w-[260px] opacity-0 invisible translate-y-1 group-hover/cs:opacity-100 group-hover/cs:visible group-hover/cs:translate-y-0 transition-all duration-200 z-50 pointer-events-none">
          <div className="rounded-2xl bg-card border border-border shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)] px-3.5 py-3 text-left">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              How the call went
            </p>
            <div className="mb-2">
              <p className="text-[17px] font-bold tabular-nums text-foreground">{score}</p>
              <p className="text-[11px] text-muted-foreground">Comprehensive</p>
            </div>
            <p className="text-[11px] leading-relaxed text-foreground">{scores.summary}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * How likely this candidate is to join, from their screening answers alone.
 *
 * Rules, not a model (`backend/joining_evaluator.py`): the same answers always
 * give the same category, and the hover card lists every criterion behind it so
 * the verdict can be argued with rather than just believed. It decides nothing —
 * the Decision pill beside it is still HR's, exactly as a screening gate is.
 *
 * A dash means the backend withheld a verdict: nobody has answered a question
 * any criterion measures. That is deliberately not "High" — a conversation that
 * never happened has no red flags in it either.
 */
function JoiningCell({ assessment }: { assessment?: JoiningAssessment }) {
  if (!assessment) {
    return (
      <p className="text-[13px] text-muted-foreground" title="No screening answers to assess yet">
        —
      </p>
    );
  }

  const style = JOINING_STYLE[assessment.join_category] ?? JOINING_STYLE.WITHDRAWN;
  const { red_flags: flags, matched_criteria: matched } = assessment;

  return (
    <div className="group/jn relative">
      <span
        className="inline-block text-[13px] font-bold px-2.5 py-1 rounded-lg cursor-default"
        style={{
          color: style.color,
          background: `color-mix(in oklab, ${style.color} 12%, transparent)`,
        }}
      >
        {style.label}
      </span>

      <div className="absolute bottom-full left-0 mb-2 w-[300px] opacity-0 invisible translate-y-1 group-hover/jn:opacity-100 group-hover/jn:visible group-hover/jn:translate-y-0 transition-all duration-200 z-50 pointer-events-none">
        <div className="rounded-2xl bg-card border border-border shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)] px-3.5 py-3 text-left">
          <p className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: style.color }}>
            Joining likelihood
          </p>
          <p className="text-[11px] leading-relaxed text-foreground mb-2">{assessment.summary}</p>

          {flags.map((flag, i) => (
            <div key={i} className="flex items-start gap-1.5 mb-1">
              <AlertTriangle
                size={10}
                className="mt-1 flex-shrink-0"
                style={{ color: flag.severity === "hard" ? "var(--danger)" : "var(--decision-hold)" }}
              />
              <p className="text-[11px] leading-relaxed text-foreground">
                {flag.reason}
                {/* Named so a dealbreaker is not read as one risk among several:
                    a single hard flag is LOW on its own, two soft ones are. */}
                <span className="text-muted-foreground">
                  {flag.severity === "hard" ? " (dealbreaker)" : " (risk)"}
                </span>
              </p>
            </div>
          ))}

          {matched.map((match, i) => (
            <div key={i} className="flex items-start gap-1.5 mb-1">
              <CheckCircle2 size={10} className="mt-1 flex-shrink-0 text-[var(--decision-interview)]" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">{match.reason}</p>
            </div>
          ))}

          <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t border-border">
            {flags.length + matched.length} of 6 criteria answered. Open HR Screening for the
            evidence; the decision stays yours.
          </p>
        </div>
      </div>
    </div>
  );
}

function buildScoreBars(c: CandidateEvaluation): { label: string; value: number }[] {
  const rows = [{ label: "Overall Match", value: c.overall_match_score }];

  const weights = c.scoring_weights || {};
  const catLabels: Record<string, string> = {
    required_skills: "Required Skills",
    preferred_skills: "Preferred Skills",
  };

  Object.entries(c.category_scores || {}).forEach(([key, val]) => {
    const label = catLabels[key];
    if (!label) return;
    const weight = weights[key] ? " (" + Math.round(weights[key] * 100) + "%)" : "";
    rows.push({ label: label + weight, value: Math.round(val) });
  });

  return rows;
}

// Stop words for raw-text fallback parsing (used in extractWordsFromJD)
const STOP_WORDS = new Set([
  // Common English stop words
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
  "be", "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought", "used",
  "it", "its", "this", "that", "these", "those", "i", "you", "he", "she",
  "we", "they", "what", "which", "who", "whom", "whose", "when", "where",
  "why", "how", "all", "each", "every", "both", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so",
  "than", "too", "very", "just", "because", "if", "while", "about", "into",
  "through", "during", "before", "after", "above", "below", "between",
  "under", "again", "further", "then", "once", "here", "there", "up", "down",
  "out", "off", "over", "under", "also", "now", "any", "our", "your", "my",
  // JD-specific boilerplate words that are NOT useful as filters
  "work", "title", "job", "jobs", "experience", "experienced", "required",
  "requirements", "responsibilities", "responsible", "role", "roles", "position",
  "positions", "candidate", "candidates", "looking", "seeking", "join", "team",
  "teams", "company", "companies", "year", "years", "etc", "etc.", "e.g", "eg",
  "including", "include", "includes", "preferred", "qualifications", "qualification",
  "skills", "skill", "ability", "abilities", "strong", "excellent", "good",
  "knowledge", "understanding", "familiar", "proficient", "proficiency",
  "working", "work", "works", "worked", "using", "use", "used", "uses",
  "provide", "provides", "provided", "ensure", "ensures", "ensuring",
  "develop", "develops", "developing", "development", "manage", "manages",
  "managing", "management", "support", "supports", "supporting",
  "collaborate", "collaborates", "collaborating", "collaboration",
  "communicate", "communicates", "communicating", "communication",
  "lead", "leads", "leading", "leadership", "drive", "drives", "driving",
  "deliver", "delivers", "delivering", "delivery", "build", "builds", "building",
  "maintain", "maintains", "maintaining", "maintenance", "test", "tests", "testing",
  "deploy", "deploys", "deploying", "deployment", "monitor", "monitors", "monitoring",
  "analyze", "analyzes", "analyzing", "analysis", "optimize", "optimizes", "optimizing",
  "improve", "improves", "improving", "enhance", "enhances", "enhancing",
  "identify", "identifies", "identifying", "solve", "solves", "solving",
  "create", "creates", "creating", "production", "environments", "environment",
  "systems", "system", "platform", "platforms", "application", "applications",
  "service", "services", "product", "products", "project", "projects",
  "program", "programs", "programming", "code", "codes", "coding",
  "software", "hardware", "data", "information", "business", "enterprise",
  "client", "clients", "customer", "customers", "user", "users",
  "stakeholder", "stakeholders", "partner", "partners", "vendor", "vendors",
  "internal", "external", "global", "local", "national", "international",
  "remote", "onsite", "on-site", "hybrid", "flexible", "full-time", "part-time",
  "contract", "permanent", "temporary", "intern", "internship",
  "entry", "mid", "senior", "junior", "lead", "principal", "staff", "director",
  "vp", "cto", "cio", "cfo", "ceo", "manager", "head", "chief",
  "bachelor", "master", "phd", "degree", "degrees", "diploma", "certification",
  "certifications", "certificate", "license", "clearance", "visa", "citizen",
  "eligible", "authorization", "authorized", "background", "drug",
  "must", "must have", "nice to have", "plus", "bonus", "desired",
  "minimum", "maximum", "least", "least", "least", "least",
]);

// Minimal stop words for LLM-extracted rubric (only the most generic JD noise)
// The LLM is trusted to extract actual skills, so we only filter the obvious boilerplate.
const RUBRIC_STOP_WORDS = new Set([
  "work", "title", "job", "jobs", "experience", "experienced", "required",
  "requirements", "responsibilities", "responsible", "role", "roles", "position",
  "positions", "candidate", "candidates", "looking", "seeking", "join", "team",
  "teams", "company", "companies", "year", "years", "etc", "etc.", "e.g", "eg",
  "including", "include", "includes", "preferred", "qualifications", "qualification",
  "skills", "skill", "ability", "abilities", "strong", "excellent", "good",
  "knowledge", "understanding", "familiar", "proficient", "proficiency",
  "working", "work", "works", "worked", "using", "use", "used", "uses",
  "provide", "provides", "provided", "ensure", "ensures", "ensuring",
  "must", "must have", "nice to have", "plus", "bonus", "desired",
  "minimum", "maximum", "least",
]);

// Common technical skills to identify and highlight
const TECH_SKILLS = new Set([
  "python", "java", "javascript", "typescript", "react", "angular", "vue", "node", "nodejs",
  "gcp", "aws", "azure", "docker", "kubernetes", "sql", "nosql", "mongodb", "postgresql",
  "machine learning", "ml", "ai", "tensorflow", "pytorch", "django", "flask", "spring",
  "html", "css", "scss", "sass", "nextjs", "express", "graphql", "rest", "api",
  "git", "jenkins", "ci/cd", "terraform", "ansible", "linux", "windows", "macos",
  "c++", "c#", "go", "rust", "swift", "kotlin", "scala", "ruby", "php",
  "pandas", "numpy", "scikit", "sklearn", "spark", "hadoop", "kafka", "redis",
  "microservices", "serverless", "cloud", "devops", "agile", "scrum", "kanban",
]);

// Common soft skills
const SOFT_SKILLS = new Set([
  "communication", "leadership", "teamwork", "problem solving", "analytical", "creative",
  "collaboration", "adaptability", "time management", "critical thinking", "mentoring",
  "presentation", "negotiation", "customer service", "project management",
]);

// Related skills mapping - when one skill is selected, these related skills also match
const RELATED_SKILLS: Record<string, string[]> = {
  "gcp": ["gcp", "google cloud", "google cloud platform", "aws", "azure", "cloud"],
  "aws": ["aws", "amazon web services", "gcp", "azure", "cloud"],
  "azure": ["azure", "microsoft azure", "gcp", "aws", "cloud"],
  "cloud": ["cloud", "gcp", "aws", "azure", "google cloud", "amazon web services", "microsoft azure"],
  "python": ["python", "python3", "py"],
  "java": ["java", "spring", "hibernate"],
  "javascript": ["javascript", "js", "node", "nodejs", "react", "vue", "angular"],
  "sql": ["sql", "mysql", "postgresql", "postgres", "database", "db"],
  "docker": ["docker", "container", "kubernetes", "k8s"],
  "kubernetes": ["kubernetes", "k8s", "docker", "container"],
  "machine learning": ["machine learning", "ml", "ai", "tensorflow", "pytorch", "scikit", "sklearn"],
  "ml": ["ml", "machine learning", "ai", "tensorflow", "pytorch"],
  "ai": ["ai", "artificial intelligence", "machine learning", "ml", "tensorflow", "pytorch"],
};

// Multi-word skills sorted by length (longest first) for proper extraction
const MULTI_WORD_SKILLS = [...TECH_SKILLS, ...SOFT_SKILLS]
  .filter((s) => s.includes(" "))
  .sort((a, b) => b.length - a.length);

function getWordCategory(word: string): "tech" | "soft" | "other" {
  const lower = word.toLowerCase();
  if (TECH_SKILLS.has(lower)) return "tech";
  if (SOFT_SKILLS.has(lower)) return "soft";
  return "other";
}

// getCategoryColor was deleted with the chip cloud: tech/soft/other never
// answered a question anyone asked, and three more hues fought the brand.
// `category` is still carried on each word in case it earns a use later.

function extractWordsFromJD(jdText: string): { word: string; count: number; category: "tech" | "soft" | "other"; importance: number }[] {
  if (!jdText || jdText.trim().length === 0) return [];

  const lowerJd = jdText.toLowerCase();
  const freq: Record<string, number> = {};

  // First, extract multi-word skills
  let remainingText = lowerJd;
  for (const skill of MULTI_WORD_SKILLS) {
    const regex = new RegExp(skill.replace(/[+\-]/g, "\\$&"), "g");
    const matches = remainingText.match(regex);
    if (matches) {
      freq[skill] = (freq[skill] || 0) + matches.length;
      remainingText = remainingText.replace(regex, " ");
    }
  }

  // Then extract single words
  const words = remainingText
    .replace(/[^a-z0-9\s+#.\-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  return Object.entries(freq)
    .map(([word, count]) => ({
      word,
      count,
      category: getWordCategory(word),
      importance: 0, // Will be calculated later
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}

/**
 * Builds the word cloud from the LLM-extracted JD rubric so only HR-relevant
 * skills/factors (technical, tools, soft skills, domains, knockouts) appear —
 * never raw JD noise. Word size is driven by how emphasized each skill is in
 * the JD text (frequency), defaulting to 1 so every relevant term still shows.
 */
function buildWordCloudFromRubric(
  rubric: JDRubric,
  jdText: string
): { word: string; count: number; category: "tech" | "soft" | "other"; importance: number }[] {
  const lowerJd = (jdText || "").toLowerCase();
  const entries: { word: string; category: "tech" | "soft" | "other" }[] = [
    ...rubric.required_skills.map((w) => ({ word: w, category: "tech" as const })),
    ...rubric.preferred_skills.map((w) => ({ word: w, category: "tech" as const })),
    ...rubric.soft_skills.map((w) => ({ word: w, category: "soft" as const })),
    ...rubric.domains.map((w) => ({ word: w, category: "other" as const })),
    ...rubric.hard_knockouts.map((w) => ({ word: w, category: "other" as const })),
    ...rubric.soft_knockouts.map((w) => ({ word: w, category: "other" as const })),
  ];

  const seen = new Set<string>();
  const items: { word: string; count: number; category: "tech" | "soft" | "other"; importance: number }[] = [];
  for (const e of entries) {
    const key = e.word.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    
    // Skip only the most generic JD boilerplate words (LLM is trusted for skills)
    if (RUBRIC_STOP_WORDS.has(key)) continue;
    
    const count = lowerJd.split(key).length - 1 || 1;
    items.push({ word: e.word, count, category: e.category, importance: 0 });
  }

  return items.sort((a, b) => b.count - a.count).slice(0, 40);
}

function getRelatedWords(word: string): string[] {
  const lower = word.toLowerCase();
  // Search text is always lowercased, so the fallback must be too —
  // otherwise "Python" in the JD never matches "python" in a resume.
  return RELATED_SKILLS[lower] || [lower];
}

/** What a skill chip is matched against: the skills the candidate actually has.
 *  The old "broad" scope (name, reasoning, flags, missing skills) went with the
 *  scope toggle — removed on request. */
function skillText(c: CandidateEvaluation): string {
  return [...c.matched_mandatory_skills, ...c.Transferable_skills].join(" ").toLowerCase();
}

function countMatchesForWord(evaluations: CandidateEvaluation[], word: string): number {
  const relatedWords = getRelatedWords(word);
  return evaluations.filter((c) => {
    const searchText = skillText(c);
    return relatedWords.some((w) => searchText.includes(w));
  }).length;
}

function candidateMatchesWords(
  c: CandidateEvaluation,
  selectedWords: string[],
  filterMode: "and" | "or"
): boolean {
  if (selectedWords.length === 0) return true;

  const searchText = skillText(c);
  const has = (w: string) => getRelatedWords(w).some((rw) => searchText.includes(rw));
  return filterMode === "or" ? selectedWords.some(has) : selectedWords.every(has);
}

export default function DashboardPage() {
  const appState = useAppState();
  const evaluations = appState.evaluations;
  const jdText = appState.jdText;
  const jdRubric = appState.jdRubric;
  const [search, setSearch] = useState("");
  const [screeningCandidate, setScreeningCandidate] = useState<CandidateEvaluation | null>(null);
  const [screeningResponses, setScreeningResponses] = useState<Record<number, string>>({});
  // Which questions were ticked. The backend has always stored this; the modal
  // had to re-guess it from the answers because nothing seeded it back.
  const [screeningSelected, setScreeningSelected] = useState<number[]>([]);
  /** The spoken sentences behind the parsed number/yes-no answers. */
  const [screeningHeard, setScreeningHeard] = useState<Record<number, string>>({});
  const [hrComment, setHrComment] = useState("");
  const [reviewedCandidates, setReviewedCandidates] = useState<Set<string>>(new Set());
  const [screeningData, setScreeningData] = useState<Record<string, { responses: Record<number, string>; comment: string; selected: number[]; heard: Record<number, string> }>>({});
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<"and" | "or">("and");
  const [expRange, setExpRange] = useState<[number, number] | null>(null);
  const [decisionFilter, setDecisionFilter] = useState<string | null>(null);
  // Bulk calling. Sarvam dials every selected candidate at once; each row then
  // shows its own call's progress.
  const [selectedForCall, setSelectedForCall] = useState<Set<string>>(new Set());
  // Which calls the voice service still has in hand, keyed by session id, as it
  // reports them. Held server-side rather than locally because a local copy
  // said nothing at all about a call placed from inside the screening modal.
  const [liveCalls, setLiveCalls] = useState<Record<string, ActiveCall>>({});
  // Bumped whenever a call may have been placed, to restart the poll below.
  const [callNonce, setCallNonce] = useState(0);
  const [bulkCalling, setBulkCalling] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkNotice, setBulkNotice] = useState("");
  // Which action the split button runs. Calling is the default because it is
  // the reversible one: a queued call can be ignored, a deleted resume cannot
  // be got back. Deleting has to be picked deliberately every time -- the
  // choice resets as soon as the selection is cleared, so a delete chosen for
  // one batch can never carry over and surprise the next.
  const [bulkAction, setBulkAction] = useState<"call" | "delete">("call");
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const busyWithSelection = bulkCalling || bulkDeleting;
  // An empty selection resets the choice. Covers every way the selection can
  // empty -- unticking the last row, the select-all toggle, a finished batch --
  // so "delete" is never left armed on a control the next batch will re-use.
  useEffect(() => {
    if (selectedForCall.size === 0) {
      setBulkAction("call");
      setBulkMenuOpen(false);
    }
  }, [selectedForCall]);

  /** Table narrowed to candidates HR has not screened yet — the first stat tile. */
  const [pendingScreeningOnly, setPendingScreeningOnly] = useState(false);
  /** Which score the distribution chart is showing. */
  const [scoreView, setScoreView] = useState<"resume" | "comprehensive">("resume");
  const [showAllSkills, setShowAllSkills] = useState(false);
  const [skillView, setSkillView] = useState<"cloud" | "ranked">("cloud");
  const [restoring, setRestoring] = useState(evaluations.length === 0);
  // The open requisition, the JD list and the two actions that change them live
  // in app-state now that Collective analysis shows the same bar — see JdBar.
  // Aliased under their old names so everything below reads unchanged.
  const jds = appState.jds;
  const selectedJd = appState.selectedJd;
  // Which row is on the phone. Probed once on arrival — HR who reloads the page
  // mid-call still sees it — and then every 5s for as long as anything is
  // outstanding, stopping the moment the queue empties so a quiet dashboard
  // makes no requests at all. One request covers the whole table.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let onPhone = new Set<string>();
    const tick = async () => {
      const active = await activeInterviews();
      if (stopped) return;
      setLiveCalls(active);
      // A call on the phone last tick and not now has its result in: re-read the
      // rows, which is what shows its communication score and joining verdict
      // (the backend reads both off the call) without HR opening the form.
      const now = new Set(
        Object.entries(active).filter(([, c]) => c.status === "in_progress").map(([id]) => id)
      );
      if (selectedJd && [...onPhone].some((id) => !now.has(id))) {
        try {
          const session = await loadSession(selectedJd);
          if (session && !stopped) appState.setEvaluations(session.evaluations);
        } catch (err) {
          console.warn("[Dashboard] refresh after a call ended failed:", err);
        }
      }
      onPhone = now;
      if (stopped) return;
      if (Object.keys(active).length > 0) timer = setTimeout(tick, 5000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [selectedJd, callNonce]);
  const switchingJd = appState.switchingJd;
  const refreshJds = appState.refreshJds;
  const handleSelectJd = appState.openJd;
  const handleUploadMore = (files: FileList | null) =>
    appState.uploadMore(Array.from(files ?? []));
  const uploadingMore = appState.uploading;
  const uploadCount = appState.uploadCount;
  const uploadStep = appState.uploadStep;
  const uploadMoreError = appState.uploadError;
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // On reload the in-memory evaluations are gone, but the backend still has
  // them — re-fetch the last analyzed JD's results from Chroma. Also load
  // the list of all JDs for the dropdown switcher.
  useEffect(() => {
    // Every JD, unfiltered: the switcher has to list exactly what the Upload JD
    // page lists, counts included. A JD with no resumes yet is still a real JD —
    // selecting it lands on its empty state, where Add Resumes fills it.
    refreshJds();

    // A JD renamed, re-keyed or deleted on the Upload JD page has to show up
    // here too, so re-read whenever this page comes back to the front.
    window.addEventListener("focus", refreshJds);
    document.addEventListener("visibilitychange", refreshJds);

    // `restoring` is this page's own spinner, so it is flipped here rather than
    // inside the shared action.
    appState.openLastJd().finally(() => setRestoring(false));

    return () => {
      window.removeEventListener("focus", refreshJds);
      document.removeEventListener("visibilitychange", refreshJds);
    };
  }, []);

  /** The JD the table on screen belongs to, as the database describes it. */
  const currentJd = jds.find((j) => j.jd_uuid === selectedJd) ?? null;

  /** Drop deleted candidates from the Upload page's local lists.
   *  Shared by the single-row delete and the bulk one: two copies of this
   *  drifted apart is exactly how the Upload page ends up listing resumes the
   *  backend no longer has.
   *  ponytail: SavedJD stores no backend jd_uuid, so match by filename; add the
   *  uuid to SavedJD if this ever misfires. */
  function pruneFromUploadPage(gone: CandidateEvaluation[]) {
    const names = new Set(gone.map((c) => c.resume_file_name).filter(Boolean) as string[]);
    if (names.size === 0) return;
    appState.resumes
      .filter((r) => names.has(r.name))
      .forEach((r) => appState.removeResume(r.id));
    appState.savedJDs.forEach((jd) => {
      if ((jd.resumes || []).some((r) => names.has(r.name))) {
        appState.updateSavedJDResumes(jd.id, jd.resumes.filter((r) => !names.has(r.name)));
      }
    });
  }

  async function handleDeleteSelected() {
    const ids = [...selectedForCall];
    if (bulkDeleting || bulkCalling || ids.length === 0) return;
    // Names, not just a count: "delete 12 candidates?" is not something anyone
    // can actually check before agreeing to it, and this cannot be undone.
    const names = ids.map(nameOf);
    if (!confirm(
      `Permanently delete ${ids.length} candidate${ids.length === 1 ? "" : "s"} and ` +
      `${ids.length === 1 ? "their resume" : "their resumes"} from the database?\n\n` +
      `${names.join("\n")}\n\nThis cannot be undone.`
    )) return;

    setBulkDeleting(true);
    setBulkNotice("");
    const deleted: CandidateEvaluation[] = [];
    const failed: string[] = [];
    // One at a time, and each failure is recorded rather than thrown: a batch
    // that dies halfway would leave the table disagreeing with the database
    // about everything after the one that failed.
    for (const id of ids) {
      const candidate = evaluations.find((e) => e.candidate_id === id);
      try {
        await deleteResume(id);
        if (candidate) deleted.push(candidate);
      } catch (err) {
        console.warn("[Dashboard] bulk delete failed for", id, err);
        failed.push(nameOf(id));
      }
    }

    const goneIds = new Set(deleted.map((c) => c.candidate_id));
    appState.setEvaluations(evaluations.filter((e) => !goneIds.has(e.candidate_id)));
    pruneFromUploadPage(deleted);
    setSelectedForCall(new Set());
    setBulkAction("call");
    try {
      await refreshJds(); // the screened counts dropped
    } catch (err) {
      console.warn("[Dashboard] refresh after bulk delete failed:", err);
    }
    setBulkNotice(
      `Deleted ${deleted.length} candidate${deleted.length === 1 ? "" : "s"}.` +
      (failed.length ? ` Could not delete ${failed.join(", ")} — they are still listed.` : "")
    );
    setBulkDeleting(false);
  }

  async function handleDeleteCandidate(c: CandidateEvaluation) {
    if (!confirm("Delete " + c.candidate_name + "? This permanently removes their resume from the database.")) return;
    setDeletingId(c.candidate_id);
    try {
      await deleteResume(c.candidate_id);
      appState.setEvaluations(evaluations.filter((e) => e.candidate_id !== c.candidate_id));
      await refreshJds(); // the screened count dropped by one

      pruneFromUploadPage([c]);
    } catch (err) {
      console.warn("[Dashboard] delete failed:", err);
      alert(err instanceof Error ? err.message : "Failed to delete candidate.");
    } finally {
      setDeletingId(null);
    }
  }

  // Seed saved HR screening responses (persisted in the backend) so they
  // survive page reloads. Local unsaved edits win over the backend copy.
  useEffect(() => {
    const seeded: Record<string, { responses: Record<number, string>; comment: string; selected: number[]; heard: Record<number, string> }> = {};
    const reviewed: string[] = [];
    evaluations.forEach((e) => {
      if (e.hr_screening) {
        seeded[e.candidate_id] = {
          responses: e.hr_screening.responses || {},
          comment: e.hr_screening.comment || "",
          selected: e.hr_screening.selected_questions || [],
          // What the candidate said out loud for the number/yes-no questions,
          // whose field only holds the figure parsed out of it.
          heard: e.hr_screening.heard || {},
        };
        reviewed.push(e.candidate_id);
      }
    });
    if (reviewed.length > 0) {
      setScreeningData((prev) => ({ ...seeded, ...prev }));
      setReviewedCandidates((prev) => new Set([...prev, ...reviewed]));
    }
  }, [evaluations]);

  // Initialize ai_decision for any evaluations that don't have it yet
  useEffect(() => {
    const needsInit = evaluations.some((e) => !e.ai_decision);
    if (needsInit) {
      appState.setEvaluations(
        evaluations.map((e) => ({
          ...e,
          ai_decision: e.ai_decision || e.shortlist_decision,
        }))
      );
    }
  }, [evaluations.length]); // Only run when count changes

  // Prefer the LLM-extracted JD rubric (clean, HR-relevant skills only).
  // Fall back to raw-text tokenization if the rubric isn't available.
  const jdWordCloud = useMemo(
    () => (jdRubric ? buildWordCloudFromRubric(jdRubric, jdText) : extractWordsFromJD(jdText)),
    [jdRubric, jdText]
  );

  // Calculate match counts for each word
  const wordMatchCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    jdWordCloud.forEach((item) => {
      counts[item.word] = countMatchesForWord(evaluations, item.word);
    });
    return counts;
  }, [jdWordCloud, evaluations]);

  

  const filtered = useMemo(() => {
    let result = evaluations;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) =>
        c.candidate_name.toLowerCase().includes(q) ||
        c.candidate_id.toLowerCase().includes(q)
      );
    }

    if (selectedWords.length > 0) {
      result = result.filter((c) => candidateMatchesWords(c, selectedWords, filterMode));
    }

    if (decisionFilter) {
      // Screened only, to match the pipeline segment that sets this: clicking a
      // segment counting 1 must not list every un-screened row whose score
      // happens to default to the same decision.
      result = result.filter(
        (c) => c.shortlist_decision === decisionFilter && reviewedCandidates.has(c.candidate_id)
      );
    }

    // The "Ready for HR screening" tile — the rows whose decision button still
    // reads "HR Screening", which is exactly the set that tile counts.
    if (pendingScreeningOnly) {
      result = result.filter((c) => !reviewedCandidates.has(c.candidate_id));
    }

    if (expRange) {
      // Unknown experience never matches an explicit range.
      result = result.filter(
        (c) =>
          c.years_experience !== undefined &&
          c.years_experience >= expRange[0] &&
          c.years_experience <= expRange[1]
      );
    }

    return result.sort((a, b) => {
      const priority: Record<string, number> = { Interview: 0, "On Hold": 1, Rejected: 2 };
      const pa = priority[a.shortlist_decision] !== undefined ? priority[a.shortlist_decision] : 99;
      const pb = priority[b.shortlist_decision] !== undefined ? priority[b.shortlist_decision] : 99;
      if (pa !== pb) return pa - pb;
      return b.overall_match_score - a.overall_match_score;
    });
  }, [evaluations, search, selectedWords, filterMode, expRange, decisionFilter, pendingScreeningOnly, reviewedCandidates]);

  // Slider bounds come from the data — rounded up, and never smaller than 10
  // so the track doesn't collapse when everyone is a fresher.
  const expMax = useMemo(() => {
    const highest = Math.max(0, ...evaluations.map((c) => c.years_experience ?? 0));
    return Math.max(10, Math.ceil(highest));
  }, [evaluations]);

  const unknownExpCount = useMemo(
    () => evaluations.filter((c) => c.years_experience === undefined).length,
    [evaluations]
  );

  const [expLow, expHigh] = expRange ?? [0, expMax];

  function setExpBound(which: 0 | 1, value: number) {
    const next: [number, number] = expRange ? [...expRange] : [0, expMax];
    next[which] = value;
    // Keep the thumbs from crossing.
    if (next[0] > next[1]) next[which === 0 ? 1 : 0] = value;
    setExpRange(next);
  }

  // The pipeline: how the *screened* cohort splits across the three outcomes.
  // Segment widths are the real proportions, so the bar reads as the shape of
  // the shortlist rather than as decoration.
  //
  // Only candidates HR has actually screened are counted — the rows whose
  // decision button reads a decision. Everyone else's button reads "HR
  // Screening", and counting their score-derived default here put candidates
  // nobody had opened under "Selected for R1". They belong to the "Ready for HR
  // screening" tile above instead.
  //
  // Percentages are of the **screened** set, not the cohort, so the bar fills
  // its whole width — a bar with a permanent grey tail read as broken.
  const pipeline = useMemo(() => {
    const stages = [
      { id: "Interview", label: decisionLabel("Interview"), color: decisionColor.Interview },
      { id: "On Hold", label: "On Hold", color: decisionColor["On Hold"] },
      { id: "Rejected", label: "Rejected", color: decisionColor.Rejected },
    ];
    const screened = evaluations.filter((e) => reviewedCandidates.has(e.candidate_id));
    const total = screened.length || 1;
    const counts = stages.map((s) => ({
      ...s,
      count: screened.filter((e) => e.shortlist_decision === s.id).length,
      of: screened.length,
    }));
    // Largest segment absorbs the rounding, so the widths always total exactly
    // 100 — three rounded thirds otherwise leave a 1% sliver of track showing.
    const pcts = counts.map((s) => Math.round((s.count / total) * 100));
    const widest = pcts.indexOf(Math.max(...pcts));
    if (screened.length > 0) {
      pcts[widest] += 100 - pcts.reduce((a, b) => a + b, 0);
    }
    return counts.map((s, i) => ({ ...s, pct: pcts[i] }));
  }, [evaluations, reviewedCandidates]);

  // Every cohort-level number on this page comes from here (lib/insights.ts).
  const insights = useMemo(() => buildInsights(evaluations), [evaluations]);

  /** Candidates whose decision button still reads "HR Screening". */
  const pendingScreeningCount = useMemo(
    () => evaluations.filter((c) => !reviewedCandidates.has(c.candidate_id)).length,
    [evaluations, reviewedCandidates]
  );

  /** Candidates whose call has actually been graded — the comprehensive view's n. */
  const gradedCallCount = useMemo(
    () => evaluations.filter((c) => c.interview_scores?.status === "done").length,
    [evaluations]
  );

  /**
   * JD skills ranked by how much of the pool actually has them, scarcest
   * first — the row a hiring manager can act on ("nobody has Kubernetes:
   * relax it, train for it, or source differently").
   *
   * Counts come from `wordMatchCounts`, not from insights, so the skills/broad
   * scope toggle keeps working exactly as it did for the chips. Clicking a bar
   * toggles the same `selectedWords` filter.
   */
  /**
   * One derivation feeding both views of the skills card. The cloud keeps the
   * JD's own ordering (emphasis) and the ranked list re-sorts by coverage —
   * same chips, same click target, same filter.
   */
  const skillChips: SkillChip[] = useMemo(() => {
    const total = evaluations.length || 1;
    return jdWordCloud.map((item) => {
      const have = wordMatchCounts[item.word] || 0;
      const pct = Math.round((have / total) * 100);
      return {
        word: item.word,
        weight: item.count,
        have,
        total: evaluations.length,
        pct,
        category: item.category,
        scarce: pct < 25,
      };
    });
  }, [jdWordCloud, wordMatchCounts, evaluations.length]);

  const coverageRows = useMemo(
    () =>
      [...skillChips]
        .sort((a, b) => a.pct - b.pct || a.word.localeCompare(b.word))
        .map((c) => ({
          key: c.word,
          label: c.word,
          value: c.pct,
          caption: c.have + " / " + c.total,
          scarce: c.scarce,
          flagged: c.scarce,
        })),
    [skillChips]
  );

  const scarceCount = coverageRows.filter((r) => r.scarce).length;

  /**
   * Mean requirement coverage across the JD. Read together with the median
   * score this catches the trap in the scoring model: `similarity_score` is
   * embedding cosine similarity, which stays high for any professional resume
   * and does NOT mean the candidate has the skills. A pool can sit at 80%
   * "match" while meeting none of the requirements — the caller needs telling.
   */
  const meanCoverage = useMemo(
    () =>
      coverageRows.length === 0
        ? 0
        : Math.round(coverageRows.reduce((sum, r) => sum + r.value, 0) / coverageRows.length),
    [coverageRows]
  );

  const scoreOverstatesFit = meanCoverage < 20 && insights.medianScore >= SCORE_THRESHOLDS.hold;

  /**
   * Queue AI screening calls for every ticked candidate.
   *
   * No question list is sent: there is no open modal to read ticks from, so
   * each candidate gets every question that applies to them, which the backend
   * works out per resume (the employment gate, the WFH rule).
   *
   * Candidates whose number is undialable come back with an error and are
   * simply not queued — one bad CV must not block the rest of the batch.
   */
  async function handleCallSelected() {
    if (bulkCalling || selectedForCall.size === 0) return;
    setBulkCalling(true);
    setBulkNotice("");
    try {
      const results = await startBulkInterviews([...selectedForCall]);
      const failed: string[] = [];
      let queued = 0;
      for (const result of results) {
        if (result.session_id) queued += 1;
        else failed.push(nameOf(result.resume_uuid));
      }
      setSelectedForCall(new Set());
      setBulkNotice(
        `${queued} call${queued === 1 ? "" : "s"} queued — they are placed one at a time.` +
        (failed.length ? ` Skipped ${failed.join(", ")}: no usable phone number.` : "")
      );
      // The rows now carry a session id, so re-read them: that is what reveals
      // Play recording and the transcript once each call lands.
      if (selectedJd) {
        try {
          const session = await loadSession(selectedJd);
          if (session) appState.setEvaluations(session.evaluations);
        } catch (err) {
          // A refresh that fails does not undo the calls we just queued.
          console.warn("[Dashboard] refresh after bulk call failed:", err);
        }
      }
      // Only now: the poll marks rows by session id, and the reload above is
      // what puts those ids on the rows.
      setCallNonce((n) => n + 1);
    } catch (err) {
      console.warn("[Interview] bulk call failed:", err);
      setBulkNotice(err instanceof Error ? err.message : "The calls could not be queued.");
    } finally {
      setBulkCalling(false);
    }
  }

  const nameOf = (resumeUuid: string) =>
    evaluations.find((e) => e.candidate_id === resumeUuid)?.candidate_name || resumeUuid;

  function toggleForCall(candidateId: string) {
    setSelectedForCall((prev) => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  }

  function clearAllFilters() {
    setSelectedWords([]);
    setExpRange(null);
    setDecisionFilter(null);
    setPendingScreeningOnly(false);
    setSearch("");
  }

  /** Every filter currently narrowing the table, each individually removable. */
  const activeFilters = useMemo(() => {
    const list: { label: string; clear: () => void }[] = [];
    if (decisionFilter) {
      list.push({ label: decisionLabel(decisionFilter), clear: () => setDecisionFilter(null) });
    }
    if (pendingScreeningOnly) {
      list.push({ label: "Ready for HR screening", clear: () => setPendingScreeningOnly(false) });
    }
    selectedWords.forEach((w) =>
      list.push({ label: w, clear: () => setSelectedWords((prev) => prev.filter((x) => x !== w)) })
    );
    if (expRange) {
      list.push({ label: expRange[0] + "–" + expRange[1] + " yrs", clear: () => setExpRange(null) });
    }
    if (search.trim()) {
      list.push({ label: '"' + search.trim() + '"', clear: () => setSearch("") });
    }
    return list;
  }, [decisionFilter, pendingScreeningOnly, selectedWords, expRange, search]);

  function toggleWord(word: string) {
    setSelectedWords((prev) =>
      prev.includes(word) ? prev.filter((w) => w !== word) : [...prev, word]
    );
  }

  if (evaluations.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full text-center">
        {restoring ? (
          <div className="w-full max-w-xs">
            <p className="text-[15px] font-semibold text-foreground mb-3">Loading your last screening</p>
            <ProgressBar label="Fetching candidates" />
          </div>
        ) : currentJd ? (
          <>
            {/* A real JD with nothing screened against it yet. The switcher and
                Add Resumes stay, so picking an empty JD is a place to work from
                rather than a dead end. */}
            <Users size={52} className="text-muted-foreground/30 mb-4" />
            <p className="text-[26px] font-semibold text-foreground tracking-[-0.015em]">
              No resumes yet for {currentJd.job_name || currentJd.source}
            </p>
            {/* The requisition on its own line, the action on the next — one
                run-on sentence buried the thing HR is here to do. */}
            {(currentJd.job_code || currentJd.primary_location) && (
              <p className="text-[17px] text-muted-foreground mt-2">
                {currentJd.job_code ? <span className="numeral">{currentJd.job_code}</span> : null}
                {currentJd.job_code && currentJd.primary_location ? " · " : ""}
                {currentJd.primary_location}
              </p>
            )}
            <p className="text-[17px] text-muted-foreground mt-2 max-w-md leading-relaxed">
              Add resumes to see analysis on dashboard
            </p>
            <div className="flex items-end gap-3 mt-6">
              {jds.length > 1 && (
                <div className="flex flex-col items-start gap-1">
                  <label htmlFor="jd-switcher-empty" className="eyebrow-lg">Job description</label>
                  <JdPicker
                    id="jd-switcher-empty"
                    jds={jds}
                    value={selectedJd}
                    onChange={handleSelectJd}
                    disabled={switchingJd}
                  />
                </div>
              )}
              <label
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-xl text-[17px] font-semibold text-white transition-all active:scale-95",
                  uploadingMore ? "opacity-60 cursor-wait" : "cursor-pointer hover:opacity-90"
                )}
                style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}
              >
                {uploadingMore ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} />}
                {uploadingMore ? "Analyzing…" : "Add Resumes"}
                <input
                  type="file"
                  accept=".pdf,.docx,.ppt,.pptx"
                  multiple
                  disabled={uploadingMore}
                  className="hidden"
                  onChange={(e) => { handleUploadMore(e.target.files); e.target.value = ""; }}
                />
              </label>
            </div>
            {uploadingMore && (
              <ProgressBar overlay label={analyzingLabel(uploadCount, uploadStep)} percent={uploadStep?.percent} />
            )}
            {uploadMoreError ? (
              <p className="text-[13px] text-[var(--danger)] mt-3 max-w-xs">{uploadMoreError}</p>
            ) : null}
          </>
        ) : (
          <>
            {/* This is the first screen after login, so it has to explain the
                starting point rather than assume one. The button carries the
                same name as the page it opens. */}
            <Users size={52} className="text-muted-foreground/30 mb-4" />
            <p className="text-[26px] font-semibold text-foreground tracking-[-0.015em]">No candidates yet</p>
            <p className="text-[17px] text-muted-foreground mt-2 max-w-md leading-relaxed">
              Start with a Job Description, then add resumes to screen against it. The
              ranked shortlist lands here.
            </p>
            <a
              href="/upload"
              className="mt-6 flex items-center gap-2 px-6 py-3 rounded-xl text-[17px] font-semibold text-white transition-all active:scale-95"
              style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}
            >
              <Upload size={18} />Upload JD
            </a>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 bg-background min-h-full relative">
      {/* The page title block (eyebrow, job name, job code · location · count)
          was removed on request — the JD switcher already names the job being
          worked on, and the top nav carries the app identity. */}
      {/* The requisition bar — shared with Collective analysis, which shows the
          same JD, the same two controls and the same export. It carries its own
          progress bar and upload-failure notice, because both belong to the
          button that caused them. */}
      {/* The calendar of every call made and still to come sits beside Export:
          a side errand like it, and Dashboard-only (Collective analysis is
          figures, not a diary). */}
      <JdBar onSwitched={() => setSelectedWords([])} actions={<CallCalendar />} />

      {/* What the last batch of calls did, including anyone it could not dial.
          A skipped candidate has to be said out loud: the batch otherwise looks
          like a clean run and nobody notices the missing call. */}
      {bulkNotice && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-border bg-secondary/50 rise">
          <PhoneCall size={13} className="mt-0.5 flex-shrink-0 text-[var(--brand)]" />
          <p className="text-[15px] text-foreground/90 flex-1">{bulkNotice}</p>
          <button
            onClick={() => setBulkNotice("")}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* What a hiring manager needs in one glance: who to act on, whether the
          pool is any good, what is blocking it, and what HR still owes. The
          caption under each figure was removed on request — the label and the
          number are the tile. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 rise" style={{ animationDelay: "60ms" }}>
        {/* Counts exactly the rows whose decision button still reads "HR
            Screening", so the tile and the table can never disagree. */}
        <StatTile
          label="Ready for HR screening"
          value={pendingScreeningCount}
          tone="interview"
          active={pendingScreeningOnly}
          onClick={() => setPendingScreeningOnly((v) => !v)}
        />
        <StatTile
          label="Median match"
          value={insights.medianScore + "%"}
          tone={scoreOverstatesFit || insights.medianScore < SCORE_THRESHOLDS.hold ? "hold" : "neutral"}
        />
        <StatTile
          label="Scarce Skills"
          value={scarceCount}
          tone={scarceCount > 0 ? "hold" : "neutral"}
        />
        <StatTile
          label="Flagged for risk"
          value={insights.atRisk}
          tone={insights.atRisk > 0 ? "hold" : "neutral"}
        />
      </div>

      {/* Pipeline — one bar, segment widths are the real proportions of the
          cohort. Clicking a stage filters the table to it. */}
      <div className="bg-card border border-border rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2.5">
          {/* Removed on request: the "n awaiting HR screening" note that used to
              sit beside this title. The tile above already counts them. */}
          <p className="eyebrow-lg">
            Pipeline
          </p>
          {decisionFilter && (
            <button
              onClick={() => setDecisionFilter(null)}
              className="text-[11px] font-semibold text-muted-foreground hover:text-[var(--brand)] transition-colors"
            >
              Show all
            </button>
          )}
        </div>

        {/* The 2px gap is the app's chart spacer — the same one separating the
            segments of a stacked column on Collective analysis. */}
        <div className="flex h-9 rounded-lg overflow-hidden bg-secondary gap-[2px]">
          {pipeline.map(function (s) {
            if (s.count === 0) return null;
            const isDimmed = decisionFilter !== null && decisionFilter !== s.id;
            return (
              <button
                key={s.id}
                onClick={() => setDecisionFilter(decisionFilter === s.id ? null : s.id)}
                title={s.label + ": " + s.count + " of " + s.of + " screened"}
                className={cn(
                  "flex items-center justify-center transition-all duration-300 hover:brightness-110",
                  isDimmed ? "opacity-25" : "opacity-100"
                )}
                style={{ width: s.pct + "%", background: s.color, color: decisionInk[s.id] }}
              >
                <span className="numeral text-[13px] font-bold px-1 truncate">
                  {s.pct >= 12 ? s.count + " " + s.label : s.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4 mt-2.5 flex-wrap">
          {pipeline.map(function (s) {
            const isActive = decisionFilter === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setDecisionFilter(isActive ? null : s.id)}
                disabled={s.count === 0}
                className={cn(
                  "flex items-center gap-1.5 text-[13px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                  isActive ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {/* A rect, because it keys a bar. Dots key lines. */}
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                {s.label}
                <span className="numeral font-semibold text-foreground">{s.count}</span>
                <span className="numeral text-muted-foreground">({s.pct}%)</span>
              </button>
            );
          })}
        </div>
      </div>

      {jdWordCloud.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              {/* The explainer line under this heading was removed on request. */}
              <p className="eyebrow-lg">
                Skills in this job description
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Cloud vs ranked list — same chips, same filter, two readings
                  of them. The cloud answers "what does this JD care about",
                  the list answers "what can't I find". */}
              <div className="flex items-center bg-secondary rounded-lg p-1">
                {([["cloud", "Word Cloud"], ["ranked", "Chart"]] as const).map(([view, label]) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => setSkillView(view)}
                    className={cn(
                      "text-[15px] font-semibold px-3.5 py-1.5 rounded-md transition-all",
                      skillView === view
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center bg-secondary rounded-lg p-0.5">
                {(["and", "or"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setFilterMode(mode)}
                    className={cn(
                      "text-[15px] font-semibold px-3.5 py-1.5 rounded-md transition-all uppercase",
                      filterMode === mode
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              {/* The skills/broad scope toggle was removed on request — matching
                  always runs over matched + transferable skills. */}
              {/* No "clear" here — every active filter is listed and removable
                  in one place above the candidates table. */}
            </div>
          </div>

          {/* Ranked bars, scarcest first. The chip cloud sized words by how
              often the JD said them — emphasis, not supply — and no two chips
              could be compared. A sorted bar answers "what is hard to find"
              directly, and the amber bars are the shortage. */}
          {skillView === "cloud" ? (
            <div className="rounded-xl bg-secondary/40 border border-border/60 p-4">
              <SkillCloud
                chips={showAllSkills ? skillChips : skillChips.slice(0, 24)}
                selected={selectedWords}
                onToggle={toggleWord}
              />
            </div>
          ) : (
            /* A long JD can carry 30+ skills; showing them all buries the few
               that matter. The scarcest are the ones worth acting on. */
            <BarList
              rows={showAllSkills ? coverageRows : coverageRows.slice(0, 12)}
              onRowClick={toggleWord}
              selected={selectedWords}
              emptyLabel="No skills extracted from this job description."
            />
          )}

          {(skillView === "cloud" ? skillChips.length > 24 : coverageRows.length > 12) && (
            <button
              onClick={() => setShowAllSkills((v) => !v)}
              className="mt-2 text-[13px] font-semibold transition-colors hover:opacity-80"
              style={{ color: "var(--brand)" }}
            >
              {showAllSkills
                ? "Show fewer"
                : "Show all " + skillChips.length + " skills"}
            </button>
          )}

          {scoreOverstatesFit && (
            <div
              className="flex items-start gap-2 mt-3 px-3 py-2.5 rounded-xl border"
              style={{ background: "var(--decision-hold-wash)", borderColor: "var(--decision-hold)" }}
            >
              <AlertTriangle size={14} className="text-[var(--decision-hold)] mt-0.5 flex-shrink-0" />
              <p className="text-[13px] leading-snug text-foreground">
                <span className="font-semibold">Scores are running ahead of the evidence.</span>{" "}
                The median match is {insights.medianScore}% but candidates meet only {meanCoverage}% of
                the listed requirements on average. Match score measures how similar a resume reads to
                the JD, not whether the skills are actually there — screen these manually before
                shortlisting.
              </p>
            </div>
          )}

          {/* Legend: one entry per visual channel, so nothing on the chip is
              carried by colour alone. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-border">
            {(["tech", "soft", "other"] as const).map((cat) => (
              <span key={cat} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {/* 2.5px rect, the same key every chart legend in the app uses:
                    the swatch mirrors the mark, and a chip is a rectangle. */}
                <span
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ background: `var(--cat-${cat})` }}
                />
                {CATEGORY_LABEL[cat]}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <AlertTriangle size={11} className="text-[var(--decision-hold)] flex-shrink-0" />
              Scarce — under 25% of the pool has it
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {/* The numerator was hardcoded to 3, so a one-candidate pool read
                  "3/1" — an impossible figure sitting beside real ones. */}
              <span className="rounded-full px-1.5 py-px text-[11px] font-bold leading-none bg-secondary text-foreground tabular-nums">
                {Math.min(3, evaluations.length)}/{evaluations.length}
              </span>
              Candidates with the skill
            </span>
          </div>
        </div>
      )}

      {/* Both distributions behind one collapsed bar, on request — they were two
          cards that each had to be opened. Side by side once expanded, so the
          shape of the scores and the shape of the seniority read together. */}
      <ChartPanel title="Score distribution & experience mix">
        {/* Both charts on one baseline: each column opens with a fixed-height
            header row and both histograms are the same height, so the bars,
            the axes and the footnotes line up across the pair. Without that the
            view toggle pushed the left chart down and the two read as unrelated
            blocks at different scales. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6 items-start">
          <div className="min-w-0">
            {/* Two views of the same pool, so the shapes can be compared: strong
                on paper is not the same set of people as strong on the phone.
                Only graded calls appear in the comprehensive view, so its total
                is smaller — the empty state says so rather than showing a flat
                chart that reads as "everyone scored zero". */}
            <div className="flex items-center justify-between gap-3 h-7 mb-3">
              <p className="eyebrow truncate">
                {scoreView === "resume" ? "Candidate score" : "Comprehensive score"}
              </p>
              <div className="flex gap-1 flex-shrink-0">
                {(["resume", "comprehensive"] as const).map(function (view) {
                  const active = scoreView === view;
                  return (
                    <button
                      key={view}
                      onClick={() => setScoreView(view)}
                      className={cn(
                        "text-[15px] font-semibold px-3.5 py-1.5 rounded-lg transition-colors capitalize",
                        active
                          ? "bg-[var(--brand)] text-white"
                          : "bg-secondary text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {view}
                    </button>
                  );
                })}
              </div>
            </div>

            {scoreView === "comprehensive" && gradedCallCount === 0 ? (
              <p className="text-[13px] text-muted-foreground text-center" style={{ height: 88 }}>
                No calls graded yet — run an AI phone screening to see this.
              </p>
            ) : (
              <Histogram
                bins={scoreView === "resume" ? insights.scoreBins : insights.communicationBins}
                barColor={(b) => scoreColor(b.from)}
              />
            )}
            {/* Only the denominator survives here: what one bar is was plain
                enough from the axis, but "graded" covers fewer people than the
                table does, and that is not visible from the chart. */}
            {scoreView === "comprehensive" && gradedCallCount > 0 && (
              <p className="text-[11px] text-muted-foreground mt-2">
                {`${gradedCallCount} of ${evaluations.length} candidate${evaluations.length === 1 ? "" : "s"} called and graded`}
              </p>
            )}
          </div>

          {/* Seniority mix — shape only. Its range slider sits directly above
              the candidate table, next to the rows it filters. */}
          <div className="min-w-0">
            <div className="flex items-center h-7 mb-3">
              <p className="eyebrow truncate">Experience mix, in years</p>
            </div>
            <Histogram bins={insights.experienceBins} />

            {unknownExpCount > 0 && (
              <p className="text-[11px] text-muted-foreground mt-2">
                {`${unknownExpCount} without extracted experience, re-upload to include ${unknownExpCount > 1 ? "them" : "it"}`}
              </p>
            )}
          </div>
        </div>
      </ChartPanel>

      {/* The cohort as one set of figures used to sit here. It is its own page
          now — Collective analysis in the nav — because it answers a different
          question from this one: "what is this pool worth and what did it cost"
          rather than "who is this person". Both read the same `evaluations`. */}

      <div className="bg-card border border-border rounded-2xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="eyebrow-lg">
              Candidate Analysis
            </p>
            {/* "Ranked by decision, then match score" was removed on request.
                The count only appears while something is filtering the table. */}
            {filtered.length !== evaluations.length && (
              <p className="text-[13px] text-foreground mt-0.5">
                Showing {filtered.length} of {evaluations.length}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Sits with Search rather than with Export: both act on the rows
                below, while Export is a side errand. To the *left* of Search,
                so appearing and disappearing with the tick count does not shove
                the search box sideways under the cursor. Only appears once
                something is ticked — an always-visible "Call 0 candidates" is a
                dead control, and this one places real phone calls, so it should
                not sit there invitingly at rest. */}
            {/* Which voice the batch is dialed in. Only next to Call — a
                voice picker beside "Delete selected" is noise. Same control
                and same remembered choice as the HR modal's. */}
            {selectedForCall.size > 0 && bulkAction === "call" && (
              <VoicePicker disabled={busyWithSelection} />
            )}
            {selectedForCall.size > 0 && (
              <div className="relative flex items-center">
                {/* Split button: the label runs the chosen action, the chevron
                    changes which one it is. Delete is styled in --danger the
                    moment it is picked, so the control never looks the same
                    for "call these people" and "erase these people". */}
                <button
                  type="button"
                  onClick={bulkAction === "call" ? handleCallSelected : handleDeleteSelected}
                  disabled={busyWithSelection}
                  title={
                    bulkAction === "call"
                      ? "Queue AI screening calls for the ticked candidates — placed one at a time"
                      : "Permanently delete the ticked candidates and their resumes"
                  }
                  className={cn(
                    "flex items-center justify-center gap-2 h-[42px] pl-4 pr-3 rounded-l-lg text-[15px] font-semibold border transition-all active:scale-95 disabled:opacity-60",
                    bulkAction === "call"
                      ? "border-[var(--brand)]/40 text-[var(--brand)] hover:bg-[var(--brand-wash)]"
                      : "border-[var(--danger)]/40 text-[var(--danger)] hover:bg-[var(--danger-wash)]"
                  )}
                >
                  {busyWithSelection
                    ? <Loader2 size={15} className="animate-spin" />
                    : bulkAction === "call" ? <PhoneCall size={15} /> : <Trash2 size={15} />}
                  <span className="w-[8.5rem] text-left">
                    {bulkCalling
                      ? "Queueing…"
                      : bulkDeleting
                        ? "Deleting…"
                        : `${bulkAction === "call" ? "Call" : "Delete"} selected (${selectedForCall.size})`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setBulkMenuOpen((open) => !open)}
                  disabled={busyWithSelection}
                  aria-haspopup="menu"
                  aria-expanded={bulkMenuOpen}
                  aria-label="Choose what to do with the selected candidates"
                  className={cn(
                    "flex items-center justify-center h-[42px] w-9 rounded-r-lg border border-l-0 transition-all active:scale-95 disabled:opacity-60",
                    bulkAction === "call"
                      ? "border-[var(--brand)]/40 text-[var(--brand)] hover:bg-[var(--brand-wash)]"
                      : "border-[var(--danger)]/40 text-[var(--danger)] hover:bg-[var(--danger-wash)]"
                  )}
                >
                  <ChevronDown size={15} className={cn("transition-transform", bulkMenuOpen && "rotate-180")} />
                </button>

                {bulkMenuOpen && (
                  <>
                    {/* Click-away layer. Without it the menu can only be closed
                        by picking something, which on a destructive menu means
                        the only exit is an action. */}
                    <div className="fixed inset-0 z-10" onClick={() => setBulkMenuOpen(false)} />
                    <div
                      role="menu"
                      className="absolute left-0 right-0 top-full mt-1 z-20 rounded-lg border border-border bg-card shadow-lg overflow-hidden"
                    >
                      {([
                        { value: "call", label: "Call selected", hint: "Queue AI screening calls", Icon: PhoneCall },
                        { value: "delete", label: "Delete selected", hint: "Removes resumes permanently", Icon: Trash2 },
                      ] as const).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="menuitem"
                          onClick={() => { setBulkAction(option.value); setBulkMenuOpen(false); }}
                          className={cn(
                            "w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-secondary transition-colors",
                            option.value === "delete" ? "text-[var(--danger)]" : "text-foreground",
                            bulkAction === option.value && "bg-secondary"
                          )}
                        >
                          <option.Icon size={15} className="mt-0.5 flex-shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-[15px] font-semibold">{option.label}</span>
                            <span className="block text-[11px] text-muted-foreground">{option.hint}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                placeholder="Search name…"
                value={search}
                onChange={function (e) { setSearch(e.target.value); }}
                className="pl-9 pr-3 h-[42px] text-[15px] bg-secondary border border-border rounded-lg focus:outline-none focus:border-[var(--brand)] w-56"
              />
            </div>
          </div>
        </div>

        {/* One place that shows every filter in force, each removable on its
            own. Previously a clear button sat on the skills card, another on
            the pipeline, and a third in the empty state — none of them aware
            of the others. */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-[11px] font-medium text-muted-foreground">Filtered by</span>
            {activeFilters.map((f) => (
              <button
                key={f.label}
                onClick={f.clear}
                title={"Remove filter: " + f.label}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md text-white transition-all hover:opacity-85 active:scale-95"
                style={{ background: "var(--brand)" }}
              >
                {f.label}
                <X size={10} />
              </button>
            ))}
            {activeFilters.length > 1 && (
              <button
                onClick={clearAllFilters}
                className="text-[11px] font-semibold px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Experience filter, sitting on the table it narrows. Two native range
            inputs stacked on one track — the filled span between the thumbs is
            the selection. */}
        <div className="flex items-center gap-3 mb-3">
          <span className="eyebrow-lg flex-shrink-0">Experience</span>
          <div className="relative h-6 flex items-center flex-1 min-w-[140px]">
            <div className="absolute left-0 right-0 h-1.5 rounded-full" style={{ background: "var(--chart-track)" }} />
            <div
              className="absolute h-1.5 rounded-full"
              style={{
                left: (expLow / expMax) * 100 + "%",
                right: 100 - (expHigh / expMax) * 100 + "%",
                background: "linear-gradient(135deg, var(--brand), var(--brand-strong))",
              }}
            />
            <input
              type="range"
              min={0}
              max={expMax}
              step={1}
              value={expLow}
              onChange={(e) => setExpBound(0, Number(e.target.value))}
              aria-label="Minimum years of experience"
              className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--brand)] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer"
            />
            <input
              type="range"
              min={0}
              max={expMax}
              step={1}
              value={expHigh}
              onChange={(e) => setExpBound(1, Number(e.target.value))}
              aria-label="Maximum years of experience"
              className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--brand)] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer"
            />
          </div>
          <span
            className="numeral text-[13px] font-semibold px-2 py-0.5 rounded-md flex-shrink-0"
            style={{ background: "var(--brand-wash)", color: "var(--brand)" }}
          >
            {expRange ? expLow + "–" + expHigh + " yrs" : "Any"}
          </span>
          {expRange && (
            <button
              onClick={() => setExpRange(null)}
              className="text-[11px] font-semibold text-muted-foreground hover:text-[var(--brand)] transition-colors flex-shrink-0"
            >
              Reset
            </button>
          )}
        </div>

        <div className="overflow-visible rounded-xl border border-border">
          <div className="grid grid-cols-[32px_1fr_1fr_1fr_1fr_1fr_1fr_1fr_36px] gap-4 bg-secondary/60 px-4 py-2.5 border-b border-border rounded-t-xl">
            {/* Select-all is over `filtered`, not the whole cohort: it must
                mean what is on screen, or a filter plus a tick would queue
                calls to people HR cannot see. */}
            <button
              onClick={() =>
                setSelectedForCall(
                  filtered.every((c) => selectedForCall.has(c.candidate_id))
                    ? new Set()
                    : new Set(filtered.map((c) => c.candidate_id))
                )
              }
              title="Select all candidates currently listed"
              aria-label="Select all listed candidates"
              className="text-[var(--brand)] hover:opacity-80 transition-opacity flex items-center"
            >
              {filtered.length > 0 && filtered.every((c) => selectedForCall.has(c.candidate_id))
                ? <CheckSquare size={15} />
                : <Square size={15} />}
            </button>
            {["Name", "Resume score", "Green flags", "Red flags", "Comprehensive score", "Joining scope", "Decision"].map(function (h) {
              // Left-aligned in every column, including the action one.
              return <p key={h} className="eyebrow-lg text-left">{h}</p>;
            })}
            {/* The delete column is a bare icon with no header, so the width it
                used to spend on the word "Remove" goes to the content columns.
                The row's own button carries the tooltip and aria-label. */}
            <span />
          </div>

          {/* The 60/75 scale key above the Match column, and the two threshold
              ticks inside each ruler, were both removed on request. */}
          {filtered.map(function (c, i) {
            const summaryLines = buildDecisionSummary(c);
            return (
              <div key={c.candidate_id} className={cn(i < filtered.length - 1 ? "border-b border-border" : "")}>
              <div className="grid grid-cols-[32px_1fr_1fr_1fr_1fr_1fr_1fr_1fr_36px] gap-4 items-center px-4 py-3.5 hover:bg-secondary/30 transition-colors relative">
                <button
                  onClick={() => toggleForCall(c.candidate_id)}
                  title="Include this candidate in the next batch of AI screening calls"
                  aria-label={`Select ${c.candidate_name} for an AI screening call`}
                  className="text-[var(--brand)] hover:opacity-80 transition-opacity flex items-center"
                >
                  {selectedForCall.has(c.candidate_id) ? <CheckSquare size={15} /> : <Square size={15} />}
                </button>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}>
                    {initialsOf(c.candidate_name)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                    {/* The name is the way into the resume itself — same rule as
                        the HR modal's View resume: a link only when the backend
                        kept the file, plain text otherwise, so it never opens a
                        tab on a 404. */}
                    {c.resume_url ? (
                      <a
                        href={c.resume_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open this candidate's resume in a new tab"
                        className="block text-[13px] font-semibold text-foreground truncate hover:text-[var(--brand)] hover:underline"
                      >
                        {c.candidate_name}
                      </a>
                    ) : (
                      <p className="text-[13px] font-semibold text-foreground truncate" title="The original file for this resume was not kept">
                        {c.candidate_name}
                      </p>
                    )}
                    {/* The resume, same target as the name beside it — the name
                        reads as text, this eye is the explicit "open it"
                        affordance. It sits at the end of the name, greyed out
                        when the backend never kept the file. The JD has its own
                        i, up by the switcher. */}
                    {c.resume_url ? (
                      <a
                        href={c.resume_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open this candidate's resume in a new tab"
                        aria-label="View resume"
                        className="flex-shrink-0 text-muted-foreground hover:text-[var(--brand)] transition-colors"
                      >
                        <Eye size={13} />
                      </a>
                    ) : (
                      <span
                        title="The original file for this resume was not kept"
                        className="flex-shrink-0 text-muted-foreground/30"
                      >
                        <Eye size={13} />
                      </span>
                    )}
                    </div>
                    {c.years_experience !== undefined && (
                      <p className="text-[11px] text-muted-foreground">
                        {c.years_experience === 0
                          ? "Fresher"
                          : c.years_experience + " yr" + (c.years_experience > 1 ? "s" : "") + " exp"}
                      </p>
                    )}
                  </div>
                </div>
                {/* The bar was removed on request — the number alone, matching
                    how the comprehensive score beside it reads. */}
                <div className="flex items-baseline gap-1">
                  <span className="text-[17px] font-bold tabular-nums text-foreground">
                    {c.overall_match_score}
                  </span>
                  <span className="text-[11px] text-muted-foreground">/ 100</span>
                </div>

                <div className="flex gap-1.5">
                  {c.green_flags.length === 0 ? (
                    <span className="text-[13px] text-muted-foreground">—</span>
                  ) : (
                    c.green_flags.map(function (reason, j) {
                      return (
                        <div key={j} className="relative group">
                          <CheckCircle2 size={14} className="text-[var(--decision-interview)] cursor-pointer transition-transform hover:scale-110" />
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 opacity-0 invisible translate-y-1 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 transition-all duration-200 z-50 pointer-events-none">
                            <div className="w-[220px] rounded-xl overflow-hidden bg-card border border-border shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)]">
                              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border">
                                <CheckCircle2 size={11} className="text-[var(--decision-interview)] flex-shrink-0" />
                                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--decision-interview)]">Green Flag</p>
                              </div>
                              <p className="text-[11px] text-muted-foreground leading-snug px-3 py-2 text-left">{reason}</p>
                            </div>
                            <div className="w-2.5 h-2.5 bg-card border-r border-b border-border rotate-45 absolute -bottom-[5px] left-1/2 -translate-x-1/2" />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="flex gap-1.5">
                  {c.red_flags_detected.length === 0 ? (
                    <span className="text-[13px] text-muted-foreground">—</span>
                  ) : (
                    c.red_flags_detected.map(function (reason, j) {
                      return (
                        <div key={j} className="relative group">
                          <AlertTriangle size={14} className="text-[var(--decision-hold)] cursor-pointer transition-transform hover:scale-110" />
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 opacity-0 invisible translate-y-1 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 transition-all duration-200 z-50 pointer-events-none">
                            <div className="w-[220px] rounded-xl overflow-hidden bg-card border border-border shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)]">
                              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border">
                                <AlertTriangle size={11} className="text-[var(--decision-hold)] flex-shrink-0" />
                                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--decision-hold)]">Red Flag</p>
                              </div>
                              <p className="text-[11px] text-muted-foreground leading-snug px-3 py-2 text-left">{reason}</p>
                            </div>
                            <div className="w-2.5 h-2.5 bg-card border-r border-b border-border rotate-45 absolute -bottom-[5px] left-1/2 -translate-x-1/2" />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* How the candidate came across on the AI phone screening,
                    graded from the transcript once the call ends. It sits right
                    before the Decision pill on request: the last thing read
                    before deciding. Only a call the candidate actually sat
                    produces a number; someone who asked to be called back reads
                    "Rescheduled", never 0, so scanning the column can't mistake
                    "was busy" for "interviewed badly". */}
                {/* Queue position rides in this cell rather than a tenth
                    column: the cell is empty until a call has been graded
                    anyway, and the table is already wide. */}
                {c.interview_session_id && liveCalls[c.interview_session_id] ? (
                  <CallProgressCell call={liveCalls[c.interview_session_id]} />
                ) : (
                  <ComprehensiveScoreCell scores={c.interview_scores} called={!!c.interview_recording_url} />
                )}

                {/* How likely they are to actually join, from the screening
                    answers — deterministic rules, not a score. It sits beside
                    the Decision pill because that is the question it informs:
                    two candidates who interview alike are not equally worth an
                    offer if one will not relocate. It never sets the decision. */}
                <JoiningCell assessment={c.joining_assessment} />

                {/* Decision pill with multi-line hover summary. min-w-0 so the
                    availability line under it clamps instead of widening the
                    column. */}
                <div className="relative group min-w-0">
                  <button
                    onClick={() => {
                      // Opens for every candidate whatever their current
                      // decision: a status is never final, so putting someone
                      // On Hold or Rejected must not lock HR out of the form
                      // they'd use to move them back.
                      setScreeningCandidate(c);
                      const saved = screeningData[c.candidate_id];
                      setScreeningResponses(saved?.responses || {});
                      setScreeningSelected(saved?.selected || []);
                      setHrComment(saved?.comment || "");
                      setScreeningHeard(saved?.heard || {});
                    }}
                    className="flex items-center gap-1 text-[13px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-all hover:scale-105 active:scale-95"
                    // The pill keeps its decision colour whether or not HR has
                    // reviewed it. Repainting reviewed rows blue broke the
                    // mapping to the pipeline bar — a row counted as "On Hold"
                    // above showed up in a colour that appears nowhere else.
                    // "Reviewed" is a tick inside the pill instead.
                    style={{
                      background: decisionColor[c.shortlist_decision],
                      color: decisionInk[c.shortlist_decision],
                    }}
                  >
                    {reviewedCandidates.has(c.candidate_id) && (
                      <CheckCircle2 size={11} className="flex-shrink-0" aria-label="HR reviewed" />
                    )}
                    {/* A freshly uploaded resume has no HR opinion on it yet, so
                        the pill names the action it opens rather than a decision
                        nobody made. Once HR has screened them it reads as the
                        decision again. */}
                    {reviewedCandidates.has(c.candidate_id)
                      ? decisionLabel(c.shortlist_decision)
                      : "HR Screening"}
                    {c.ai_decision && c.ai_decision !== c.shortlist_decision && (
                      <span className="text-[11px] opacity-80">(HR)</span>
                    )}
                  </button>

                  {/* When they can sit the next round. Every candidate is asked,
                      but it is shown only where it is needed: on a row whose
                      pill reads Selected for R1, by the same test the pill
                      uses (reviewed, and the decision is Interview). */}
                  {reviewedCandidates.has(c.candidate_id) && c.shortlist_decision === "Interview" && (
                    <p
                      className="text-[11px] leading-tight text-muted-foreground mt-1 line-clamp-2"
                      title={c.r1_availability ? "Available for the next round: " + c.r1_availability : undefined}
                    >
                      Available:{" "}
                      {c.r1_availability ? (
                        <span className="font-semibold text-foreground">{c.r1_availability}</span>
                      ) : (
                        "—"
                      )}
                    </p>
                  )}

                  {/* Hover card — light surface, fixed palette so it reads the
                      same in either theme (it floats above the table). */}
                  <div className="absolute bottom-full right-0 mb-2.5 opacity-0 invisible translate-y-1 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 transition-all duration-200 z-50 pointer-events-none">
                    <div className="w-[340px] text-left rounded-2xl overflow-hidden bg-card border border-border shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)]">

                      {/* Header: decision + big score */}
                      <div
                        className="flex items-center justify-between px-4 py-3 border-b border-border"
                        style={{ background: decisionWash[c.shortlist_decision] }}
                      >
                        <div className="min-w-0">
                          <span
                            className="inline-block text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                            style={{
                              background: decisionColor[c.shortlist_decision],
                              color: decisionInk[c.shortlist_decision],
                            }}
                          >
                            {decisionLabel(c.shortlist_decision)}
                          </span>
                          <p className="text-[13px] font-semibold text-foreground truncate mt-1.5">
                            {c.candidate_name}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <p className="text-[21px] font-bold leading-none" style={{ color: decisionColor[c.shortlist_decision] }}>
                            {c.overall_match_score}%
                          </p>
                          <p className="text-[11px] text-muted-foreground uppercase tracking-wide mt-0.5">Match</p>
                        </div>
                      </div>

                      <div className="px-4 py-3 space-y-3">

                        {/* Why the model landed here. buildDecisionSummary was
                            already being computed for every row and then
                            discarded — the reasoning never reached the screen. */}
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {summaryLines[0]}
                        </p>

                        {/* Score bars */}
                        <div className="space-y-1.5">
                          {buildScoreBars(c).map(function (row, idx) {
                            return (
                              <div key={idx} className="flex items-center gap-2">
                                <span className="text-[11px] text-muted-foreground w-[104px] flex-shrink-0 truncate">
                                  {row.label}
                                </span>
                                <div className="flex-1 h-1.5 rounded-full bg-[var(--chart-track)] overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: Math.max(0, Math.min(100, row.value)) + "%",
                                      background: decisionColor[c.shortlist_decision],
                                    }}
                                  />
                                </div>
                                <span className="text-[11px] font-semibold text-foreground w-8 text-right flex-shrink-0">
                                  {row.value}%
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Skill chips */}
                        {c.matched_mandatory_skills.length > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                              Matched Skills
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {c.matched_mandatory_skills.slice(0, 6).map(function (s, i) {
                                return (
                                  <span key={i} className="text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--decision-interview)]/10 text-[var(--decision-interview)] border border-[var(--decision-interview)]/30">
                                    {s}
                                  </span>
                                );
                              })}
                              {c.matched_mandatory_skills.length > 6 && (
                                <span className="text-[11px] text-muted-foreground px-1 py-0.5">
                                  +{c.matched_mandatory_skills.length - 6}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Flags */}
                        {(c.green_flags.length > 0 || c.red_flags_detected.length > 0) && (
                          <div className="flex items-center gap-3 pt-2 border-t border-border">
                            {c.green_flags.length > 0 && (
                              <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--decision-interview)]">
                                <CheckCircle2 size={11} />
                                {c.green_flags.length} green flag{c.green_flags.length > 1 ? "s" : ""}
                              </span>
                            )}
                            {c.red_flags_detected.length > 0 && (
                              <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--decision-hold)]">
                                <AlertTriangle size={11} />
                                {c.red_flags_detected.length} red flag{c.red_flags_detected.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        )}

                        {c.shortlist_decision === "Interview" && (
                          <p className="text-[11px] text-muted-foreground text-center pt-0.5">
                            Click to open HR screening
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="w-2.5 h-2.5 bg-card border-r border-b border-border rotate-45 absolute -bottom-[5px] right-6" />
                  </div>
                </div>

                <button
                  onClick={() => handleDeleteCandidate(c)}
                  disabled={deletingId !== null}
                  title={`Delete ${c.candidate_name}`}
                  aria-label={`Delete ${c.candidate_name}`}
                  className="justify-self-center p-1.5 rounded-lg text-muted-foreground hover:text-[var(--decision-hold)] hover:bg-[var(--danger)]/10 transition-colors disabled:opacity-40"
                >
                  {deletingId === c.candidate_id
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Trash2 size={14} />}
                </button>
              </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="text-[15px] font-semibold text-foreground">No candidates match these filters</p>
              <button
                onClick={clearAllFilters}
                className="text-[13px] font-semibold mt-1.5 transition-colors"
                style={{ color: "var(--brand)" }}
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      </div>

      {screeningCandidate && (
        <HrScreeningModal
          candidate={screeningCandidate!}
          onClose={async () => {
            setScreeningCandidate(null);
            // A call may have been placed in there, and it carries on after the
            // modal shuts — the row is where it shows from here.
            setCallNonce((n) => n + 1);
            // A call placed inside the modal attaches a recording to that
            // candidate, so re-read the JD's resumes on the way out — otherwise
            // the row's play button stays greyed until the next page reload.
            if (!selectedJd) return;
            try {
              const session = await loadSession(selectedJd);
              if (session) appState.setEvaluations(session.evaluations);
            } catch (err) {
              console.warn("[Dashboard] refresh after screening failed:", err);
            }
          }}
          onSave={(candidateId, responses, comment, selectedQuestions, heard) => {
            setReviewedCandidates((prev) => new Set(prev).add(candidateId));
            setScreeningData((prev) => ({
              ...prev,
              [candidateId]: {
                responses,
                comment,
                selected: selectedQuestions,
                heard,
              },
            }));
            setScreeningResponses(responses);
            setScreeningSelected(selectedQuestions);
            setHrComment(comment);
            setScreeningHeard(heard);
          }}
          initialResponses={screeningResponses}
          initialComment={hrComment}
          initialSelectedQuestions={screeningSelected}
          initialHeard={screeningHeard}
          // What this requisition itself answered under the old fixed questions,
          // shown alongside the candidate's answers to them.
          jdAnswers={currentJd?.screening_answers}
          // What the screening flow branches on: the requisition's typed
          // constraints, plus where the job actually is (the relocation branch).
          criteria={currentJd?.role_criteria}
          jobLocation={currentJd?.primary_location || ""}
        />
      )}
    </div>
  );
}
