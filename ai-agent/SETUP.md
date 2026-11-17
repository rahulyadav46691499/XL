# TalentAI — setup on macOS and Windows

> **This zip ships source and data, not dependencies or keys.**
> `frontend/node_modules` and `backend/.venv` are not in it, so **everyone runs
> the install in §2**, on every platform. It has no API keys either: create
> `backend/.env` first (see [Environment files](#environment-files)). The short
> version of this whole file is **[RUNNING.md](RUNNING.md)**.
>
> The **public GitHub copy** (`ai-agent/` in `rahulyadav46691499/XL`) also
> leaves out the candidate data in §0, `resumes/` and `presentation/`, which
> are real people's personal information. It starts empty: upload a JD and
> resumes to begin.

Two services. Both must run for the app to work end to end.

| Service | Folder | Port | Started from |
|---|---|---|---|
| Frontend (Next.js) | `frontend` | 3000 | `frontend/` |
| Backend (FastAPI), including AI phone calls over Sarvam Voice Agents | `backend` | 8000 | `backend/` |

The folder must keep its shipped layout — several paths are relative and one
(`llm_config.json`) is read from the project root, one level above `backend/`.

---

## 0. What is in the folder

Dependencies are gone; data and source remain.

| Inside the zip | Size | Notes |
|---|---|---|
| `backend/resume_files` | ~10 MB | Uploaded resumes |
| `backend/chroma_db` | ~10 MB | The embedded resume index |
| `backend/interview_files` | ~82 MB | Archived call recordings, saved when HR saves a screening |
| `backend/jd_files` | ~260 KB | Uploaded job descriptions |
| `backend/voice/sessions`, `transcripts` | <1 MB | Call sessions and transcripts |
| `backend/.env.example` | tiny | Template only, **no keys**: see [Environment files](#environment-files) |

**Not** in the zip: `frontend/node_modules` and `backend/.venv` (rebuilt by
§2), `frontend/.next` and `__pycache__` (rebuilt on first run), and
`backend/.env` and `llm_config.json` (they hold API keys).

> **The data is real candidates' personal information** (resumes, call
> recordings, transcripts). Share the zip only with people meant to see it.

---

## 1. Prerequisites

| | macOS | Windows |
|---|---|---|
| Python | 3.13 or 3.14 — `brew install python@3.13` | 3.13 from [python.org](https://python.org), tick **"Add python.exe to PATH"** |
| Node.js | 20 or newer (built on 24) — `brew install node` | 20 or newer — `winget install OpenJS.NodeJS.LTS` |
| ngrok or cloudflared | optional, phone calls only (§4) | optional, phone calls only (§4) |

Check both are visible before you start:

```bash
python3 --version && node --version
```

```powershell
py --version; node --version
```

Windows Explorer's built-in unzip is fine for this zip — the deep
`node_modules` paths that used to need 7-Zip and the long-path registry tweak
are no longer in it.

---

## 2. Install

Two installs, one per service. Required on **every** machine and OS.

### macOS

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
cd frontend && npm install
```

### Windows (PowerShell)

```powershell
cd backend; py -m venv .venv; .venv\Scripts\python -m pip install -r requirements.txt
```

```powershell
cd frontend; npm install
```

Call `.venv\Scripts\python` directly, as above, rather than activating the
environment — `Activate.ps1` is blocked by the default PowerShell execution
policy and activation buys nothing here.

`uvicorn[standard]` will skip `uvloop` on Windows; that is expected, and uvicorn
falls back to asyncio with no change in behaviour.

### About `backend/requirements.txt`

Rebuilt on 2026-09-02 from the actual `import` statements rather than from
`pip freeze`, so it lists direct dependencies only: it added `python-dotenv` and
`httpx` (imported but previously missing, so a clean install failed) and dropped
`langchain-groq` (never imported). Every line is pinned (2026-11-17, from the
working environment); `requirements.lock.txt` pins the transitive packages too.

Phone calls need nothing beyond it: the call itself runs on Sarvam, so there is
no audio, Twilio or LLM library to install.

---

## 3. Run — one terminal per service

### macOS

```bash
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --timeout-graceful-shutdown 3 --port 8000
```

```bash
cd frontend && npm run dev
```

### Windows (PowerShell)

```powershell
cd backend; .venv\Scripts\python -m uvicorn app.main:app --reload --timeout-graceful-shutdown 3 --port 8000
```

```powershell
cd frontend; npm run dev
```

Then open **http://localhost:3000** and sign in as `Admin` with password
`EXL123` (fixed in `frontend/app/login/page.tsx`). Stop either service with
Ctrl+C in its terminal.

`--timeout-graceful-shutdown 3` is not optional decoration: an audio player in
the browser (a call recording, a voice preview) can hold a response open
half-read, and without a timeout every reload and Ctrl+C waits on it forever, so
the backend stops answering after the next code change.

Use `npm run dev`, not `npm start`: `npm start` serves whatever `next build`
last produced, which is not your current source.

Resume upload, JD matching, scoring, the dashboard and the HR screening form all
work with just these two. Only the "AI Phone Call" button needs §4.

The frontend takes no configuration: it derives the backend URL from whatever
hostname the browser is on and appends `:8000`
([`frontend/lib/api.ts`](frontend/lib/api.ts)). `frontend/.env.local` is
deliberately left with everything commented out — hardcoding `localhost` breaks
remote/cloudspace access.

---

## 4. Phone calls only: Sarvam Voice Agents

The call runs on Sarvam's managed Voice Agents platform, in the agent
**TalentAI HR Screening** (`TalentAI-HR-4a763f40-8322`). Twilio is gone, and
so is the separate voice service: the backend places the calls itself
(`backend/voice/`). Fill these into `backend/.env` (template:
`backend/.env.example`):

1. **`SARVAM_VOICE_AGENTS_API_KEY`**: Voice Agents dashboard → **Settings →
   API Key**. This is a different key from `SARVAM_API_KEY`, which the Voice
   Agents API rejects ("Invalid API key format").
2. **`SARVAM_CONNECTION_ID`** and **`SARVAM_AGENT_PHONE_NUMBER`**: the number
   calls go out from, under **Deploy → Phone Numbers**. Either **Rent from
   Sarvam** (KYC, no provider account) or connect your own Exotel, Vobiz or
   Plivo account. Use the number exactly as Sarvam lists it (E.164).
3. **`PUBLIC_URL`** (optional): a public https URL for port 8000, so Sarvam can
   POST each call's result the moment it ends. Either of:

   ```bash
   ngrok http 8000 --domain=<your-ngrok-domain>.ngrok-free.dev
   ```

   ```bash
   cloudflared tunnel --url http://localhost:8000
   ```

   A quick `cloudflared` URL changes every time it starts, so update
   `PUBLIC_URL` and restart the backend each time.

   Without it the backend fetches results from Sarvam's analytics API about
   three minutes after each call, so nothing is lost; it is just slower.

   **The tunnel reaches the webhook and nothing else.** A tunnel publishes the
   whole port, and port 8000 is the whole backend, so any request that arrives
   with `PUBLIC_URL`'s hostname is refused unless it is `POST
   /api/sarvam/webhook` (`backend/voice/calls.py:tunnel_guard`). ngrok and
   cloudflared keep that hostname in the `Host` header by default (checked for
   cloudflared on 2026-10-17); don't use ngrok's `--host-header=rewrite`, which
   would hide it. And don't set `PUBLIC_URL` to the address the browser itself
   uses for the backend (a cloudspace `8000-…` URL, say): the dashboard would get
   404s.
4. **What calls cost** (optional; Collective analysis' spend figures). The
   rates default to pay as you go, ₹3.50 a started minute plus ₹0.20 a started
   30s of Sarvam telephony: set `SARVAM_RATE_PER_MINUTE` to your plan's, and
   `SARVAM_TELEPHONY_PER_PULSE=0` if the number is your own provider's. Sarvam
   has **no API for the credit balance**, so for the "Credits left" tile copy
   the balance from indus.sarvam.ai/billing into `SARVAM_CREDIT_BALANCE`, and
   the moment you read it into `SARVAM_CREDIT_BALANCE_AT` (e.g.
   `2026-11-05T10:30:00+05:30`); the tile shows that less every call since.
   Put the total of the usage CSV exported at the same moment (product
   `samvaad-conversations`: minutes + Vobiz pulses + number rental) in
   `SARVAM_SPENT`, and "Total spent" shows the bill plus calls since. Re-copy
   all three now and then: calls after the anchor are estimated (the published
   per-call rounding runs above the bill, 113 pulses against a billed 93 on
   2026-11-05), and the estimate cannot see the workspace's other agents or the
   ₹59 monthly number rental.

**Testing by phone without TalentAI.** The Voice Agents MCP `place_test_call`
(and its dashboard equivalent) dials a verified number, but on 2026-10-17 it
dropped every variable it was given, so the agent runs as it would for an
unknown caller: the apology greeting, then it ends the call (see "Candidates
ringing back" below). To hear the real flow, place the call through TalentAI
(the voice backend always sends the script and its own greeting), or test the
draft by text: put sample values in the draft's variable defaults, including a
normal opening line in `greeting` (the intro is `{{greeting}}`, and its default
is the unknown-caller apology). Then `send_chat` with the draft's
`app_version`; `analytics` operation `chat` shows what the post-call extraction
returned. Restore the defaults from `agent_config.json` before committing. The draft's `prompt_sha` (from `agents`
operation `get`) is the first 16 hex characters of the SHA-256 of
`agent_prompt.md` with surrounding whitespace stripped, so you can confirm the
pushed instructions match the repo byte for byte.

The backend logs whatever is still missing when it starts ("AI phone calls will
fail until backend/.env has: …"). Until all three required values are set, "AI
Phone Call" fails with a message naming them.

**Voices.** HR picks one of six voices (Simran, Ishita and Shalini; Sunny and
two Shubhs, all English and Hindi), with a preview of each, and that is the
voice the candidate hears. Sarvam cannot change an agent's voice per call, so
each voice is its own committed version of the agent, listed with its version
in `VOICES` in `backend/voice/calls.py`. The agent introduces itself by the
voice's name (`agent_name`). Previews are cached in `backend/voice/media/`.

**Candidates ringing back.** The number answers incoming calls through the
inbound deployment *TalentAI callbacks* (`SARVAM_DEPLOYMENT_ID`, Deploy →
Inbounds), 24/7, in Simran's voice. Every candidate TalentAI dials is added to
its known callers with their screening, so when they ring back the agent greets
them by name and carries on; about a minute after the call ends the backend
files it under the screening that was open when they rang (answers, transcript, score), and cancels
any redial that was pending. Two things to know:

- **On Vobiz, the number must be attached to a voice application** whose Answer
  URL and Hangup URL are both `https://apps.sarvam.ai/api/app-runtime/v1/channels/vobiz`
  (POST). Outbound calls work without it, so it is easy to miss: if a callback
  rings out or goes silent, check this first. Sarvam's
  [Vobiz page](https://docs.sarvam.ai/voice-agents/deploy/telephony/vobiz) has
  the steps.
- A callback, like a redial, asks only what is still unanswered. The agent is
  given the job description, the candidate's resume (contact details removed)
  and every answer they already gave, so it never asks one twice and can answer
  "what did I say my notice period was?". If nothing is left, it says the
  screening is complete and asks how it can help, and takes any change to an
  earlier answer ("my current CTC is 32, not 30"), which updates the form.
  A number TalentAI never dialled gets the agent's defaults: the intro
  apologises ("I don't have your details in front of me right now, so a
  recruiter from our team will call you back") and the script reads NO SCRIPT,
  so the agent ends the call on its first turn, whatever the caller says
  (8 text tests on 2026-10-21, including "who is this?", a salary question and
  Hindi, on the draft and on versions 21 and 26; all ended on the first turn).
  Every call TalentAI places or expects sends its own greeting as the
  `greeting` variable (the agent's intro is exactly `{{greeting}}`), so no
  candidate hears that apology. Keep the intro that way: on an outbound call
  Sarvam speaks the intro and ignores the `initial_bot_message` override, which
  on 2026-10-21 made every outbound call open with the apology. A callback with every question answered is sent NOTHING
  LEFT, never an empty script, and gets the "screening complete, how can I
  help" path. The markers live in `backend/voice/script.py`.

**Changing the agent.** Its instructions are `backend/voice/agent_prompt.md`
and its variables are `backend/voice/agent_config.json`. Because there is one
version per voice, a change is committed once per voice:

1. Edit the two files, and push them to the agent's draft (Sarvam dashboard,
   or the Voice Agents MCP server's `configure_agent`).
2. For each voice in `VOICES`: set the draft's
   `text_to_speech_config.internal_id` to that voice's `internal_id`, commit,
   and write the new version number into its `version`.
3. Set the draft's voice back to the first (default) voice, so the draft
   matches `agent_config.json` again, and move the inbound deployment to the
   default voice's new version (`configure_deployment` with its id and the new
   `app_version`; never delete and recreate it, that releases the number).
   Sarvam refuses to edit an active deployment, so pause it
   (`telephony` `pause_deployment`), patch it, and resume it straight away
   (`resume_deployment`). The number goes unanswered for those few seconds.
4. Run the check (`cd backend && .venv/bin/python -m voice.check`; on Windows
   `cd backend; .venv\Scripts\python -m voice.check`). It fails if
   two voices share a version, if the default voice differs from
   `agent_config.json`, or if the answer-extraction prompt there drifts from
   `script.py`.

There is no REST API for agent versions, so this is done through the dashboard
or the MCP server; Claude Code with the Voice Agents MCP connected can do all of
it from one request. Adding a voice is steps 2–4 for one new row: pick it from
the workspace's voice catalogue (`agents list_voices` on the MCP server), and
give it the `id` of its twin on the TTS API (`<name>_enhi_<style>`, Bulbul v4
Flash) for the preview.

---

## 5. Sending a smaller zip

Dependencies and build output are most of the folder, and none of it is
needed: the receiver rebuilds them in §2.

```bash
cd "/path/to/TalentAI" && zip -r ../talentai.zip . -x "*/node_modules/*" "*/.venv/*" "*/__pycache__/*" "*/.next/*" "*.tsbuildinfo" "*.DS_Store" "backend/.env" "llm_config.json"
```

```powershell
Compress-Archive -Path * -DestinationPath talentai.zip
```

PowerShell's `Compress-Archive` cannot exclude paths, so on Windows delete
`node_modules`, `.venv`, `.next`, `backend/.env` and `llm_config.json` from a **copy** of the folder first, then
compress that copy. The receiver runs §2 and gets a working install.

---

## Environment files

`backend/.env` is not in the zip, because it holds API keys. Copy
`backend/.env.example` to `backend/.env` and fill it in: `GEMINI_API_KEY` and
`MISTRAL_API_KEY` for the app, the Sarvam values (§4) for phone calls.

`llm_config.json` (the app's LLM settings, project root) is left out for the
same reason. Without it the backend runs on Gemini with the keys from `.env`;
the file is written, keys included, the first time someone saves the LLM
settings in the app.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ModuleNotFoundError: No module named 'dotenv'` or `'httpx'` | Installed from a `requirements.txt` older than 2026-09-02 | Reinstall, from `backend/`: `.venv/bin/pip install -r requirements.txt` (Windows: `.venv\Scripts\python -m pip install -r requirements.txt`) |
| UI is missing your latest changes | `npm start` served an old `next build` | Use `npm run dev`; delete `frontend/.next` if in doubt, it is rebuilt |
| Windows: `running scripts is disabled on this system` | You tried `Activate.ps1` | Don't activate — call `.venv\Scripts\python` directly |
| `next: command not found` / `.bin\next is not recognized` | `npm install` not run yet, or it failed | `cd frontend && npm install` (Windows: `cd frontend; npm install`) |
| Backend won't start: `address already in use` (macOS) or `only one usage of each socket address` (Windows) | Something else is already on port 8000, often another project's server | Find it: `lsof -nP -iTCP:8000 -sTCP:LISTEN` (macOS) or `netstat -ano \| findstr :8000` (Windows), and stop it with Ctrl+C in its own terminal |
| Next.js: "failed to load SWC binary" | Wrong-architecture native module | Delete `frontend/node_modules`, `npm install` |
| Dashboard loads but every panel is empty; console shows `Failed to fetch` | Backend not running on 8000 | Start it; check http://localhost:8000/jds returns JSON |
| Backend stops answering right after a code change (even http://localhost:8000/ hangs) | Started without `--timeout-graceful-shutdown`: the reload is waiting for a browser audio player to finish a half-read response | Ctrl+C twice, then start it with the §3 command |
| Recording button returns **502** | Sarvam's analytics API failed; the message says why | Usually a wrong or missing `SARVAM_VOICE_AGENTS_API_KEY` (§4) |
| "AI Phone Call" says calls are not set up yet | `backend/.env` is missing a Sarvam value | Fill in what the message names (§4) and restart the backend |
| Calling the agent's number back rings out or is silent | The number is not attached to the Sarvam voice application on Vobiz, or `SARVAM_DEPLOYMENT_ID` is unset | See "Candidates ringing back" in §4 |
| A call stays "in progress" for minutes | Webhook not reaching you (no `PUBLIC_URL`, or the tunnel is down) | Nothing to do: the result is fetched from Sarvam about three minutes after the call ends |
| Backend starts but finds no LLM config | Started from the wrong directory | `cd backend` first; `llm_config.json` is read from one level up |
| A pip wheel tries to compile on Windows | No prebuilt wheel for your Python | Install [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (C++ workload), or use Python 3.13 rather than 3.14 |

---

## Notes

- `llm_config.json`, once saved, sits in the **project root**, not in
  `backend/` — the backend reads it from one level up. Keep the folder layout as shipped.
- The backend must be started from inside `backend/`: `chroma_db/`,
  `resume_files/`, `jd_files/` and `interview_files/` are relative paths.
- If you were sent a stripped zip with no candidate data, upload a JD and some
  resumes on first run; `chroma_db/` is created automatically.
- Call sessions are JSON files in `backend/voice/sessions/`, transcripts are in
  `backend/voice/transcripts/`, and recordings stay on Sarvam (fetched on
  demand). Restarting the backend loses nothing, and pending callbacks and
  retries carry on.
- `backend/voice/` is the only voice code. The separate `voice_agent` service
  (port 8080) was folded into the backend on 2026-10-17, and the old Twilio
  pipeline (`sarvam_ai_updated`), the `sarvam_ai_11_sept` and `lean` copies and
  `backend/_backup` were removed the same day; if your copy still has any of
  them, they can be deleted.
