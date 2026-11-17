# Resume Screening System — Architecture & Design Document

## 1. Technology Stack

| Technology | Version | Purpose | Why Chosen |
|---|---|---|---|
| **FastAPI** | 0.139.0 | REST API framework | Async-native, automatic OpenAPI docs, strong type validation, high performance |
| **Uvicorn** | 0.51.0 | ASGI server | Production-grade async server for FastAPI |
| **Pydantic** | 2.13.4 | Data validation & structured output | Enforces schema for LLM responses (JDOutput, ResumeOutput) |
| **LangChain** | 1.3.13 | LLM orchestration | Agent creation with structured response formatting |
| **LangGraph** | 1.2.9 | Agent state machine | Middleware support (`dynamic_prompt`), checkpointing (`InMemorySaver`), multi-turn chat |
| **LangChain MistralAI** | 1.1.6 | LLM + Embeddings provider | `ministral-8b-2512` for structured extraction; `mistral-embed` for vector embeddings |
| **LangChain Google GenAI** | 4.2.7 | Chatbot LLM | `gemini-2.5-flash` powers the HR assistant — chosen for conversational quality & context handling |
| **LangChain Chroma** | 1.1.0 | Vector DB integration | Persistent document + embedding storage with metadata filtering |
| **ChromaDB** | (via langchain-chroma) | Vector database | Open-source, embedded, supports metadata queries — no external DB needed |
| **LiteParse** | 2.5.1 | Document parsing | Extracts text from PDFs and other uploaded documents |
| **python-multipart** | 0.0.32 | File upload handling | Enables `UploadFile` + `Form` parsing in FastAPI |

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Frontend)                          │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │  HTTP/REST
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        FastAPI Application (main.py)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  JD Routes   │  │ Resume Routes│  │  Chat Route  │  │ Admin APIs │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
└─────────┼─────────────────┼─────────────────┼────────────────┼─────────┘
          │                 │                 │                │
          ▼                 ▼                 ▼                ▼
┌─────────────────┐  ┌─────────────────┐  ┌───────────────────────────┐  │
│   logic.py      │  │   logic.py      │  │       agents.py           │  │
│  (JD pipeline)  │  │ (Resume pipeline)│  │  (LangGraph chatbot)      │  │
└────────┬────────┘  └────────┬────────┘  └───────────┬───────────────┘  │
         │                    │                        │                  │
         ▼                    ▼                        ▼                  │
┌─────────────────────────────────────────────────────────────────────────┐
│                        AI / LLM Layer                                   │
│  ┌─────────────────────────┐    ┌──────────────────────────────────┐   │
│  │  Mistral (ministral-8b) │    │  Gemini (gemini-2.5-flash)       │   │
│  │  - JD structured extract│    │  - HR chatbot assistant          │   │
│  │  - Resume structured    │    │  - Conversational Q&A            │   │
│  │    extract               │    │  - Candidate comparison          │   │
│  │  - Embeddings (mistral-  │    │                                  │   │
│  │    embed)                │    │                                  │   │
│  └─────────────────────────┘    └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Vector Store (ChromaDB)                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  Collection: "job_descriptions"                                   │ │
│  │  - Stores JD documents + resume documents                         │ │
│  │  - Embedding function: MistralAIEmbeddings                        │ │
│  │  - Persist directory: ./chroma_db                                 │ │
│  │  - Metadata filtering for queries                                 │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        File Storage                                     │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  Directory: ./resume_files/                                       │ │
│  │  - Original PDFs keyed by resume UUID                             │ │
│  │  - Used for HR download / view                                     │ │
│  │  Directory: ./jd_files/                                           │ │
│  │  - Original postings keyed by job id                              │ │
│  │  - Opened from the Upload JD list in a new tab                    │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Application Flow

