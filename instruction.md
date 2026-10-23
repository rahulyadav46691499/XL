# Handoff: the LangChain SQL agent as the brain of OpPal's Chat tab

This file is for the next LLM or engineer picking up this work. It covers:

- what the user asked for;
- everything that was built and decided, and why;
- how the two codebases connect;
- how to run and test it safely;
- what is still open.

**Read sections 1, 2 and 9 before you change or run anything.**

---

## 1. The goal (in the user's words, then precisely)

> "Replace OpPal stage chat with this. It's OK to keep these functionalities only; there might be more we will be losing. Make a list of what we have already and what we will lose (for example pin to dashboard etc). But use the OpPal stack for the UI (frontend) and this one for the backend."

The user then chose the recommended option:

> "Add this agent inside OpPal's backend as the Chat's brain, keep OpPal's login, history, pinning and other tabs, run its SQL through OpPal's governed data layer, and emit OpPal's chart format."

What that means in practice:

- **"This one"** is the LangChain SQL agent in `/Users/rahulyadav/Desktop/SQL Agent` (a Streamlit app).
- **OpPal stage** is at `/Users/rahulyadav/Downloads/oppal-complete-v14.15/oppal_stage`.
  - Backend: FastAPI with about 96 routes.
  - Frontend: React 18 + Vite 5 + Recharts 2, with 19 tabs.
- **Only OpPal's Chat tab changes.** It now has a LangChain agent behind it. OpPal's own backend still runs:
  - login, chat history, the Workspace/dashboard and pinning;
  - the other 18 tabs.
- **Both apps use the identical `oppal.db` warehouse**, byte for byte.

**Status: the integration is built and tested.** If you are continuing, section 3 lists every file it touches. If you are rebuilding it in a fresh copy of OpPal, section 5 is the step-by-step build.

---

## 2. Hard rules (the user set these; do not break them)

1. **The database stays read-only.** Never enable `INSERT`, `UPDATE`, `DELETE`, DDL or any write path. This rule is also in `/Users/rahulyadav/Desktop/SQL Agent/CLAUDE.md`.
2. **Don't copy or share `backend/app/data/settings.json`.** It holds the user's LLM API key.
3. **Never run an OpPal test or demo script without backing up `backend/app/data` first** (see section 9.1). Some of them delete the real data.
4. **Use scratch copies of every store for live testing** (section 8.3), so the user's real history, dashboards, audit log, settings and active domain are never written.
5. **NFR-1 (an OpPal rule): no prompts or business rules as string literals in Python.** Prompts live in the Brain's `prompts.md` files.
6. **Keep OpPal's frontend dependency list small.** It deliberately has three runtime dependencies (react, react-dom, recharts). Don't add Markdown or chart libraries; a few lines of code were enough each time so far.
7. **The Gemini key in `/Users/rahulyadav/Desktop/SQL Agent/.env` was pasted in chat**, so the user was told to rotate it. Never copy it into another file, share it or print it.

---

## 3. Current state: what changed in OpPal

All the work is already in OpPal stage. These are the files it touches:

| File | Change |
|---|---|
| `backend/app/chat_agent.py` | New: the agent (section 5.1) |
| `backend/app/main.py` | `POST /api/agent/ask`, `Ask.chat_id`, shared `_degraded_answer` / `_log_ask_usage`, rebuild hook (5.2) |
| `backend/app/semantic/domains/{healthcare_payer,medicare_sales,pharma_supply_chain}/prompts.md` | New `## chat_agent` section (5.3) |
| `backend/requirements.txt` | LangChain dependencies (5.4) |
| `frontend/src/App.jsx` | Agent switch, routing to the agent, `chat_id`, Markdown answers (5.5) |
| `frontend/src/components/Markdown.jsx` | New: Markdown renderer (5.5) |
| `frontend/src/styles.css` | `.md` styles (5.5) |
| `backend/tests/test_chat_agent.py` | New: 31 offline checks (5.6) |
| `backend/run_all_tests.sh` | Runs `test_chat_agent` (5.6) |

---

## 4. What we keep, what we lose, what we gain

### Kept (OpPal's frontend and backend still handle it)

