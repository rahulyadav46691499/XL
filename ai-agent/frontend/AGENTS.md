<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Frontend

Next.js App Router + React, all client components. The backend it talks to is
documented in `../AGENTS.md`.

**This UI was not written against this backend.** It was built for a different API,
and `lib/api.ts` is the adapter that bridges the two. Every backend call goes
through it — never `fetch` from a component. When the UI wants a shape the backend
doesn't have, the translation belongs in `api.ts`, not in the page.

## lib/api.ts

- `CandidateEvaluation` is the UI's shape; `BackendResume` is the backend's.
  `toEvaluation()` maps one to the other — matched/missing/transferable skills are
  derived here by comparing resume skills to JD skills (case-insensitively).
- `shortlist_decision` is **derived on the frontend** from the embedding similarity
  score via `decisionFromScore()` (≥75 Interview, ≥60 On Hold). The backend has no
  opinion on it. A saved HR override outranks the score.
- The **stored value is `"Interview"`; the label HR reads is "Selected for R1"**.
  `decisionLabel()` in `lib/api.ts` is the only place that translates — use it for
  every visible decision (dropdown, row pill, hover card, filter chip, pipeline
  segment). Never rename the value: backend metadata, filters and the Excel export
  all key off `"Interview"`.
- The **stored value is `communication_score`; the label HR reads is
  "Comprehensive"**. Same shape as the rule above, and the same warning: the
  field name is on the wire from the grader (the Sarvam agent's post-call
  extraction, served by `backend/voice/calls.py`) all
  the way to the resume's stored metadata, so renaming it breaks saved calls.
  The label lives in the four places it is shown — the table header, the score
  cell's hover card, the histogram's title and view toggle, and the HR modal's
  score tile — plus the `Comprehensive score:` line of the `.txt` transcript the
  voice service writes. Identifiers that wrap the field (`communicationBins()`)
  keep the field's name on purpose; identifiers that name the *view* (the
  `scoreView` union, `ComprehensiveScoreCell`) follow the label, because the
  union member is rendered raw as the toggle's caption.
- A module-level `lastJD` caches the current JD's uuid + skills. `getLastJDUuid()`
  reads it.
- `resume_url` is built in `toEvaluation()` from the backend's `has_file` flag —
  it points at `GET /resume/{uuid}/download`, and is `undefined` when the backend
  never kept the original file (resumes analyzed before it did). The HR modal's
  download button renders only when `resume_url` is set, so it never links to a
  404. Don't reintroduce a hardcoded `/api/resume/...` fallback; no such route
  exists.
- **A resume batch is routinely part-successful.** `POST /resume/upload` processes
  each file independently and returns per-file `results` with errors (unreadable
  PDF, duplicate, LLM timeout). `uploadResumesForJD()` returns
  `{ evaluations, failures }` — **both call sites must show `failures`**, via
  `describeFailures()`. It used to read them only when *every* file failed, so
  uploading five and getting three back looked like a clean run. The backend
  rejects batches over 10 files with a 400.
- **Parse once.** The parser (liteparse) is slow and only runs on first upload.
  `uploadJD()` returns the parsed `text` and `skills` in the same response, so the
  page never fetches back what it was just handed, and Analyze sends only resumes
  (`uploadResumesForJD`). A flurry of liteparse logs in the uvicorn output means
  something regressed here.

## Job ids

A JD's identity is its **job id** — the fixed prefix `EXL` plus six digits, e.g.
`EXL267432` — not a generated uuid. It is the Chroma document id, so `jd_uuid`
everywhere in the frontend holds a job id for anything uploaded since. JDs from
before still carry uuids and render as "No job ID"; both work as keys.

- The rule lives in `backend/job_id.py` (`normalize_job_id`, with its own
  `python3 job_id.py` self-check). It accepts the digits alone or with the prefix.
- `POST /jd/upload` takes `job_id` and `primary_location` **with** the file. Nothing
  reaches the vector store until HR has supplied both — don't reintroduce a
  create-then-label flow.
- A taken id is caught twice: the upload page checks the ids already on screen while
  HR types (inline error + a corner toast, submit disabled), and the backend 409s on
  submit, which is what catches an id another recruiter claimed a moment ago.
