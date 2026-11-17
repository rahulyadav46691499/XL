"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  FileText, CheckCircle2, Loader2,
  Zap, ArrowRight, FilePlus, ChevronDown, Briefcase, Trash2, AlertTriangle, Pencil,
  Upload, MapPin, Hash, X, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppState, SavedJD } from "@/lib/app-state";
import { uploadJD, extractJDSkills, listJDs, saveJDInfo, deleteJD, jdFileUrl, stageLabel, JDSummary, UploadProgress } from "@/lib/api";
import ProgressBar from "@/components/ProgressBar";
import {
  CRITERIA_CHOICES,
  CRITERIA_KEYS,
  CRITERIA_RANGES,
  CriteriaDraft,
  criteriaErrors,
  criteriaFilledCount,
  criteriaFromDraft,
  criteriaValid,
  draftFromCriteria,
  emptyCriteriaDraft,
} from "@/lib/role-criteria";

/** A job id is the fixed prefix EXL plus six digits — see backend/job_id.py. */
const JOB_ID_PREFIX = "EXL";
const JOB_ID_DIGITS = 6;

function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function extOf(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "FILE";
}

/** Digits-only job id entry with EXL fixed inside the field. Used by the upload
 *  form and the edit dialog, so the two can't drift apart. */
function JobIdField({
  id, value, onChange, error, hint, disabled,
}: {
  id: string;
  value: string;
  onChange: (digits: string) => void;
  error: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-[15px] font-medium text-foreground mb-1.5 block">
        Job ID
      </label>
      <div
        className={cn(
          "flex items-stretch rounded-lg border bg-background overflow-hidden transition-all focus-within:ring-2",
          error
            ? "border-[var(--danger)] focus-within:ring-[var(--danger)]/20"
            : "border-border focus-within:border-[var(--brand)] focus-within:ring-[var(--brand)]/20",
          disabled && "opacity-60"
        )}
      >
        <span
          aria-hidden="true"
          className="numeral flex items-center px-3 text-[15px] font-semibold border-r border-border bg-secondary/70"
          style={{ color: "var(--brand)" }}
        >
          {JOB_ID_PREFIX}
        </span>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, JOB_ID_DIGITS))}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          aria-describedby={id + "-hint"}
          aria-invalid={Boolean(error)}
          placeholder="267432"
          className="numeral flex-1 min-w-0 px-3 py-2.5 text-[15px] bg-transparent text-foreground placeholder:text-muted-foreground/50 focus:outline-none tracking-[0.08em] disabled:cursor-not-allowed"
        />
      </div>
      <p
        id={id + "-hint"}
        className={cn("text-[13px] mt-1", error ? "text-[var(--danger)] font-medium" : "text-muted-foreground")}
      >
        {error || hint}
      </p>
    </div>
  );
}

/**
 * The requisition's hiring constraints: three ranges and two radio groups.
 *
 * Rendered by both the upload form and the Edit dialog for the same reason
 * `JobIdField` is — two copies of a form this fiddly drift apart. Native number
 * inputs and radios; nothing here needs a component library.
 *
 * These are what the HR screening flow branches on, so they are typed rather
 * than free text — see `lib/role-criteria.ts` and `lib/screening-flow.ts`.
 */