| Feature | Notes |
|---|---|
| Login, roles, the "authorized LOBs" badge | OpPal's auth wraps every `/api` route. The agent endpoint calls `_user()` and `_require(user, "ask")`. |
| Chat history sidebar (per user, server-side) | Replay, new chat, clear |
| Starter suggestions on the welcome screen | `/api/suggestions` |
| **📌 Pin to dashboard / Workspace** | Plus share, auto-arrange, PNG/HTML export. This works because the agent emits **OpPal's chart format**. |
| Chart controls | Type (bar/line/area/pie), orientation, bar shape, three palettes, editable title |
| Edit SQL behind a chart and re-run it | OpPal's `/api/query/rerun` (but see the open gap in section 10) |
| Data grid, light/dark theme, Simple/AI mode | |
| Journey strip and usage chip | Rebuilt from the agent's tool calls and token usage |
| Click a bar to ask a drill-down question | The agent sets `drilldown_prompt` and it becomes `drilldown.prompt_template` |
| Errors become review-queue tickets, not 500s | Shared `_degraded_answer()` |
| Offline mock LLM | Chat falls back to the old pipeline when the provider isn't Gemini |
| Audiences in chat | Any question with a `cohort_id` falls back to the old pipeline |
| LOB scoping (`u-ma` sees only Medicare Advantage) | Every agent query goes through OpPal's governed data layer |
| PHI scrubbing before the LLM | Row values pass `PHIGuard.scrub_structure`, the question passes `scrub`, and the SQL/answer are detokenized |
| Active-domain scoping (payer / Medicare sales / pharma) | Tables come from the active Brain's catalog, plus a deny-by-default boundary check |
| Context Brain grounding | Column meanings, joins and table descriptions come from the active Brain |
| The other 18 tabs | Untouched |

### Lost when the agent answers (still available by unticking the agent switch)

| # | Feature | Severity |
|---|---|---|
| 1 | Trust score, the 0.85 hard gate, and the Trust panel (`trust: None` hides it) | 🟠 |
| 2 | Per-answer provenance receipt and tamper-evident audit-ledger entry for the answer | 🟠 |
| 3 | Template fallback ("a model can never change a metric's meaning"). The agent writes its own SQL, guided by the Brain. | 🟠 |
| 4 | Semantic cache (repeat questions instant and free) | 🟡 |
| 5 | Proactive root-cause and anomaly markers on charts | 🟡 |
| 6 | Insight cards and follow-up suggestion chips (`followups: []`) | 🟡 Easy to add |
| 7 | Pipeline toggles (LLM assist, cache, root-cause) | 🟢 They only affect the old pipeline |

### Lost from the Streamlit app (not ported)

- **Vega-Lite charts** (heatmaps, layered and faceted charts). OpPal's `ChartArtifact` only draws bar, line, area, pie and scatter.
- **The standalone sidebar SQL editor and the "Edit in SQL editor" buttons.** OpPal only lets you edit the SQL behind a chart.
- **`sql_db_query_checker`** (an extra LLM call per query). OpPal's gates validate every query and errors flow back to the model.
- **The agent seeing chart edits made in the UI.** In Streamlit, `build_input()` told the model when the user changed a chart in the Customize popover. In OpPal, chart-panel edits are local to the UI.

### Gained in OpPal's Chat

- **Conversation memory.** OpPal's `orchestrator.handle(question, cohort_id, user, pipeline)` takes no history. The agent remembers each chat, so "make it a pie" and "now sort it" work.
- **Open-ended, multi-step questions** across every table of the active domain, not only the metrics and question types declared in the Brain.
- **Changing charts by asking**, with everything else kept.
- **The model sees only the first row of every result.** Full rows go to the UI as artifacts.

---

## 5. How it is built (step by step: follow this to rebuild it)

### 5.1 Backend module: `backend/app/chat_agent.py` (new, about 390 lines)

It is ported from `/Users/rahulyadav/Desktop/SQL Agent/agent.py`, with OpPal's own services swapped in:

| Streamlit agent | OpPal version |
|---|---|
| Raw read-only `sqlite3` connection | `data_service().execute(sql, scope, purpose="analytics")` from `app/mcp`, which returns a `QueryResult` (`ok`, `columns`, `rows`, `truncated`, `error`, `refusal_reason`) |
| `sql_db_list_tables` (all 27 tables) | `list_tables`: `data_service().catalog(scope)` (active domain only, excluded tables removed), plus an `OTHER_DOMAINS:` section listing what the inactive domains hold |
| `sql_db_schema` + `schema_notes.md` | `table_schema`: the Brain's `get_brain()["tables"]`, `["columns"]` and `["joins"]`, plus 3 sample rows through the governed path |
| `sql_db_query` | `run_sql`: `response_format="content_and_artifact"`; content = row count + columns + first row only; artifact = `{sql, columns, rows}` |
| Vega-Lite `create_chart(query, spec: dict)` | `create_chart(query, chart: OppalChart, runtime)`, where `OppalChart` is a Pydantic model shaped like `ChartArtifact.jsx` |
| System prompt in Python | The `@dynamic_prompt` `chat_agent_prompt` reads the Brain's `prompts["chat_agent"]` and appends `CHARTS_IN_THIS_CHAT` |