### 3.1 Upload Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        UPLOAD FLOW                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. POST /jd/upload  (file + job_id + primary_location               │
│                       + role_criteria)                              │
│     └─ Normalize job id to EXL###### (job_id.py), 400 if malformed  │
│     └─ 400 unless all 8 role criteria are set and each min <= max   │
│     └─ 409 if that job id already exists — before any parsing        │
│     └─ LiteParse extracts text from PDF                             │
│     └─ Mistral agent extracts: skills + full text                   │
│     └─ Store in ChromaDB under the job id as the document id        │
│        (document_type="job_description")                            │
│                                                                     │
│  2. POST /resume/upload  (multiple files + jd_uuid)                 │
│     └─ For each resume (parallel via asyncio.gather):               │
│         ├─ LiteParse extracts text                                  │
│         ├─ SHA-256 hash check (reject duplicates within batch)      │
│         ├─ Mistral agent extracts: name, email, phone, skills,      │
│         │   years_experience, summary, green/red flags, full text   │
│         ├─ Cosine similarity score vs JD (embedding-based)          │
│         └─ Store in ChromaDB (document_type="resume")               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Query Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        QUERY FLOW                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  GET /jds                    → List all JDs + resume counts        │
│  GET /jd/{uuid}              → Get single JD details                │
│  GET /jd/{uuid}/skills       → Get JD skills only                   │
│  GET /jd/{uuid}/resumes      → Get all resumes for a JD            │
│                                 (sorted by similarity_score desc)   │
│  PUT /jd/{uuid}/info         → Update job_code + primary_location   │
│  PUT /resume/{uuid}/screening → Save HR screening decision          │
│  GET /resume/{uuid}/download → Download original resume file        │
│  DELETE /resume/{uuid}       → Delete resume + file                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.3 Chatbot Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CHATBOT FLOW                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  GET /chatbot?user_input=...&thread_id=...&resume_uuid=...          │
│     └─ LangGraph agent (Gemini) with dynamic_prompt middleware      │
│     └─ Middleware loads resume context (redacted PII)               │
│     └─ If resume_uuid set → scoped to 1 candidate + its JD          │
│     └─ If empty → all resumes (dashboard comparison mode)           │
│     └─ Returns conversational HR assistant response                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Data Model (ChromaDB Metadata Schema)

### 4.1 Job Description Document

| Field | Type | Description |
|---|---|---|
| `uuid` | string | Primary key / document ID |
| `document_type` | string | Always `"job_description"` |
| `source` | string | Original filename |
| `file_path` | string | Local disk path to the original posting (`jd_files/`). Absent on JDs uploaded before the file was kept — `/jd/{id}/download` 404s for those, and `has_file` in the API says so up front. |
| `content_hash` | string | SHA-256 of full text (deduplication) |
| `skills` | JSON string | Array of extracted skills |
| `job_code` | string | HR-assigned job code (updatable) |
| `primary_location` | string | Work location (updatable) |
| `screening_answers` | JSON string | **No longer written.** HR used to answer 8 free-text screening questions per requisition here; nothing ever compared them against the candidate's answers, so collecting them was dropped along with `QUESTION_KEYS` / `parse_answers()`. Still stored and still returned — the HR modal reads it to label answers recorded while those questions were being asked. |
| `role_criteria` | JSON string | The requisition's **typed** hiring constraints — experience min/max (years), budget min/max (**lakhs**), workplace mode, notice min/max (days), buyout offered — keyed by `role_criteria.py`. What the conditional HR screening flow branches on, and the only thing HR now states about a requisition beyond its name, id and location. Required at upload; `{}` on JDs predating it, which simply means that JD's candidates get every question, ungated. |

### 4.2 Resume Document

| Field | Type | Description |
|---|---|---|
| `uuid` | string | Primary key / document ID |
| `document_type` | string | Always `"resume"` |
| `source` | string | Original filename |
| `file_path` | string | Local disk path to original PDF |
| `content_hash` | string | SHA-256 of full text (deduplication) |
| `jd_uuid` | string | Foreign key → linked JD |
| `candidate_name` | string | Extracted candidate name |
| `email` | string | Extracted email |
| `phone` | string | Extracted phone |
| `skills` | JSON string | Array of candidate skills |
| `years_experience` | float | Total work years (internships counted fully) |
| `summary` | string | One-sentence fit summary |
| `green_flags` | JSON string | Positive signals vs JD |
| `red_flags` | JSON string | Concerns/gaps vs JD |
| `screening_questions` | JSON string | **No longer written.** The LLM used to reproduce the 8 fixed questions per resume; they are a constant now (`screening_questions.py` / `lib/screening-questions.ts`). Still read back so the UI can re-key responses saved under the old layout. |
| `similarity_score` | float | Cosine similarity % vs JD (0–100) |
| `hr_screening` | JSON string | `{responses, comment, decision}` |

