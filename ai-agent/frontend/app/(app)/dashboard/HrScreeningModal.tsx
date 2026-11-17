"use client";

import { X, FileText, Download, Send, Bot, User, Loader2, CheckSquare, Square, PhoneCall, AlertTriangle, PlayCircle, Volume2, FileDown } from "lucide-react";
import {
  CALL_ENDED,
  callStatusHint,
  callStatusLabel,
  CandidateEvaluation,
  ChatMessage,
  chatWithAI,
  decisionLabel,
  formatCallTime,
  getPhoneInterview,
  interviewUrls,
  JoiningAssessment,
  PhoneInterviewStatus,
  saveScreening,
  startPhoneInterview,
} from "@/lib/api";
import Markdown from "@/components/Markdown";
import VoicePicker from "@/components/VoicePicker";
import { scoreColor, JOINING_STYLE } from "@/components/charts";
import { useAppState } from "@/lib/app-state";
import { SCREENING_QUESTIONS, ScreeningAnswers, parseNumericAnswer, parseYesNo } from "@/lib/screening-questions";
import {
  ASK_ORDER,
  FLOW_INDEX_BASE,
  FLOW_QUESTIONS,
  LEGACY_FLOW_INDEX_BASE,
  LEGACY_FLOW_QUESTIONS,
  RESCHEDULE_INDICES,
  addedSince,
  callableFlow,
  fillFlowQuestion,
  requisitionNote,
  visibleFlow,
} from "@/lib/screening-flow";
import type { RoleCriteria } from "@/lib/role-criteria";
import { useState, useRef, useEffect, useMemo } from "react";

/**
 * Turn a call's transcripts into the two maps the form keeps: `filled` is what
 * goes in the field, `spoken` the sentence the candidate actually said.
 *
 * A number- or yes/no-typed question gets its value parsed out of the sentence,
 * because neither a number input nor a radio pair can render "actually it's
 * quite low, only 4LPA" and the answer would look lost. The sentence is kept and
 * shown under the field, so a miss is always visible and correctable — and a
 * yes/no answer is what the *next* branch reads, which makes getting it wrong
 * quietly worse than for a free-text one.
 */
/**
 * Marks a sentence the candidate volunteered — they were never asked this
 * question and answered it while answering another one.
 *
 * The flag rides on the `heard` string rather than in a map of its own, and
 * `unprompted()` takes it back off at the one place the sentence is rendered.
 * That is deliberate: `heard` is what gets *saved* with the screening, and "we
 * did not ask this, they offered it" is exactly as worth keeping in the record
 * as the sentence itself — whereas a parallel map would have to be threaded
 * through the poll, the form state and the save payload to say the same thing.
 */
const UNPROMPTED = "Mentioned unprompted: ";

function said(answer: PhoneInterviewStatus["answers"][number]): string {
  return answer.volunteered ? UNPROMPTED + answer.transcript : answer.transcript;
}

/** Split a stored `heard` sentence into its flag and the words actually said. */
function unprompted(heard: string): { volunteered: boolean; sentence: string } {
  return heard.startsWith(UNPROMPTED)
    ? { volunteered: true, sentence: heard.slice(UNPROMPTED.length) }
    : { volunteered: false, sentence: heard };
}

function answersFromCall(answers: PhoneInterviewStatus["answers"]) {
  const filled: Record<number, string> = {};
  const spoken: Record<number, string> = {};
  for (const [index, answer] of Object.entries(answers)) {
    if (answer.status !== "done" || !answer.transcript) continue;
    const i = Number(index);
    // Three index ranges reach this map; only the two typed ones need a parse,
    // and risk questions are free text by nature.
    const question = i >= FLOW_INDEX_BASE ? FLOW_QUESTIONS[i - FLOW_INDEX_BASE] : SCREENING_QUESTIONS[i];
    if (question?.type === "number" || question?.type === "yesno") {
      // The call's own reading wins. It is the value the conversation was
      // actually *routed* by, and it was produced server-side with an LLM
      // fallback for anything the fast path could not read — so a form showing
      // something different would have HR "correcting" the figure that already
      // decided which question came next.
      //
      // Our parsers stay as the fallback, and are still load-bearing: they
      // serve the 0-9 range, and the extractor returns nothing at all if its
      // model call fails.
      filled[i] = answer.value
        || (question.type === "number"
          ? parseNumericAnswer(answer.transcript, question.unit)
          : parseYesNo(answer.transcript));
      spoken[i] = said(answer);
    } else {
      // Free text, but not always *only* text: `current_location` is typed here
      // and the call extracts a cleaned place name from it. Prefer that. The
      // raw transcript accumulates every attempt at a node, so a candidate who
      // answered something else first and was re-asked would otherwise have
      // "my current package is 12 LPA Pune" saved as their location.
      filled[i] = answer.value || answer.transcript;
      // Whenever the field shows something other than what was said, the
      // sentence goes underneath it — a substitution HR can't see is one they
      // can't correct. A volunteered answer always shows its sentence, even
      // when the field matches it word for word, because the thing worth
      // seeing there is that nobody asked.
      if (answer.value || answer.volunteered) spoken[i] = said(answer);
    }
  }
  return { filled, spoken };
}

/**
 * The joining-likelihood verdict, with every criterion behind it.
 *
 * Rules over the saved answers, not a model — `backend/joining_evaluator.py`.
 * Renders nothing until this candidate's screening has answered something a
 * criterion measures, which is also why the note says "as at the last save":
 * the verdict is recomputed by the backend on each read, so answers typed into
 * the form below only reach it once Save Responses has been pressed.
 *
 * Advisory, and it says so. A dealbreaker here is evidence for the Override
 * dropdown at the top of this modal, exactly as a screening gate is — nothing
 * in this app moves a candidate's decision on its own.
 */