- Identical JD text is **rejected under any job id and any location** — one posting
  is one requisition. `reject_duplicate_jd()` in `logic.py` 409s it before the LLM
  runs, naming the job id that already holds it, and `uploadJD()` shows that detail
  verbatim like any other 409. A role open in several cities is one JD, edited.
  (This replaced a location-scoped rule that allowed the same document under a new
  job id per city — don't reintroduce it without being asked.) Resumes still dedupe
  on text within one JD.
- Changing a job id via `PUT /jd/{id}/info` **moves** the JD (`rekey_jd` in
  `logic.py`): re-added under the new key, every resume repointed, old key dropped
  last, stored embedding carried over. So `saveJDInfo()` **returns the JD's id** —
  it may differ from the one passed in, and callers must use the returned value.
  This also works on legacy uuid-keyed JDs, which is how they get a job id.

## Keeping the two pages in step

The Upload JD list and the dashboard's JD switcher must show the same JDs, in the
same order, with the same counts — both read `/jds` and neither filters it.

- Clicking a row on the Upload JD page opens **the original posting** in a new tab
  (`jdFileUrl()` → `GET /jd/{id}/download`, served inline). The row is only a link
  when the JD reports `has_file`; JDs uploaded before the backend kept the file get
  a plain row and a tooltip, because linking them would open a tab on a 404 — the
  same rule as `resume_url` in the HR modal.
- `jdLabel()` (`lib/jd-search.ts`) shows the **job name only** — the job ID and
  the screened count belong to the Upload JD rows, which is where you go to manage
  a requisition. The switcher just picks one. The one exception is the rows inside
  the switcher's open list, which carry `jdSubtitle()` (job ID · location) under
  the name: at a hundred requisitions two are called the same thing, and the
  second line is what tells them apart — and what makes a job ID searchable.
- The switcher is `components/JdPicker.tsx`, **not a `<select>`**. It was one until
  an account had a hundred-odd open JDs and the only way to a job was scrolling
  past the rest. It is a button + popover with a search box over `matchJDs()`
  (`lib/jd-search.ts`): terms are ANDed, matched as substrings, over name, source
  file, job ID and location. Keyboard behaviour is the `<select>`'s, on purpose —
  ↑/↓ walk, Enter picks, Esc closes, a click outside closes — so don't drop it
  when editing. Both the dashboard's sticky header and its scoped empty state
  render the same component; there is no second copy.
- Both pages `refreshJds` / `refreshBackendJDs` on mount, on window focus and on
  `visibilitychange`. The dashboard also re-reads after adding resumes and after
  deleting a candidate, since those change a count while the page stays put.
- The switcher lists JDs with **zero** resumes too. Selecting one lands on a scoped
  empty state that keeps the switcher and Add Resumes — don't restore the old
  `resume_count > 0` filter or the `alert()`, which left the previous JD's table on
  screen pretending to belong to the JD just picked.

## Routes

The URLs are flat — `/dashboard`, `/upload`, `/chatbot` — and the pages live in the
**`app/(app)/`** route group. The parentheses are what make that work: the folder
gives all three pages one shared layout (`(app)/layout.tsx` — header, auth guard,
`AppStateProvider`) **without** adding a URL segment. That is why the paths used to
read `/dashboard/upload` and `/dashboard/dashboard`.

- Adding a page inside `(app)/` puts it at `/<folder>` and it inherits the header
  and the auth guard. Don't reintroduce a real `dashboard/` parent folder to get a
  shared layout — that is the doubled segment coming back.
- `app/page.tsx` redirects `/` to `/dashboard`; login sits outside the group at
  `/login`, since it must not inherit the header or the auth guard that sends an
  unauthenticated visitor there.
- Internal links live in `components/layout/Header.tsx` (`navItems`), plus
  `router.push("/dashboard")` after login and after an upload.

## State

`lib/app-state.tsx` holds the session. Saved JDs live in `localStorage`
(`exl_saved_jds`) with the raw file blobs in IndexedDB (`lib/db.ts`);
`exl_last_jd_uuid` drives dashboard restore-on-reload.

Split of responsibility, easy to get wrong:

- **Upload page = the JD only.** It uploads and labels job descriptions; it does not
  take resumes. The entry card *is* the JD file picker (choosing a file sets
  `showNewJD`), and the page ends at "Add resumes on the Dashboard", which stores
  `exl_last_jd_uuid` so the dashboard opens on the JD just uploaded. The resumes
  panel, the local resume list and `handleAnalyze` were all removed from here —
  two upload paths meant two error strips and two "max 10" rules to keep in step.
  Don't reintroduce resume upload on this page.
- **Dashboard = resumes.** `handleUploadMore()` ("Add Resumes") is the *only* place
  resumes are uploaded: it posts to `/resume/upload` against a JD already in the
  database and re-renders the table from the response. Analyzed resumes live in the
  backend and are re-fetched (`restoreLastSession`), not held in localStorage.
- The JD list shows *analyzed* counts from `/jds` `resume_count`.
- `hasAnalyzed` (which unlocks AI Assistant) is set in `app-state.tsx` from
  `exl_last_jd_uuid` or any JD existing — not by the old Analyze button.

Deleting a candidate on the dashboard also has to prune the Upload page's lists.
That match is keyed on **filename** (`ponytail:` — the same filename under two saved
JDs would remove from both; store the resume uuid on `UploadedFile` if it misfires).

## HR screening

`app/(app)/dashboard/HrScreeningModal.tsx`. Responses, HR notes, and a decision
override persist to the backend (`PUT /resume/{uuid}/screening`) and are seeded back
into the form on reload from `hr_screening` on each resume.

`selected_questions` is persisted alongside the responses. It used to be dropped by
the backend even though the modal sent it, so a question ticked but left unanswered
came back unticked — don't remove it from the `PUT` payload or the stored dict. The
dashboard now also seeds it back (`initialSelectedQuestions`); without that the modal
had to re-guess the ticked set from which answers were non-empty.

The questions are a **conditional flow**, not a list: `lib/screening-flow.ts`.
A static decision tree, so it is a flat array with an `askIf(answers, ctx)`
predicate per question — no engine, no state machine. `visibleFlow()` walks it
on every keystroke and returns what applies plus why it stopped.

**The questions and every branch come from the manager's spec** —
`TalentAgent_AI_Suite_enhancement_tracker.xlsx`, sheet
"Questions (HR, Candidate)". Don't add, reorder or reword one without that
sheet changing first; `screening-flow.check.ts` asserts the set and the order.

Two questions from the workbook's **second** sheet ("HR-based agent
questionnaire") have since been adopted: `still_interested` ("Are you still
interested in this job?") and `self_intro`. That sheet was previously not
implemented at all, and this paragraph used to say so — it is a decision that
was reversed, not a gap that was overlooked. The rest of that sheet is still
not implemented: its notice-period rules keyed to the requisition maximum, and
its negotiation question conditional on being over budget (ours is asked of
everyone, on request).

**`r1_availability`** ("If you are selected for the next round, on which
weekdays and at what time would you be available for the interview?") was
added on request on 2026-10-21, not from the sheet. It is asked **last, of
everyone** (index 321, after `join_reason` in `ASK_ORDER` and in
`script.FLOW`). The call extracts a short value ("Mon to Wed, 2 pm to 5 pm")
rather than free text, because that value is what the dashboard prints, and
only on a row Selected for R1 (see the dashboard's candidate table below). No
joining criterion reads it.

**Ask order is no longer array order.** The two adopted questions are asked
*second and third* but sit at the **end** of `FLOW_QUESTIONS`, because a saved
response is keyed by `FLOW_INDEX_BASE + position` and inserting them would
silently re-point every answer stored against every later question. `ASK_ORDER`
holds the conversational sequence, `walk()` iterates it, and the check file
asserts it is a permutation of the keys and that every `dependsOn` is asked
before the question naming it. It mirrors the graph in
`backend/voice/script.py` (`FLOW`) — keep the two in step.

- Responses are keyed by **`FLOW_INDEX_BASE + position`** (300+), so the array is
  append-only. Reordering silently re-labels every saved response.
- **Four reserved ranges now**: 0-9 the original fixed list, 100-199 per-resume
  risk questions, 200-299 the first conditional flow (frozen as
  `LEGACY_FLOW_QUESTIONS`, read-only in "Earlier screening"), 300+ the live
  flow. The new flow took a new range rather than reusing 200 because it is a
  *different set of questions*: reusing it would have re-pointed every saved
  response and tick at a question nobody was asked.
- `requires(ctx)` vs `askIf(answers, ctx)` — and the difference matters. A
  `requires` reads only the requisition or the resume, so it is knowable before
  the phone rings and is enforced identically in the modal and on the call. An
  `askIf` reads answers and is therefore subject to the "branch undetermined"
  allowance `callableFlow` needs. Putting the employment gate in `askIf` sent
  the notice-period questions to unemployed candidates on every call.
- A follow-up whose dependency was itself dropped is dropped too (`kept` in
  `walk`), so "how long is your notice period" cannot reach a candidate who was
  never asked whether they would resign. `dependsOn` keys must sit **earlier**
  in the array than the question naming them — asserted in the self-check.
- **The employment gate is the sheet's step 3.5.** A candidate whose resume says
  they are not working anywhere is never asked about notice period, buyout or
  current CTC — on screen or on the phone. It comes from `currently_employed`
  on the resume (`"yes"` / `"no"` / `""`), extracted in `backend/agents.py` and
  stored in Chroma. `""` — every resume analyzed before the field existed —
  asks everything, because a wrong skip loses answers and a wrong ask costs
  twenty seconds.
- One question carries `options` (Yes / Maybe / No): "willing to resign", where
  the sheet ends the call on anything short of yes.
- `type` picks the input: `yesno` → two radios, `number` → a number input hinted
  with `unit`, `date` → a native `<input type="date">`, anything else → textarea.
  Stored values are `"yes"` / `"no"` / `"60"` / `"400000"` — plain strings, so
  there was no schema change; `parseYesNo()` and `parseNumericAnswer()` in
  `screening-questions.ts` turn a phone transcript into one. Both fail closed:
  `parseYesNo` reads only a reply that is *entirely* a yes/no phrase, because
  the first-keyword-wins version it replaced made "right now is not a good
  time" a yes and "no worries, this works for me" a no.
- **`heard` is saved with the responses.** A number field keeps `400000` and a
  radio keeps `yes`, so the sentence those were parsed from ("only 4LPA, but
  it's negotiable") used to vanish the moment the modal closed. It is persisted
  in `hr_screening.heard` and seeded back as `initialHeard`, and renders as the
  "On the call" line under the field. Free-text questions never needed it — the
  transcript *is* their value.
- Old answers still render, read-only, in the modal's collapsed "Earlier
  screening" block — now both frozen ranges, 0-9 and 200-299. The 0-9 half is
  the only thing that still reads the `jdAnswers` prop.
- `gate` on a question ends the screening there and shows a reason strip — bad
  time to talk, will not relocate to where the job is, not committing to
  resigning. **The reason is spoken, not just shown**: `flow_rules()` tells the
  agent to say why it is closing early before it says goodbye, and `agent.py`
  repeats the rule for JDs with no criteria. A screening never ends on a bare
  thank-you. A gate **never** touches
  the decision — that stays with the Override dropdown. `flag` is the softer
  version: a warning under the field, flow carries on (notice over the
  requisition's max, expected CTC over budget).
- The gate sits on the **last** question of a terminating branch, not the one
  that triggers it — otherwise "no, it's a bad time" would stop before asking
  when to call back.
- A branch opening mid-screening arrives **ticked** (`everRevealed` in the
  modal), because a question's input only renders when ticked. Only genuinely
  new indices are touched, so an explicit untick survives the tree reshaping.
  A candidate screened before the flow existed has no opinion stored about the
  200+ range at all, so that whole range starts ticked rather than entirely off.
- **A question appended to the flow later also arrives ticked.** Every save
  records `flow_size` (how many flow questions existed); on open, `addedSince()`
  in `screening-flow.ts` ticks any question past it. Saves from before the field
  count as `UNRECORDED_FLOW_SIZE` (21, frozen). Without this, a saved tick set
  read the new question as unticked, and since the call sends only ticked
  questions, `r1_availability` was never asked of anyone already screened.
- **The per-resume risk questions are gone from HR screening.** The 100-104
  range ("Flags from this resume") is no longer rendered, ticked, or called. The
  backend still generates and stores them, and a candidate who answered some
  before still has those answers saved back untouched — they simply are not
  shown or asked. Removing the UI alone was not enough: `handlePhoneCall` treats
  "never shown" as "no opinion, include it", so the range had to come out of
  `visibleIndices` and `callable` too, and out of the bulk endpoint's
  `question_indices` default in `main.py` — that default was the one remaining
  path that would still have read them down the phone.
- The flow branches on `role_criteria`, passed in as the `criteria` prop, plus
  `jobLocation` for the relocation branch. A JD without criteria gates nobody
  and asks everything — that is what every JD uploaded before them does.
- **Budget is in lakhs, CTC is in rupees.** `BUDGET_LAKH` in `screening-flow.ts`
  is the only place the two meet. Drop the conversion and the negotiation branch
  silently never fires; `screening-flow.check.ts` has a case for exactly that.
- The old list used to be rendered **twice**: the modal had its own hardcoded
  copy *and* rendered `candidate.screening_questions`, which the LLM was
  instructed to reproduce verbatim for every resume. The LLM field is gone
  (schema, prompt and stored metadata); `migrateScreening()` in `api.ts` shifts
  indices saved under the old two-block layout down by the stored
  `screening_questions.length`. Don't reintroduce a per-resume question list
  without deciding what it does to those indices.

### Joining likelihood

`joining_assessment` on `CandidateEvaluation` — HIGH / MEDIUM / LOW / WITHDRAWN
plus the criteria behind it, from the screening answers against the requisition.
The rules are the backend's (`backend/joining_evaluator.py`, §7.4 of
`../backend/ARCHITECTURE.md`) and there is **no copy of them in TypeScript** —
duplicating a decision table across two languages is how the two start
disagreeing about the same candidate. The frontend renders what it is given.

- Two places show it, one style: the dashboard's **Joining** column
  (`JoiningCell`, a pill with a hover card) and the HR modal's **Joining
  likelihood** panel (`JoiningPanel`, under the resume's own flag lists — the
  resume says whether they can do the job, this says whether they would turn
  up). `JOINING_STYLE` in `components/charts.tsx` is the single
  category → label + colour mapping, the same rule `scoreColor()` follows.
- **WITHDRAWN is grey, not red.** The candidate took themselves out; painting it
  as a failure puts our worst outcome on someone we never judged.
- `undefined` renders as **an em dash, never "High"**. The backend withholds a
  verdict for a screening nobody has answered, because unknown means "no flag"
  in the rules and an empty screening would otherwise come back with a clean
  sheet. Don't add a default here.
- It is **advisory and says so**: both surfaces point at the Override dropdown.
  Nothing reads it into `shortlist_decision` — same rule as a screening `gate`.
- Recomputed by the backend on every read, so the modal's panel is **as at the
  last save**: answers typed into the form below it reach the verdict once Save
  Responses has been pressed and the dashboard re-reads (`loadSession` on close).
  Wiring it live would mean the TypeScript copy of the rules this avoids.
- **A call's answers count without a save.** The backend fills every field HR
  has not saved from the candidate's call before judging (`with_call` in
  `backend/app/main.py`), the same fill the modal does on open, and serves the
  call's own communication score as `interview_scores` until Save stores
  Mistral's regrade. So a row has both the moment its call ends, bulk or single:
  the dashboard's active-call poll re-reads the rows (`loadSession`) whenever a
  session it saw `in_progress` no longer is.
- The Excel export carries `Joining Likelihood` and `Joining Red Flags`, blank
  for an unscreened candidate for the same reason the dash is.

## JD role criteria

The only thing HR states about a requisition beyond its name, id and location:
experience min/max (years), budget min/max (**lakhs**), workplace mode
(WFO/WFH/Hybrid), notice min/max (days), and whether the company pays a buyout.
`lib/role-criteria.ts` holds the field spec; `backend/role_criteria.py` holds the
keys, which are the storage contract.

- They are what the HR screening flow **branches on**, so they are numbers and
  enums rather than sentences. Stored on the JD in Chroma as `role_criteria`,
  returned by `/jds` and `/jd/{id}` so the dashboard gets them with the JD list
  rather than a per-JD round trip.
- `RoleCriteriaFields` in the Upload page renders them for both the upload form
  and the Edit dialog, same reason `JobIdField` is shared. Native number inputs
  and radios; no component library.
- Required at upload — the button stays disabled until all 8 are set and
  `POST /jd/upload` 400s on a partial set, so a JD can never exist half-specified.
- Three states on **edit**, and the middle one is why the gate exists: all set →
  sent; all blank (a JD from before them) → omitted, stored set untouched;
  part-set **or min above max** → Save disabled, because sending it 400s and
  dropping it would silently discard what HR just typed.
- `criteriaErrors()` runs the backend's own rules in the browser so `min > max`
  reads as a message under the field rather than a 400 after the file uploaded.
  The backend still checks — this is the nicer copy of the check, not the only one.

### The screening answers that used to live here

HR used to answer eight free-text questions per requisition at JD upload — max
notice period, work model, BGC requirements — stored as `screening_answers`.
**Removed on request.** Nothing ever compared them against the candidate's
answers; they were prose printed beside prose.

What that means if you go looking for them:

- `screening_answers` is still **stored, still returned, never written**. JDs
  that have them keep them; the HR modal's "Earlier screening" block is the only
  reader left, and it uses them to label historical candidate answers.
- The backend's `QUESTION_KEYS` and `parse_answers()` are gone, as is the
  `screening_answers` branch in `PUT /jd/{id}/info` and the `Form` field on
  `POST /jd/upload`. `SCREENING_QUESTIONS` in `lib/screening-questions.ts`
  survives (frozen, append-only) purely to label those stored answers.
- Don't reintroduce the form without deciding what compares the two sides. The
  role criteria above are the version of this idea that pays for itself: typed,
  and the screening flow actually branches on them.

The **AI Phone call** button calls the candidate on the number extracted from
their resume and asks the ticked questions (`startPhoneInterview` →
`POST /resume/{uuid}/interview`), then polls every 5s
(`getPhoneInterview` → `GET /interview/{session_id}`) and writes each
transcript into `responses` — the same map HR types into, so nothing is stored
until Save Responses and a mis-heard answer can be fixed first.

- The **question text is the backend's** (`FLOW_QUESTIONS` in
  `screening_questions.py`, plus the legacy `CALL_QUESTIONS`); the modal only
  sends the ticked *indices* and gets answers back keyed by index. Both lists
  are index-aligned — the append-only rule applies to `screening-flow.ts` and
  `FLOW_QUESTIONS` together.
- Only the **visible** ticked questions are sent. A question the flow has ruled
  out must not be read down the phone just because it was ticked before the
  branch closed.
- **"Is this the right time to talk?" is sent like any other question.** It is
  the graph's first node and the greeting no longer duplicates it, so index 300
  comes back as a real answer rather than a field HR filled in by hand. The old
  `RIGHT_TIME_POSITION` strip is gone.
- **A redial drops the previous call's `right_time` / `callback_time`**
  (`RESCHEDULE_INDICES` in `screening-flow.ts`). Those two describe the call they
  were said on, not the candidate, and `callback_time` *gates* — left in, every
  second call was truncated to those two questions and the candidate was dialed
  only to be read the CV questions. Every other answer a call recorded is still
  a fact about them and still shapes the next call's script.
- **The modal keeps polling through an armed callback** (`callback_at`). A
  rescheduled redial runs on the *same* session and fills the *same* answers, so
  `call_status: completed` on the first call is not the end of the screening.
  Stopping there left the redial to run the whole questionnaire with nothing in
  the browser watching — HR came back to an empty form and no live updates.
  (The comprehensive score no longer depends on it: the dashboard row reads it
  off the call itself.) Polling drops to 30s while waiting, since a callback can
  be hours away.
- **Ticks lock while a call is out** (`ticksLocked`). The script goes to the
  voice service when the call is placed, so a tick changed afterwards would
  change nothing the agent asks — HR would untick a question and then watch it
  get asked.
- Once a call has been placed the question list **stops shrinking**
  (`frozenIndices`). The call's own answers reshape the flow, and a question
  that disappears takes its tick and its answer box with it — so HR could no
  longer correct what the agent misheard.
- The modal **reads back the call on open** (`interview_session_id`, stored on
  the resume when the call is placed). Answers come back keyed by flow key, so
  the session id is all it needs. This is what recovers a **rescheduled
  callback**, which is dialed automatically hours after HR closed the form.
  Only empty fields are filled.
- The **branching is code-driven, in the voice service.** It used to be a
  `context` string of prose rules pushed into the agent's prompt
  (`flow_rules()`), which the model followed only mostly. It is now an explicit
  flow table (`backend/voice/script.py`) whose keys are these
  flow keys. Questions it never reaches are **absent** from the answers rather
  than `no_answer` — that still means "asked, and they said nothing".
- **Which questions apply is settled before dialing**, by the backend, as the
  key set of the map it sends. HR's ticks, the WFH rule and the employment gate
  are all `requires`-shaped — knowable without hearing a word — so none of them
  is a runtime decision for the agent.
- **Answers come back with the call's own reading.** Each answer carries a
  `value` — the yes/no, day count or rupee figure the conversation actually
  *branched on*, extracted server-side. `answersFromCall` prefers it over
  `parseYesNo` / `parseNumericAnswer`, because a browser-side parse can land
  somewhere else and then HR is "correcting" a figure that already decided which
  question came next. Our parsers stay as the fallback and are still
  load-bearing: they serve the 0-9 range, and the extractor returns nothing at
  all when its model call fails.
- **Bulk calling**: tick rows on the dashboard and "Call selected" appears
  **beside the Search box**, over the table it acts on — moved there on request
  from its first home next to Export, which is a side errand rather than
  something that changes the rows (`startBulkInterviews` →
  `POST /interviews/bulk`). Calls are
  placed concurrently by Sarvam Voice Agents, so `queue_position` is always 0
  now and the queue-position label never shows. A candidate with no usable number is named in the notice strip and
  skipped, never allowed to fail the batch. Select-all covers the *filtered*
  rows, not the whole cohort: it must mean what is on screen.
- **A second call clears the first one's artefacts.** Placing a call wipes
  `interview_transcript`, `interview_recording_path` and `interview_scores` on
  the resume, because those archived copies are served *in preference to* the
  live session — the footer would otherwise play the previous call back over
  the new one, next to a comprehensive score earned on a different
  conversation. Save Responses re-archives from the new session.
- Polling stops when the call reaches a terminal `call_status` (`CALL_ENDED`;
  `backend/voice` maps Sarvam's statuses onto these words, pinned by its `check.py`)
  and no transcript is still running — with a ~30s grace, because questions the
  candidate never reached stay `pending` forever and would otherwise poll on.
- Answers arrive when the call ends (Sarvam extracts them post-call), not
  turn by turn.
- It needs the Sarvam values in `backend/.env` (see `backend/ARCHITECTURE.md`
  §7.1 and SETUP.md §4); without them the button reports which are missing
  instead of failing silently.

**Play recording / Transcript** sit in the modal footer beside AI Phone call —
the only place either lives now, since the dashboard table's Recording /
Transcript column was removed on request. They are **absent until this candidate
has been called**, since nothing else in the footer is a permanently dead
control. The urls come from `interviewUrls()` in `api.ts` rather than the candidate's
`interview_recording_url`, because a call placed *inside* the modal has no url on
the prop it was opened with; `calledHere` is what reveals them in that case.

The **View resume** button opens the original file in a new tab (`target="_blank"`),
not a download — the backend serves it with `Content-Disposition: inline`
(`/resume/{uuid}/download`). Unviewable types (e.g. docx) still download.

The **mini-chat** (`AI Assistant`) is scoped to just this candidate: it passes
`candidate.candidate_id` (the resume uuid) to `chatWithAI`, which forwards it as
`?resume_uuid=` so the backend loads only that one resume plus its JD (see
`../AGENTS.md`). The dashboard-wide chat (`app/(app)/chatbot/`) omits it and sees
every resume — don't "simplify" by dropping the id, or the mini-chat starts
answering about everyone.

One ordering trap, already fixed — don't undo it:

- The decision pill opens the modal when `shortlist_decision` **or** `ai_decision` is
  Interview — otherwise overriding a candidate locks you out of their own form.

If Save Responses fails with a bare 404, the backend is a stale uvicorn — see the
`--reload` note in `../AGENTS.md` before touching this file.

## Word cloud

Match text is lowercased everywhere, so anything compared against it must be
lowercased too — including the `getRelatedWords()` fallback. Case-sensitivity bugs
here show up as "JD says Python, resume says python, no match".

Clicking a chip toggles a filter; AND/OR and skills/broad set how the selection is
applied. Bulk selectors (Select All / High-Match / a min-match threshold) were
deliberately removed — don't add them back without being asked.

## Dashboard layout

`app/(app)/dashboard/page.tsx`. The stacked **pipeline bar** is the page's one
bold element: segment widths are the real Interview/On Hold/Rejected proportions,
and clicking a segment or its legend entry sets `decisionFilter`. It replaced a row
of generic stat cards — keep the rest of the page quiet around it (uppercase eyebrow
headers, `tabular-nums` on figures). Empty and no-match states must offer the action
that resolves them, not just state the problem.

- **It counts only screened candidates** — the rows in `reviewedCandidates`, which
  is exactly the set whose decision button reads a decision rather than "HR
  Screening". `shortlist_decision` has a value for everyone (it is derived from
  the resume score), so counting the whole cohort put candidates nobody had
  opened under "Selected for R1". The un-screened rows are counted by the
  Ready-for-HR-screening tile above and appear nowhere in this card — the note
  beside the title that used to name them was removed on request.
  `decisionFilter` carries the same restriction — a segment reading 1 must list
  one row.
- Percentages are over the **screened** set, not the cohort, so the bar always
  fills its full width; a permanent grey tail read as a broken bar. The widest
  segment absorbs the rounding so three thirds total exactly 100.
- `ChartPanel` ("Score distribution & experience mix") is **open by default** on
  request. It stays collapsible; the charts don't mount while closed.

### Collective analysis

The second `ChartPanel`, between the distributions and the candidate table: the
cohort as one set of figures — mean, median and mode per metric — rather than a
list of people. `lib/collective.ts` computes it, the page only renders.

- **Three tables, because their denominators differ.** *Call effort* covers only
  candidates with an archived call; *Criteria* covers whoever has each score;
  *Compensation* covers whoever has been screened. Merging them would average
  over people who were never measured, so every row ships its own `n` and a
  metric nobody has reads as an em dash, never 0.
- Call figures come from `interview_call_stats` on the candidate — duration,
  dials placed, callbacks arranged, dials not picked up, times they rang back,
  and rupees spent — served **live** off the voice session, or from the copy
  archived on Save once the session file is gone (`backend/ARCHITECTURE.md`
  §7.1). They are **per candidate across every dial**, because a reschedule
  redials the same voice session.
- **The page is its own route now** (`app/(app)/analysis/page.tsx`, "Collective
  analysis" in the nav), not a card on the Dashboard; the bullets here still
  describe it.
- **Money, two ways.** The tiles *Total spent* and *Credits left* are the
  **account's** (`getCallUsage` → `GET /interviews/usage`): Sarvam's own bill
  and balance, copied by hand into `backend/.env` (`SARVAM_SPENT`,
  `SARVAM_CREDIT_BALANCE`, `SARVAM_CREDIT_BALANCE_AT` — Sarvam has no balance
  API), moved by the estimated cost of every call since. The note under Total
  spent says which it is (`billed_at`); without the bill it estimates every
  call the agent has taken. Credits left is a dash until a balance is set. The
  per-candidate credits are **estimates** from the published rate, which runs
  a little above the bill, and the table's footnote says so. The **Calls and credits per
  candidate** table is **this JD's** share: times called (every dial,
  answered or not), callbacks, talk time, credits, and a total row
  (`callSpend()` in `collective.ts`, money via `formatCredits`, exact to the
  paisa, unlike `formatMoney`'s compact salaries). A row whose stats predate
  cost (archived from the old Twilio service) reads a dash, never ₹0. These two
  tiles replaced *Median ask* and *Above the ceiling* on request; both figures
  are still read in the salary panel's "Against this JD" column.
- Built from the whole cohort, **not `filtered`** — the search box narrows the
  table below, and must not silently re-scope the requisition's summary.
- `median` here is deliberately **not** `insights.ts`'s: that one rounds because
  it feeds a score tile. Don't merge them.
- Mode: ties resolve to the smallest value, and a set where nothing repeats has
  **no** mode. Naming an arbitrary member would read as a finding.
- Labels follow the app's wording — the stored field is `communication_score`,
  the row says **Comprehensive score**, same rule as the table header.
- **Two charts, both about the call**, above the tables: call length spread
  (minute bands, open-topped at 5m+) and dials per candidate (1/2/3/4+). They
  are the same `Histogram` the score and experience panel uses, fed by
  `durationBins()` / `dialBins()`. The **criteria are deliberately not charted**
  — their histograms are in the panel immediately above, and a second drawing of
  them says nothing new.
- The bars must always **sum to the `n`** printed beside them, which is why both
  top bands are open-ended and `dialBins` clamps a 0 up to 1 (only reachable
  from a call archived before dials were counted). The check file asserts the
  totals; a chart whose bars quietly lose a row is the failure to avoid.
- Charts are hidden entirely while nothing has been called, rather than drawn as
  empty bands — six flat bars read as "every call was zero seconds".

#### Compensation

What the requisition offers, what candidates are on, and what they are asking —
the three read against each other. **Units are the trap here.**

- The JD's band is in **lakhs**; a candidate's CTC answer is in **rupees**.
  `budgetRupees()` in `screening-flow.ts` is the only converter, sitting on
  `BUDGET_LAKH` exactly as `role-criteria.ts` requires. The dashboard calls it
  and hands `buildCollectiveAnalysis` a band **already in rupees** — never
  convert at a call site, and never inside `collective.ts`.
- `current_ctc` / `expected_ctc` are parsed onto `CandidateEvaluation` by
  `ctcFrom()` in `api.ts`, not read in a component: the raw answer is a string
  in a map keyed by `FLOW_INDEX_BASE + position`. It goes through
  `answersByKey()` — **never hardcode an index**, the flow is append-only and a
  literal would re-point the day a question is added. A stored `0` is dropped
  with the blanks; nobody's package is nothing.
- Both parses live in `api.ts` rather than `collective.ts` so that module keeps
  its type-only imports and its check keeps running without a bundler.
- Money renders through `Intl.NumberFormat("en-IN", { notation: "compact" })` —
  "15L", "12.5L", "1.2Cr". The locale already knows the lakh/crore grouping, so
  there is no arithmetic to get wrong and a package past a crore needs no case.
- `aboveBudget` is **null, not 0**, when the JD has no ceiling: "nobody is over"
  and "there is nothing to be over" are different answers, and only one of them
  is about the candidates. Asking *exactly* the ceiling is within budget.

### Call calendar

The **calendar icon** beside Export (Dashboard only — `JdBar`'s `actions`
slot) opens `components/CallCalendar.tsx`: a Teams-style week, Sunday first,
of every AI call made or taken and every redial still to come
(`getCallSchedule` → `GET /interviews/schedule`, every session, not just this
JD's — the phone line and its diary are shared).

- Four tones, all tokens: **scheduled** (brand; a callback the candidate asked
  for, or a retry after a miss), **on the call** (interview green), **called**
  (slate) and **not reached** (amber). The strip under the toolbar lists every
  scheduled call and jumps to its week, since the view opens on today.
- The arithmetic is `lib/call-calendar.ts`, type-only imports, checked by
  `call-calendar.check.ts`: blocks are drawn at least 30 minutes long and laid
  side by side where they overlap (a bulk call dials everyone in one minute),
  and the grid shows calling hours, 9 to 21, widened to take in any call
  outside them.
- **Portalled to `document.body`.** The button lives in the sticky `JdBar`,
  whose backdrop blur makes it the containing block for `position: fixed`; an
  in-place dialog rendered inside the bar instead of over the page.

The page has **no title block** — the eyebrow, job name and "job code · location ·
n candidates screened" line were removed on request; the JD switcher names the
job and the top nav (taller since, `h-[88px]`, with correspondingly larger logo,
nav links and icon buttons) carries the app identity. Don't
reintroduce a page heading here. The top row is the JD switcher + Add Resumes on
the left, Export alone on the right.

The candidate table's own affordances:

- The **name is a link** to that candidate's resume, opened in a new tab. Same
  rule as the HR modal's View resume and the Upload page's JD rows: it is only a
  link when the backend kept the file (`resume_url`), plain text otherwise, so it
  can never open a tab on a 404.
- Columns are **evenly sized**: seven equal `1fr` content columns, then a 36px
  action column, one `gap-4` throughout. Don't reintroduce per-column widths on
  the content columns.
- **Delete is a bare 36px icon with no column header** — reversed on request; it
  used to be a labelled 112px "Remove" column, and this bullet used to say so.
  The 76px that bought went back to the content columns, which is the point:
  Comprehensive score and Joining were cramped. The header slot renders an empty
  `<span />` to keep the grid's child count matching its nine tracks, and the
  row's button carries `title` and `aria-label` naming the candidate, since
  there is no longer a header to read it from. Column headers are otherwise
  bold, **left-aligned** and `text-foreground` (not the muted eyebrow grey).
- Two icons that point at different things on purpose: the **ⓘ** by the JD
  switcher opens the **JD** (`jdFileUrl`, greyed when the file wasn't kept); the
  **👁 eye in front of each candidate name** opens that **candidate's resume** —
  the same target as the name, which reads as text while the eye is the explicit
  affordance. Nothing inside the table links to the JD.
- Closing the HR modal re-reads the JD's resumes (`loadSession`), because a call
  placed inside it changes what the row knows about the candidate.
- **Next-round availability sits under the Decision pill**, on rows that read
  Selected for R1 only: the same test the pill uses (`reviewedCandidates` and
  `shortlist_decision === "Interview"`). It reads "Available: Mon to Wed, 2 pm
  to 5 pm", clamped to two lines with the full text on hover, or "Available: —"
  when the saved screening has no answer yet. The value is `r1_availability` on
  `CandidateEvaluation`, from the **saved** responses (`toEvaluation`), so an
  answer from a call reaches the row once HR presses Save Responses, like every
  other answer. Every candidate is asked; only R1 rows show it, on request.

Removed on request, don't restore without being asked:

- The `60` / `75` scale key above the Match column, **and** the two threshold ticks
  `ScoreRuler` drew on every fill. The ruler is a plain 0–100 bar now; the Decision
  pill in the same row carries the cut-off. `SCORE_THRESHOLDS` still drives
  `scoreColor()` and the score histogram's markers.
- The **Recording / Transcript column** — the inline `<audio>` player and the
  `.txt` download. Both still exist in the HR modal footer, and
  `interview_recording_url` / `interview_transcript_url` are still on
  `CandidateEvaluation`; only the table column is gone.

The years-of-experience range slider (`expRange`) moved out of the Experience mix
card to sit **directly above the candidate table**, with the badge and Reset on the
same row — it filters the table, so it lives with the table. The chart shows shape
only. Its clear-chip in the active-filters strip is the other way to drop it.

## One type scale, one palette

Both live in `app/globals.css` and nothing outside it invents a value.

- **Type**: eight steps — `text-[11px]` caption · `13` secondary · `15` body ·
  `17` emphasis · `21` page/card title · `26` hero · `34` stat readout · `44`
  the progress overlay's figure. There is no `text-sm`/`text-xs` anywhere; a
  size not on the ladder is a bug, not a decision.
- **Headings**: `.eyebrow` (11px mono caps) for inline labels, `.eyebrow-lg`
  (14px) for every card and section title, both inked with `--heading`. The HR
  modal used to title its sections with sentence-case bold instead — one
  system now. Page `<h1>`s are 21px `text-foreground`.
- **Colour**: semantic meaning always comes from a token — `--brand`,
  `--decision-interview` / `-hold` / `-rejected` (+ their `-wash` and `-ink`
  steps), and `--danger` / `--danger-strong` / `--danger-wash` for errors,
  invalid fields and delete. No `red-500`, `emerald-*`, `amber-*` or raw hex
  in a component; `scoreColor()` in `components/charts.tsx` is the single
  score→colour mapping (the HR modal had grown a second one with different
  thresholds).
- The `* { border-color: var(--border) }` reset **must stay inside
  `@layer base`**. Unlayered CSS outranks every layered rule regardless of
  specificity, so while it sat outside a layer it silently overrode every
  Tailwind border-colour utility in the app — every `border-[var(--brand)]/40`
  hover and every coloured error strip rendered plain grey.

## Waiting

`components/ProgressBar.tsx` is the one bar, used wherever a request runs long
enough to look stuck: JD upload (Upload page), Add Resumes and JD switch
(dashboard), and session restore. The fill is **indeterminate** — the batch
comes back in one response, so any percentage would be invented — and the
**label is real**: it names the stage the backend is actually on.

- `uploadJD()` and `uploadResumesForJD()` take an optional `onProgress`. They
  mint an `upload_id`, send it with the files, and poll
  `GET /upload/{id}/progress` (backend `progress.py`, §7.2 of
  `../backend/ARCHITECTURE.md`) until the POST returns. Polling failures are
  swallowed: this watches a request that is going fine, so a missed poll must
  never surface as an error beside it.
- The backend's stage names (`parsing`, `checking`, `analyzing`, `embedding`,
  `storing`) are identifiers. `stageLabel()` in `api.ts` is the **only** place they become
  words HR reads, and it falls back to the caller's own label until the first
  poll lands — so a backend that never reports still shows something sensible.
- The **percentage** is `uploadPercent()` in `lib/upload-progress.ts`: files
  stored, plus how far into the current stage the batch is, worth at most one
  file of credit. It reaches 100 only when the backend says every file is
  stored — a bar reading 100% while the page still waits is worse than one
  reading 99. `watchProgress` keeps the **running maximum**, because files run
  in parallel and the reported stage is whichever one moved last: a raw reading
  legitimately goes `storing` → `parsing` when a second file starts, and a bar
  that slides backwards reads as a bug.
  `node --experimental-strip-types lib/upload-progress.check.ts` covers the
  arithmetic; the file has no runtime imports so it needs no bundler.
- `overlay` centres the bar on a dimmed full-screen backdrop with the
  percentage as a 44px headline. Both **uploads** use it — JD upload and Add
  Resumes — because nothing else on the page is usable while one runs. A JD
  switch and a session restore keep the inline bar.
- `ProgressBar` is determinate **only when given `percent`**. A JD switch and a
  session restore have nothing to measure, so they keep the travelling fill —
  as does an upload, for the moment before its first poll lands.

## Wrong file uploaded

The backend refuses a file that is not the kind it was asked for — a payslip in
the resume batch, an offer letter in the JD slot — before any analysis runs
(`backend/document_check.py`, §7.3 of `../backend/ARCHITECTURE.md`). It comes
back as a **422 whose `detail` is already written for HR**, so both call sites
show it verbatim:

- `uploadJD()` passes 400/409/**422** through unchanged; the Upload page puts it
  in the corner toast and the inline error strip, and no JD is created.
- A rejected resume arrives as that file's `error` in `results` and reaches the
  dashboard through `describeFailures()` — which is why its wording is "was not
  analyzed" and not "could not be read": the file was read fine, it just wasn't
  a resume.

Don't add a second copy of this rule in the browser. A file extension says
nothing about what is inside it, and the only thing that can tell a CV from a
certificate is the model that reads it.

## Checks

`./node_modules/.bin/tsc --noEmit` from `frontend/` (run it from that directory —
the binary is not on PATH from the repo root).

Eight runnable self-checks, no framework, not imported by the app:

```
node --experimental-strip-types lib/call-calendar.check.ts
node --experimental-strip-types lib/screening-questions.check.ts
node --experimental-strip-types lib/screening-flow.check.ts
node --experimental-strip-types lib/upload-progress.check.ts
node --experimental-strip-types lib/jd-search.check.ts
node --experimental-strip-types lib/collective.check.ts
node --experimental-strip-types lib/call-status.check.ts
node --experimental-strip-types lib/pool-decision.check.ts
```

`screening-flow.ts`, `jd-search.ts`, `collective.ts`, `call-calendar.ts` and `call-status.ts` have
**no runtime imports** (`import type` only) so their checks run without a
bundler — keep it that way, or they need a build step. `call-status.ts` was
split out of `api.ts` for exactly this reason; `api.ts` re-exports all of it.
`*.check.ts` is excluded in `tsconfig.json`, which is what lets those files use
`.ts` import extensions.
