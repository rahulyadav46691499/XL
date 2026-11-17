# Running TalentAI

The quick path from a fresh unzip to a working app. For the full detail
(every `.env` value, AI phone calls, changing the Sarvam agent) see
**[SETUP.md](SETUP.md)**.

TalentAI is two services. Both must run.

| Service | Folder | Port | What it is |
|---|---|---|---|
| Backend | `backend/` | 8000 | FastAPI + Chroma. Parses and scores resumes, runs the AI phone calls |
| Frontend | `frontend/` | 3000 | Next.js. The web app you open in the browser |

---

## What you get

- **Always:** all source code and docs, and sample job descriptions in `jds/`.
- **Only in the privately shared zip:** the existing candidate data
  (`backend/chroma_db`, `resume_files`, `jd_files`, `interview_files`,
  `voice/sessions`, `voice/transcripts`), sample `resumes/` and the
  `presentation/` walkthrough. It is real people's personal information, so
  the public GitHub copy leaves it out (see `.gitignore`). Without it the app
  starts empty and creates those folders itself: upload a JD and some
  resumes to begin.
- **Never:** `frontend/node_modules`, `backend/.venv`, build output and
  caches (you rebuild them in step 2), and **no API keys**: `backend/.env`
  and `llm_config.json` are left out on purpose. You add your own in step 1.

Keep the folder layout as it is. The backend reads paths relative to itself.

---

## 0. Prerequisites

| | macOS | Windows |
|---|---|---|
| Python | **3.13 or 3.14**: `brew install python@3.14` | 3.13 from [python.org](https://python.org), tick **"Add python.exe to PATH"** |
| Node.js | **20.9 or newer** (built on 24): `brew install node` | `winget install OpenJS.NodeJS.LTS` |

Check:

```bash
python3 --version && node --version
```

On Windows (PowerShell):

```powershell
py --version; node --version
```

---

## 1. Add your API keys

Copy the template and fill it in.

```bash
cp backend/.env.example backend/.env
```

On Windows:

```powershell
copy backend\.env.example backend\.env
```

Then open `backend/.env` in an editor and set at least:

| Key | Needed for | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | **Required: the backend will not start without it.** Resume/JD parsing, search, chat | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `MISTRAL_API_KEY` | Scoring a finished phone call | [console.mistral.ai](https://console.mistral.ai) |

The `SARVAM_*` values are only for the **AI Phone Call** button. Leave them
empty and everything else works; SETUP.md §4 explains each one.

---

## 2. Install (once per machine)

### macOS / Linux

```bash
cd backend && python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
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

Don't run `Activate.ps1`; calling `.venv\Scripts\python` directly is enough.

Want the exact package versions this was last tested with? Install
`requirements.lock.txt` instead of `requirements.txt`.

---

## 3. Start both services (two terminals)

### macOS / Linux

Terminal 1:

```bash
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --timeout-graceful-shutdown 3 --port 8000
```

Terminal 2:

```bash
cd frontend && npm run dev
```

### Windows (PowerShell)

Terminal 1:

```powershell
cd backend; .venv\Scripts\python -m uvicorn app.main:app --reload --timeout-graceful-shutdown 3 --port 8000
```

Terminal 2:

```powershell
cd frontend; npm run dev
```

Keep `--timeout-graceful-shutdown 3`: without it the backend can hang on
reload while the browser is playing a call recording.

Stop either one with **Ctrl+C**.

---

## 4. Open the app

Go to **http://localhost:3000** and sign in:

- Username: `Admin`
- Password: `EXL123`

The backend alone answers at http://localhost:8000/jds (JSON) if you want to
check it is up.

Typical flow: upload a job description → upload resumes → see them scored
and ranked → open a candidate to screen them, on screen or with **AI Phone
Call**.

---

## 5. Self-checks (optional)

No test framework; these are plain scripts that fail loudly.

```bash
cd backend && .venv/bin/python -m voice.check
```

```bash
cd frontend && npx tsc --noEmit
```

The full list is in `CLAUDE.md` §4.

---

## Common problems

| You see | Fix |
|---|---|
| Dashboard is empty, browser console says `Failed to fetch` | The backend is not running. Start it (step 3) |
| Backend crashes on start: `API key required for Gemini Developer API` | `GEMINI_API_KEY` is empty or `backend/.env` is missing (step 1) |
| `ModuleNotFoundError` when starting the backend | Run the step 2 install inside `backend/`, and start with `.venv/bin/python` (Windows: `.venv\Scripts\python`) |
| `next: command not found` | `npm install` in `frontend/` has not run or failed |
| `address already in use` on 8000 or 3000 | Something else holds the port. macOS: `lsof -nP -iTCP:8000 -sTCP:LISTEN`. Windows: `netstat -ano \| findstr :8000` |
| Resume upload fails with an API/auth error | `GEMINI_API_KEY` missing or wrong in `backend/.env`. Restart the backend after editing it |
| "AI Phone Call" says calls are not set up | Expected without the Sarvam keys. See SETUP.md §4 |
| A pip package tries to compile on Windows | Use Python 3.13, or install the C++ Build Tools for Visual Studio |

More in SETUP.md → Troubleshooting.

---

## Where to read next

| File | For |
|---|---|
| [SETUP.md](SETUP.md) | Full install, every `.env` value, Sarvam phone calls |
| [CLAUDE.md](CLAUDE.md) | Map of the codebase and the rules that span both services |
| [frontend/AGENTS.md](frontend/AGENTS.md) | The frontend in detail |
| [backend/ARCHITECTURE.md](backend/ARCHITECTURE.md) | The backend in detail |
