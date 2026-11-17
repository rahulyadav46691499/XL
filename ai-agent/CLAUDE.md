# TalentAI

> **Whenever you change anything in this repo, update `CLAUDE.md` in the same commit so it always matches the code.**

An AI recruitment suite: upload a job description, upload resumes, get them
scored and ranked against it, then screen the shortlist — on screen, or by an
AI voice agent that actually telephones the candidate. The phone call runs on
**Sarvam Voice Agents** (Saaras v4 ASR, Bulbul v4 TTS, Sarvam's LLM); there is
no Twilio and no self-hosted audio pipeline any more.

---

## 1. Two services, both needed end to end

| Service | Folder | Port | Start |
|---|---|---|---|
| Frontend (Next.js, App Router) | `frontend/` | 3000 | `npm run dev` |
| Backend (FastAPI + Chroma, and the AI phone calls) | `backend/` | 8000 | `.venv/bin/python -m uvicorn app.main:app --reload --timeout-graceful-shutdown 3 --port 8000` |

Install steps, Windows commands, the Sarvam keys and phone number, `.env`
contents and troubleshooting are in **[SETUP.md](SETUP.md)** — don't duplicate
any of it here. **[RUNNING.md](RUNNING.md)** is its short quick-start for
whoever receives the zip; keep the two consistent.

Everything except the **AI Phone Call** button works without the Sarvam values
in `backend/.env`; without them that button says which are missing.

`.claude/launch.json` defines these same two for the Browser pane. They are
the only code in the repo; the rest is data and docs — see §5.

### `backend/voice/` and the Sarvam agent are one unit

The phone calls live in the backend process, in the `voice` package (until
2026-10-17 they were a separate service on :8080). `backend/voice/calls.py`
places calls through Sarvam's Instant Outbound API and takes the result off
Sarvam's call-end webhook, `POST /api/sarvam/webhook` on :8000 (or, if that
never arrives, off the analytics API, polled by a scheduler that runs in the
backend's lifespan). The conversation itself is the Sarvam agent
**TalentAI HR Screening** (`TalentAI-HR-4a763f40-8322`, org/workspace in
`backend/.env.example`). Its source of truth is in the repo:
`backend/voice/agent_prompt.md` (instructions) and `backend/voice/agent_config.json`
(variables, voice, languages). Calls always run a **committed** version, never
the draft.

**One committed version per voice.** Instant Outbound cannot set a voice per
call, so each voice in HR's picker (`VOICES` in `backend/voice/calls.py`) is
its own committed version of the agent, identical but for
`text_to_speech_config.internal_id`, and a call dials its voice's version. The
call also passes the voice's persona as `agent_name`, which the prompt, intro
and voicemail introduce themselves by. So a change to `agent_prompt.md` or
`agent_config.json` is pushed to the draft and **committed once per voice**,
and every `version` in `VOICES` bumped (procedure: SETUP.md §4). `check.py`
pins the roster: one version each, and the default voice equal to the voice in
`agent_config.json`.

**Candidates can ring the number back.** The inbound deployment
`SARVAM_DEPLOYMENT_ID` (*TalentAI callbacks*) answers the agent's number in the
default voice's version. Every candidate dialled is uploaded to its known-caller
list with what is left of their screening (refreshed after every connected
call), so a callback carries on from there, and
the scheduler files each finished inbound call (read off the analytics API, by
caller number) under the session that number had open when they rang, and
only that number's newest session is ever uploaded. The deployment pins one
version, so it is bumped with the default voice's on every agent change.

**The agent's defaults are for unknown callers only.** The agent's intro is
exactly `{{greeting}}`, and every call TalentAI places or expects (Instant
Outbound, the known-caller upload) sends its own `greeting` variable and a
non-empty `call_script`. So the defaults, an apology
(`script.UNKNOWN_CALLER_GREETING`) and `script.NO_SCRIPT`, are heard only by
someone TalentAI has no record of, and they end the call. The greeting has to
be a variable: an outbound call speaks the intro's per-language copies and
ignores `initial_bot_message` (found 2026-10-21, when every outbound call
opened with the apology). Editing the intro regenerates those copies, so keep
it `{{greeting}}`.
A script with nothing left to ask is sent as `script.NOTHING_LEFT`, never as
"": the agent read past an empty script and improvised questions. `script.py`'s
self-check pins all three against `agent_config.json` and `agent_prompt.md`.

---

## 2. Where the real documentation is

This file is the map. The detail lives next to the code it describes:

| Read this | For |
|---|---|
| **[frontend/AGENTS.md](frontend/AGENTS.md)** | The frontend, exhaustively. `api.ts` as an adapter, the screening flow, index ranges, the type scale and palette, the dashboard. **Read it before touching `frontend/`.** |
| **[backend/ARCHITECTURE.md](backend/ARCHITECTURE.md)** | Backend stack, request pipelines, the LLM layer, Chroma, the interview/progress/document-check subsystems (§7). |
| **[SETUP.md](SETUP.md)** | Install and run, both platforms. |
| **[RUNNING.md](RUNNING.md)** | Quick start from a fresh unzip: keys, install, run, sign in. |
| Module docstrings in `backend/voice/` | The phone calls. No README: `calls.py` (lifecycle, statuses, webhook, tunnel guard), `script.py` (the flow and the per-call script), `sarvam.py` (every Sarvam endpoint used, with its docs URL). |
| `backend/voice/agent_prompt.md`, `agent_config.json` | The Sarvam agent's instructions and config, as pushed to Sarvam. |
| `backend.md`, `frontend.md` | Older narrative notes. Historical; prefer the three above. |

`frontend/CLAUDE.md` is a one-line include of `frontend/AGENTS.md`. Keep it that
way — one frontend doc, not two.

---

## 3. Rules that span services

These are the ones that bite, because no single folder owns them.

### The backend↔voice contract is plain dicts

`backend/app/main.py` and `backend/interview_scoring.py` call `voice.calls`
directly, and get sessions back as dicts in the JSON shape the old HTTP service
served (`calls.public()`). Nothing type-checks the field names, so a renamed
field is a `KeyError` or a silently empty value in the HR modal.

- `calls.place(candidates)` returns session ids, **positionally aligned** with
  the candidates. `queue_position` is always 0 on the wire: Sarvam dials
  concurrently.
- Then `calls.get(id)`, `calls.active()`, `calls.transcript_text(id)` and
  `calls.recording(id)`.
- **`backend/voice/check.py` asserts every field the backend reads by name.**
  Change a shape on either side and update it.

### The tunnel reaches the webhook and nothing else

`PUBLIC_URL` is a public tunnel to port 8000 so Sarvam can deliver results, but
port 8000 is the whole backend (resumes, LLM keys). `calls.tunnel_guard`
refuses every request carrying `PUBLIC_URL`'s hostname except `POST
/api/sarvam/webhook`. A new endpoint Sarvam (or anything outside) must reach
has to be let through there, deliberately.

### The Sarvam agent's answer keys are the flow keys

Sarvam's post-call extraction returns `answers_json` keyed by flow key. Its
prompt lists every key explicitly, generated by `script.extraction_prompt()`;
left to "use the script's keys", Sarvam invented its own and every answer
missed the HR form. `check.py` fails if `agent_config.json` drifts from
`script.py`. Adding a flow key means: `script.FLOW`, regenerate the prompt into
`agent_config.json`, push it to Sarvam, commit a version.

### Node ids are flow keys are stored indices

One string travels from `frontend/lib/screening-flow.ts` → `backend/screening_questions.py`
→ `backend/voice/script.py` → the Sarvam agent, and back as an answer. So:

- `FLOW_QUESTIONS` and `screening-flow.ts` are **append-only and index-aligned**.
  Responses are stored as `FLOW_INDEX_BASE + position`; reordering silently
  re-labels every saved answer. See frontend/AGENTS.md for the four reserved
  ranges (0-9, 100-199, 200-299, 300+).
- Ask order is `script.FLOW` order (`backend/voice/script.py`), not array order. It is a port of the old
  Twilio service's decision graph.
- A saved screening records `flow_size`, how many flow questions existed at
  that save (`PUT /resume/{uuid}/screening`). The modal ticks any question
  appended since (`addedSince` in `screening-flow.ts`); without it a new
  question was silently left off every already-screened candidate's call. The
  latest one appended is `r1_availability` (index 321), shown on the dashboard
  for Selected-for-R1 rows only.

### Which questions get asked is settled before dialing

The voice service asks exactly the keys it is handed (`questions: {node_id: text}`)
and steps over the rest. HR's ticks, the WFH rule and the employment gate are
all knowable before the phone rings, so all three are resolved in
`backend/app/main.py:prepare_call` — never at runtime by the agent.

A question already answered on an earlier call of the same session is stepped
over too, the way its answer branched (`script.render(..., known)`), and handed
to the agent as `answers_so_far` instead, with the resume as
`candidate_profile`. So a redial or a callback asks only what is left, and with
nothing left the agent offers help. "Is now a good time" (`script.PER_CALL`) is
asked on every outbound call and never on a callback.

Routing *during* the call is now the Sarvam agent's LLM, but it is never asked
to work out a skip. `script.render()` turns the key set into one line per
question whose "next" rule already names only questions on this call, and the
agent follows those pointers. Branch logic lives in `script.FLOW`, not in the
prompt.

### Sarvam's `call_status` is not the screening's status

`call_status` is one attempt's leg state, translated from Sarvam's
(`connected`, `no_answer`, `busy`, `failed`) into the words the frontend's
`CALL_ENDED` has always used (`in-progress`, `completed`, `no-answer`, `busy`,
`failed`). `check.py` pins the mapping against `frontend/lib/api.ts`. And
`completed` covers a line that dropped at question four. The
voice package folds its own fields into one `status`
(`backend/voice/calls.py:compute_status`): `queued`, `in_progress`, `rescheduled`,
`awaiting_retry`, `completed`, `not_interested`, `disconnected`, `no_answer`,
`failed`, `cancelled`. **Show `status` to HR, never `call_status`.**
`frontend/lib/call-status.ts` is the single place it becomes words.

It is computed on read, never stored, so it cannot drift from the fields behind
it. Don't add a stored copy.

### A session outlives one call

A reschedule the candidate asked for, an automatic retry after a missed or
dropped call, and the candidate ringing back all land on **the same session**
and fill **the same answers**. So
the first call ending is not the end of the screening — anything that stops
watching there sees none of what the redial collects.

### What a call costs is ours to work out

Sarvam reports durations, not money, and has **no credit-balance API** (none
in the API reference or the Voice Agents MCP, checked 2026-11-05). So
`voice/calls.py:cost()` applies the published rates
(docs.sarvam.ai/voice-agents/pricing: each started minute, plus each started
30s of Sarvam telephony, connected calls only; `SARVAM_RATE_PER_MINUTE` /
`SARVAM_TELEPHONY_PER_PULSE` in `backend/.env`), per call, off the session's
`calls` rows. That is an estimate, and it runs above the real bill (113
telephony pulses estimated against 93 billed, 2026-11-05). So Collective
analysis' account tiles start from Sarvam's own figures, copied by hand off the
billing page into `backend/.env`: the balance (`SARVAM_CREDIT_BALANCE`) and the
usage CSV's total (`SARVAM_SPENT`), both read at `SARVAM_CREDIT_BALANCE_AT`.
Only calls after that time are estimated (`GET /interviews/usage`). The
per-candidate table is estimated throughout. The dashboard's calendar reads the same `calls`
rows plus pending redials (`GET /interviews/schedule`). Change the rate when
the plan changes; `check.py` pins the rounding.

### A finished call scores its row without HR

`GET /jd/{id}/resumes` reads each called candidate's session
(`with_call` in `backend/app/main.py`): the call's answers fill every field HR
has not saved before the joining verdict is judged, and the call's
communication score is served until Save stores Mistral's regrade (marked with
its `model`). The dashboard re-reads its rows when a call comes off the phone.
So bulk and single calls both show the Comprehensive score and Joining verdict
the moment they end; before, each needed HR to open (score) and save (joining)
the candidate's form.

---

## 4. Checks

No test framework anywhere. Self-checks are plain `assert`s that run standalone.

```bash
cd backend && .venv/bin/python -m voice.check
```

That is the big one: the whole call lifecycle offline with Sarvam faked
(contract, callback and redial, retries, cancel, duplicate and forged webhooks,
polling fallback, refused and retried dials, calling hours, the tunnel guard, per-voice versions, callbacks,
call cost, account usage and the calendar),
plus
`script.py`'s own
self-check.

Frontend, from `frontend/`:

```bash
npx tsc --noEmit
```

```bash
for c in screening-questions screening-flow upload-progress jd-search collective call-status pool-decision call-calendar; do node --experimental-strip-types lib/$c.check.ts; done
```

Backend, from `backend/`: `.venv/bin/python job_id.py` and
`.venv/bin/python screening_questions.py`.

**Non-trivial logic leaves one runnable check behind.** Add to the nearest
existing `demo()` / `.check.ts` rather than starting a new suite.

---

## 5. What else is in the repo

Only the two services in §1 are code. Removed on 2026-10-17 (to the macOS
Trash, `TalentAI-cleanup-2026-10-17`, so recoverable until it is emptied): the
old Twilio voice service `sarvam_ai_updated/` with its past recordings, the
colleague's fork `sarvam_ai_11_sept/`, the stripped copy `lean/`, and
`backend/_backup/`. The same day the separate `voice_agent/` service (:8080) was
folded into `backend/voice/` (its old folder is in the Trash under
`TalentAI-voice-fold-2026-10-17`). Don't reintroduce a second voice-service
tree or process; there is one package.

- `jds/`, `resumes/`: sample input files, for trying the app by hand. Most of
  the JDs exist nowhere else.
- `presentation/`: the product walkthrough for managers (2026-11-04), as
  `TalentAgent_AI_Walkthrough.pptx` and `.pdf` (dark mode) and
  `TalentAgent_AI_Walkthrough_Light.pptx` and `.pdf` (light mode), plus the raw
  screenshots in `presentation/screenshots/` (`light/` for light). Static output, not code; retake the shots if the
  UI changes.
- `backend.md`, `frontend.md`: older narrative notes, historical. Prefer the
  docs in §2 where they disagree.
- The shared zip (command in SETUP.md §5) leaves out dependencies, caches,
  `backend/.env` and `llm_config.json` (API keys); it keeps the candidate data.
  The public GitHub copy (`ai-agent/` in `rahulyadav46691499/XL`) also leaves
  out the candidate data, `resumes/` and `presentation/`; the root
  `.gitignore` keeps keys and that data out of any commit.
  `backend/requirements.txt` is fully pinned; `requirements.lock.txt` pins
  every transitive package.

---

## 6. Conventions

- **Frontend never `fetch`es from a component.** Every backend call goes through
  `lib/api.ts`, which is the adapter between the UI's shapes and the backend's.
- **No raw colours or ad-hoc font sizes.** One eight-step type scale and a token
  palette, both in `app/globals.css`. See frontend/AGENTS.md.
- **Stored value vs displayed label** — `"Interview"` displays as "Selected for
  R1"; `communication_score` displays as "Comprehensive". Translate at the one
  designated helper; never rename the stored field.
- **Write the smallest change that works, then leave a check for it.** Prefer
  stdlib and what the repo already has over a new dependency; mark a deliberate
  shortcut with a `ponytail:` comment naming its ceiling.
- Comments explain *why*, especially where a simpler-looking version was tried
  and broke something. Several in this repo record exactly that — don't
  "simplify" them away without reading them.

---

## 7. Keeping this file true

Everything above is a claim about the code, and a stale claim is worse than no
claim — someone acts on it. So, restating the rule at the top of this file:

**Any change to this repo updates `CLAUDE.md` in the same commit.** New service,
new port, new cross-service contract, a renamed field on the wire, a new check
to run, a folder that stops being live — all of it lands here. If the change is
confined to one area and that area's own doc covers it
(`frontend/AGENTS.md`, `backend/ARCHITECTURE.md`), update that doc and make sure
this file still points at it correctly.

<!-- claude-reflect: learned rules (saved from the band; edit freely) -->
## Learned rules
- On callbacks, ask only the screening questions not yet answered; never repeat questions already answered, and keep the JD and resume context.
<!-- end claude-reflect -->