function JoiningPanel({ assessment }: { assessment?: JoiningAssessment }) {
  if (!assessment) return null;

  const style = JOINING_STYLE[assessment.join_category] ?? JOINING_STYLE.WITHDRAWN;
  const { red_flags: flags, matched_criteria: matched } = assessment;

  return (
    <div className="mt-3 rounded-xl border bg-card p-3"
      style={{ borderColor: `color-mix(in oklab, ${style.color} 35%, transparent)` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <p className="eyebrow-lg">Joining likelihood</p>
        <span
          className="text-[13px] font-bold px-2 py-0.5 rounded-md"
          style={{
            color: style.color,
            background: `color-mix(in oklab, ${style.color} 12%, transparent)`,
          }}
        >
          {style.label}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {flags.length + matched.length} of 6 criteria answered
        </span>
      </div>

      <p className="text-[15px] text-foreground/90 mb-2">{assessment.summary}</p>

      <ul className="space-y-1.5">
        {flags.map((flag, i) => (
          <li key={`flag-${i}`} className="flex items-start gap-1.5">
            <AlertTriangle
              size={13}
              className="mt-1 flex-shrink-0"
              style={{ color: flag.severity === "hard" ? "var(--danger)" : "var(--decision-hold)" }}
            />
            <div className="min-w-0">
              <p className="text-[15px] text-foreground/90">
                {flag.reason}
                {/* A hard flag is LOW on its own; two soft ones are. Saying
                    which is which is the difference between "argue with this"
                    and "this one is settled". */}
                <span className="text-muted-foreground">
                  {flag.severity === "hard" ? " (dealbreaker)" : " (risk)"}
                </span>
              </p>
              {flag.evidence ? (
                <p className="text-[13px] text-muted-foreground mt-0.5">
                  <span className="eyebrow">They said</span>{" "}
                  <span className="italic text-foreground/80">“{flag.evidence}”</span>
                </p>
              ) : null}
            </div>
          </li>
        ))}
        {matched.map((match, i) => (
          <li key={`match-${i}`} className="flex items-start gap-1.5">
            <span className="mt-0.5 text-[var(--decision-interview)]">•</span>
            <p className="text-[15px] text-foreground/80">{match.reason}</p>
          </li>
        ))}
      </ul>

      <p className="text-[13px] text-muted-foreground mt-2">
        Fixed rules over the answers below, as at the last save — no AI, so the same
        answers always give the same result. It never changes the decision; use Override
        above.
      </p>
    </div>
  );
}

/** One flag list, straight from the resume. Renders nothing when empty.
 *  The call's own verdict is deliberately kept out of both lists — it has its
 *  own score tile, and mixing it in made a resume flag and a phone-manner note
 *  read as the same kind of evidence. */
function FlagBlock({ title, color, flags }: { title: string; color: string; flags?: string[] }) {
  if (!flags || flags.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-[13px] font-semibold uppercase tracking-wide mb-1" style={{ color }}>
        {title}
      </p>
      <ul className="space-y-1">
        {flags.map((flag, i) => (
          <li key={i} className="text-[15px] text-foreground/90 flex items-start gap-1.5">
            <span style={{ color }} className="mt-0.5">•</span>
            {flag}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function HrScreeningModal({
  candidate,
  onClose,
  onSave,
  initialResponses = {},
  initialComment = "",
  initialSelectedQuestions = [],
  initialHeard = {},
  jdAnswers,
  criteria,
  jobLocation = "",
}: {
  candidate: CandidateEvaluation;
  onClose: () => void;
  onSave?: (candidateId: string, responses: Record<number, string>, comment: string, selectedQuestions: number[], heard: Record<number, string>) => void;
  initialResponses?: Record<number, string>;
  initialComment?: string;
  initialSelectedQuestions?: number[];
  /** What the candidate said for the number/yes-no questions, saved with the
   *  screening — their field only holds the figure parsed out of it. */
  initialHeard?: Record<number, string>;
  /** The requisition's answers to the *old* fixed questions — see the
   *  "Earlier screening" block, which is the only thing that still reads them. */
  jdAnswers?: ScreeningAnswers;
  /** The requisition's typed constraints — what the flow branches on. */
  criteria?: RoleCriteria;
  /** The JD's primary location — drives the relocation branch. */
  jobLocation?: string;
}) {
  const appState = useAppState();
  const [responses, setResponses] = useState<Record<number, string>>(initialResponses);
  const [comment, setComment] = useState(initialComment);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<string>("");
  const [currentDecision, setCurrentDecision] = useState<"Rejected" | "On Hold" | "Interview">(candidate.shortlist_decision);
  const [saving, setSaving] = useState(false);
  const [callNotice, setCallNotice] = useState("");
  const [calling, setCalling] = useState(false);
  const [callSession, setCallSession] = useState<{ id: string } | null>(null);
  const [selectedQuestions, setSelectedQuestions] = useState<Set<number>>(new Set());
  // The recording of the AI screening call, played inline the same way the
  // dashboard row plays it. `calledHere` is what makes a call placed in this
  // modal playable without closing it first: the candidate prop was fetched
  // before that call existed, so it carries no interview urls yet.
  const [showRecording, setShowRecording] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const [calledHere, setCalledHere] = useState(false);
  // What the candidate actually said, for the number-typed questions only. A
  // number input cannot render "only 4LPA", so the sentence is kept here and
  // shown under the field — the parsed figure is a convenience, not the record.
  const [heard, setHeard] = useState<Record<number, string>>(initialHeard);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef<string>("");
  /** Flow indices HR has already seen, so a re-reveal doesn't undo an untick. */
  const everRevealed = useRef<Set<number>>(new Set());

  // The conditional screening flow: which questions apply is a function of the
  // answers so far and the requisition's criteria, so it is recomputed on every
  // keystroke rather than being a fixed list. `gate` is why the questions
  // stopped (bad time to talk, experience below the minimum) — a reason to show
  // HR, never an automatic decision.
  const flowCtx = useMemo(
    () => ({
      criteria: criteria || {},
      jobLocation,
      // The sheet's step 3.5: a candidate who is not working anywhere is never
      // asked about notice period, buyout or current CTC. Read off the resume,
      // never asked — and `undefined` when the resume did not say, which asks
      // everything rather than guessing a skip.
      employed:
        candidate.currently_employed === "yes"
          ? true
          : candidate.currently_employed === "no"
            ? false
            : undefined,
    }),
    [criteria, jobLocation, candidate.currently_employed]
  );
  const { questions: flowQuestions, gate } = useMemo(
    () => visibleFlow(responses, flowCtx),
    [responses, flowCtx]
  );

  // NOTE: `candidate.risk_questions` — the per-resume flags (gaps, job hopping)
  // in the 100-104 range — are deliberately NOT rendered or called from here.
  // They were removed from HR screening on request. The backend still generates
  // and stores them, and any already answered against a candidate are still
  // saved back untouched; nothing in this modal asks or shows them.

  // Graded only after the call, so it is absent for a candidate nobody has
  // called — undefined means "not scored", never zero, and a rescheduled call
  // ("skipped") carries no score at all. The tile is hidden in both cases
  // rather than showing a dash.
  const callScore =
    candidate.interview_scores?.status === "done"
      ? candidate.interview_scores.communication_score
      : undefined;

  // Questions that must stay on screen whatever the flow now says. A call's own
  // answers reshape the tree underneath HR — a "no" closes a branch, a gate
  // truncates everything after it — and a question that disappears takes its
  // tick *and* its answer box with it, so HR could no longer see or correct
  // what the agent heard. Filled when a call is placed (with what the agent may
  // ask) and when a called candidate's modal is reopened (with the ticked set
  // that was saved), so on both paths the boxes stay as they were.
  const [frozenIndices, setFrozenIndices] = useState<Set<number>>(new Set());

  const shownQuestions = useMemo(() => {
    const byIndex = new Map(flowQuestions.map((q) => [q.index, q]));
    for (const index of frozenIndices) {
      if (byIndex.has(index)) continue; // the live copy wins: its flag is current
      const q = FLOW_QUESTIONS[index - FLOW_INDEX_BASE];
      if (!q) continue;
      byIndex.set(index, {
        index,
        key: q.key,
        label: q.label,
        question: fillFlowQuestion(q.question, flowCtx),
        type: q.type,
        unit: q.unit,
        options: q.options,
        // A question the flow has ruled out has no live warning to give.
        flag: null,
      });
    }
    // Ask order, NOT index order. They used to be the same thing — every index
    // is FLOW_INDEX_BASE + position, so sorting by index sorted by the array.
    // Since the two questions adopted from the second spec sheet are *appended*
    // (to keep saved responses where they are) while being asked second and
    // third, sorting by index here would list them dead last and undo the
    // ordering `visibleFlow` just applied.
    const askAt = (key: string) => {
      const at = ASK_ORDER.indexOf(key);
      return at === -1 ? ASK_ORDER.length : at; // unknown key sorts to the end
    };
    return [...byIndex.values()].sort((a, b) => askAt(a.key) - askAt(b.key));
  }, [flowQuestions, frozenIndices, flowCtx]);

  /** Everything on screen right now, in ask order — what the call is placed with. */
  const visibleIndices = useMemo(() => shownQuestions.map((q) => q.index), [shownQuestions]);
  const selectedVisible = visibleIndices.filter((i) => selectedQuestions.has(i)).length;

  // The script goes to the voice service when the call is placed. Ticking after
  // that changes nothing the agent will ask, so the boxes lock until it ends —
  // otherwise HR unticks a question and then watches it get asked anyway.
  const ticksLocked = calling || callSession !== null;
  const lockTitle = "The call is in progress — the questions it was placed with can't be changed.";

  /** Has this candidate been called at all — before this modal opened, or in it. */
  const hasInterview = !!candidate.interview_recording_url || calledHere;

  // Answers stored against the old fixed question list, before the flow
  // replaced it. Read-only, and only rendered when this candidate has any —
  // their indices were never reused, so they still mean what they meant.
  const earlierAnswers = [
    // The requisition answered the 0-9 list too, so those carry a key to look
    // its answer up by; the flow questions never had a requisition side.
    ...SCREENING_QUESTIONS.map((q, i) => ({ text: q.question, jdKey: q.key, index: i })),
    // …and against the first conditional flow, which the sheet replaced. Both
    // ranges are frozen, so an answer still means what it meant when it was
    // recorded — that is the whole reason the old list is kept.
    ...LEGACY_FLOW_QUESTIONS.map((q, i) => ({
      text: q.question,
      jdKey: "",
      index: LEGACY_FLOW_INDEX_BASE + i,
    })),
  ]
    .map((entry) => ({ ...entry, answer: (initialResponses[entry.index] || "").trim() }))
    .filter((entry) => entry.answer !== "");

  // Sync decision if candidate changes
  useEffect(() => {
    setCurrentDecision(candidate.shortlist_decision);
  }, [candidate.candidate_id, candidate.shortlist_decision]);

  // Restore the ticked questions from the saved screening, falling back to the
  // ones that have an answer. A fresh candidate starts with all of them ticked:
  // they are asked of everyone, so untick is the exception.
  useEffect(() => {
    const initKey = candidate.candidate_id;
    if (initializedRef.current === initKey) return;
    initializedRef.current = initKey;

    // What someone has already expressed an opinion about, by ticking it or by
    // answering it.
    let stored = initialSelectedQuestions;
    if (stored.length === 0) {
      stored = Object.keys(initialResponses)
        .map(Number)
        .filter((idx) => initialResponses[idx]?.trim());
    }

    // A saved set only says anything about the index ranges that existed when
    // it was saved. A candidate screened before the conditional flow has
    // nothing at all in the 200+ range, and reading that as "every flow
    // question is unticked" would open their modal with the whole list off and
    // no inputs to type into. So a range nobody has an opinion about starts
    // ticked, exactly as it does for a candidate nobody has screened yet.
    const selected = new Set(stored);
    const knowsFlow = stored.some((idx) => idx >= FLOW_INDEX_BASE);
    if (!knowsFlow) for (const idx of visibleIndices) selected.add(idx);
    // Same reasoning, one question at a time: one appended to the flow after
    // this screening was saved was never in front of HR either.
    const added = addedSince(candidate.hr_screening?.flow_size);
    for (const idx of visibleIndices) if (added.includes(idx)) selected.add(idx);

    // Everything on screen at this moment has now been put in front of HR, so
    // it must not count as newly revealed below — otherwise restoring a saved
    // untick would be undone the instant the modal opened.
    everRevealed.current = new Set(visibleIndices);
    setSelectedQuestions(selected);

    // A candidate who has been called keeps the boxes they open with — the
    // agent may well have asked one the answers since ruled out, and its
    // transcript is stored against it. `selected` is the ticked set at open:
    // what was saved, or everything when nothing was.
    // Always assigned, never only when frozen: the modal is reused across
    // candidates without remounting, so leaving it alone carried one
    // candidate's frozen list onto the next one.
    setFrozenIndices(
      hasInterview
        ? new Set([...selected].filter((idx) => idx >= FLOW_INDEX_BASE))
        : new Set()
    );
  }, [candidate.candidate_id, visibleIndices, initialResponses, initialSelectedQuestions]);

  // Answers from a call this modal did not place. The commonest case is a
  // rescheduled callback: the candidate said it was a bad time, the voice
  // service redialed at the agreed hour — hours after HR closed this form — and
  // those answers sat on the session with nothing to read them back. Fetched
  // once on open; answers come back keyed by flow key, so they land on the
  // right question whatever the call was placed with.
  //
  // Only empty fields are filled: whatever HR typed and saved outranks the
  // call. As with a live call nothing is stored until Save Responses.
  useEffect(() => {
    const sessionId = candidate.interview_session_id;
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await getPhoneInterview(sessionId, candidate.candidate_id);
        if (cancelled) return;

        // Still on the phone? Hand the session to the live poll below, which
        // takes over the filling from here. Without this the read-back was a
        // single snapshot: close the form mid-call, reopen it, and the answers
        // froze at whatever had been said before you reopened — the rest of the
        // call ran with nothing in the browser watching. Guarded with `prev ??`
        // because this effect re-runs when the parent refreshes the candidate,
        // and restarting a poll that is already running would double it.
        // `retry_at` counts as live for the same reason `callback_at` does: the
        // redial runs on THIS session and fills THESE answers, so stopping at
        // the first call's end is how a candidate came back to an empty form.
        const live =
          !CALL_ENDED.includes(status.call_status) ||
          !!status.callback_at ||
          !!status.retry_at;
        if (live) {
          setCallSession((prev) => prev ?? { id: sessionId });
        }

        const { filled, spoken } = answersFromCall(status.answers);
        if (Object.keys(filled).length === 0) return;
        setResponses((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const [index, value] of Object.entries(filled)) {
            if (next[Number(index)]?.trim()) continue;
            next[Number(index)] = value;
            changed = true;
          }
          return changed ? next : prev;
        });
        setHeard((prev) => ({ ...spoken, ...prev }));
        // A live call gets its own running notice from the poll a moment later;
        // telling HR to review and save while the candidate is still talking
        // would be wrong for as long as it showed.
        if (!live) {
          setCallNotice(
            "Answers from the AI call are shown below — review them, then Save Responses."
          );
        }
      } catch (err) {
        // The call's answers are a bonus on top of the saved screening: a voice
        // service that is down must not make opening the form look broken.
        console.warn("[Interview] could not read back the call:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidate.candidate_id, candidate.interview_session_id]);

  // A branch opening mid-screening ("no, I'm not serving notice" reveals the
  // notice-period and buyout questions) arrives ticked. Its input only renders
  // when it is ticked, so anything else would make HR tick a box before they
  // could type the answer they just heard. Only *newly* revealed indices are
  // touched, so an explicit untick survives the tree changing shape around it.
  useEffect(() => {
    const revealed = visibleIndices.filter((i) => !everRevealed.current.has(i));
    if (revealed.length === 0) return;
    revealed.forEach((i) => everRevealed.current.add(i));
    setSelectedQuestions((prev) => new Set([...prev, ...revealed]));
  }, [visibleIndices]);

  // Scroll modal to top on open
  useEffect(() => {
    const el = modalContentRef.current;
    if (!el) return;
    // Use requestAnimationFrame to ensure DOM is fully rendered before scrolling
    requestAnimationFrame(() => {
      el.scrollTop = 0;
    });
  }, [candidate.candidate_id]);

  // Reset scroll position when candidate changes by forcing a remount
  const modalContentKey = `${candidate.candidate_id}-${candidate.candidate_name}`;

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleSendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const userMessage: ChatMessage = { role: "user", content: chatInput.trim() };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);

    try {
      const sessionId = chatSessionId || `SESSION-${candidate.candidate_id}`;
      if (!chatSessionId) setChatSessionId(sessionId);

      const data = await chatWithAI(sessionId, userMessage.content, candidate.candidate_id);
      const assistantMessage: ChatMessage = { role: "assistant", content: data.response };
      setChatMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      // Same reasoning as the full AI Assistant page: a rejected provider key
      // is not something "try again" resolves, so pass the real cause through.
      console.warn("[Chat] failed:", err);
      setChatMessages((prev) => [...prev, {
        role: "assistant",
        content: err instanceof Error ? err.message : "The assistant could not answer. Please try again.",
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  // AI phone call: the backend dials the number extracted from the resume and
  // asks the ticked questions, in this order.
  const handlePhoneCall = async () => {
    if (calling || callSession) return;
    // NOT `visibleIndices`. A call is placed before the candidate has said
    // anything, so no branch is open yet and the visible list is just the
    // unconditional questions — placing the call with it dropped every
    // follow-up (notice period, buyout, relocation, negotiation, offer
    // details) before the agent ever saw them. `callableFlow` keeps anything
    // still undetermined and drops only what HR's answers have actually ruled
    // out; the agent branches live from there.
    // "It wasn't a good time" describes the call it was said on, not this one.
    // See RESCHEDULE_INDICES.
    const priorAnswers = { ...responses };
    for (const idx of RESCHEDULE_INDICES) delete priorAnswers[idx];
    const callableQuestions = callableFlow(priorAnswers, flowCtx).questions;
    const callable = callableQuestions.map((q) => q.index);
    // A question HR has never been shown carries no opinion, so it is included
    // by default — the same rule the tick state uses when the modal opens.
    // Only an explicit untick keeps one off the call.
    const indices = callable.filter(
      (i) => selectedQuestions.has(i) || !everRevealed.current.has(i)
    );
    if (indices.length === 0) {
      setCallNotice("Tick at least one question before calling.");
      return;
    }

    setCalling(true);
    setCallNotice("Preparing the questions and dialing — this takes a few seconds…");
    try {
      const started = await startPhoneInterview(candidate.candidate_id, indices);
      setCallSession({ id: started.session_id });
      // Freeze the list to what the agent may ask, before its answers start
      // closing branches under HR.
      setFrozenIndices(new Set(callableQuestions.map((q) => q.index)));
      setCalledHere(true);
      setCallNotice(
        `Calling ${started.phone} with ${started.question_indices.length} question` +
        `${started.question_indices.length === 1 ? "" : "s"}…`
      );
    } catch (err) {
      console.warn("[Interview] could not start:", err);
      setCallNotice(err instanceof Error ? err.message : "The call could not be placed.");
    } finally {
      setCalling(false);
    }
  };

  // While the call runs, each transcript drops straight into the response field
  // for its question — the call fills the same form HR types into, so nothing is
  // stored until Save Responses, and HR can correct a mis-heard answer first.
  useEffect(() => {
    if (!callSession) return;
    let stopped = false;
    let pollsSinceEnded = 0;
    let timer: ReturnType<typeof setTimeout>;

    /** One poll. Returns the delay before the next one, or 0 to stop watching. */
    const poll = async (): Promise<number> => {
      try {
        // The resume uuid is what lets the backend persist the call's
        // comprehensive score onto this candidate, so the dashboard
        // row keeps them once this modal closes.
        const status = await getPhoneInterview(callSession.id, candidate.candidate_id);
        if (stopped) return 0;

        const { filled, spoken } = answersFromCall(status.answers);
        if (Object.keys(filled).length) {
          setResponses((prev) => ({ ...prev, ...filled }));
        }
        if (Object.keys(spoken).length) {
          setHeard((prev) => ({ ...prev, ...spoken }));
        }

        const ended = CALL_ENDED.includes(status.call_status);
        const transcribing = Object.values(status.answers).some((a) => a.status === "pending");

        // A callback the candidate asked for is dialed on *this same session*
        // and fills *these same* answers, so the first call ending is not the
        // end of the screening. Stopping here was why a rescheduled candidate
        // came back to an empty form: the redial ran the whole questionnaire
        // with nothing in the browser watching, and none of it reached HR until
        // the modal was closed and reopened.
        // Two ways the screening continues after this call ends, both redialling
        // THIS session into THESE answers: a time the candidate asked for, and
        // an automatic retry after we could not reach them. Worded differently
        // because HR acts on them differently — one is arranged, one is us
        // still trying — but both mean "leave this open".
        const armedAt = status.callback_at || status.retry_at;
        if (armedAt) {
          pollsSinceEnded = 0;
          const when = formatCallTime(armedAt);
          setCallNotice(
            (status.callback_at
              ? `Not a good time — calling back at ${when}.`
              : `No answer${status.call_attempts ? ` after ${status.call_attempts} ` +
                  `attempt${status.call_attempts > 1 ? "s" : ""}` : ""} — ` +
                `trying again automatically at ${when}.`) +
            ` Leave this open and the answers appear here after that call.`
          );
          // Slowly: a callback can be minutes or hours away.
          return ended ? 30000 : 5000;
        }

        if (ended) pollsSinceEnded += 1;

        // Give transcription ~30s to catch up after the call drops; questions
        // never reached (hang-up, no answer) stay "pending" forever, so waiting
        // on them alone would poll until the modal closed.
        if (ended && (!transcribing || pollsSinceEnded > 6)) {
          setCallSession(null);
          // `status` over `call_status`: the leg reads "completed" for a line
          // that dropped at question four, and telling HR the call completed
          // is how a half-finished screening gets reviewed as a whole one.
          const hint = callStatusHint(status.status);
          setCallNotice(
            `${callStatusLabel(status.status ?? status.call_status)}.` +
            (hint ? ` ${hint}` : "") +
            ` Answers filled in below — review them, then Save Responses.`
          );
          return 0;
        }
        setCallNotice(
          `${callStatusLabel(status.status ?? status.call_status)} — ` +
          `answers appear below when the call ends.`
        );
        return 5000;
      } catch (err) {
        if (stopped) return 0;
        console.warn("[Interview] poll failed:", err);
        setCallSession(null);
        setCallNotice(err instanceof Error ? err.message : "Lost track of the call.");
        return 0;
      }
    };

    const tick = async () => {
      const next = await poll();
      if (!stopped && next) timer = setTimeout(tick, next);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [callSession, candidate.candidate_id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div key={modalContentKey} ref={modalContentRef} className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-[21px] font-semibold tracking-[-0.02em] text-foreground">HR Screening</h2>
            <p className="text-[15px] text-muted-foreground mt-0.5">Record candidate responses and add notes</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Candidate Info */}
        <div className="p-5 border-b border-border space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[15px] font-bold" style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}>
              {candidate.candidate_name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[17px] font-bold text-foreground">{candidate.candidate_name}</p>
              <p className="text-[13px] text-muted-foreground">
                <span className="eyebrow">ID</span> <span className="numeral">{candidate.candidate_id}</span>
              </p>
              {candidate.resume_url && (
                <a
                  href={candidate.resume_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] font-semibold px-2 py-0.5 rounded-lg text-white hover:opacity-90 transition-opacity"
                  style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}
                >
                  <Download size={10} />
                  View resume
                </a>
              )}
            </div>
          </div>

          {/* Decision Override */}
          <div className="flex items-center gap-2 pt-2">
            {/* The pill is where the candidate stands *now* — it follows the
                dropdown as HR picks, so the two never disagree, and Save
                Responses is what pushes it to the table. */}
            <span className="text-[15px] font-semibold text-muted-foreground">Current status:</span>
            <span className={`text-[15px] font-bold px-2 py-0.5 rounded-md ${
              currentDecision === "Interview" ? "bg-[var(--decision-interview)]/12 text-[var(--decision-interview)]" :
              currentDecision === "On Hold" ? "bg-[var(--decision-hold)]/12 text-[var(--decision-hold)]" :
              "bg-[var(--danger)]/12 text-[var(--danger)]"
            }`}>
              {decisionLabel(currentDecision)}
            </span>
            <span className="text-[15px] text-muted-foreground">|</span>
            <span className="text-[15px] font-semibold text-muted-foreground">Override to decision:</span>
            <select
              value={currentDecision}
              onChange={(e) => {
                // Only local until Save Responses — the table's pill must not
                // move on a choice HR hasn't committed (and may cancel out of).
                setCurrentDecision(e.target.value as "Rejected" | "On Hold" | "Interview");
              }}
              className="text-[15px] bg-secondary border border-border rounded-lg px-2 py-1 focus:outline-none focus:border-[var(--brand)]"
            >
              <option value="Interview">Selected for R1</option>
              <option value="On Hold">On Hold</option>
              <option value="Rejected">Rejected</option>
            </select>
            {currentDecision !== (candidate.ai_decision || candidate.shortlist_decision) && (
              <span className="text-[13px] font-semibold text-[var(--brand)]">(Modified)</span>
            )}
          </div>
        </div>

        {/* Decision Summary — explains WHY the candidate is in this bucket
            (HR Screening / Hold / Reject) and WHY the score is what it is,
            using the reasoning produced from the actual resume vs. the job
            description, plus the matched / missing skills that drive it. */}
        <div className="p-5 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={14} className="text-[var(--brand)]" />
            <p className="eyebrow-lg">Summary</p>
          </div>

          {/* The resume against the JD, and — only once the call has been
              graded — how the candidate came across on it. Neither is coloured,
              the same rule as the dashboard's score columns. */}
          <div className="flex items-center gap-3 mb-3">
            {/* Wide enough for the longest label: "COMPREHENSIVE" is 13
                letter-spaced mono caps, which ran off a w-24 tile. */}
            <div className="flex flex-col items-center justify-center gap-0.5 w-36 h-20 px-2 rounded-xl bg-card border border-border flex-shrink-0">
              <span className="readout text-[26px] text-foreground">{candidate.overall_match_score}%</span>
              <span className="eyebrow whitespace-nowrap">Resume</span>
            </div>
            {callScore !== undefined && (
              <div className="flex flex-col items-center justify-center gap-0.5 w-36 h-20 px-2 rounded-xl bg-card border border-border flex-shrink-0">
                <span className="readout text-[26px] text-foreground">{callScore}%</span>
                <span className="eyebrow whitespace-nowrap">Comprehensive</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-foreground">
                {candidate.shortlist_decision === "Interview"
                  ? "HR Screening"
                  : candidate.shortlist_decision === "On Hold"
                  ? "Hold"
                  : "Reject"}
              </p>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                The resume score measures this CV against the job description
                {callScore !== undefined && ", and the comprehensive score is graded from the call transcript"}.
                Both are guidance only — the final decision is yours, and you can change it with Override above.
              </p>
            </div>
          </div>

          {candidate.reasoning ? (
            <p className="text-[15px] text-foreground/90 leading-relaxed bg-card border border-border rounded-xl p-3">
              {candidate.reasoning}
            </p>
          ) : null}

          {/* The matched/missing skill tiles and the "0 of 8 required skills
              matched … lands in the Interview band" paragraph were here. They
              contradicted the score they claimed to explain: the score is
              embedding similarity against the whole JD, while the tiles count
              exact skill-string matches, so a candidate could read 0 / 8 matched
              at 80%. The skills themselves are on the dashboard row. */}

          {/* Green and Red Flags, both read off the resume against the JD. */}
          <FlagBlock title="Green Flags" color="var(--decision-interview)" flags={candidate.green_flags} />
          <FlagBlock title="Red Flags" color="var(--danger)" flags={candidate.red_flags_detected} />

          {/* …and the joining verdict, which reads the *screening answers*
              rather than the resume. It sits under the two resume flag lists
              on purpose: the resume says whether they can do the job, this says
              whether they would turn up. */}
          <JoiningPanel assessment={candidate.joining_assessment} />

          {candidate.category_scores && Object.keys(candidate.category_scores).length > 0 && (
            <div className="mt-3">
              <p className="eyebrow-lg mb-2">Score breakdown</p>
              <div className="space-y-1.5">
                {Object.entries(candidate.category_scores).map(([cat, score]) => (
                  <div key={cat} className="flex items-center gap-2">
                    <span className="text-[13px] text-muted-foreground w-28 flex-shrink-0 capitalize">
                      {cat.replace(/_/g, " ")}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round(Number(score))}%`,
                          background: scoreColor(Number(score)),
                        }}
                      />
                    </div>
                    <span className="text-[13px] font-semibold text-foreground w-9 text-right">
                      {Math.round(Number(score))}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* The conditional screening flow. Which questions appear is a function
            of the answers so far and this requisition's criteria — a "no" to
            serving notice opens the notice-period and buyout questions, an
            expected CTC over budget opens the negotiation one. Tick the ones
            being asked; the requisition's own constraint sits under each so the
            two can be read together. */}
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-white" style={{ background: "var(--brand)" }}>
                <FileText size={12} />
              </div>
              <p className="eyebrow-lg">Screening Questions</p>
              <span className="text-[13px] text-muted-foreground">
                ({selectedVisible} of {visibleIndices.length} selected)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedQuestions(new Set([...selectedQuestions, ...visibleIndices]))}
                disabled={ticksLocked}
                title={ticksLocked ? lockTitle : undefined}
                className="text-[13px] font-semibold text-[var(--brand)] hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
              >
                Select All
              </button>
              <button
                onClick={() => setSelectedQuestions(
                  new Set([...selectedQuestions].filter((i) => !visibleIndices.includes(i)))
                )}
                disabled={ticksLocked}
                title={ticksLocked ? lockTitle : undefined}
                className="text-[13px] font-semibold text-muted-foreground hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
              >
                Deselect All
              </button>
            </div>
          </div>

          <div className="space-y-3 pl-4 border-l-2 border-[var(--brand)]/20">
            {shownQuestions.map((q, position) => {
              const idx = q.index;
              const isSelected = selectedQuestions.has(idx);
              const note = requisitionNote(q.key, criteria || {});
              const value = responses[idx] || "";
              return (
                <div key={q.key} className={`space-y-2 ${!isSelected ? "opacity-60" : ""}`}>
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => {
                        const newSelected = new Set(selectedQuestions);
                        if (newSelected.has(idx)) {
                          newSelected.delete(idx);
                        } else {
                          newSelected.add(idx);
                        }
                        setSelectedQuestions(newSelected);
                      }}
                      disabled={ticksLocked}
                      className="mt-0.5 flex-shrink-0 text-[var(--brand)] hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                      title={ticksLocked ? lockTitle : isSelected ? "Uncheck to exclude this question" : "Check to include this question"}
                    >
                      {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-foreground">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[13px] font-bold text-white mr-2" style={{ background: "var(--brand)" }}>
                          {position + 1}
                        </span>
                        {q.question}
                      </p>
                      {note ? (
                        <p className="text-[13px] text-muted-foreground mt-1 ml-7">
                          <span className="eyebrow">Requisition</span>{" "}
                          <span className="text-foreground/80">{note}</span>
                        </p>
                      ) : null}
                      {isSelected && (
                        <>
                          {q.type === "yesno" ? (
                            <div className="flex items-center gap-2 mt-2">
                              {/* Yes/No unless the question carries its own set —
                                  "willing to resign" is Yes / Maybe / No, because
                                  the spec branches on all three. */}
                              {(q.options ?? [
                                { value: "yes", label: "Yes" },
                                { value: "no", label: "No" },
                              ]).map((option) => (
                                <label
                                  key={option.value}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[15px] cursor-pointer transition-all ${
                                    value === option.value
                                      ? "border-[var(--brand)] bg-[var(--brand-wash)] text-foreground font-semibold"
                                      : "border-border bg-secondary/50 text-muted-foreground hover:border-[var(--brand)]/40"
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name={`flow-${candidate.candidate_id}-${q.key}`}
                                    value={option.value}
                                    checked={value === option.value}
                                    onChange={() => setResponses((prev) => ({ ...prev, [idx]: option.value }))}
                                    className="accent-[var(--brand)]"
                                  />
                                  {option.label}
                                </label>
                              ))}
                              {value ? (
                                <button
                                  onClick={() => setResponses((prev) => ({ ...prev, [idx]: "" }))}
                                  className="text-[13px] text-muted-foreground hover:underline"
                                >
                                  Clear
                                </button>
                              ) : null}
                            </div>
                          ) : q.type === "number" ? (
                            <input
                              type="number"
                              min={0}
                              value={value}
                              onChange={(e) => setResponses((prev) => ({ ...prev, [idx]: e.target.value }))}
                              placeholder={q.unit || ""}
                              className="w-full mt-2 px-3 py-2 text-[15px] rounded-xl border border-border bg-secondary/50 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20"
                            />
                          ) : q.type === "date" ? (
                            // Native picker: the platform already has one, and it
                            // gives a consistent yyyy-mm-dd whatever HR types.
                            <input
                              type="date"
                              value={value}
                              onChange={(e) => setResponses((prev) => ({ ...prev, [idx]: e.target.value }))}
                              className="mt-2 px-3 py-2 text-[15px] rounded-xl border border-border bg-secondary/50 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20"
                            />
                          ) : (
                            <textarea
                              value={value}
                              onChange={(e) => setResponses((prev) => ({ ...prev, [idx]: e.target.value }))}
                              placeholder="Type the candidate's response here…"
                              className="w-full mt-2 px-3 py-2 text-[15px] rounded-xl border border-border bg-secondary/50 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 resize-none"
                              rows={2}
                            />
                          )}

                          {heard[idx] ? (() => {
                            // A volunteered answer says so in the label, not
                            // inside the quotation marks: the candidate did not
                            // say "mentioned unprompted".
                            const { volunteered, sentence } = unprompted(heard[idx]);
                            return (
                              <p className="text-[13px] text-muted-foreground mt-1">
                                <span
                                  className="eyebrow"
                                  style={volunteered ? { color: "var(--decision-hold)" } : undefined}
                                  title={
                                    volunteered
                                      ? "This question was not put to them — they said this while answering another one. Check it before saving."
                                      : undefined
                                  }
                                >
                                  {volunteered ? "Mentioned unprompted" : "On the call"}
                                </span>{" "}
                                <span className="italic text-foreground/80">“{sentence}”</span>
                                {!value ? " — nothing clear found, please set it above." : null}
                              </p>
                            );
                          })() : null}

                          {q.flag ? (
                            <p className="text-[13px] font-semibold mt-1" style={{ color: "var(--decision-hold)" }}>
                              {q.flag}
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* A gate stops the questions and says why. It never touches the
              decision — that stays with the Override dropdown above. */}
          {gate ? (
            <div
              className="flex items-start gap-2 px-3 py-2.5 rounded-xl border"
              style={{
                background: "color-mix(in oklab, var(--decision-hold) 10%, transparent)",
                borderColor: "color-mix(in oklab, var(--decision-hold) 35%, transparent)",
              }}
            >
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" style={{ color: "var(--decision-hold)" }} />
              <p className="text-[15px] text-foreground/90">
                <span className="font-semibold">Screening stopped here.</span> {gate}{" "}
                The decision is still yours — set it with Override above.
              </p>
            </div>
          ) : null}


          {/* Answers recorded against the old fixed question list, before the
              conditional flow replaced it. Read-only and collapsed: the flow
              lives in its own index range, so nothing here was re-labelled — it
              simply isn't asked any more. Rendered only when this candidate has
              some, so it is invisible for everyone screened since. */}
          {earlierAnswers.length > 0 && (
            <details className="pt-2 border-t border-border">
              <summary className="text-[15px] font-semibold text-muted-foreground cursor-pointer hover:text-foreground">
                Earlier screening ({earlierAnswers.length} answered under the previous questions)
              </summary>
              <div className="space-y-2 mt-3 pl-4 border-l-2 border-border">
                {earlierAnswers.map(({ text, jdKey, index, answer }) => (
                  <div key={index}>
                    <p className="text-[15px] font-semibold text-foreground/80">{text}</p>
                    {jdKey && jdAnswers?.[jdKey] ? (
                      <p className="text-[13px] text-muted-foreground mt-0.5">
                        <span className="eyebrow">Requisition</span>{" "}
                        <span className="text-foreground/70">{jdAnswers[jdKey]}</span>
                      </p>
                    ) : null}
                    <p className="text-[15px] text-foreground/90 mt-0.5 whitespace-pre-wrap">{answer}</p>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* HR Comment Box */}
          <div className="space-y-2 pt-2 border-t border-border">
            <p className="eyebrow-lg">HR Additional Notes</p>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Anything else worth recording about this candidate…"
              className="w-full px-3 py-2 text-[15px] rounded-xl border border-border bg-secondary/50 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 resize-none"
              rows={3}
            />
          </div>
        </div>

        {/* AI Chat Assistant */}
        <div className="p-5 border-t border-border">
          <div className="flex items-center gap-2 mb-3">
            <Bot size={16} className="text-[var(--brand)]" />
            <p className="eyebrow-lg">Your Assistant — Ask about this candidate</p>
          </div>

          {/* Chat Messages */}
          <div className="bg-secondary/30 rounded-xl border border-border p-3 max-h-[200px] overflow-y-auto space-y-3 mb-3">
            {chatMessages.length === 0 ? (
              <p className="text-[15px] text-muted-foreground text-center py-4">
                Ask anything about this candidate’s profile, skills or evaluation.
              </p>
            ) : (
              chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`flex items-start gap-2 min-w-0 ${msg.role === "user" ? "flex-row-reverse max-w-[85%]" : "max-w-[92%]"}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === "user" ? "bg-[var(--brand)]" : "bg-secondary border border-border"}`}>
                      {msg.role === "user" ? <User size={12} className="text-white" /> : <Bot size={12} className="text-[var(--brand)]" />}
                    </div>
                    <div className={`min-w-0 px-3 py-2 rounded-xl text-[15px] leading-relaxed ${msg.role === "user" ? "bg-[var(--brand)] text-white" : "bg-secondary text-foreground"}`}>
                      {msg.role === "user" ? msg.content : <Markdown text={msg.content} />}
                    </div>
                  </div>
                </div>
              ))
            )}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary text-foreground">
                  <Loader2 size={12} className="animate-spin text-[var(--brand)]" />
                  <span className="text-[15px] text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat Input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
              placeholder="Ask about skills, experience, red flags…"
              className="flex-1 px-3 py-2 text-[15px] rounded-xl border border-border bg-secondary/50 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20"
            />
            <button
              onClick={handleSendChat}
              disabled={chatLoading || !chatInput.trim()}
              className="px-4 py-2 rounded-xl text-[15px] font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-border space-y-3">
          {callNotice ? (
            <p className="text-[15px] text-muted-foreground bg-secondary/50 border border-border rounded-xl px-3 py-2.5">
              {callNotice}
            </p>
          ) : null}

          {/* Playback sits above the buttons, full width, so the player is not
              squeezed into the footer row. */}
          {showRecording && hasInterview && (
            <div>
              <audio
                key={candidate.candidate_id}
                src={interviewUrls(candidate.candidate_id).recording}
                controls
                autoPlay
                className="w-full h-9"
                onError={() =>
                  setRecordingError(
                    "That recording isn't available yet — Sarvam takes a minute or two " +
                    "to process a call. Try again shortly."
                  )
                }
              />
              {recordingError && (
                <p className="text-[13px] text-muted-foreground mt-1">{recordingError}</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handlePhoneCall}
              disabled={!candidate.contact_phone || calling || !!callSession}
              title={
                candidate.contact_phone
                  ? `Call ${candidate.contact_phone} and ask the ticked screening questions`
                  : "No phone number was extracted from this resume"
              }
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[15px] font-semibold border border-[var(--brand)]/40 text-[var(--brand)] hover:bg-[var(--brand-wash)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {calling || callSession ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <PhoneCall size={13} />
              )}
              {callSession ? "Call in progress…" : calling ? "Dialing…" : "AI Phone call"}
            </button>

            {/* The voice that button dials in, with a demo of it. Sits beside
                the button because that is the moment HR is deciding how the
                call should sound; the choice itself is remembered browser-wide,
                so the dashboard's bulk call goes out in it too. */}
            <VoicePicker disabled={calling || !!callSession} />

            {/* Play the screening call back and take the Q&A away as a .txt.
                Both appear only once this candidate has actually been called —
                before that there is nothing to play, and a permanently greyed
                pair of buttons is just clutter beside the button that creates
                them. (The dashboard row keeps its inert version: that column
                has to stay aligned across every row.) */}
            {hasInterview && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setRecordingError("");
                  setShowRecording((prev) => !prev);
                }}
                title={showRecording ? "Hide the AI interview recording" : "Play the AI interview recording"}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[15px] font-semibold text-muted-foreground hover:text-[var(--brand)] hover:bg-[var(--brand-wash)] transition-colors"
              >
                {showRecording ? <Volume2 size={13} className="text-[var(--brand)]" /> : <PlayCircle size={13} />}
                {showRecording ? "Hide recording" : "Play recording"}
              </button>
              {/* A plain link: the backend sends the .txt with a
                  Content-Disposition, so there is no JS behind it. */}
              <a
                href={interviewUrls(candidate.candidate_id).transcript}
                title="Download the AI interview transcript"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[15px] font-semibold text-muted-foreground hover:text-[var(--brand)] hover:bg-[var(--brand-wash)] transition-colors"
              >
                <FileDown size={13} />
                Transcript
              </a>
            </div>
            )}
            </div>

            <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-[15px] font-semibold text-foreground bg-secondary hover:bg-secondary/70 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              if (saving) return;
              setSaving(true);
              try {
                await saveScreening(candidate.candidate_id, {
                  responses,
                  selected_questions: Array.from(selectedQuestions),
                  comment,
                  decision: currentDecision,
                  heard,
                  flow_size: FLOW_QUESTIONS.length,
                });
                // Saved, so the table's pill can move to it now.
                appState.updateEvaluationDecision(candidate.candidate_id, currentDecision);
                if (onSave) onSave(candidate.candidate_id, responses, comment, Array.from(selectedQuestions), heard);
                onClose();
              } catch (err) {
                console.warn("[Screening] save failed:", err);
                alert(err instanceof Error ? err.message : "Failed to save screening responses.");
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-[15px] font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))", boxShadow: "0 4px 14px var(--brand-wash)" }}
          >
            {saving ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />Saving…
              </span>
            ) : (
              "Save Responses"
            )}
          </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