---

## 5. Formulas Used

### 5.1 Cosine Similarity (Embedding-based JD–Resume Match)

```
similarity = (A · B) / (||A|| × ||B||)

where:
  A · B  = Σ (A_i × B_i)          ← dot product
  ||A||  = √(Σ A_i²)              ← Euclidean magnitude
  ||B||  = √(Σ B_i²)

score = max(0, min(1, similarity)) × 100   ← clamped to 0–100%
```

**Implementation location:** [`logic.py`](backend/logic.py:62) — `cosine_similarity()` and [`calculate_similarity()`](backend/logic.py:78)

### 5.2 SHA-256 Content Hash (Duplicate Detection)

```
content_hash = SHA-256(text.encode()).hexdigest()
```

**Implementation location:** [`logic.py`](backend/logic.py:92) — two callers, with
different rules:

- `reject_duplicate()` — **resumes**. The same CV twice under one JD is a 409.
  Scoped by `jd_uuid`, so the same person may be a candidate for two roles.
- `reject_duplicate_jd()` — **job descriptions**. Identical text is a 409 under
  **any** job id and **any** location: one posting is one requisition. The
  location used to be part of the test (same role, two cities = two real
  requisitions), which let the same document in under a third job id for a third
  city and split one role's candidates across job ids. Ruled out on request. It
  runs after the document-type check and before the LLM, so a re-upload costs a
  parse rather than an analysis.
  - The comparison is **exact text**, so a document altered by one character is a
    new JD. Wrong in the safe direction: a missed duplicate costs a stray
    requisition, a wrong reject blocks a real one.

---

## 6. Key Design Decisions

| Decision | Rationale |
|---|---|
| **Dual-LLM strategy** | Mistral (`ministral-8b-2512`) handles structured extraction (deterministic, `temperature=0`); Gemini (`gemini-2.5-flash`) handles open-ended chat. Separation of concerns for cost and quality. |
| **PII redaction in chatbot** | Email and phone are stripped from resume text before reaching the LLM middleware — defense-in-depth beyond prompt instructions. |
| **Parallel resume processing** | `asyncio.gather` with `return_exceptions=True` ensures one bad resume doesn't fail the whole batch. |
| **Local file storage** | Original resumes saved to `resume_files/` keyed by UUID, original JDs to `jd_files/` keyed by job id. Both are served with `Content-Disposition: inline` so HR opens them in a tab instead of downloading. A rekeyed JD keeps its old filename — the path is in metadata, so the name doesn't matter. A comment notes this should move to object storage for multi-box deployments. |
| **In-memory chat checkpointer** | `InMemorySaver()` means chat history is lost on restart — suitable for single-process dev, not production. |
| **Embedding-based similarity** | Uses Mistral embeddings + cosine similarity to score resume-to-JD fit, complementing the LLM's qualitative analysis. |

---