The main pieces, in file order:

- **`ChatContext` dataclass (LangChain runtime context, `context_schema`):** `scope: ScopeContext`, `guard: PHIGuard`, `row_samples: bool`. These are per-request facts the tools need, never shown to the model.
- **`ChatAgentState(AgentState)`:** `charts: Annotated[dict[str, dict], _merge]`. It maps `chart_id` → `{"query", "chart"}` for every chart drawn in the chat, so follow-ups can edit one.
- **`_other_domains()`:** maps each inactive domain's name to its Brain tables, minus its `governance.excluded_tables`.
- **`_warehouse_tables()`:** every table any Brain declares, plus every table and view in the bundled sqlite (`sqlite_master`, opened read-only).
- **`_out_of_domain(tables)`:** builds the refusal `OUT_OF_DOMAIN: enrollments (in the Medicare Sales domain) is not part of the active … domain, so this chat cannot query it.`
- **`_run(runtime, sql)`, the single governed entry point for all agent SQL:**
  1. `guard.detokenize(sql)`, because the model may filter on a privacy token.
  2. **Domain-boundary check (deny by default).** It normalizes the SQL with `ScopeEnforcer._normalize_for_guard`, takes every word that names a warehouse table, removes the tables the catalog allows, and refuses if anything is left.
     - A name used only as an alias (`COUNT(*) AS members`) is ignored.
     - `FROM enrollments AS enrollments` is still caught: a name is skipped only when **every** occurrence is an alias.
  3. `CURRENT_ACTOR.set(scope.user_id)`, because tools can run on a worker thread where the request's actor is unset; without it the SQL log loses the user.
  4. `data_service().execute(...)`. **Not `run_legacy()`:** its legacy dict drops the engine's error text, and the model needs "no such column: x" to fix its query.
- **`_row_for_model`:** `guard.scrub_structure(list(row))`, cut to 500 characters.
  - `scrub()` on a stringified row wrongly tokenized ISO dates and 5-digit numbers; `scrub_structure` passes numbers through.
  - The 500-character cut stops a packed row (`group_concat`, `json_group_array`) from carrying a whole result.
- **`chart_error()`:** refuses columns missing from the result, a scatter without `y`, and a chart with neither `series` nor `series_dim` + `value`.
- **`chart_artifact()`:** the exact dict `ChartArtifact.jsx` reads:
  - `type:"chart"`, `chart_type`, `title`, `x`, `series`, `format`, `orientation`, `color_scheme`, `columns`, `rows`;
  - optional `series_dim`/`value`, `y`/`label` (scatter) and `drilldown.prompt_template`.
- **`create_chart`:** returns a `Command(update={"charts": …, "messages": [ToolMessage(..., artifact={…chart_artifact…, chart_id, sql})]})`. `chart_id = "chart_" + tool_call_id[-6:]`.
- **Lifecycle:**
  - `_CHECKPOINTER = InMemorySaver()` is a module singleton, so a Settings rebuild keeps chat memory.
  - `rebuild_chat_agent()` builds the agent only when `LLM_PROVIDER == "gemini"` and `GEMINI_API_KEY` and `GEMINI_MODEL` are set. It calls `create_agent(init_chat_model("google_genai:<model>"), [list_tables, table_schema, run_sql, create_chart], state_schema=ChatAgentState, context_schema=ChatContext, middleware=[chat_agent_prompt], checkpointer=_CHECKPOINTER).with_config(recursion_limit=50)`.
  - `available()` is true when the agent was built **and** the active Brain has a `chat_agent` prompt.
  - `thread_id(user_id, chat_id)` returns `f"{user_id}:{chat_id}"`. It is namespaced per user so nobody can load another user's thread.
