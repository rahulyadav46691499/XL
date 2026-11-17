"use client";

import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { storeFileBlob, getFileBlob, deleteFileBlob } from "@/lib/db";
import {
  JDRubric,
  JDSummary,
  UploadProgress,
  listJDs,
  loadSession,
  restoreLastSession,
  uploadResumesForJD,
  describeFailures,
  CandidateEvaluation,
} from "@/lib/api";

export type UploadedFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  status?: "done" | "uploading" | "queued";
  rawFile?: File;
};

export type SavedJD = {
  id: string;
  jobName: string;
  jdUuid?: string; // backend uuid — lets saved JDs load from the db without re-parsing
  jobCode?: string;
  primaryLocation?: string;
  file: UploadedFile;
  resumes: UploadedFile[];
  savedAt: number;
};

/**
 * Re-exported, not redeclared. This file used to carry its own copy of the
 * shape, which drifted from the one in lib/api.ts (its `hr_screening` was
 * missing `selected_questions`) — so every call passing state into an api
 * function was a type error. lib/api.ts owns the shape; this is an alias.
 */
export type { CandidateEvaluation } from "@/lib/api";

const STORAGE_KEY = "exl_saved_jds";
const TWO_WEEKS_MS = 1000 * 60 * 60 * 24 * 14;

function isExpired(jd: SavedJD): boolean {
  return Date.now() - jd.savedAt > TWO_WEEKS_MS;
}

function loadSavedJDs(): SavedJD[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const jds: SavedJD[] = raw ? JSON.parse(raw) : [];
    const normalized = jds.map((jd) => ({ ...jd, resumes: jd.resumes || [] }));
    const fresh = normalized.filter((jd) => !isExpired(jd));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    return [];
  }
}

function persistSavedJDs(jds: SavedJD[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jds));
  } catch {
    // ignore
  }
}