## 7. API Endpoints Summary

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/jd/upload` | Upload a job description PDF |
| `POST` | `/resume/upload` | Upload resumes for a JD (multiple files) |
| `GET` | `/jds` | List all JDs with resume counts |
| `GET` | `/jd/{jd_uuid}` | Get JD details |
| `PUT` | `/jd/{jd_uuid}/info` | Update JD job_code, primary_location, job_name and role_criteria |
| `GET` | `/jd/{jd_uuid}/download` | Serve the original posting inline (new-tab view) |
| `GET` | `/jd/{jd_uuid}/skills` | Get JD skills |
| `GET` | `/jd/{jd_uuid}/resumes` | Get all resumes for a JD (sorted by score), each with its `joining_assessment` (see 7.4) |
| `PUT` | `/resume/{resume_uuid}/screening` | Save HR screening decision |
| `POST` | `/resume/{resume_uuid}/interview` | Place the AI phone screening call (see below) |
| `GET` | `/interview/{session_id}` | Poll that call; transcripts keyed by question index |
| `GET` | `/resume/{resume_uuid}/interview/recording` | The call's audio, for the dashboard's play button |
| `GET` | `/resume/{resume_uuid}/interview/transcript` | The call's Q&A `.txt`, for the dashboard's download button |
| `POST` | `/api/sarvam/webhook` | Sarvam's call-end result; the only route reachable through `PUBLIC_URL` (see 7.1) |
| `POST` | `/interview/{session_id}/cancel` | Stop a session's pending redials; no button uses it |
| `GET` | `/interviews/schedule` | Every call made, taken and still to come, for the dashboard calendar (see 7.1) |
| `GET` | `/interviews/usage` | Rupees the agent's calls have cost, and the credit left (see 7.1) |
| `GET` | `/resume/{resume_uuid}/download` | Download original resume file |
| `DELETE` | `/resume/{resume_uuid}` | Delete a resume |
| `GET` | `/upload/{upload_id}/progress` | Which stage a running upload is on (see 7.2) |
| `GET` | `/chatbot` | HR chatbot assistant |

### 7.1 AI phone screening

The HR modal's **AI Phone call** button asks the ticked screening questions over
the phone and drops the transcripts into the same form HR types into.

- **`voice/calls.py`** is the dialer, inside this backend process (until
  2026-10-17 it was a separate service on port 8080). The call itself runs on
  **Sarvam Voice Agents** (Saaras v4 ASR, Bulbul v4 TTS, Sarvam's LLM) in the
  agent *TalentAI HR Screening*; `calls.place()` places it through Sarvam's
  Instant Outbound API, and the result comes back on Sarvam's call-end webhook,
  `POST /api/sarvam/webhook` (`calls.router`), with a scheduler in the app's
  lifespan (`calls.lifespan`) that redials and falls back to Sarvam's analytics
  API if the webhook never arrives. There is no Twilio any more.
- **The voice HR picks is the voice on the call.** Each voice in
  `calls.VOICES` is its own committed agent version (Instant Outbound cannot
  set a voice per call), so `prepare_call()` passes the picked `speaker` and the
  dial uses that voice's `version` and its persona as `agent_name`. An unknown
  voice is a 400 before anything is dialled; a session with no voice (or one
  since dropped from the roster) redials in the default.
- **A later call asks only what is left.** Every dial, and every known-caller
  upload, builds its script from the session as it stands (`calls._call_inputs`):
  `script.known_answers` picks the answered questions (a text question once it
  has a transcript, any other once it has a value, so an unclear yes/no is
  asked again), `script.render` steps over them the way their answers branched
  (on_notice "yes" keeps notice_days_left and drops willing_to_resign), and
  `script.answered` lists them for the agent as `answers_so_far`. The agent also
  gets `candidate_profile`: the parsed resume text, contact details redacted
  (`candidate_profile()` in `app/main.py`), never HR's summary or flags, which
  it could repeat to the candidate.
- **Callbacks.** The inbound deployment `SARVAM_DEPLOYMENT_ID` answers the
  agent's number. `calls.place()` uploads every candidate it dials to that
  deployment's known callers (`sarvam.add_known_caller`, a one-row CSV: the JSON
  stream endpoint refuses deployment records), with their script and a "thanks
  for calling back" greeting, and uploads them again after every connected call
  so the record carries the latest answers. Every minute the scheduler reads inbound attempts
  off the analytics API and folds each finished one into the caller's newest
  session as of the call's `start_datetime` (`calls._newest`, `calls.apply_inbound`), once per `interaction_id`, clearing any
  pending redial. Inbound calls have no per-call webhook to name a session, and
  known-caller records cannot carry one (`user_identifier` is refused), so the
  match is by phone number. For the same reason only a number's newest session
  is uploaded: an older one's record would greet with one screening while the
  callback files under another.
- **The webhook is the only route reachable through `PUBLIC_URL`.** That tunnel
  publishes port 8000, so `calls.tunnel_guard` (HTTP middleware) 404s every
  request carrying its hostname except `POST /api/sarvam/webhook`.
- **The questions come from here**, `FLOW_QUESTIONS` in
  `screening_questions.py`, rendered by `questions_map()` into a
  `{node_id: text}` map with `{location}` / `{mode}` already substituted. The
  keys are the flow keys, which are also the keys in `voice/script.py`,
  the keys the Sarvam agent extracts answers under, and the keys the modal
  stores answers under — so an answer travels back without a translation
  table. `INDEX` / `KEY_AT` are the one place a key becomes a modal index.
- **Branching is resolved in code before the call.** `voice/script.py`
  holds the flow (a port of the old `questionnaire.py` graph) and renders each
  call's script with every "next question" pointer already resolved against the
  key set, so the Sarvam agent follows pointers and is never asked to apply a
  skip rule. This is what `flow_rules()` (an English rendering of the whole
  tree, obeyed *mostly*) could not guarantee.
- **Which questions apply is decided here, before dialing** — never at runtime
  by the agent. `prepare_call()` in `app/main.py` applies all three pre-call
  rules (HR's ticks, the WFH rule that makes relocation moot, the employment
  gate) by simply leaving keys out of the map it sends. The **key set is the
  script**. Putting the employment gate in a runtime branch instead is a bug
  this project has already shipped once — see `requires` vs `askIf` in
  `frontend/AGENTS.md`.
- A branch that was never taken is **absent** from `answers`. Every answer the
  agent extracted comes back with `status: done`.
- **Calls are dialled inline and concurrently.** Sarvam is not limited to one
  call per number, so `calls.place()` dials each candidate before it returns
  (about half a second each) and `queue_position` is always 0. A dial Sarvam
  turns away for now (429 or 5xx) is tried twice more, after 1 s and 4 s, as
  Sarvam advises; any other refusal, or the last, lands on the session as
  `call_error`. A read timeout is not retried: the call may already be ringing. If `.env` is missing Sarvam
  settings, it refuses with a 503 naming them before any session exists.
- **Callbacks and retries** are the scheduler's: a callback the candidate
  agreed redials at that time; a missed or dropped call redials after 15
  minutes, then the next day, then stops (`MAX_CALL_ATTEMPTS`, default 3). Both
  redial the *same* session and merge into the same answers. A redial whose
  time TalentAI chose (a retry, or a callback with no time given) is moved
  into calling hours, 9:00 to 21:00 IST (`CALL_WINDOW_START_HOUR`,
  `CALL_WINDOW_END_HOUR`); a time the candidate asked for is kept as asked.
- **The number comes from the resume.** `ResumeOutput.phone` is whatever was
  printed on the CV; `CandidatePhone` (a pydantic model in `app/main.py`)
  normalises it to E.164 — assuming +91 — and rejects anything undialable with a
  400 before a call is placed.
- Nothing is persisted by the call itself: transcripts fill the modal's response
  fields and are stored only when HR hits **Save Responses**, so a mis-heard
  answer can be corrected first. The exception is `interview_session_id`,
  written onto the resume when the call is placed: it is how a reopened form
  reads a **rescheduled callback** dialed long after that modal was closed.
  Answers come back keyed by flow key, so nothing else is needed to map them.
- **What the call cost is counted, not just what it said.** The voice session
  carries `call_placed_count`, `call_not_picked_count`, `call_seconds` and
  `reschedule_count`, accumulated over every dial of the session, plus a
  `calls` list, one row per attempt or callback (`at`, `seconds`, `status`,
  `inbound`), from which `call_cost` (rupees = Sarvam credits) and
  `call_callbacks` are derived. Cost follows docs.sarvam.ai/voice-agents/pricing:
  each started minute at `SARVAM_RATE_PER_MINUTE` plus each started 30s of
  telephony at `SARVAM_TELEPHONY_PER_PULSE`, connected calls only
  (`calls.cost`). `interview_scoring.call_stats()` shapes them as
  `interview_call_stats`; `/jd/{id}/resumes` serves it **live** off the session
  (`with_call`), and `archive_and_score` copies it onto the resume on Save so it
  survives the session file. `record_call()` clears it with the rest of the
  previous call's artefacts. **Collective analysis** is the reader
  (`frontend/lib/collective.ts`). Sessions from before 2026-11-05 were given
  their `calls` from Sarvam's analytics, matched by attempt id.
- **Account usage** (`GET /interviews/usage`, `calls.usage()`): every attempt
  on the agent from Sarvam's analytics API, playground calls included, costed
  the same way. Sarvam has no balance API (none in the API reference or the
  MCP), so "credits left" is `SARVAM_CREDIT_BALANCE` less what was spent after
  `SARVAM_CREDIT_BALANCE_AT`; null when unset. With `SARVAM_SPENT` (the usage
  CSV's total at the same moment) "spent" is that bill plus calls since,
  otherwise the estimate over every call. The estimate runs above the real
  bill (on 2026-11-05: 113 telephony pulses estimated, 93 billed; playground
  minutes differ too, and Sarvam exposes no per-call charge to reconcile
  against), and it cannot see the workspace's other agents, number rental or
  the TTS preview, so re-anchor all three from the billing page now and then.
- **Phone numbers stay out of logs.** Sarvam's Analytics docs treat
  `user_contact` as personal data to keep out of logs, and so are candidates'
  numbers here: log lines print `calls.masked()` (last four digits), pinned in
  `check.py`.
- **Calendar** (`GET /interviews/schedule`, `calls.schedule()`): every row of
  every session's `calls`, the dial on the line now, and each pending redial
  (`reschedule_at` / `no_answer_retry_at`) as `status: "scheduled"`. Read by
  the dashboard's calendar button (`frontend/components/CallCalendar.tsx`).
- **Communication score**: the Sarvam agent grades the call in its post-call
  extraction (`communication_score`, `communication_summary`), and the session
  carries it as `scores`. HR saving re-grades through `interview_scoring.py`
  (Mistral Medium) and that score replaces it.
- Sessions are JSON files in `voice/sessions/`, so a restart loses nothing and
  pending redials still fire.
- **Playback**: `/resume/{uuid}/interview/recording` serves the archived copy if
  HR has saved, else `calls.recording()` fetches it from Sarvam's analytics API
  (`audio/wav`). Sarvam has it a minute or two *after* the call ends, so the
  endpoint 404s with an explanation until then, and 502s with Sarvam's own error
  if that call fails.
- **Transcript**: `/resume/{uuid}/interview/transcript` serves the archived copy,
  else `voice/transcripts/{session_id}.txt` via `calls.transcript_text()`, as an
  attachment named after the candidate; 404 until the call has ended.

---

### 7.2 Upload progress

`POST /jd/upload` and `POST /resume/upload` are one blocking request each —
parse, LLM, embed, store — and until they return the browser can only spin.

So the frontend mints an `upload_id`, sends it as a form field with the files,
and polls `GET /upload/{upload_id}/progress` while it waits. `progress.py`
holds the stages (`parsing` → `checking` → `analyzing` → `embedding` → `storing` → `done`)
in a process-local dict; `logic.py` names each one as it starts it, and
`finish_one()` counts a file as stored. The response is
`{"total": n, "done": k, "stage": "..."}`, or `{}` when nothing is known about
that id — never an error, since a missed poll must not look like a failed
upload. The stage names are identifiers; the words HR reads are `stageLabel()`
in the frontend's `lib/api.ts`.

`upload_id` is optional on both endpoints. Omit it and every stage call is a
no-op, which is what makes `curl` against these endpoints work unchanged.

**Every blocking step must go through `asyncio.to_thread` (or its async twin).**
liteparse, the document classifier, the LLM call and `add_documents` all block,
and on the event loop they starve the progress endpoint itself: the browser
polls, FastAPI cannot answer until the upload finishes, and the bar sits at its
opening label for the whole wait. `create_jd` had exactly that bug — it read as
"the JD upload reports no progress" rather than as an async mistake.

Not LangChain event streaming: that can only see the agent call, and three of
the four stages (liteparse, the similarity embedding, the Chroma write) happen
outside it — plus streaming would mean every caller re-learning a JSON endpoint
that works today.

`python3 progress.py` runs its self-check.

### 7.3 Is this file even a resume / a JD?

`document_check.py`. HR uploads the wrong file often enough to matter — an
offer letter into the JD slot, a payslip into the resume batch — and the
extractor will happily invent a candidate out of an invoice, because that is
what it was told to do. A made-up name with a made-up match score is
indistinguishable from a real one afterwards.

So `verify_document()` runs **straight after parsing and before anything
expensive**: no LLM extraction, no embedding, no file copy, nothing stored. It
classifies the first 3000 characters with `parse_llm.with_structured_output(
DocumentCheck)` — LangChain's documented pattern for a fixed-answer
classification, so the result is a `Literal["resume", "job_description",
"other"]` rather than a sentence to regex — and raises **422** with a message
written for HR: what the file looks like instead, and what to upload.

- On the JD path the 422 is the response; the Upload JD page shows it as a toast
  and an inline error, and no JD is created.
- On the resume path it becomes that file's entry in `results`, so the rest of
  the batch still lands and the dashboard names the rejected file.
- It **fails open**. A classifier that errors or times out lets the upload
  through: a bad row can be deleted, a classifier outage that blocks every
  upload stops the hiring work.
- Documents under 200 characters skip the check — there is nothing to judge, and
  `parse_document` has already rejected genuinely empty files.

`python3 document_check.py` runs its self-check (stubs the model; covers the
branching, not the model's judgment).

### 7.4 Will they actually join?

Two different questions decide a hire, and the app only answered one of them.
The resume score says whether a candidate **can do the job**; nothing said
whether they would **turn up** — that lived in the screening answers as prose,
and a recruiter had to hold six thresholds in their head per candidate.

`joining_evaluator.py` is the answer, and it is deliberately **not an LLM**.
Fixed rules over the collected answers, so the same answers always give the same
category, every category comes with the criteria behind it, and the whole thing
is testable without a network call. Output per candidate:

| Field | Meaning |
|---|---|
| `join_category` | `HIGH` \| `MEDIUM` \| `LOW` \| `WITHDRAWN` |
| `red_flags` | criteria not met — each with a `severity`, a `reason` and the candidate's own words as `evidence` |
| `matched_criteria` | criteria that *were* met: the "why more likely" half |
| `summary` | one line for a recruiter |

Six criteria, at two severities:

| Criterion | Severity | Flags when |
|---|---|---|
| `location` | **hard** | not at the primary location, role is not remote, will not relocate |
| `work_model` | **hard** | not comfortable with the required mode |
| `ctc` | **hard** / soft | expected CTC over `max_budget` — **hard** when the candidate says it is not negotiable, soft when they say it is *or were never asked* |
| `notice` | **hard** | notice over `max_notice` with no buyout (N/A if unemployed) |
| `documents` | soft | employment/education verification documents not ready |
| `competing_offers` | soft | an advanced-stage competing offer — renege risk |

The tiers: **any hard flag → LOW**; **any soft flag → MEDIUM**; **0 → HIGH**. A
candidate who rules themselves out is `WITHDRAWN`, kept out of LOW on purpose —
they left, we did not reject them.

Soft flags no longer combine into LOW. Two risks — paperwork not ready *and*
another offer in play — is not the same thing as refusing to work where the job
is, and the old "≥2 soft → LOW" rule rated them identically.

**Three of these changed on 17 Aug 2026**, from a second version of
`joining_evaluator.py` circulated by the team: `bgc` was renamed `documents`,
`notice` was promoted to hard, and the "≥2 soft → LOW" tier was dropped. Their
version also makes **any** over-budget CTC hard and marks the negotiation answer
unused; we did not take that half, because the manager's spec requires the
"is your CTC negotiable?" question and a rule that ignores it would leave us
asking a question that cannot change an outcome. `_eval_ctc` is therefore the
one function in that file that is ours rather than theirs, and it is commented
as such at the point of divergence.

**It decides nothing.** Same rule as a screening `gate`: it is evidence for the
Override dropdown, never a decision. Nothing in `shortlist_decision` reads it.

**`joining_assessment.py` is the wiring**, and it is where every app-shaped
detail lives so the rules above stay auditable on their own:

- Screening answers are stored **by index** (`FLOW_INDEX_BASE + position`) and
  the evaluator wants named fields, so it re-keys them off `FLOW_QUESTIONS` —
  derived, never written out, or appending a question would shift the table.
- **Lakhs → rupees.** `max_budget` is in lakhs, a spoken CTC is parsed into
  rupees. This is the third and last place those two units meet (with
  `screening-flow.ts` and `flow_rules()`); drop the ×1e5 and nothing is ever
  over budget.
- A criterion the requisition never stated gets **no verdict**. A JD from before
  `role_criteria` has no budget and no notice ceiling, so those answers go in as
  `None` rather than being measured against an invented threshold.
- **An unscreened candidate gets no verdict at all**, which is the single most
  important line in the file. Every field the evaluator reads is Optional and
  unknown means "no flag", so an *empty* screening produces zero flags and lands
  on HIGH — "we asked nothing, therefore they are very likely to join". A
  candidate who only said it was a bad time must not read HIGH.
- WITHDRAWN now has **two** sources, and they are genuinely different refusals.
  `still_interested` is the direct question — added when the voice service was
  merged, from the workbook's second sheet, which this app had previously not
  implemented. Before it existed, interest could only be *inferred* from
  `willing_to_resign`, flagged at the time as the one place this module guessed
  rather than mapped. `willing_to_resign` stays alongside it: a candidate can
  want the job and still not commit to leaving their current employer, and the
  flow ends the screening on either. Where the resign gate is what fired, the
  evidence spells out the question actually put, since the evaluator's stock
  reason reads "no longer interested in the role".

**Computed on read**, in `GET /jd/{id}/resumes`, and returned as
`joining_assessment` (`null` when there is nothing to say). Not stored: it is a
pure function of the row, so recomputing costs nothing and a rule that changes
tomorrow can never leave yesterday's verdict cached next to a candidate. The JD
is fetched once for the whole listing, and `joining_for()` in `app/main.py`
swallows a failure the same way the sort guards a missing score — one odd row
must not 500 a JD's entire shortlist.

**Judged on the call too, not only on Save.** A called candidate's row is read
through `with_call()` in `app/main.py`: `joining_assessment.with_call` fills
every field HR has not saved from the call's answers (exactly what the HR modal
fills on open, so what HR saved still wins), and the row's `interview_scores`
falls back to the call's own communication score (`scores_for`; the Mistral
regrade on Save, marked with its `model`, still outranks it). Before this both
reached the row only through the modal (opening it stored the score, Save stored
the answers), so a bulk call left every row blank until HR opened each one. The
dashboard re-reads the rows whenever one of its calls comes off the phone.

`python3 joining_assessment.py` runs its self-check (the mapping, the units,
every tier, and the empty-screening refusal). `python3 joining_evaluator.py`
prints one candidate per category.

## 8. Structured Output Schemas

### 8.1 JDOutput

```python
class JDOutput(BaseModel):
    skills: list[str]       # Skills from the job description
    text: str               # The complete original JD text
```

### 8.2 ResumeOutput

```python
class ResumeOutput(BaseModel):
    name: str                           # Candidate name
    email: str                          # Candidate email
    phone: str                          # Candidate phone
    skills: list[str]                   # Candidate skills
    years_experience: float             # Total work years (internships counted fully)
    summary: str                        # One-sentence fit summary
    green_flags: list[str]              # Positive signals vs JD
    red_flags: list[str]                # Concerns/gaps vs JD
    text: str                           # Complete original resume text (verbatim)
```

---

*Document generated from code review of `/teamspace/studios/this_studio/backend`*