- **`run_chat(question, chat_id, user, guard, row_samples)`:** streams the agent (`stream_mode="updates"`) and returns OpPal's existing `/api/ask` answer shape:
  - `summary` (detokenized final AI message);
  - `artifacts`: charts in order, then the last multi-row result as a `grid` (collapsed when a chart exists);
  - `sql`, `followups: []`, `trust: None`, `degraded: False`, `engine: "langchain_agent"`;
  - `audit`: one entry per step, using the step names `JourneyStrip` already knows — `access_control`, `semantic_grounding` (list/schema), `validation_and_execute` (run_sql), `visualization` (create_chart), `sql_generation` (model turn with tool calls), `insight_narration` (final answer);
  - `usage`: tokens from `usage_metadata`, cost via `llm.base.price_for("gemini", model)`, latency, rows scanned, provider;
  - `grounding`.
  - Parallel tool calls make a node report a **list** of updates. `run_chat` handles that.

> Known nit: the module docstring at the top of `chat_agent.py` still says `run_legacy`. The code uses `execute()` (see above). Fix the docstring if you touch the file.

### 5.2 Endpoint: `backend/app/main.py`

- The `Ask` model gets `chat_id: str | None = None`.
- `_degraded_answer(question, user, e)`: the old inline error handling of `/api/ask`, extracted. It creates a review-queue ticket and returns a "⛔ Something went wrong… ticket #…" answer.
- `_log_ask_usage(user, question, res)`: the old inline `log_usage` block, extracted.
- **New `POST /api/agent/ask`:**
  1. If `import chat_agent` fails (LangChain not installed), or `body.cohort_id` is set, or `not chat_agent.available()`, it returns `ask(body, request)`, i.e. the old pipeline.
  2. Otherwise: `_user()` → `_require(user, "ask")` → `chat_agent.run_chat(question, chat_id or "default", user, phi_guard, config.load()["privacy"].get("send_row_samples", True))`.
  3. On an exception it returns `_degraded_answer`. It then calls `_log_ask_usage` and returns the answer.
- `rebuild_orchestrator()` also calls `chat_agent.rebuild_chat_agent()`, wrapped in `try/except ImportError`. That function already runs at startup and after every Settings save, so a provider or key change takes effect immediately.
- **How the key gets there:** the OpPal Settings tab saves the provider, model and key to `backend/app/data/settings.json`. Then `config.apply_llm_env()` exports `LLM_PROVIDER`, `GEMINI_API_KEY` and `GEMINI_MODEL`, and `rebuild_chat_agent()` reads them. OpPal's guide says not to add a `.env`, so the agent has none.

### 5.3 Brain prompts (NFR-1)

A `## chat_agent` section was added to `backend/app/semantic/domains/{healthcare_payer,medicare_sales,pharma_supply_chain}/prompts.md`. Each has a domain paragraph, then nine rules:

1. Call `list_tables`, then `table_schema`; follow the governed column meanings and joins.
2. Write one read-only SELECT with `run_sql`, or `create_chart` when the user asks for a chart. Never write DML or DDL.
3. Query only the columns needed, ordered so the most relevant rows come first, with simple aliases.
4. Every query is LOB-scoped. If a result looks small, say scope may explain it; never work around it.
5. You only see the row count, the columns and the first row. Describe the result and point to the table or chart. **State only what you saw: never guess the other rows' values or order, never list them, never fetch them.** This rule was added after the model invented a ranking.
6. On a tool error, fix and retry.
7. `MEMBER_1a2b3c`-style values are privacy tokens. Use them exactly, including in SQL.
8. `CHARTS_IN_THIS_CHAT` lists every chart's current version. To change one, call `create_chart` with its query and an edited copy, keeping everything the user did not ask to change.
9. If no listed table holds the data, don't search. Name the missing data and the domain that holds it (from `OTHER_DOMAINS` or an `OUT_OF_DOMAIN` error), say that switching domains in the Context Brain tab makes it available, then stop.

Copy the exact text from `medicare_sales/prompts.md`.

> Gap: the `retail_banking` domain has **no** `chat_agent` prompt, so `available()` is false there and Chat silently uses the old pipeline. Add the section if the user wants the agent on that domain.

### 5.4 Dependencies: `backend/requirements.txt`

`langchain==1.0.3`, `langgraph==1.0.2`, `langchain-google-genai==4.2.0`. These are the versions the SQL Agent runs on. Development used miniconda Python 3.13.11 and FastAPI 0.120.3.

### 5.5 Frontend: `frontend/src/App.jsx` (no new dependencies)

- `DEFAULT_PIPE` gets `agent: true`.
- Pipeline config gets a first checkbox: **"🤖 LangChain agent (multi-step, remembers this chat; unchecked = governed pipeline below)"**. This is the rollback switch.
  - Pipeline settings are saved per user in `localStorage` (`oppal-pipeline`).
  - A pipeline saved before the switch existed has no `agent` key, so the code treats `pipeline.agent !== false` as on.