type AppState = {
  jdFile: UploadedFile | null;
  setJdFile: (f: UploadedFile | null) => void;
  jdText: string;
  setJdText: (t: string) => void;
  jdRubric: JDRubric | null;
  setJdRubric: (r: JDRubric | null) => void;
  resumes: UploadedFile[];
  addResumes: (files: UploadedFile[]) => void;
  removeResume: (id: string) => void;
  setResumes: (files: UploadedFile[]) => void;
  hasAnalyzed: boolean;
  setHasAnalyzed: (v: boolean) => void;
  savedJDs: SavedJD[];
  addSavedJD: (jd: SavedJD) => Promise<void>;
  removeSavedJD: (id: string) => Promise<void>;
  updateSavedJDResumes: (jdId: string, resumes: UploadedFile[]) => void;
  activeJDId: string | null;
  setActiveJDId: (id: string | null) => void;
  evaluations: CandidateEvaluation[];
  setEvaluations: (e: CandidateEvaluation[]) => void;
  /**
   * Which requisition is open, and its cohort — shared because two screens now
   * show it (the Dashboard and Collective analysis) and they must never
   * disagree about which JD the figures belong to.
   *
   * These four actions all end in `setEvaluations`, which is why they live here
   * rather than in either page: a second copy of "switch JD" or "add resumes"
   * is how one screen ends up listing candidates the other has replaced.
   */
  jds: JDSummary[];
  selectedJd: string;
  /** Re-read the JD list, so the counts match the Upload JD page. */
  refreshJds: () => Promise<void>;
  /** Switch to a JD and load its screening. */
  openJd: (uuid: string) => Promise<void>;
  /** Restore whichever JD was last open — the reload / cold-open path. */
  openLastJd: () => Promise<void>;
  switchingJd: boolean;
  /** Add resumes to the open requisition. */
  uploadMore: (files: File[]) => Promise<void>;
  uploading: boolean;
  /** How many files the batch in flight holds, and the backend's stage. */
  uploadCount: number;
  uploadStep: UploadProgress | null;
  uploadError: string;
  setUploadError: (message: string) => void;
  updateEvaluationDecision: (candidateId: string, newDecision: "Rejected" | "On Hold" | "Interview") => void;
  loadSavedJDWithFiles: (jd: SavedJD) => Promise<{ jdFile: UploadedFile; resumes: UploadedFile[] }>;
  resetApp: () => void;
};

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [jdFile, setJdFile] = useState<UploadedFile | null>(null);
  const [jdText, setJdText] = useState("");
  const [jdRubric, setJdRubric] = useState<JDRubric | null>(null);
  const [resumes, setResumesState] = useState<UploadedFile[]>([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [savedJDs, setSavedJDs] = useState<SavedJD[]>([]);
  const [activeJDId, setActiveJDIdState] = useState<string | null>(null);
  const [evaluations, setEvaluations] = useState<CandidateEvaluation[]>([]);
  const [jds, setJds] = useState<JDSummary[]>([]);
  const [selectedJd, setSelectedJd] = useState("");
  const [switchingJd, setSwitchingJd] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadStep, setUploadStep] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState("");

  // Keep a ref-like value accessible inside callbacks without stale closure issues
  const activeJDIdRef = { current: activeJDId };

  function setActiveJDId(id: string | null) {
    setActiveJDIdState(id);
  }

  useEffect(() => {
    // A previous analysis is restorable from the backend, so keep the
    // Dashboard/AI Assistant nav unlocked across page reloads.
    if (localStorage.getItem("exl_last_jd_uuid")) {
      setHasAnalyzed(true);
    } else {
      listJDs()
        .then((jds) => { if (jds.length > 0) setHasAnalyzed(true); })
        .catch(() => {});
    }
    setSavedJDs(loadSavedJDs());
    const interval = setInterval(() => {
      setSavedJDs((prev) => {
        const fresh = prev.filter((jd) => !isExpired(jd));
        if (fresh.length !== prev.length) {
          const expiredJDs = prev.filter((jd) => isExpired(jd));
          expiredJDs.forEach((jd) => {
            deleteFileBlob("jd:" + jd.id);
            (jd.resumes || []).forEach((r) => deleteFileBlob("resume:" + r.id));
          });
          persistSavedJDs(fresh);
        }
        return fresh;
      });
    }, 1000 * 60 * 60);
    return () => clearInterval(interval);
  }, []);

  // ─── addSavedJD ─────────────────────────────────────────────────────────────
  // Persists a JD with its current resume snapshot. Uses the existing ID if
  // one is passed (re-save / update), so the activeJDId stays stable.
  const addSavedJD = async (jd: SavedJD) => {
    if (jd.file.rawFile) {
      await storeFileBlob("jd:" + jd.id, jd.file.rawFile);
    }
    for (const r of jd.resumes) {
      if (r.rawFile) {
        await storeFileBlob("resume:" + r.id, r.rawFile);
      }
    }

    setSavedJDs((prev) => {
      // Replace any existing entry with the same id OR same jobName
      const filtered = prev.filter(
        (j) => j.id !== jd.id && j.jobName !== jd.jobName
      );
      const next = [jd, ...filtered];
      persistSavedJDs(next);
      return next;
    });
  };

  const removeSavedJD = async (id: string) => {
    const jd = savedJDs.find((j) => j.id === id);
    if (jd) {
      await deleteFileBlob("jd:" + jd.id);
      for (const r of jd.resumes || []) {
        await deleteFileBlob("resume:" + r.id);
      }
    }
    setSavedJDs((prev) => {
      const next = prev.filter((j) => j.id !== id);
      persistSavedJDs(next);
      return next;
    });
  };

  const updateSavedJDResumes = (jdId: string, newResumes: UploadedFile[]) => {
    setSavedJDs((prev) => {
      const next = prev.map((jd) => (jd.id === jdId ? { ...jd, resumes: newResumes } : jd));
      persistSavedJDs(next);
      return next;
    });
    newResumes.forEach((r) => {
      if (r.rawFile) storeFileBlob("resume:" + r.id, r.rawFile);
    });
  };

  // ─── setResumes ──────────────────────────────────────────────────────────────
  // Used when loading a saved JD or clearing the session.
  // Does NOT write back to savedJDs — this is intentional so that loading a
  // saved JD doesn't overwrite its stored resume count.
  const setResumes = (files: UploadedFile[]) => {
    setResumesState(files);
  };

  // ─── addResumes ──────────────────────────────────────────────────────────────
  // Called when the user drops / browses new resumes.
  // Writes back to the active saved JD so the count stays in sync.
  const addResumes = (files: UploadedFile[]) => {
    setResumesState((prev) => {
      const next = [...prev, ...files];
      // Persist blobs for new files
      files.forEach((f) => {
        if (f.rawFile) storeFileBlob("resume:" + f.id, f.rawFile);
      });
      // Keep the saved JD's resume list in sync
      if (activeJDIdRef.current) {
        setSavedJDs((savedPrev) => {
          const savedNext = savedPrev.map((jd) =>
            jd.id === activeJDIdRef.current ? { ...jd, resumes: next } : jd
          );
          persistSavedJDs(savedNext);
          return savedNext;
        });
      }
      return next;
    });
  };

  // ─── removeResume ────────────────────────────────────────────────────────────
  // Called when the user explicitly removes a resume from the session.
  // Writes back to the active saved JD so the count stays in sync.
  const removeResume = (id: string) => {
    setResumesState((prev) => {
      const next = prev.filter((r) => r.id !== id);
      if (activeJDIdRef.current) {
        setSavedJDs((savedPrev) => {
          const savedNext = savedPrev.map((jd) =>
            jd.id === activeJDIdRef.current ? { ...jd, resumes: next } : jd
          );
          persistSavedJDs(savedNext);
          return savedNext;
        });
      }
      return next;
    });
    deleteFileBlob("resume:" + id);
  };

  const loadSavedJDWithFiles = async (jd: SavedJD) => {
    const jdRawFile = await getFileBlob("jd:" + jd.id);
    const restoredJdFile: UploadedFile = {
      ...jd.file,
      rawFile: jdRawFile || undefined,
    };
    const restoredResumes: UploadedFile[] = [];
    for (const r of jd.resumes || []) {
      const rawFile = await getFileBlob("resume:" + r.id);
      restoredResumes.push({ ...r, rawFile: rawFile || undefined });
    }
    return { jdFile: restoredJdFile, resumes: restoredResumes };
  };

  // Keep activeJDIdRef in sync with state so callbacks always see the latest value
  activeJDIdRef.current = activeJDId;

  const updateEvaluationDecision = (candidateId: string, newDecision: "Rejected" | "On Hold" | "Interview") => {
    setEvaluations((prev) =>
      prev.map((e) =>
        e.candidate_id === candidateId
          ? { ...e, shortlist_decision: newDecision }
          : e
      )
    );
  };

  // ─── The open requisition ───────────────────────────────────────────────────
  // Lifted out of the dashboard when Collective analysis started showing the
  // same JD bar. The bodies are that page's, unchanged.

  const applySession = (session: {
    evaluations: CandidateEvaluation[];
    jdText: string;
    rubric: JDRubric | null;
  }) => {
    setEvaluations(session.evaluations);
    setJdText(session.jdText);
    if (session.rubric) setJdRubric(session.rubric);
  };

  const refreshJds = async () => {
    try {
      const list = await listJDs();
      setJds(list);
      // Unlocks Your Assistant on a later read: the nav's flag is otherwise set
      // once on mount, so a page loaded while the backend was down left it
      // locked until a manual reload.
      if (list.length > 0) setHasAnalyzed(true);
    } catch (err) {
      console.warn("[AppState] could not refresh job descriptions:", err);
    }
  };

  const openJd = async (uuid: string) => {
    if (!uuid || uuid === selectedJd) return;
    setSwitchingJd(true);
    try {
      const session = await loadSession(uuid);
      localStorage.setItem("exl_last_jd_uuid", uuid);
      setSelectedJd(uuid);
      if (!session) {
        // A JD nobody has been screened against yet. Show its empty state
        // rather than leaving the previous JD's table on screen pretending to
        // belong to the one just picked.
        setEvaluations([]);
        return;
      }
      applySession(session);
    } catch (err) {
      console.warn("[AppState] JD switch failed:", err);
      alert(err instanceof Error ? err.message : "Failed to load this JD.");
    } finally {
      setSwitchingJd(false);
    }
  };

  /**
   * Open whichever JD was last uploaded or last opened — the one
   * `exl_last_jd_uuid` names — and never anything else.
   *
   * The in-memory evaluations are not trusted here: arriving from "Add resumes
   * on the Dashboard" is a client-side navigation, so the previous JD's table is
   * still in state and used to stay on screen under the new JD's name. The
   * stored id decides, and a JD with nothing screened against it yet lands on
   * its own empty state rather than borrowing someone else's candidates.
   */
  const openLastJd = async () => {
    const stored = localStorage.getItem("exl_last_jd_uuid") || "";
    setSelectedJd(stored);
    try {
      const session = stored ? await loadSession(stored) : null;
      if (session) {
        applySession(session);
        return;
      }
      // loadSession returns null for both "no such JD" and "no resumes yet".
      // Only the first is worth falling back from — a real but empty JD is
      // exactly what the page is being asked to show.
      if (stored && (await listJDs()).some((jd) => jd.jd_uuid === stored)) {
        setEvaluations([]);
        return;
      }
      const fallback = await restoreLastSession();
      if (fallback) {
        applySession(fallback);
        setSelectedJd(localStorage.getItem("exl_last_jd_uuid") || "");
      } else {
        setEvaluations([]);
      }
    } catch (err) {
      console.warn("[AppState] session restore failed:", err);
    }
  };

  const uploadMore = async (files: File[]) => {
    if (files.length === 0) return;
    const jdUuid = selectedJd || localStorage.getItem("exl_last_jd_uuid");
    if (!jdUuid) {
      setUploadError("No job description is selected.");
      return;
    }

    setUploading(true);
    setUploadCount(files.length);
    setUploadStep(null);
    setUploadError("");
    try {
      const { evaluations: updated, failures } = await uploadResumesForJD(
        jdUuid, files, undefined, setUploadStep
      );
      setEvaluations(updated);
      // The successes are on screen; the failures would otherwise be invisible.
      setUploadError(describeFailures(failures, files.length));
      setSelectedJd(jdUuid);
      // The screened count just changed — the switcher and the Upload JD page
      // both read it from /jds, so re-read it rather than let one page show a
      // number the other disagrees with.
      await refreshJds();
    } catch (err) {
      console.warn("[AppState] upload more failed:", err);
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  // Clears the in-progress upload draft (the logo click, "start over"). It must
  // NOT clear `hasAnalyzed`: that flag says whether any JD exists in the backend,
  // which resetting the draft does not change. Clearing it locked Your Assistant
  // on a logo click and left it locked, since the unlock check only runs on
  // mount — the nav claiming there is nothing to ask about while five JDs sat in
  // the switcher.
  const resetApp = () => {
    setJdFile(null);
    setJdText("");
    setJdRubric(null);
    setResumesState([]);
    setActiveJDIdState(null);
    setEvaluations([]);
  };

  const value: AppState = {
    jdFile, setJdFile, jdText, setJdText, jdRubric, setJdRubric, resumes,
    addResumes, removeResume, setResumes,
    hasAnalyzed, setHasAnalyzed,
    savedJDs, addSavedJD, removeSavedJD, updateSavedJDResumes,
    activeJDId, setActiveJDId,
    evaluations, setEvaluations,
    jds, selectedJd, refreshJds, openJd, openLastJd, switchingJd,
    uploadMore, uploading, uploadCount, uploadStep, uploadError, setUploadError,
    updateEvaluationDecision,
    loadSavedJDWithFiles,
    resetApp,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}