function RoleCriteriaFields({
  idPrefix, draft, onChange,
}: {
  idPrefix: string;
  draft: CriteriaDraft;
  onChange: (key: string, value: string) => void;
}) {
  const errors = criteriaErrors(draft);

  return (
    <div className="space-y-3">
      {CRITERIA_RANGES.map((range) => (
        <div key={range.minKey}>
          <label
            htmlFor={`${idPrefix}-${range.minKey}`}
            className="text-[15px] font-medium text-foreground mb-1 block"
          >
            {range.label} <span className="text-muted-foreground">({range.unit})</span>
            <span className="text-[var(--danger)] ml-0.5">*</span>
          </label>
          <p className="text-[13px] text-muted-foreground mb-1.5 leading-snug">{range.question}</p>
          <div className="flex items-center gap-2">
            {[
              { key: range.minKey, placeholder: range.minPlaceholder },
              { key: range.maxKey, placeholder: range.maxPlaceholder },
            ].map((field, i) => (
              <div key={field.key} className="flex items-center gap-2 flex-1 min-w-0">
                {i === 1 ? (
                  <span aria-hidden="true" className="text-[15px] text-muted-foreground">to</span>
                ) : null}
                <input
                  id={`${idPrefix}-${field.key}`}
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={draft[field.key] || ""}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  aria-invalid={Boolean(errors[field.key])}
                  className={cn(
                    "numeral w-full min-w-0 px-3 py-2.5 text-[15px] rounded-lg border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 transition-all",
                    errors[field.key]
                      ? "border-[var(--danger)] focus:ring-[var(--danger)]/20"
                      : "border-border focus:border-[var(--brand)] focus:ring-[var(--brand)]/20"
                  )}
                />
              </div>
            ))}
          </div>
          {errors[range.minKey] || errors[range.maxKey] ? (
            <p className="text-[13px] text-[var(--danger)] font-medium mt-1">
              {errors[range.maxKey] || errors[range.minKey]}
            </p>
          ) : null}
        </div>
      ))}

      {CRITERIA_CHOICES.map((choice) => (
        <fieldset key={choice.key}>
          <legend className="text-[15px] font-medium text-foreground mb-1">
            {choice.label}
            <span className="text-[var(--danger)] ml-0.5">*</span>
          </legend>
          <p className="text-[13px] text-muted-foreground mb-1.5 leading-snug">{choice.question}</p>
          <div className="flex flex-wrap gap-2">
            {choice.options.map((option) => {
              const checked = draft[choice.key] === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    "flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border text-[15px] cursor-pointer transition-all",
                    checked
                      ? "border-[var(--brand)] bg-[var(--brand-wash)] text-foreground font-semibold"
                      : "border-border bg-background text-muted-foreground hover:border-[var(--brand)]/40"
                  )}
                >
                  <input
                    type="radio"
                    name={`${idPrefix}-${choice.key}`}
                    value={option.value}
                    checked={checked}
                    onChange={() => onChange(choice.key, option.value)}
                    className="accent-[var(--brand)]"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const appState = useAppState();
  const jdFile = appState.jdFile;
  const setJdFile = appState.setJdFile;
  const setJdText = appState.setJdText;
  const setJdRubric = appState.setJdRubric;
  const setResumes = appState.setResumes;
  const savedJDs = appState.savedJDs;
  const addSavedJD = appState.addSavedJD;
  const removeSavedJD = appState.removeSavedJD;
  const activeJDId = appState.activeJDId;
  const setActiveJDId = appState.setActiveJDId;

  const [jdDrag, setJdDrag] = useState(false);
  const [showNewJD, setShowNewJD] = useState(false);

  const [jobName, setJobName] = useState("");
  const [jobIdDigits, setJobIdDigits] = useState("");
  const [primaryLocation, setPrimaryLocation] = useState("");
  /**
   * The requisition's hiring constraints — experience, budget, workplace mode,
   * notice period, buyout. Required, because the HR screening flow *branches*
   * on them: a JD without them asks every candidate every question, ungated.
   *
   * These replaced a set of eight free-text "Standard Recruitment & Eligibility
   * Checks" that HR answered per requisition. They were never compared against
   * anything — just prose sitting beside the candidate's prose — so collecting
   * them was dropped. Answers already stored stay on their JDs and still label
   * the historical answers in the HR modal; nothing writes them any more.
   */
  const [criteria, setCriteria] = useState<CriteriaDraft>(emptyCriteriaDraft);
  const [jdSaved, setJdSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** Which backend stage the upload is on — parsing, analyzing, storing. */
  const [uploadStep, setUploadStep] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState("");

  /** The JD in the database this session is working against, once uploaded. */
  const [uploadedJD, setUploadedJD] = useState<{ jd_uuid: string; skills: string[] } | null>(null);

  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  /**
   * The job descriptions that actually exist in the database.
   *
   * The list used to be driven by `savedJDs` in localStorage, which meant a JD
   * uploaded in another browser — or after a cache clear — was invisible here
   * even though it was sitting in Chroma with resumes attached. The backend is
   * the source of truth; localStorage only keeps the original file blobs.
   */
  const [backendJDs, setBackendJDs] = useState<JDSummary[]>([]);
  const [deletingJD, setDeletingJD] = useState<string | null>(null);
  const [confirmDeleteBackendJD, setConfirmDeleteBackendJD] = useState<JDSummary | null>(null);

  /** The stored JD being edited, plus the values being edited into it. */
  const [editJD, setEditJD] = useState<JDSummary | null>(null);
  const [editDigits, setEditDigits] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editName, setEditName] = useState("");
  /** The stored role criteria, editable — seeded in `openEditJD`. */
  const [editCriteria, setEditCriteria] = useState<CriteriaDraft>(emptyCriteriaDraft);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [jdError, setJdError] = useState("");
  const [confirmRemoveJdSession, setConfirmRemoveJdSession] = useState(false);

  const jdInputRef = useRef<HTMLInputElement>(null);
  /** The JD whose stored role criteria have already been seeded into the form. */
  const seededCriteriaFor = useRef<string>("");

  // Coming back from the dashboard remounts this page, so the form fields are
  // rebuilt from the JD the session is already working against — otherwise the
  // job id looks unset and uploading it again would collide with itself.
  useEffect(() => {
    if (!activeJDId) return;
    const activeJD = savedJDs.find((j) => j.id === activeJDId);
    if (!activeJD) return;
    setJobName(activeJD.jobName);
    setJobIdDigits((activeJD.jobCode || "").replace(/\D/g, ""));
    setPrimaryLocation(activeJD.primaryLocation || "");
    if (activeJD.jdUuid) {
      setUploadedJD((current) => current ?? { jd_uuid: activeJD.jdUuid as string, skills: [] });
    }
    setJdSaved(true);
  }, [activeJDId, savedJDs]);

  // Esc closes whichever dialog is open — never mid-save, so a request in flight
  // can't be walked away from.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || savingEdit || deletingJD) return;
      setEditJD(null);
      setConfirmDeleteBackendJD(null);
      setConfirmRemoveJdSession(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [savingEdit, deletingJD]);

  // Toasts announce and then get out of the way.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Analyzed-resume counts per JD come from the backend, not local snapshots.
  // Refresh on mount, when the picker opens / active JD changes, and whenever the
  // page regains focus — so resumes added from the dashboard (or another tab)
  // update the "already analyzed" count here without a hard reload.
  useEffect(() => {
    const refresh = () =>
      listJDs()
        .then(setBackendJDs)
        .catch(() => {});
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [activeJDId]);

  /**
   * Editing an already-uploaded JD uses the same form, and saving replaces the
   * whole criteria set — so seed it from the database first, once, or re-saving
   * a JD to fix its location would arrive with the criteria blank.
   */
  useEffect(() => {
    if (!uploadedJD || seededCriteriaFor.current === uploadedJD.jd_uuid) return;
    const stored = backendJDs.find((jd) => jd.jd_uuid === uploadedJD.jd_uuid)?.role_criteria;
    if (!stored || Object.keys(stored).length === 0) return;
    seededCriteriaFor.current = uploadedJD.jd_uuid;
    setCriteria(draftFromCriteria(stored));
  }, [uploadedJD, backendJDs]);

  /**
   * Pick the file. Nothing is sent yet.
   *
   * Choosing a file used to upload and parse it on the spot, which stored a JD
   * in the database before anyone had said which requisition it was. The upload
   * now waits for the job id and location.
   */
  function handleJdFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const f = files[0];
    setJdFile({
      id: uid(),
      name: f.name,
      size: f.size,
      type: extOf(f.name),
      status: "done",
      rawFile: f,
    });
    setJdSaved(false);
    setJobName("");
    setJobIdDigits("");
    setPrimaryLocation("");
    setCriteria(emptyCriteriaDraft());
    setUploadedJD(null);
    setUploadError("");
    setActiveJDId(null);
    setResumes([]);
    // A file was chosen, so open the flow — the entry card and the JD list are
    // both pickers for this same step, and neither is what you want to see next.
    setShowNewJD(true);
  }

  // handleResumeFiles / handleReuploadResume / handleAnalyze lived here. This
  // page is the JD's page now: resumes are added from the dashboard, against a
  // JD that is already stored ("Add Resumes" → POST /resume/upload). Screening
  // from two places meant two upload paths, two error strips and two "max 10"
  // rules to keep in step.

  /** Record the JD locally so its file blob survives a reload. */
  async function rememberLocally(jdUuid: string) {
    if (!jdFile) return;
    const localId = activeJDId ?? uid();
    const record: SavedJD = {
      id: localId,
      jobName: jobName.trim(),
      jdUuid,
      jobCode: jobId,
      primaryLocation: primaryLocation.trim(),
      file: jdFile,
      resumes: [],
      savedAt: Date.now(),
    };
    await addSavedJD(record);
    setActiveJDId(localId);
  }

  /**
   * Send the JD to the database under its job id.
   *
   * This is the moment the vector is created — job id and location are part of
   * the same request, so a JD can never exist without them. Editing an
   * already-uploaded JD takes the other branch: the job id is its key, so only
   * the title and location can change.
   */
  async function handleUploadJD() {
    if (!canUploadJD || !jdFile?.rawFile) return;

    setUploading(true);
    setUploadStep(null);
    setUploadError("");
    try {
      if (uploadedJD) {
        await saveJDInfo(
          uploadedJD.jd_uuid,
          primaryLocation.trim(),
          jobName.trim(),
          undefined,
          criteriaFromDraft(criteria)
        );
        await rememberLocally(uploadedJD.jd_uuid);
        setToast({ kind: "success", text: `${jobId} updated` });
      } else {
        const jd = await uploadJD(
          jdFile.rawFile,
          jobId,
          primaryLocation.trim(),
          jobName.trim(),
          criteriaFromDraft(criteria),
          setUploadStep
        );
        setUploadedJD({ jd_uuid: jd.jd_uuid, skills: jd.skills });
        await rememberLocally(jd.jd_uuid);

        // The word cloud reads the parsed text and skills the upload returned,
        // so no second round trip to fetch what we were just handed.
        if (jd.text) setJdText(jd.text);
        try {
          const rubric = await extractJDSkills();
          if (rubric) setJdRubric(rubric);
        } catch (err) {
          console.warn("[Upload] JD skill extraction failed:", err);
        }
        setToast({ kind: "success", text: `${jd.jd_uuid} uploaded successfully` });
      }

      setJdSaved(true);
      await refreshBackendJDs();
    } catch (err) {
      const message = err instanceof Error ? err.message : "The job description could not be uploaded.";
      console.warn("[Upload] JD upload failed:", err);
      setUploadError(message);
      setToast({ kind: "error", text: message });
    } finally {
      setUploading(false);
    }
  }

  // handleSelectSavedJD / handleOpenDashboard / handleOpenAIAssistant were
  // deleted with the three-button JD card. Adding resumes and opening results
  // now go through the JD's uuid, so nothing has to rehydrate the original
  // file blob from IndexedDB just to reach a stored job description.

  /** Refresh the JD list from the database. */
  async function refreshBackendJDs() {
    try {
      setBackendJDs(await listJDs());
    } catch (err) {
      console.warn("[Upload] Could not refresh job descriptions:", err);
    }
  }

  // The per-row "Add resumes" and "Results" actions were removed, so their
  // handlers went with them. Adding resumes to an existing JD now happens from
  // the dashboard's own "Add Resumes"; results are reached through the nav.

  function openEditJD(jd: JDSummary) {
    setEditJD(jd);
    setEditDigits((jd.job_code || "").replace(/\D/g, ""));
    setEditLocation(jd.primary_location || "");
    setEditName(jd.job_name || "");
    // Seeded from the database so the dialog shows what is actually stored, and
    // so saving can't silently blank a criterion nobody touched. JDs from before
    // the criteria existed open blank.
    setEditCriteria(draftFromCriteria(jd.role_criteria));
    setEditError("");
  }

  /**
   * Save the edited job id / location / title.
   *
   * A changed job id moves the JD — the id is its key — so the backend hands
   * back the id it now lives under and everything holding the old one is
   * repointed here.
   */
  async function handleSaveEdit() {
    if (!editJD || !canSaveEdit) return;
    setSavingEdit(true);
    setEditError("");
    try {
      const newId = await saveJDInfo(
        editJD.jd_uuid,
        editLocation.trim(),
        editName.trim(),
        editDigitsComplete ? JOB_ID_PREFIX + editDigits : undefined,
        // A sent set replaces the stored one and has to be complete, so send it
        // only when it is. A JD from before the criteria, left blank, keeps its
        // empty set rather than blocking a location fix behind eight fields.
        criteriaValid(editCriteria) ? criteriaFromDraft(editCriteria) : undefined
      );

      if (uploadedJD?.jd_uuid === editJD.jd_uuid) {
        setUploadedJD({ ...uploadedJD, jd_uuid: newId });
        setJobIdDigits(editDigits);
        setPrimaryLocation(editLocation.trim());
        setJobName(editName.trim());
        if (criteriaValid(editCriteria)) setCriteria(editCriteria);
      }

      await refreshBackendJDs();
      setToast({
        kind: "success",
        text: newId === editJD.jd_uuid ? `${newId} updated` : `Job ID changed to ${newId}`,
      });
      setEditJD(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save those changes.";
      console.warn("[Upload] Editing the JD failed:", err);
      setEditError(message);
    } finally {
      setSavingEdit(false);
    }
  }

  /** Permanently delete a JD and everything screened against it. */
  async function handleDeleteBackendJD(jd: JDSummary) {
    setDeletingJD(jd.jd_uuid);
    setJdError("");
    try {
      await deleteJD(jd.jd_uuid);
      // Drop the matching local record too, so the file blobs don't linger.
      const local = savedJDs.find((s) => s.jdUuid === jd.jd_uuid);
      if (local) await removeSavedJD(local.id);
      if (localStorage.getItem("exl_last_jd_uuid") === jd.jd_uuid) {
        localStorage.removeItem("exl_last_jd_uuid");
      }
      await refreshBackendJDs();
    } catch (err) {
      console.warn("[Upload] Deleting the JD failed:", err);
      setJdError(err instanceof Error ? err.message : "Could not delete that job description.");
    } finally {
      setDeletingJD(null);
      setConfirmDeleteBackendJD(null);
    }
  }

  function handleRemoveJdFromSession() {
    setJdFile(null);
    setJdSaved(false);
    setJobName("");
    setJobIdDigits("");
    setPrimaryLocation("");
    setCriteria(emptyCriteriaDraft());
    setUploadedJD(null);
    setUploadError("");
    setActiveJDId(null);
    setResumes([]);
    setShowNewJD(false);
  }

  function handleEditSavedJD() {
    setJdSaved(false);
  }

  // ── Job id ────────────────────────────────────────────────────────────────
  // The prefix is fixed, so only the digits are state. The clash is caught here
  // against the JDs already on screen — HR sees it while typing rather than
  // after a failed upload — and the backend enforces it again on submit, which
  // is what catches an id another recruiter claimed a minute ago.
  const jobId = JOB_ID_PREFIX + jobIdDigits;
  const takenJobIds = new Set(
    backendJDs
      .map((jd) => jd.job_code || jd.jd_uuid)
      .filter((code): code is string => Boolean(code))
  );
  const jobIdComplete = jobIdDigits.length === JOB_ID_DIGITS;
  // An existing JD keeps its own id — only a *new* one can collide.
  const jobIdTaken = jobIdComplete && !uploadedJD && takenJobIds.has(jobId);
  const jobIdError = jobIdTaken
    ? `${jobId} is already taken`
    : jobIdDigits.length > 0 && !jobIdComplete
      ? `Job ID needs ${JOB_ID_DIGITS} digits`
      : "";

  /** Digits only, capped at six — and a clash is announced the moment it forms. */
  function handleJobIdChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, JOB_ID_DIGITS);
    setJobIdDigits(digits);
    setUploadError("");
    if (digits.length === JOB_ID_DIGITS && takenJobIds.has(JOB_ID_PREFIX + digits)) {
      setToast({
        kind: "error",
        text: `Job ID ${JOB_ID_PREFIX + digits} is already taken. Enter a different one.`,
      });
    }
  }

  // Same rules for the edit dialog, minus the JD's own id — re-saving a JD
  // under the id it already has is not a clash.
  const editDigitsComplete = editDigits.length === JOB_ID_DIGITS;
  const editIdTaken =
    editDigitsComplete &&
    JOB_ID_PREFIX + editDigits !== editJD?.job_code &&
    takenJobIds.has(JOB_ID_PREFIX + editDigits);
  const editIdError = editIdTaken
    ? `${JOB_ID_PREFIX + editDigits} is already taken`
    : editDigits.length > 0 && !editDigitsComplete
      ? `Job ID needs ${JOB_ID_DIGITS} digits`
      : "";
  // Three states for the criteria — all set (sent), all blank (a JD from before
  // they existed, left alone), part-set or inconsistent (blocked, because
  // sending it 400s and dropping it would quietly discard the edit).
  const editCriteriaFilled = criteriaFilledCount(editCriteria);
  const editCriteriaBlocked =
    editCriteriaFilled > 0 && !criteriaValid(editCriteria);
  const canSaveEdit =
    editDigitsComplete &&
    !editIdTaken &&
    editLocation.trim() !== "" &&
    !editCriteriaBlocked &&
    !savingEdit;

  const criteriaComplete = criteriaValid(criteria);

  const canUploadJD =
    Boolean(jdFile?.rawFile) &&
    jobName.trim() !== "" &&
    jobIdComplete &&
    !jobIdTaken &&
    primaryLocation.trim() !== "" &&
    criteriaComplete &&
    !uploading;

  /** Where the JD stands: uploaded and labelled, ready for resumes. */
  const jdReadyForResumes = Boolean(uploadedJD) && jdSaved;

  /** How many resumes are already screened against this JD, per the database. */
  const analyzedForActive = uploadedJD
    ? backendJDs.find((j) => j.jd_uuid === uploadedJD.jd_uuid)?.resume_count ?? 0
    : 0;


  return (
    <div className="flex flex-col h-full">
      {/* Same header scale as Dashboard and AI Assistant. The nav calls this
          "Upload", so the page does too — it used to say "Home", which is the
          system's word rather than anything the user clicked. */}
      <div className="border-b border-border px-8 py-4 bg-card/50 rise">
        {/* The "Screening" eyebrow was removed on request — the page names
            itself. */}
        <h1 className="text-[21px] font-semibold tracking-[-0.02em] text-foreground leading-[1.15]">
          Upload JD
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Upload a Job Description, then add resumes to screen against it.
        </p>
      </div>

       <div className="flex-1 overflow-y-auto p-6">
         <div className="max-w-6xl mx-auto">
           {/* ── One primary action: upload a job description ──────────────
               This used to be two identical "Start New Analysis" buttons (one
               in the empty state, one in the list header) plus three buttons on
               every JD card. Now the page has a single obvious way in. */}
           {/* This card *is* the file picker. It used to only reveal a second,
               identical empty dropzone — one click for nothing. Choosing a file
               here opens the upload flow with the JD already picked, so the
               details form (and its screening questions) is what comes next. */}
           {!showNewJD && (
             <label
               onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setJdDrag(true); }}
               onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setJdDrag(false); }}
               onDrop={(e) => {
                 e.preventDefault();
                 e.stopPropagation();
                 setJdDrag(false);
                 handleJdFiles(e.dataTransfer.files);
               }}
               className={cn(
                 "w-full rounded-2xl border-2 border-dashed transition-all p-14 flex flex-col items-center text-center group rise cursor-pointer",
                 jdDrag
                   ? "border-[var(--brand)] bg-[var(--brand)]/10"
                   : "border-border hover:border-[var(--brand)] hover:bg-[var(--brand-wash)]"
               )}
             >
               <div
                 className="w-20 h-20 rounded-2xl flex items-center justify-center mb-5 transition-transform group-hover:scale-105"
                 style={{ background: "var(--brand-wash)" }}
               >
                 <Upload size={36} style={{ color: "var(--brand)" }} />
               </div>
               <p className="text-[26px] font-semibold tracking-[-0.016em] text-foreground">
                 {jdDrag ? "Drop to upload" : "Upload a Job Description"}
               </p>
               <p className="text-[17px] text-muted-foreground mt-2.5 max-w-xl leading-relaxed">
                 Drop a file here or click to browse — PDF, DOCX, TXT or PPT. Then add
                 resumes to see analysis on dashboard for all candidates.
               </p>
               <input
                 type="file"
                 accept=".pdf,.docx,.txt,.ppt,.pptx"
                 className="hidden"
                 onChange={(e) => handleJdFiles(e.target.files)}
               />
             </label>
           )}

           {jdError && (
             <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[var(--danger)]/10 border border-[var(--danger)]/30">
               <AlertTriangle size={14} className="text-[var(--danger)] mt-0.5 flex-shrink-0" />
               <p className="text-[13px] text-[var(--danger)]">{jdError}</p>
             </div>
           )}

           {/* ── Already uploaded, straight from the database ──────────────── */}
           {!showNewJD && backendJDs.length > 0 && (
             <div className="mt-8 rise" style={{ animationDelay: "60ms" }}>
               <div className="flex items-baseline gap-2 mb-3">
                 <h2 className="eyebrow-lg">Already uploaded</h2>
                 <span className="numeral text-[13px] text-muted-foreground">{backendJDs.length}</span>
               </div>

               <div className="space-y-2.5">
                 {backendJDs.map((jd) => {
                   const busy = deletingJD === jd.jd_uuid;
                   const title = jd.job_name || jd.source || "Untitled job description";
                   // The job id is the JD's identity, so it is always shown —
                   // JDs uploaded before job ids existed carry a uuid instead
                   // and say so rather than showing a meaningless string.
                   const code = jd.job_code || "";
                   const location = jd.primary_location || "";
                   // Clicking the row opens the posting HR uploaded. Undefined for
                   // JDs stored before the file was kept — those stay unclickable
                   // rather than opening a tab on a 404.
                   const fileUrl = jdFileUrl(jd);

                   const face = (
                     <>
                       <div
                         className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                         style={{ background: "var(--brand-wash)" }}
                       >
                         <FileText size={20} style={{ color: "var(--brand)" }} />
                       </div>

                       <div className="flex-1 min-w-0">
                         <p className="text-[17px] font-semibold text-foreground truncate flex items-center gap-1.5">
                           <span className="truncate">{title}</span>
                           {fileUrl && (
                             <ExternalLink
                               size={11}
                               className="flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                             />
                           )}
                         </p>
                         <div className="flex items-center gap-3 mt-1.5 text-[15px] text-muted-foreground">
                           <span className="flex items-center gap-1 flex-shrink-0">
                             <Hash size={13} className="opacity-60" />
                             {code ? (
                               <span className="numeral text-foreground">{code}</span>
                             ) : (
                               <span className="italic">No job ID</span>
                             )}
                           </span>
                           <span className="flex items-center gap-1 min-w-0">
                             <MapPin size={13} className="opacity-60 flex-shrink-0" />
                             <span className="truncate">{location || <span className="italic">No location</span>}</span>
                           </span>
                         </div>
                       </div>
                     </>
                   );

                   return (
                     <div
                       key={jd.jd_uuid}
                       className={cn(
                         "bg-card border border-border rounded-2xl p-5 transition-all hover:border-[var(--brand)]/40",
                         busy && "opacity-60"
                       )}
                     >
                       <div className="flex items-center gap-3">
                         {fileUrl ? (
                           <a
                             href={fileUrl}
                             target="_blank"
                             rel="noopener noreferrer"
                             title="Open this job description in a new tab"
                             className="group flex items-center gap-3 flex-1 min-w-0 rounded-xl -m-1 p-1 hover:bg-secondary/40 transition-colors"
                           >
                             {face}
                           </a>
                         ) : (
                           <div
                             className="flex items-center gap-3 flex-1 min-w-0"
                             title="The original file wasn't kept for this job description — re-upload it to view"
                           >
                             {face}
                           </div>
                         )}

                         {/* How many resumes are mapped to this JD. The figure is
                             the whole point of the row, so it gets the readout
                             treatment rather than sitting in a sentence. */}
                         <div className="flex items-center gap-4 flex-shrink-0">
                           <div className="text-right">
                             <p
                               className="readout text-[26px]"
                               style={{ color: jd.resume_count > 0 ? "var(--brand)" : "var(--muted-foreground)" }}
                             >
                               {jd.resume_count}
                             </p>
                             <p className="text-[13px] text-muted-foreground mt-0.5">
                               resume{jd.resume_count === 1 ? "" : "s"}
                             </p>
                           </div>

                           <button
                             type="button"
                             onClick={() => openEditJD(jd)}
                             disabled={busy}
                             title="Change the job ID or location"
                             aria-label={"Edit " + title}
                             className="p-2 rounded-lg text-muted-foreground hover:text-[var(--brand)] hover:bg-[var(--brand-wash)] transition-colors disabled:opacity-40"
                           >
                             <Pencil size={16} />
                           </button>

                           <button
                             type="button"
                             onClick={() => setConfirmDeleteBackendJD(jd)}
                             disabled={busy}
                             title="Delete this job description"
                             aria-label={"Delete " + title}
                             className="p-2 rounded-lg text-muted-foreground hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors disabled:opacity-40"
                           >
                             {busy ? (
                               <Loader2 size={16} className="animate-spin" />
                             ) : (
                               <Trash2 size={16} />
                             )}
                           </button>
                         </div>
                       </div>
                     </div>
                   );
                 })}
               </div>
             </div>
           )}

            {/* Either the entry card or this flow — never both. It used to also
                open whenever the database had no JDs, which stacked a second
                "Drop JD here" panel under the entry card that is already a
                picker. */}
            {showNewJD ? (
              <div className={backendJDs.length > 0 ? "border-t border-border pt-6 mt-8" : ""}>
                <button
                  type="button"
                  onClick={() => setShowNewJD(false)}
                  className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground mb-4 transition-colors"
                >
                  <ChevronDown size={12} className="rotate-90" />
                  {backendJDs.length > 0 ? "Back to existing JDs" : "Back"}
                </button>
                {/* One column since the resumes panel left: a half-width card
                    beside empty space read as something failing to load. */}
                <div className="max-w-4xl mx-auto">

          {/* LEFT: JD */}
          <div className="bg-card border border-border rounded-2xl p-5 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: "var(--brand-wash)" }}>
                  <FilePlus size={13} style={{ color: "var(--brand)" }} />
                </div>
                <p className="eyebrow-lg">Job description</p>
              </div>

              {/* The "Saved JDs" dropdown lived here and listed the same job
                  descriptions a third time, with its own select and delete
                  actions. The "Already uploaded" list on the main view does
                  that job with the matched candidates visible, so this is gone
                  rather than kept in sync. */}
             </div>

             {!jdFile ? (
              <label
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setJdDrag(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setJdDrag(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setJdDrag(false);
                  handleJdFiles(e.dataTransfer.files);
                }}
                className={cn(
                  "flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all p-8 text-center min-h-[280px]",
                  jdDrag
                    ? "border-[var(--brand)] bg-[var(--brand)]/10"
                    : "border-white/15 hover:border-[var(--brand)]/60 hover:bg-[var(--brand)]/5"
                )}
              >
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ background: "var(--brand-wash)" }}>
                  <Upload size={22} style={{ color: "var(--brand)" }} />
                </div>
                <p className="text-[15px] font-semibold text-foreground mb-1">
                  {jdDrag ? "Drop to upload" : "Drop JD here"}
                </p>
                <p className="text-[13px] text-muted-foreground mb-4">PDF, DOCX, TXT, or PPT up to 10MB</p>
                <span
                  className="text-[13px] font-semibold px-4 py-2 rounded-lg text-white"
                  style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}
                >
                  Browse file
                </span>
                <input
                  ref={jdInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.ppt,.pptx"
                  className="hidden"
                  onChange={(e) => handleJdFiles(e.target.files)}
                />
              </label>
            ) : (
              <div className="flex-1 flex flex-col gap-3">

                {/* File preview — only before save */}
                {!jdSaved ? (
                  <>
                    <div className="flex items-center gap-3 bg-[var(--decision-interview)]/10 border border-[var(--decision-interview)]/30 rounded-xl px-4 py-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--brand-wash)" }}>
                        <FileText size={16} style={{ color: "var(--brand)" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-foreground truncate">{jdFile.name}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {fmtSize(jdFile.size)} · {jdFile.rawFile ? "Ready" : "Needs re-upload"}
                        </p>
                      </div>
                      {jdFile.rawFile ? (
                        <CheckCircle2 size={16} className="text-[var(--decision-interview)] flex-shrink-0" />
                      ) : (
                        <AlertTriangle size={16} className="text-[var(--decision-hold)] flex-shrink-0" />
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveJdSession(true)}
                        className="text-muted-foreground hover:text-[var(--danger)] ml-1"
                        title="Remove this JD from the active session"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </>
                ) : null}

                {/* The details that make this JD a requisition. Nothing is
                    stored until they're filled in — the job id is the JD's
                    identity, so it can't be added as an afterthought. */}
                {!jdSaved ? (
                  <div className="bg-secondary/60 rounded-xl p-5 border border-border space-y-4">
                    <p className="eyebrow-lg">
                      {uploadedJD ? "Edit this job description" : "Job details"}
                    </p>

                    <div>
                      <label htmlFor="jd-job-name" className="text-[15px] font-medium text-foreground mb-1.5 block">Job Name</label>
                      <div className="relative">
                        <Briefcase size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                          id="jd-job-name"
                          value={jobName}
                          onChange={(e) => setJobName(e.target.value)}
                          placeholder="e.g. Senior Backend Engineer"
                          className="w-full pl-9 pr-3 py-2.5 text-[15px] rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 transition-all"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <JobIdField
                        id="jd-job-id"
                        value={jobIdDigits}
                        onChange={handleJobIdChange}
                        error={jobIdError}
                        hint={`${JOB_ID_DIGITS} digits after EXL`}
                        disabled={Boolean(uploadedJD)}
                      />

                      <div>
                        <label htmlFor="jd-location" className="text-[15px] font-medium text-foreground mb-1.5 block">
                          Primary Location
                        </label>
                        <div className="relative">
                          <MapPin size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                          <input
                            id="jd-location"
                            value={primaryLocation}
                            onChange={(e) => setPrimaryLocation(e.target.value)}
                            placeholder="e.g. Gurgaon"
                            className="w-full pl-9 pr-3 py-2.5 text-[15px] rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 transition-all"
                          />
                        </div>
                        <p className="text-[13px] text-muted-foreground mt-1">Where the role sits</p>
                      </div>
                    </div>

                    {/* The requisition's hiring constraints. Required, and not
                        merely for the record: the HR screening flow branches on
                        them — a candidate under the minimum experience ends the
                        screening, an expected CTC over the budget triggers the
                        negotiation question. */}
                    <div className="pt-2 border-t border-border space-y-4">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="eyebrow-lg">Role criteria</p>
                        <span
                          className="text-[13px] font-medium"
                          style={{ color: criteriaComplete ? "var(--decision-interview)" : "var(--muted-foreground)" }}
                        >
                          <span className="numeral">{criteriaFilledCount(criteria)}</span>
                          {" / "}
                          <span className="numeral">{CRITERIA_KEYS.length}</span> set
                        </span>
                      </div>
                      <p className="text-[13px] text-muted-foreground leading-relaxed">
                        All required. This criteria helps evaluate the probability
                        of joining of candidates.
                      </p>

                      <RoleCriteriaFields
                        idPrefix="jd-criteria"
                        draft={criteria}
                        onChange={(key, value) => {
                          setCriteria((prev) => ({ ...prev, [key]: value }));
                          setUploadError("");
                        }}
                      />
                    </div>

                    {/* The eight free-text "Standard Recruitment & Eligibility
                        Checks" were here. They were never compared against
                        anything — prose beside the candidate's prose — so
                        collecting them was dropped. The role criteria above are
                        what the screening actually branches on. */}

                    {uploadError ? (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30">
                        <AlertTriangle size={15} className="text-[var(--danger)] mt-0.5 flex-shrink-0" />
                        <p className="text-[15px] text-[var(--danger)]">{uploadError}</p>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={handleUploadJD}
                      disabled={!canUploadJD}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-white text-[15px] font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}
                    >
                      {uploading ? (
                        <>
                          <Loader2 size={15} className="animate-spin" />
                          {uploadedJD ? "Saving…" : "Uploading JD…"}
                        </>
                      ) : (
                        <>
                          <Upload size={15} />
                          {uploadedJD ? "Save changes" : "Upload JD"}
                        </>
                      )}
                    </button>

                    {/* Parsing and skill extraction take a few seconds — long
                        enough that a still button reads as a dead one. */}
                    {uploading && (
                      <ProgressBar
                        overlay
                        label={stageLabel(uploadStep, uploadedJD ? "Saving changes" : "Uploading the job description")}
                        percent={uploadStep?.percent}
                      />
                    )}
                  </div>
                ) : (
                  /* Uploaded */
                  <div className="flex items-center gap-3 bg-[var(--brand)]/8 border border-[var(--brand)]/30 rounded-xl px-4 py-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--brand-wash)" }}>
                      <Briefcase size={16} style={{ color: "var(--brand)" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-foreground truncate">{jobName}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        <span className="numeral">{uploadedJD?.jd_uuid || jobId}</span>
                        {primaryLocation.trim() ? " · " + primaryLocation.trim() : ""}
                      </p>
                    </div>
                    <CheckCircle2 size={16} className="text-[var(--decision-interview)] flex-shrink-0" />
                    <button
                      type="button"
                      onClick={handleEditSavedJD}
                      className="text-muted-foreground hover:text-foreground ml-1"
                      title="Edit this Job Description"
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      ) : null}
    </div>
  </div>
      {/* The JD's next step is on the dashboard: resumes are uploaded there,
          against a JD that is already stored. This bar used to hold "Analyze
          Candidates" for resumes picked on this page. */}
      {showNewJD && (
      <div className="border-t border-border bg-card/80 backdrop-blur-sm px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4 text-[13px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={12} className={jdReadyForResumes ? "text-[var(--decision-interview)]" : "text-muted-foreground/40"} />
            {jdReadyForResumes ? (
              <>JD <span className="numeral">{uploadedJD?.jd_uuid}</span> uploaded</>
            ) : (
              "JD not uploaded yet"
            )}
          </span>
          {analyzedForActive > 0 ? (
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={12} className="text-[var(--decision-interview)]" />
              <span className="numeral">{analyzedForActive}</span> resume{analyzedForActive === 1 ? "" : "s"} already screened
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => {
            // Point the dashboard at this JD, so Add Resumes there can't land on
            // whichever JD was last opened. The previous JD's candidates are
            // still in memory (this is a client-side navigation) and would sit
            // under the new JD's name until its own fetch landed — drop them.
            if (uploadedJD) localStorage.setItem("exl_last_jd_uuid", uploadedJD.jd_uuid);
            appState.setEvaluations([]);
            router.push("/dashboard");
          }}
          disabled={!jdReadyForResumes}
          className="flex items-center gap-2.5 px-8 py-3.5 rounded-xl text-white text-[17px] font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: "linear-gradient(135deg, var(--brand), var(--brand-strong))",
            boxShadow: jdReadyForResumes ? "0 4px 16px var(--brand-wash)" : "none",
          }}
        >
          <Zap size={18} />Dashboard<ArrowRight size={17} />
        </button>
      </div>
      )}

      {/* Edit a stored JD. The job ID is the JD's key, so changing it moves the
          JD and every resume screened against it — the dialog says so rather
          than letting that happen silently. */}
      {editJD ? (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => !savingEdit && setEditJD(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-2xl px-6 pb-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            {/* Sticky, so the close button stays reachable — the screening
                questions make this dialog taller than the viewport, which used to
                push Cancel below the fold with no other way out. */}
            <div className="flex items-center gap-3 mb-5 sticky top-0 bg-card pt-6 pb-3 z-10">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand-wash)" }}>
                <Pencil size={17} style={{ color: "var(--brand)" }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">Edit job description</p>
                <p className="text-[13px] text-muted-foreground truncate">
                  {editJD.job_name || editJD.source || "Untitled job description"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditJD(null)}
                disabled={savingEdit}
                title="Close without saving (Esc)"
                aria-label="Close"
                className="p-2 -mr-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 flex-shrink-0"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="edit-job-name" className="text-[15px] font-medium text-foreground mb-1.5 block">Job Name</label>
                <div className="relative">
                  <Briefcase size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="edit-job-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="e.g. Senior Backend Engineer"
                    className="w-full pl-9 pr-3 py-2.5 text-[15px] rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <JobIdField
                  id="edit-job-id"
                  value={editDigits}
                  onChange={(digits) => { setEditDigits(digits); setEditError(""); }}
                  error={editIdError}
                  hint={`${JOB_ID_DIGITS} digits after EXL`}
                />
                <div>
                  <label htmlFor="edit-location" className="text-[15px] font-medium text-foreground mb-1.5 block">
                    Primary Location
                  </label>
                  <div className="relative">
                    <MapPin size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      id="edit-location"
                      value={editLocation}
                      onChange={(e) => setEditLocation(e.target.value)}
                      placeholder="e.g. Gurgaon"
                      className="w-full pl-9 pr-3 py-2.5 text-[15px] rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 transition-all"
                    />
                  </div>
                  <p className="text-[13px] text-muted-foreground mt-1">Where the role sits</p>
                </div>
              </div>

              {/* The saved role criteria, editable here under the same
                  whole-set-or-nothing rule as the screening answers below. */}
              <div className="pt-2 border-t border-border space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="eyebrow-lg">Role criteria</p>
                  <span
                    className="text-[11px] font-medium"
                    style={{
                      color: editCriteriaBlocked
                        ? "var(--decision-rejected)"
                        : editCriteriaFilled === CRITERIA_KEYS.length
                          ? "var(--decision-interview)"
                          : "var(--muted-foreground)",
                    }}
                  >
                    <span className="numeral">{editCriteriaFilled}</span>
                    {" / "}
                    <span className="numeral">{CRITERIA_KEYS.length}</span> set
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  What each candidate&apos;s screening branches on. Saving replaces the whole
                  set, so leave them all set — or all blank to leave the stored ones
                  untouched.
                </p>

                <RoleCriteriaFields
                  idPrefix="edit-criteria"
                  draft={editCriteria}
                  onChange={(key, value) => {
                    setEditCriteria((prev) => ({ ...prev, [key]: value }));
                    setEditError("");
                  }}
                />

                {editCriteriaBlocked ? (
                  <p className="text-[11px] font-medium" style={{ color: "var(--decision-rejected)" }}>
                    {editCriteriaFilled < CRITERIA_KEYS.length
                      ? `Set the remaining ${CRITERIA_KEYS.length - editCriteriaFilled} to save — a partial set can't be stored.`
                      : "Fix the ranges above to save."}
                  </p>
                ) : null}
              </div>

              {/* The eight free-text screening answers were editable here too.
                  Gone with the upload form's copy — see the note there. */}

              {editDigitsComplete && JOB_ID_PREFIX + editDigits !== editJD.job_code && editJD.resume_count > 0 ? (
                <p className="text-[13px] text-muted-foreground bg-secondary/60 border border-border rounded-lg px-3 py-2">
                  <span className="numeral text-foreground font-medium">{editJD.resume_count}</span> screened
                  resume{editJD.resume_count === 1 ? "" : "s"} will move to{" "}
                  <span className="numeral text-foreground font-medium">{JOB_ID_PREFIX + editDigits}</span> with it.
                </p>
              ) : null}

              {editError ? (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30">
                  <AlertTriangle size={13} className="text-[var(--danger)] mt-0.5 flex-shrink-0" />
                  <p className="text-[13px] text-[var(--danger)]">{editError}</p>
                </div>
              ) : null}
            </div>

            <div className="flex gap-2.5 mt-5">
              <button
                type="button"
                onClick={() => setEditJD(null)}
                disabled={savingEdit}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold border border-border text-foreground hover:bg-secondary transition-all disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={!canSaveEdit}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-strong))" }}
              >
                {savingEdit ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                Save changes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirm delete saved JD */}
      {/* This delete now really deletes: the JD and its resumes leave the
          database and the resume files leave disk. Previously it only cleared
          localStorage, so the JD came straight back in the dashboard picker.
          The dialog says exactly what goes. */}
      {confirmDeleteBackendJD ? (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setConfirmDeleteBackendJD(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "var(--danger-wash)" }}>
                <AlertTriangle size={18} className="text-[var(--danger)]" />
              </div>
              <div>
                <p className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">
                  Delete this job description?
                </p>
                <p className="text-[13px] text-muted-foreground">This cannot be undone</p>
              </div>
            </div>
            <div className="bg-secondary/50 rounded-xl p-3 mb-5">
              <p className="text-[13px] font-semibold text-foreground truncate">
                {confirmDeleteBackendJD.job_name || confirmDeleteBackendJD.source}
              </p>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {confirmDeleteBackendJD.resume_count > 0 ? (
                  <>
                    <span className="numeral">{confirmDeleteBackendJD.resume_count}</span> screened
                    candidate{confirmDeleteBackendJD.resume_count === 1 ? "" : "s"} will be deleted with it
                  </>
                ) : (
                  "No candidates have been screened against it"
                )}
              </p>
            </div>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDeleteBackendJD(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold border border-border text-foreground hover:bg-secondary transition-all"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => handleDeleteBackendJD(confirmDeleteBackendJD)}
                disabled={deletingJD !== null}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, var(--danger), var(--danger-strong))" }}
              >
                {deletingJD ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirm remove JD from session */}
      {confirmRemoveJdSession && jdFile ? (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setConfirmRemoveJdSession(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "var(--danger-wash)" }}>
                <AlertTriangle size={18} className="text-[var(--danger)]" />
              </div>
              <div>
                <p className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">Remove this JD?</p>
                <p className="text-[13px] text-muted-foreground">This action cannot be undone</p>
              </div>
            </div>
            <div className="bg-secondary/50 rounded-xl p-3 mb-5">
              <p className="text-[13px] font-semibold text-foreground truncate">{jdFile.name}</p>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                It hasn&apos;t been uploaded yet, so nothing in the database changes
              </p>
            </div>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmRemoveJdSession(false)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold border border-border text-foreground hover:bg-secondary transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { handleRemoveJdFromSession(); setConfirmRemoveJdSession(false); }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg, var(--danger), var(--danger-strong))" }}
              >
                <Trash2 size={13} />Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirmation lands in the corner, clear of the analyse bar: it reports
          what happened without taking over the screen, and carries the job id
          so HR can check it against the requisition. */}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 right-6 z-[60] flex items-start gap-2.5 max-w-sm px-4 py-3 rounded-xl border shadow-lg rise bg-card"
          style={{
            borderColor: toast.kind === "success" ? "var(--decision-interview)" : "var(--danger)",
          }}
        >
          {toast.kind === "success" ? (
            <CheckCircle2 size={16} className="flex-shrink-0 mt-px" style={{ color: "var(--decision-interview)" }} />
          ) : (
            <AlertTriangle size={16} className="flex-shrink-0 mt-px text-[var(--danger)]" />
          )}
          <p className="text-[13px] text-foreground leading-relaxed">{toast.text}</p>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground flex-shrink-0 mt-px"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}