- `ask()` posts to `/api/agent/ask` when the agent is on, otherwise to `/api/ask`. The body adds `chat_id: String(chatId)`.
- The busy text reads "agent working: tables → schema → governed SQL → chart…" when the agent is on.
- **Markdown rendering:** new `frontend/src/components/Markdown.jsx`, used as `<Markdown className="summary" text={m.data.summary} />`.
  - It renders headings, `**bold**`, `*italic*`, `` `code` ``, nested bullet and numbered lists (`start` kept), tables (numeric cells right-aligned), code fences and `---` rules.
  - Output is React elements only, **never HTML**, so model or data text can't inject markup.
  - `_underscore_` emphasis is deliberately not supported, so column names like `enrollment_quarter` stay intact.
  - Plain-text answers from the old pipeline become paragraphs with their line breaks kept.
  - Its styles are the `.md` rules in `frontend/src/styles.css`, using the existing theme variables. `.summary` lost its `white-space: pre-wrap`.
- Everything else is reused unchanged: `ChartArtifact`, `DataGrid`, `EditableTitle`, pin, rerun, history, `Sidebar`, `JourneyStrip`, `UsageChip`.

### 5.6 Tests: `backend/tests/test_chat_agent.py` (31 offline checks, no LLM, no key)

- It is a plain PASS/FAIL script, registered in `backend/run_all_tests.sh`'s standalone loop next to `test_chat_trust_gate`.
- It copies `oppal.db` and the Brain into a temp dir and points every `OPPAL_*` store variable there.
- It **never calls `reset_demo_env()`**.
- Tools are called directly through `.func(...)` with a stand-in runtime: `SimpleNamespace(context=ChatContext(...), tool_call_id="call_test01", state={})`.

| Group | Checks |
|---|---|
| 1. Governed data access | `u-ma` gets only Medicare Advantage; `u-compliance` gets 4 LOBs; `users` table refused; `DELETE` refused; engine error text reaches the model; SQL on a worker thread is logged under the asking user |
| 2. What the model sees | Artifact has all 50 rows; content has only the first row, as a token; member IDs tokenized; a token in SQL runs as the real id; `send_row_samples` off sends no values; plain numbers aren't mistaken for PHI |
| 3. Brain-backed schema | `list_tables` shows governed tables and hides excluded ones; `table_schema` carries column meanings and joins and refuses tables outside the catalog |
| 4. Charts | Missing column refused; artifact has every key `ChartArtifact` reads; `drilldown_prompt` becomes `drilldown.prompt_template`; chart remembered in state; scatter without `y` refused |
| 5. Domain boundary (payer active) | `enrollments` refused, naming Medicare; `FROM enrollments AS enrollments` caught; ungoverned warehouse table (`cdag_universe`) refused; aliases and string literals not mistaken for tables; `list_tables` names the other domain; `table_schema` names it; charts obey the same boundary |
| 6. Memory and fallback | Thread ids namespaced per user; with provider `mock` the agent is off |

---

## 6. The original Streamlit SQL agent (`/Users/rahulyadav/Desktop/SQL Agent`)

It is still there and still works. It is the source of the port.

| File | What |
|---|---|
| `agent.py` (about 390 lines) | LangChain v1 `create_agent` with Gemini (`GEMINI_MODEL`, default `gemini-3.7-flash`); read-only sqlite URI on `oppal.db`. Details below. |
| `app.py` (about 154 lines) | Streamlit UI. Details below. |
| `schema_notes.md` | General rules plus one section per table (27). Each table's section is appended to `sql_db_schema` output. |
| `.env` | `GEMINI_API_KEY` (rotate it), optional `GEMINI_MODEL` |
| `requirements.txt` | `langchain`, `langchain-google-genai`, `streamlit`, `python-dotenv` |
| `.claude/launch.json` | Preview config for `http://localhost:8502` |
| `CLAUDE.md` | The read-only rule |

What `agent.py` contains:

- **Tools:** `sql_db_list_tables`, `sql_db_schema` (+ notes), `sql_db_query` (`content_and_artifact`; first row to the model, up to 100,000 rows in the artifact; the `top_k` limit was removed at the user's request), `sql_db_query_checker`, and `create_chart` (a Vega-Lite spec validated with Altair, stored through `Command`).
- **State and memory:** `SQLAgentState` (`charts`, `user_queries`) with merge reducers; a `@dynamic_prompt` listing current charts; `InMemorySaver`; `recursion_limit=50`.
- **Chart editing:** `edit_spec`, `chart_types_for` and `_move` (portable encoding keys) power the UI's chart customization. `build_input()` adds a note to the conversation when the user edited a chart in the UI, so the model doesn't redraw the old one.

What `app.py` contains: chat with an expandable "steps" view, inline Vega-Lite charts, a 🎨 Customize popover per chart (title, chart type, color, and so on), a sidebar SQL editor (write, run, change, run again), "Edit in SQL editor" buttons, and new-chat handling with a `thread_id`.

Run it:

```bash
cd "/Users/rahulyadav/Desktop/SQL Agent" && streamlit run app.py --server.headless true --server.port 8502
```

Port 8501 belongs to the user's separate Voice Agent app, so leave it alone.

Lessons from this app that shaped the port:

- **The 1-row limit pushed the model to cheat.** It added `LIMIT 1`, then packed rows with `json_group_array`. That led to the docstring rules and the 500-character cut.
- **25 steps wasn't enough** when the model only sees first rows, so the limit is 50.
- **Streamlit silently kept showing the old chart when a spec was invalid**, so every spec is validated before it is stored.
- **The model ignored UI-side chart edits that lived only in the prompt.** They have to be in the conversation.

---

## 7. How to run OpPal with the agent

### 7.1 One-time setup

```bash
cd /Users/rahulyadav/Downloads/oppal-complete-v14.15/oppal_stage
pip install -r backend/requirements.txt
cd frontend && npm install
```

### 7.2 Configure Gemini

In OpPal's **Settings** tab, set provider **Gemini**, a model (the tests used `gemini-3.6-flash`) and the API key. This writes the real `settings.json`.

For testing without touching it, use the scratch launcher in section 8.3, which writes its own `settings.json`.

### 7.3 Start the servers

Backend on port **8001**, from `backend/`:

```bash
PYTHONPATH=. python3 -m uvicorn app.main:app --port 8001
```

Frontend on port **5173**, from `frontend/`. Vite proxies `/api` to `http://127.0.0.1:8001`:

```bash
npm run dev -- --port 5173 --strictPort
```

### 7.4 Use it

Open `http://localhost:5173` and log in. The demo password is shown on the login screen. Demo users:

| user_id | Name | Role | Sees |
|---|---|---|---|
| `u-compliance` | Casey Compliance | compliance_officer | all 4 LOBs |
| `u-compliance2` | Dana Controls | compliance_officer | all 4 LOBs |
| `u-ma` | Morgan Advantage | ma_analyst | Medicare Advantage only |
| `u-medicaid` | Max Medicaid | medicaid_analyst | Medicaid only |
| `u-commercial` | Blair Broker | commercial_analyst | Commercial only |

**Where the switch is:** Chat tab → **"pipeline config"** expander under the header → **🤖 LangChain agent** checkbox. It is on by default.

- When it is on, LLM assist, Semantic cache and Proactive root-cause don't matter; they only affect the old pipeline.
- The old pipeline still answers when the box is unticked, when an audience is active, or when the provider isn't Gemini.

The active domain is switched in the **Context Brain** tab. The real pointer is `backend/app/semantic/active_domain.txt`, currently `healthcare_payer`.

---

## 8. Testing

### 8.1 Offline unit checks (fast, safe, no key)

From `backend/`:

```bash
PYTHONPATH=. python3 tests/test_chat_agent.py
```

Expected: `31/31 passed`.

### 8.2 Full regression (DANGER: back up first, see 9.1)

From `backend/`:

```bash
bash run_all_tests.sh
```

Last result: **1667 phase checks + the end-to-end business scenario all pass.** Most stores are scratched by the script, but **some demo packs call `reset_demo_env()`, which deletes the real `app/data` files** (section 9.1). Always back up first, then restore and compare checksums:

```bash
B=/Users/rahulyadav/Downloads/oppal-complete-v14.15/oppal_stage/backend/app/data
BK=/tmp/oppal_data_backup_$(date +%s)
cp -Rp "$B" "$BK"
(cd "$B/../.." && bash run_all_tests.sh)
rsync -a --delete "$BK"/ "$B"/
diff -r "$BK" "$B" && echo "app/data restored exactly"
```

The `rsync --delete` restore removes anything the run created. Use it only when the backup was taken right before the run.

### 8.3 Live test on scratch stores (no writes to the user's real data)

Run the backend with **every** store redirected. This is the launcher used during development (`oppal_live.sh`):

```bash
#!/usr/bin/env bash
set -euo pipefail
S=/tmp/oppal_live                       # scratch dir
B=/Users/rahulyadav/Downloads/oppal-complete-v14.15/oppal_stage/backend
rm -rf "$S" && mkdir -p "$S/semantic"
cp "$B/app/data/oppal.db" "$S/oppal.db"
cp -R "$B/app/semantic/domains" "$S/semantic/domains"
[ -d "$B/app/semantic/versions" ] && cp -R "$B/app/semantic/versions" "$S/semantic/versions"
cp "$B/app/semantic/active_domain.txt" "$S/active_domain.txt"
# Scratch settings: the user's settings with Gemini switched on, key read from the SQL Agent's .env
python3 -I - "$B/app/data/settings.json" "/Users/rahulyadav/Desktop/SQL Agent/.env" "$S/settings.json" <<'EOF'
import json, sys
settings = json.load(open(sys.argv[1]))
key = next(l.split("=", 1)[1].strip() for l in open(sys.argv[2]) if l.startswith("GEMINI_API_KEY="))
settings["llm"].update(provider="gemini", api_key=key)
json.dump(settings, open(sys.argv[3], "w"), indent=2)
EOF
export OPPAL_SETTINGS_PATH="$S/settings.json" OPPAL_DB_PATH="$S/oppal.db" \
       OPPAL_HISTORY_DB="$S/history.db" OPPAL_WORKSPACE_DB="$S/workspaces.db" \
       OPPAL_AUDIT_LOG="$S/audit_log.jsonl" OPPAL_LEDGER_HEAD="$S/ledger_head.json" \
       OPPAL_LEDGER_LOCK="$S/ledger_lock.json" OPPAL_ACTION_DB="$S/actions.db" \
       OPPAL_CASE_DB="$S/cases.db" OPPAL_SIM_DB="$S/simulations.db" \
       OPPAL_COMPENSATION_DB="$S/comp.db" OPPAL_BRAIN_DIR="$S/semantic/domains" \
       OPPAL_ACTIVE_DOMAIN_FILE="$S/active_domain.txt" OPPAL_REVIEW_QUEUE="$S/review_queue.json" \
       PYTHONPATH=.
cd "$B"
exec python3 -m uvicorn app.main:app --port 8001
```

`OPPAL_REVIEW_QUEUE` was once missed. A degraded answer then wrote `review_queue.json` into the real `app/data`. If you add a store, redirect it too.

Chats, pins and domain switches on this server vanish when it restarts. That is expected.

For a single question without the UI, a helper (`oppal_ask.py`) did the same redirection in Python, then:

```python
from app import chat_agent
from app.data.db import get_user_context
from app.privacy.phi_guard import PHIGuard

chat_agent.rebuild_chat_agent()
res = chat_agent.run_chat(question, "repro", get_user_context(user_id), PHIGuard(True), True)
# print the tool calls from res["audit"], the artifact types, res["usage"]["latency_ms"], res["summary"]
```

### 8.4 Browser checklist (all passed at the last run; re-run after any change)

On the payer domain (`healthcare_payer`):

1. **`u-compliance`: "bar chart of paid amount by line of business".** Expect a Recharts bar chart with 4 LOBs.
2. **Follow-up "make it a pie".** It is remembered: the same query, now a pie, with no new list/schema calls.
3. **Chart controls:** orientation, palette, bar shape, type → pie, then restore.
4. **📌 Pin**, then the chart appears in the Workspace tab.
5. **Chart panel ▸ "SQL behind this chart":** edit the SQL, click **▶ Run** (the exact "▶ Run" button, not the journey strip's "Gates+Run"), and the chart updates.
6. **`u-ma` with the same question:** only Medicare Advantage. The SQL Log tab shows the agent's SQL under `u-ma`.
7. **Untick 🤖 LangChain agent:** the old pipeline answers (trust panel and journey strip as before). Tick it again afterwards.
8. **"effectuation rate by agent bar chart" on the payer domain:** a quick reply that the data is in the **Medicare Sales** domain and that switching in Context Brain makes it available. Before the fix this looped until `GraphRecursionError`.

After switching to **Medicare Sales** in Context Brain (on the scratch server):

9. **`u-ma`: "effectuation rate by agent bar chart".** MA-only data; top three Agent 0042, 0004, 0005 (unscoped it would be 0042, 0008, 0035).
10. **"Break down enrollment premium by lob":** a single Medicare Advantage bar.
11. **A payer question such as "paid amount by claim type":** a reply that it lives in the **Healthcare Insurance (US Payer / MCO)** domain.
12. **"show enrollment details for 2026Q2":** Markdown renders (bold labels, nested bullets, code chips) and the 71-row grid is under the answer.

Also check that the provider set to `mock` makes Chat fall back cleanly to the old pipeline.

---

## 9. Traps (each one bit us once)

### 9.1 OpPal's tests can wipe the real data

`backend/demo/_env.py::reset_demo_env()` deletes `backend/app/data/*.db`, `*.json` (except `settings.json`), `audit_log.jsonl` and `.auth_secret`, **regardless of the `OPPAL_*` env vars**. Demo packs call it, and `run_all_tests.sh` runs those packs. Back up, run, restore, compare (section 8.2).

### 9.2 The data layer LOB-filters only the active domain's tables

With the payer Brain active, the agent once queried `enrollments` (a Medicare Sales table) and an MA-only analyst got every LOB's rows. That is why `_run()` refuses any warehouse table outside `catalog(scope)`. **Never remove that check.**

### 9.3 `run_legacy()` hides SQL errors

Use `execute()`.

### 9.4 `PHIGuard.scrub()` over-tokenizes

It tokenized ISO dates and 5-digit numbers. For row values use `scrub_structure()`. Detokenize SQL before running it, and detokenize the answer, chart titles and drill-down prompts before returning them.

### 9.5 `CURRENT_ACTOR` is a ContextVar

LangChain may run tools on a worker thread, so `_run()` sets it from the scope. Otherwise the SQL log loses the user.

### 9.6 Parallel tool calls

They return a **list** of updates per node in `stream_mode="updates"`.

### 9.7 Never patch over an engine error by guessing

The model needs the error text to self-correct.

### 9.8 Browser automation

There are two buttons with "Run" in the text. Match the exact "▶ Run".

### 9.9 Leave Morgan's agent switch on

It was once left off after a rollback test, so Chat used the old pipeline and looked "broken".

### 9.10 Ports

| Port | What |
|---|---|
| 8001 | OpPal backend |
| 5173 | OpPal frontend |
| 8502 | SQL Agent Streamlit |
| 8501 | The user's Voice Agent (don't touch) |

The desktop sandbox may block tools from reading `~/Desktop`; if `preview_start` fails, start servers from a shell instead.

---

## 10. Open items (not done; ask the user before starting any)

1. **LOB leak in OpPal's own `/api/query/rerun`** (pre-existing, not agent code).
   - Edited SQL that reads a table outside the active domain (e.g. `enrollments` on the payer Brain) is not LOB-filtered, so an MA-only analyst can read every LOB through the "SQL behind this chart" editor.
   - Fix it at the data layer so every caller is covered: deny or filter tables outside `catalog(scope)`. Add a regression check.
   - This was proposed as its own task and not started.
2. **Memory is in-process (`InMemorySaver`).** Chats and the rows inside artifacts vanish on restart. Swap in LangGraph's `SqliteSaver` if the user wants memory to survive restarts.
3. **The `retail_banking` domain has no `chat_agent` prompt,** so Chat falls back there.
4. **Answers can be wordy.** The model sometimes lists every field of the first row it saw. Tighten rule 5 in the `chat_agent` prompts if the user wants shorter answers.
5. **The stale docstring** at the top of `chat_agent.py` says `run_legacy`.
6. **Things given up that could be rebuilt:**
   - follow-up chips;
   - insight cards;
   - semantic cache;
   - trust score/gate and provenance for agent answers;
   - letting the agent see chart edits made in OpPal's chart panel (as `build_input()` did in Streamlit).

---

## 11. LangChain references used

- SQL agent tutorial: https://docs.langchain.com/oss/python/langchain/sql-agent
- Agents (`create_agent`, state, context, middleware): https://docs.langchain.com/oss/python/langchain/agents
- Tools (`ToolRuntime`, `response_format="content_and_artifact"`, returning `Command`): the LangChain tools docs
- Skills-based SQL assistant (reviewed; nothing adopted): https://docs.langchain.com/oss/python/langchain/multi-agent/skills-sql-assistant

The APIs in use:

- `langchain.agents.create_agent`, `AgentState`
- `langchain.agents.middleware.dynamic_prompt`, `ModelRequest`
- `langchain.chat_models.init_chat_model`
- `langchain.tools.tool`, `ToolRuntime`
- `langchain.messages.ToolMessage`
- `langgraph.types.Command`
- `langgraph.checkpoint.memory.InMemorySaver`
