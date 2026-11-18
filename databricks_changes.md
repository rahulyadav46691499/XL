# Running OpPal on Databricks: what changed

This document lists every change made to run OpPal on a Databricks SQL
warehouse instead of the bundled SQLite `oppal.db`, in three phases:
1. route every warehouse read through the Databricks connector (section 4);
2. move logins and permissions out of `oppal.db` (section 5);
3. make the Brain's SQL run on Databricks as well as SQLite (section 6).

Sections 7 and 8 explain how Databricks changes show up in the app and how
to set up a new install. It is written so the same
changes can be re-applied on another checkout, or reviewed before committing.

Branch: `langchain-chat-agent`. **Nothing here is committed yet.**

---

## 1. Goal and the one switch

**Goal:** a user enters Databricks details in **Settings > Data source**, and the
whole application then reads its data from Databricks. `oppal.db` is not used
and is not even created.

**The switch is `settings.json` > `data.type`.**

```json
"data": {
  "type": "databricks",
  "params": {
    "server_hostname": "<workspace host, e.g. adb-....azuredatabricks.net>",
    "http_path": "/sql/1.0/warehouses/<warehouse id>",
    "access_token": "<personal access token>",
    "catalog": "<catalog>",
    "schema": "<schema>"
  }
}
```

| `data.type` | What the app does |
|---|---|
| `sqlite_demo`, missing, or `local_reference` | Bundled SQLite warehouse, as before |
| `databricks` (or any other registered connector) | Every warehouse read goes through that connector, and `oppal.db` is never built |

There is no `.env`. `settings.json` (written by the Settings UI) is the only
source of configuration. Do not add a second one.

**Before deploying, rotate the Databricks token.** The current one was shared
in a Teams chat. Never commit `settings.json` with a real token in it.

---

## 2. What stays on SQLite on purpose

OpPal has two kinds of SQLite files. Only the first kind moved.

| Kind | Files | Where it lives now |
|---|---|---|
| **Warehouse data** (claims, members, leads, …) | `oppal.db` | **Databricks** when `data.type` is `databricks` |
| **App state** (written all the time by the app) | `identity.db` (new), `cases.db`, `actions.db`, `simulations.db`, `workspaces.db`, `compensations.db`, history, Brain edits | Still local SQLite |

Why app state is not moved to Databricks:
- OpPal treats the warehouse as **read-only**. The scope enforcer blocks
  `INSERT`/`UPDATE`/`DELETE`, and the connector promises it stores nothing.
- A SQL warehouse would have to stay awake for every case update, approval
  and login. That is slow and costs money.
- If these stores ever need to be shared across servers (Azure / Cloud Run
  with more than one instance), move them to Postgres, not Databricks.

---

## 3. Before this work (changes already uncommitted at the start)

These were already in the working tree, and the rest builds on them:

- `backend/requirements.txt`: added `databricks-sql-connector>=3.0`.
- `backend/app/config.py`
  - `DATA_CONNECTORS["databricks"]["params"]` now includes `catalog` and `schema`.
  - `test_data_connection("databricks")` really connects with the **saved**
    params (Save first, then Test) and runs `SELECT current_catalog(), current_schema()`.
- `backend/app/mcp/connectors/databricks.py` `_connect()` cleans up pasted values:
  - strips `https://` and a trailing `/` from the host;
  - strips any label in front of the path (`"http: /sql/1.0/..."` becomes `/sql/1.0/...`);
  - trims whitespace from the token;
  - passes `catalog` and `schema` to `sql.connect()`, so table names without a
    catalog/schema prefix resolve inside the chosen schema.
- `backend/run_all_tests.sh`: registered `e2e_ms_case6_commission_overpayment`.

**The bug found first:** `settings.json` already said `data.type: databricks`,
but `mcp.active_connector` was still `local_reference`. The connector was
chosen from `active_connector` only, so **the app was still running entirely
on SQLite**. Phase 1 fixes this.

---

## 4. Phase 1: route every warehouse read through the connector

### 4.1 Choosing the connector: `backend/app/mcp/registry.py`

In `DataAccessService._from_config()`:

```python
name = mcp.get("active_connector", "local_reference")
settings = config.load().get("data", {})
# Settings > Data source picks the warehouse unless the MCP layer was
# pinned to a specific connector (tests pin "fake").
if name == "local_reference" and settings.get("type") in _REGISTRY:
    name = settings["type"]
...
except Exception:
    if name not in ("local_reference", "sqlite_demo"):
        raise   # never answer from SQLite when a warehouse was chosen
```

- `data.type` now picks the connector, unless `mcp.active_connector` was set
  to something else on purpose (tests pin `fake`).
- **Fail closed:** before, if the chosen connector could not be built, the app
  silently switched back to SQLite. Now it raises an error, so a misconfigured
  Databricks setup can never quietly answer from demo data.
- Saving settings already calls `rebuild_service()` (`main.py`), so a change in
  Settings takes effect without a restart.

### 4.2 The data layer: `backend/app/data/db.py`

New helpers, added after `POOL = ConnectionPool()`:

| Function | Does |
|---|---|
| `remote()` | Returns the active connector when `data.type` is not local. Returns `None` for SQLite, **and also when the connector is `LocalReferenceConnector`**. That connector runs on top of `run_query`, so treating it as remote recursed forever (`RecursionError`); this was found and fixed during testing. |
| `_system_scope()` | A full-scope `ScopeContext(user_id="system", allowed_lobs=["*"], full_lobs=["*"], authorized=True)` for the platform's own reads (LOB list, table list, profiling). It has the same reach `POOL` has on SQLite. `full_lobs` must not be empty, because `is_full_scope()` returns False for an empty universe. |
| `_remote_rows(conn, sql)` | Runs a system read through `conn.execute()` (so read-only and excluded-table guards still apply) and raises on failure. |
| `tables()` | All table/view names. SQLite: `sqlite_master`. Databricks: `information_schema.tables WHERE table_schema = current_schema()`. The remote result is cached in `_SCOPE_VALUES_CACHE["tables"]`. |
| `columns(table)` | `[(name, TYPE)]`. SQLite: `PRAGMA table_info`. Databricks: `information_schema.columns ... ORDER BY ordinal_position`. |
| `_run_remote(conn, sql, limit, allowed_lobs, full_lobs)` | The Databricks version of `run_query`. With no `allowed_lobs` it uses the system scope (internal callers). Otherwise it builds a user `ScopeContext` (user = `CURRENT_ACTOR`) so the connector filters by LOB. It writes to `SQL_LOG` like the local path. |

Changed functions:

- `run_query()`: the first lines dispatch to `_run_remote()` when `remote()`
  is set. Because every analytics module calls `run_query`, this one change
  covers `root_cause.py`, `cohort_insights.py`, `compliance_agent.py`,
  `cohort_agent.py`, the orchestrator's audience gate and `main.py`.
- `ALL_LOBS()`: when remote, it builds the list of all LOB values from
  `SELECT DISTINCT <scope column>` over each governed table that exists in
  Databricks and has that column. Results are cached and cleared by
  `invalidate_scope_values()`, which also clears the cached table list.
- `ensure_db()`: returns immediately when remote (phase 2). Nothing builds
  `oppal.db` or the synthetic tables for each domain.
- The SQLite `EXPLAIN` check in `validate_sql()` is never reached on
  Databricks. Parse errors come back from Databricks itself (see 4.4).

### 4.3 LOB filtering when tables are missing: `scope.py`, `base.py`, `databricks.py`

For a scoped (non-full) user, `build_pushdown_sql()` puts a filtered CTE in
front of the query for **every** governed table, for example
`claims AS (SELECT * FROM cat.schema.claims WHERE lob IN ('Medicare Advantage'))`.
If one of those tables does not exist in Databricks, the **whole query fails**,
even when it never touches that table.

The fix:
- `ScopeEnforcer.build_pushdown_sql(sql, scope, qualify, present=None)`:
  a new `present` argument. If it is given, CTEs are skipped for governed,
  transitive (or their parent) and ungoverned tables that don't exist.
- `BaseWarehouseConnector.present_tables()`: new, returns `None` (unknown).
  `execute()` passes `None if scope.is_full_scope() else self.present_tables()`.
  Full scope never asks, which also prevents recursion.
- `DatabricksConnector.present_tables()` returns `db.tables()`.

**Why this is safe:** a table that doesn't exist can't be read without a
filter. A query that names it just fails with `TABLE_OR_VIEW_NOT_FOUND`. A
user can never see more data than before.

`execute()` is still defined only in the base class, so the rule that
connectors cannot override it still holds.

### 4.4 Error reporting: `backend/app/mcp/models.py` `to_legacy()`

- The `parses` check now also recognises Spark errors: `parse_syntax_error`,
  `unresolved_column`, `table_or_view_not_found`. The trust scorer then reports
  a parse failure correctly instead of a generic error.
- On failure, `gate["error"]` carries the real message (refusal reason or
  engine error), the same as the SQLite path already did.

### 4.5 Modules that read `oppal.db` directly

| File | Before | Now |
|---|---|---|
| `backend/app/chat_agent.py` `_warehouse_tables()` | opened `oppal.db`, read `sqlite_master` | `db.tables()` (removed the `sqlite3` and `DB_PATH` imports) |
| `backend/app/semantic/graph.py` `export_graph(include_unmapped=True)` | `PRAGMA table_info` on `oppal.db` | `db.columns(t)` |
| `backend/app/semantic/onboarding.py` `_profile()` | sqlite connection with `PRAGMA` | `columns()` plus a `_rows()` helper over `run_query`. The SQL works on both engines (`COUNT`, `COUNT(DISTINCT)`, `LIMIT`). Numeric types now include Databricks types (`BIGINT`, `DOUBLE`, `DECIMAL(p,s)`, …) through `ctype.split("(")[0] in _NUMERIC`. |
| `backend/app/data/quality.py` | read and wrote `oppal.db` | `_ro()`/`_rw()` call `_local_only()`, which **refuses on a remote warehouse** with a clear error. Its SQL only works on SQLite (`sqlite_master`, `CAST AS TEXT`) and "impute" writes rows, which the read-only warehouse must not allow. |

### 4.6 Tests must never touch your real Databricks: `backend/run_all_tests.sh`

Before, the suite read the developer's **real** `app/data/settings.json`. With
`data.type: databricks`, every suite would have run against the real warehouse.
The script now writes a scratch copy (keeping the LLM settings the demos
expect) with the data source reset:

```bash
python3 - "$SCRATCH/settings.json" <<'PYEOF'
import json, os, sys
src = "app/data/settings.json"
s = json.load(open(src)) if os.path.exists(src) else {}
s["data"] = {"type": "sqlite_demo"}
json.dump(s, open(sys.argv[1], "w"))
PYEOF
export OPPAL_SETTINGS_PATH="$SCRATCH/settings.json"
```

---

## 5. Phase 2: move logins and permissions out of `oppal.db`

Logins (`users`, `roles`, `role_lob_access`, `user_attributes`) lived inside
the warehouse file, so nobody could log in without `oppal.db`.

### 5.1 New file: `backend/app/security/directory.py`

- Path: `OPPAL_IDENTITY_DB`, default `backend/app/data/identity.db`. It is
  read **on every call** (not at import), because demo resets redirect it
  after import.
- `connect()`: creates the 4 tables (`CREATE TABLE IF NOT EXISTS`) and, if
  `users` is empty, adds the demo cast. This is the same data `generate.py`
  used to insert:
  - roles: `compliance_officer`, `ma_analyst`, `medicaid_analyst`, `commercial_analyst`
  - grants: officers get all 4 payer LOBs; MA analyst gets Medicare Advantage;
    Medicaid analyst gets Medicaid; commercial analyst gets Commercial and ACA Exchange
  - users: `u-compliance`, `u-compliance2`, `u-ma`, `u-medicaid`, `u-commercial`,
    password `OpPal!demo2026` (hashed with `auth.hash_password`)
  - attributes: `domain` and `phi_access` for each user
- `grant(pairs)`: `INSERT OR IGNORE` into `role_lob_access`, for domain dataset
  builders.
- Both demo compliance officers are still there, so a dual-control approval
  still needs two different people.

### 5.2 Readers switched to the identity store

- `db.get_user_context()` and `db.list_users()` use `directory.connect()`.
  They still intersect the grants with `ALL_LOBS()`, so another domain's
  grants never leak into the "authorized LOBs" badge.
- `auth.authenticate()` reads `password_hash` from `directory.connect()`.

### 5.3 Login tables removed from the warehouse

- `backend/app/data/generate.py`: dropped the `CREATE TABLE` statements for
  roles, role_lob_access, users and user_attributes, and the code that filled
  them. The docstring now points to `directory.py`.
- `backend/demo/data/make_pharma_dataset.py`: its distributor grants
  (officers get all 3 distributors, analysts get `Cardinal-East`) now go
  through `directory.grant()` instead of `INSERT` into `oppal.db`.
- Those 4 tables stay in the Brain's `excluded_tables` and the importer's
  `system_tables`, so they are still blocked from any analytical query.
  Tests that assert `SELECT * FROM users` is refused still pass.

### 5.4 Test and demo isolation

- `run_all_tests.sh`: `export OPPAL_IDENTITY_DB="$SCRATCH/identity.db"`.
- `demo/_env.py` `reset_demo_env()` deletes the file at `OPPAL_IDENTITY_DB`
  as well as `OPPAL_DB_PATH`. Otherwise grants added by the pharma dataset
  would carry over into the payer suites ("ma_analyst sees Cardinal-East").
  `app/data/identity.db` is also caught by the existing `*.db` glob.

---

## 6. Phase 3: one Brain that runs on both SQLite and Databricks

### 6.1 The approach

The same Brain Markdown is executed by the bundled SQLite (demo, tests) and by
Databricks. Forking the Brain per warehouse would mean two copies of every rule
to keep in sync, so instead:

- **The Brain is written in Databricks (Spark) SQL**, using only constructs
  that SQLite also accepts, or that SQLite gets as small stand-in functions.
- **SQLite gets stand-ins** for the few Spark functions the Brain uses, through
  `_register_compat(con)` in `backend/app/data/db.py`. It is registered on every
  SQLite connection the warehouse uses (the pooled read-only connections and
  the per-user scoped in-memory copies), next to the existing `ai_*` functions.

| Function (Spark name) | What the SQLite stand-in does |
|---|---|
| `to_timestamp(x)` | parses ISO text (`2025-11-05T16:30` or with a space) and returns `YYYY-MM-DD HH:MM:SS` |
| `unix_timestamp(x)` | seconds since 1970, naive times treated as UTC (only differences are used, so the zone does not matter) |
| `collect_set(x)` | aggregate; the distinct non-NULL values, as a JSON list (sorted) |
| `array_join(list, sep)` | joins that list with `sep` |
| `exp`, `ln` | registered **only if** this SQLite build lacks math functions (some Linux images compile SQLite without them) |

None of these names exist in SQLite, so no built-in function is shadowed. To use
another Spark function in the Brain later, add one stand-in there; do not
fork the Brain.

`||` (string concatenation) already works on both engines, so the pharma
`incident` label was left as it was.

### 6.2 Brain entries rewritten

Every rewritten query was run on SQLite **before and after** and returned
**identical rows**.

| Domain / file | Entry | Was (SQLite-only) | Now (both engines) |
|---|---|---|---|
| `medicare_sales/policy_rules.md` | Scope of Appointment 48-hour rule | `julianday(a.appointment_date) - julianday(a.soa_signed_date)` (×2) | `(unix_timestamp(to_timestamp(a.appointment_date)) - unix_timestamp(to_timestamp(a.soa_signed_date))) / 86400.0` |
| `medicare_sales/policy_rules.md` | commission on enrolments that never took effect | `GROUP_CONCAT(DISTINCT c.comm_type)` | `array_join(collect_set(c.comm_type), ',')` |
| `medicare_sales/agents.md` | `compensation_siu` detector | same `GROUP_CONCAT`, plus a correlated subquery for `unrecovered_clawback_usd` beside a GROUP BY | `array_join(collect_set(...))`, and the subquery became a `LEFT JOIN` to clawbacks pre-summed per agent, read with `MAX(...)` |
| `medicare_sales/agents.md` | `lead_quality` detector | correlated subquery for `peer_cost_per_qualified` beside a GROUP BY | `LEFT JOIN` to peer cost and qualified totals pre-summed per market, quarter and source, read with `MAX(...)` |
| `pharma_supply_chain/metrics.md` | `mean_kinetic_temperature` | `mkt(t.temp_c)`, a Python aggregate that exists only on SQLite | the same formula inline: `ROUND(83144.0 / 8.314 / -LN(AVG(EXP(-83144.0 / (8.314 * (temp_c + 273.15))))) - 273.15, 2)` |
| `pharma_supply_chain/policy_rules.md` | cold-chain excursion rule | `mkt(r.temp_c)`; `GROUP BY s.shipment_id` while selecting lot, hub and units | inline MKT; `GROUP BY s.shipment_id, s.lot_id, s.hub_id, s.units_spoiled` |
| `pharma_supply_chain/agents.md` | `cold_chain_iot` detector | same as above, plus `distributor_id` | inline MKT; the selected shipment columns added to the GROUP BY |
| `pharma_supply_chain/agents.md` | `supply_allocation` detector | `GROUP BY s.lot_id` while selecting `b.units_released` | `GROUP BY s.lot_id, b.units_released` |
| `healthcare_payer/prompts.md` | `sql` prompt text | "Write ONE read-only SQLite SELECT." | "Write ONE read-only SELECT." (this section is not read by code; changed for consistency) |

Why the date rule did not become `datediff`: the SOA timestamps carry hours
(`2025-11-05T16:30`). `datediff` counts whole days, so a 41-hour gap would
count as 2 days and slip past the 48-hour rule. The seconds-based version keeps
hour precision on both engines, and works whether the Databricks column is a
STRING or a TIMESTAMP.

Why the MKT formula is inline: Databricks cannot run a Python aggregate.
A Databricks SQL function would need `CREATE FUNCTION`, a write to the
catalog, which the read-only design forbids. The constants match `_MKT` in
`backend/app/ai/functions.py` exactly (ΔH = 83144 J/mol, R = 8.314), and the
result matched it on all 193 shipments. `_MKT` stays registered on SQLite
because tests call `mkt()` directly.

Why the GROUP BY and subquery changes: SQLite accepts a selected column that
is neither grouped nor aggregated, and a correlated subquery next to a GROUP BY.
Databricks rejects both (`MISSING_AGGREGATION`,
`SCALAR_SUBQUERY_IS_IN_GROUP_BY_OR_AGGREGATE_FUNCTION`). The columns added
to the GROUP BY have one value per group (one lot per shipment), so results
are unchanged.

### 6.3 Generated SQL: `backend/app/agents/sql_agent.py`

- Governed template, `breakdown` intent grouped by `quarter`: it emitted
  `c.service_quarter AS quarter` **twice**. SQLite allowed it, but Databricks
  rejects `ORDER BY quarter` as ambiguous. Now a breakdown by the quarter
  column emits it once.
- The LLM SQL prompt says `Write ONE read-only {dialect} SELECT`, filled from
  the new `db.dialect()`.

### 6.4 Telling the LLMs which dialect to write

- New `db.dialect()`: `"SQLite"` for the bundled warehouse,
  `"Databricks SQL (Spark SQL)"` when remote.
- `sql_agent.py`: the system prompt uses it (above).
- `backend/app/chat_agent.py`: the chat agent's prompt gets a line added at the
  end, `SQL_DIALECT: write every query in <dialect>.` The `run_sql` tool
  description no longer says "SQLite". The Brain's `chat_agent` prompt text
  itself is unchanged (the dialect depends on where the app runs, not on the
  domain).

### 6.5 A dropped table no longer breaks every scoped query

Bug found while answering "will Databricks changes show up": the table list
used by the LOB filter was cached for the life of the process. After a table
was **dropped** in Databricks, every query from a scoped user built a filtered
CTE over the missing table, so **every** such query failed until a restart.

Fix, in `db.tables()`: the remote table list now expires after
`_TABLES_TTL = 60` seconds (cached as `(time, names)` in
`_SCOPE_VALUES_CACHE["tables"]`). A new or dropped table is noticed within a
minute. Tested: the first lookup took 5.8 s, the cached one 0.000 s, and a
stale entry containing a dropped table was replaced after the 60 seconds.

### 6.6 New tool: `backend/demo/databricks_brain_check.py`

```bash
cd backend && PYTHONPATH=. python3 demo/databricks_brain_check.py
```

It checks whether every Brain statement compiles on your Databricks warehouse.
**Run it after any Brain SQL edit, and before deploying.**

- It uses the Databricks details saved in Settings and is **read-only**: each
  statement is sent as `EXPLAIN`, so nothing runs.
- Tables the warehouse does not have yet are stood in by **empty TEMPORARY
  views** with the column names and types of the bundled datasets (built in a
  scratch temp folder). Temporary views exist only for that session and are
  never saved.
- Covers all three shipped domains: every `query:` in policy rules, agents,
  simulation and finops, plus the governed template SQL the app generates for
  every metric × intent (`metric_lookup`, `metric_trend`, `breakdown`) ×
  group-by dimension.
- Each failure is also run on the local SQLite. If it fails there too (a table
  in no dataset, or a combination that is invalid everywhere), it is listed
  separately and not counted as a Databricks problem.
- Exits 1 if any statement would fail on Databricks.
- It is **not** part of `run_all_tests.sh`, because it needs a live warehouse.

Results:

| Run | Result |
|---|---|
| Before phase 3 | 14 real Databricks failures (the 4 groups fixed above, plus `mkt()`) |
| After phase 3 | **299/299 Brain statements compile on Databricks** (exit 0) |

75 statements were skipped because they fail on SQLite too:
- `cms_market_enrollment` (24) and `hedis_measure_results` (18): tables
  auto-added to the **live** Brain by earlier CSV imports, with no dataset
  that builds them.
- `evil_name_drop` (2): a **leftover from a test run** that ended up in the
  live Brain (`healthcare_payer`). Remove it from the Brain.
- 30 are combinations my check generates that the app never would (a pharmacy
  dimension on a medical-claims metric), plus `sim_lead_loss_ratio`, which is
  a simulation-only metric.

---

## 7. Will changes in Databricks show up in the app?

| You change in Databricks | Shows up? | Notes |
|---|---|---|
| **Add, update or delete rows** | **Yes**, on the next query | Every query runs live; no rows are copied. Exception: the **same question** asked again within **15 minutes** replays the cached answer (`settings.json` > `cache.ttl_seconds`, default 900). |
| **A new LOB value** in the data | After a refresh | The list of all LOB values is cached until you save Settings, reload the Brain or restart. A brand-new LOB also needs a grant in `identity.db` before anyone can see it. |
| **Upload a new table** | **Not automatically** | The app notices the table within 60 seconds (6.5), but it only queries tables the **Brain** declares for the active domain. The table has to be added to the Brain. The only built-in way today is CSV import, which writes into SQLite, not Databricks (see 10.3). |
| **Drop a table** | Yes | Queries that use it fail with `TABLE_OR_VIEW_NOT_FOUND` and are refused. Since 6.5, other queries keep working (within 60 seconds). |
| **Rename or drop a column** | Breaks answers | Brain SQL that names the old column fails until the Brain is updated. Run `databricks_brain_check.py` to find which entries. |
| **Change column types** (for example STRING to TIMESTAMP) | Usually fine | The Brain's date logic goes through `to_timestamp(...)`, which accepts both. |

---

## 8. Default data source and first-time setup

**The app does not run on Databricks by default.** With no `settings.json`
(a fresh install or container), `DEFAULTS` in `backend/app/config.py` has
`data.type: "sqlite_demo"`. The app then builds `oppal.db` with the demo data
and runs on SQLite. A machine runs on Databricks only after Databricks has
been saved in Settings.

To switch an install to Databricks:
1. Log in as a **compliance officer** (`u-compliance`). The data connection is
   not self-serve: analysts' changes to it are dropped on the server.
2. Open **Settings > Data source** and choose **Databricks SQL**.
3. Fill in **server hostname**, **HTTP path**, **access token**, **catalog** and
   **schema**. Pasted `https://` and labels in front of the path are cleaned up.
4. Click **Save**. Saving switches the connector right away, with no restart
   (`rebuild_service()`).
5. Click **Test connection**. It uses the **saved** details and shows the
   current catalog and schema, so Save first, then Test.

From then on `settings.json` says `databricks`, and every restart uses it.

To make the app **Databricks-only** (not done; a decision to make first):
- change `DEFAULTS["data"]["type"]` to `"databricks"`;
- until details are saved, show a "connect a warehouse" message instead of
  building demo data;
- optionally hide the SQLite demo choice in Settings.

The catch: the test suite and every demo script depend on the SQLite demo
(they force `sqlite_demo` in their scratch settings), so it has to stay
available to them.

---

## 9. Verification

### Regression suite

```bash
cd backend && bash run_all_tests.sh
```

Result after each of the three phases: everything passes except **one** check in
`medicare_sales_alltabs_verify`, "TLS verification is on". That check reads
`network.ssl_verify` from the copied settings, and the local `settings.json`
has it set to `false`. It reflects the local setup, not this code.

The first "baseline" run is not a valid comparison: it ran while files were
being edited and read the real settings. The clean runs are the ones after
each phase.

### Live Databricks checks (read-only, saved connection)

Phase 1, through `db.run_query` and `data_service()`:

| Check | Result |
|---|---|
| Connector chosen | `databricks` |
| Tables found | `agent_certifications`, `agent_commissions`, `claims` |
| `ALL_LOBS()` | Medicaid, Medicare Advantage, Commercial, ACA Exchange |
| Full scope, claims by LOB | Medicaid 10,671 · MA 10,282 · Commercial 5,368 · ACA 4,996 (plus 1 row with a NULL lob) |
| `u-ma` scoped | only `Medicare Advantage` 10,282 (filtered inside Databricks) |
| Query naming `members` | fails with `TABLE_OR_VIEW_NOT_FOUND`, with no fallback to SQLite |

Phase 2, through the real HTTP API (`TestClient`), starting with **no database
files at all**:

| Check | Result |
|---|---|
| `u-ma` login | 200, `['Medicare Advantage']` |
| `u-compliance` login | 200, all four LOBs |
| wrong password | 401 |
| `oppal.db` afterwards | **not created** |
| `identity.db` afterwards | created and seeded |
| `/api/ask` "How many claims by LOB?" as `u-ma` | refused correctly: the generated SQL joins `members`, which doesn't exist in Databricks, so trust was 44% and the SQL was withheld below the 85% gate |

Phase 3:

| Check | Result |
|---|---|
| Regression suite | passes except the same TLS check |
| Every rewritten Brain query, old vs new on SQLite | identical rows |
| `databricks_brain_check.py` | 299/299 compile on Databricks (14 failed before) |
| `u-ma` scoped query on Databricks after the cache change | `[['Medicare Advantage', 10282]]` |

To repeat the live check safely, point every store at a scratch folder first,
so the real demo data is never touched:

```bash
S=/tmp/oppal_smoke; mkdir -p $S; echo healthcare_payer > $S/dom.txt
cd backend && OPPAL_DB_PATH=$S/oppal.db OPPAL_IDENTITY_DB=$S/identity.db \
  OPPAL_ACTIVE_DOMAIN_FILE=$S/dom.txt OPPAL_AUDIT_LOG=$S/audit.jsonl \
  OPPAL_LEDGER_HEAD=$S/head.json OPPAL_LEDGER_LOCK=$S/lock.json \
  OPPAL_CASE_DB=$S/c.db OPPAL_ACTION_DB=$S/a.db OPPAL_SIM_DB=$S/s.db \
  OPPAL_WORKSPACE_DB=$S/w.db OPPAL_COMPENSATION_DB=$S/comp.db \
  OPPAL_HISTORY_DB=$S/h.db OPPAL_BRAIN_EDIT_DB=$S/be.db \
  PYTHONPATH=. python3 -c "from app.data import db; print(sorted(db.tables())); print(db.ALL_LOBS())"
```

---

## 10. What is not done yet

1. **Data in Databricks is incomplete.** The schema has only 3 tables. No
   domain can fully run:
   - `healthcare_payer` also needs `members`, `plans`, `products`,
     `benefit_packages`, `pharmacy_claims`, `providers`, `formulary`,
     `prior_auth`, `cdag_universe`, `fwa_cases`, …
   - `medicare_sales` also needs `leads`, `applications`, `enrollments`,
     `interactions`, `sales_agents`, `sales_targets`, `campaigns`,
     `lead_activities`, `plan_benefit_packages`
   - `agent_certifications` looks **mis-loaded**: its columns are a mix of all
     three tables (commission columns, claim columns, then certification
     columns). Re-load it.
   - The `lob` values must match the grants exactly (`Medicare Advantage`,
     `Medicaid`, `Commercial`, `ACA Exchange`), or users get an empty scope.
2. ~~Brain SQL written for SQLite~~: **done in phase 3** (section 6).
   `databricks_brain_check.py` reports 299/299. Clean up the live Brain's
   leftover `evil_name_drop` entry, and the auto-onboarded
   `cms_market_enrollment` / `hedis_measure_results` entries unless those
   tables are uploaded to Databricks.
3. **CSV import** (`backend/app/data/importer.py`) still writes into SQLite.
   On Databricks, onboarding a newly imported table would profile Databricks
   and not find it.
4. **Data Quality tab** refuses to run on Databricks (see 4.5).
5. **A new connection for every query.** `DatabricksConnector._run()` opens and
   closes a connection each time. It works but is slow; connection reuse can
   come later if it matters.
6. ~~The Databricks table list is cached until restart~~: **fixed in phase 3**
   (6.5). It now expires after 60 seconds. The list of all LOB values is
   still cached until a settings save, Brain reload or restart (section 7).
7. **User management:** the identity store is seeded with the demo cast only.
   There is no UI to add users; real users mean inserting rows into
   `identity.db` (or a later move to SSO or Postgres).

---

## 11. Side effects and housekeeping

- `backend/app/data/.auth_secret` shows as modified. Demo resets in the test
  suite delete and recreate it. **Do not commit it.** A new secret invalidates
  existing login tokens, so log in again after running the suite.
- Running the suite also resets the demo data under `backend/app/data/`
  (existing `reset_demo_env()` behaviour), so local cases and actions are reset.
  `settings.json` is kept.
- An existing `backend/app/data/oppal.db` from before this change still
  contains the old login tables. Nothing reads them any more, and the file is
  harmless. Delete it if Databricks is the only data source.
- For Azure / Cloud Run: install `databricks-sql-connector`, and save the
  Databricks details through Settings (they are stored in `settings.json`).
  Remember the warehouse auto-stop and cost note: every query wakes the SQL
  warehouse.

---

## 12. Files touched (in addition to section 3)

```
backend/app/data/db.py                    remote(), tables(), columns(), _run_remote(), ALL_LOBS, ensure_db, user directory reads
backend/app/mcp/registry.py               data.type picks the connector; fail closed
backend/app/mcp/base.py                   present_tables() hook into pushdown
backend/app/mcp/scope.py                  pushdown skips CTEs for missing tables
backend/app/mcp/connectors/databricks.py  present_tables()
backend/app/mcp/models.py                 Spark parse errors, gate["error"]
backend/app/chat_agent.py                 table list via db.tables()
backend/app/semantic/graph.py             columns via db.columns()
backend/app/semantic/onboarding.py        profiler works on any warehouse
backend/app/data/quality.py               refuses on a remote warehouse
backend/app/security/directory.py         NEW identity store (identity.db)
backend/app/security/auth.py              login reads identity store
backend/app/data/generate.py              login tables removed from oppal.db
backend/demo/data/make_pharma_dataset.py  grants via directory.grant()
backend/demo/_env.py                      reset also clears OPPAL_IDENTITY_DB
backend/run_all_tests.sh                  scratch settings.json + identity.db

# phase 3
backend/app/data/db.py                    dialect(), _register_compat() stand-ins, 60 s table-list TTL
backend/app/agents/sql_agent.py           {dialect} in the SQL prompt; breakdown-by-quarter fix
backend/app/chat_agent.py                 SQL_DIALECT line in the prompt; tool text not SQLite-specific
backend/app/semantic/domains/medicare_sales/policy_rules.md        SOA hours rule, collect_set
backend/app/semantic/domains/medicare_sales/agents.md              compensation_siu, lead_quality
backend/app/semantic/domains/pharma_supply_chain/metrics.md        inline MKT
backend/app/semantic/domains/pharma_supply_chain/policy_rules.md   inline MKT, GROUP BY
backend/app/semantic/domains/pharma_supply_chain/agents.md         inline MKT, GROUP BY (x2)
backend/app/semantic/domains/healthcare_payer/prompts.md           "SQLite" removed
backend/demo/databricks_brain_check.py    NEW: compile every Brain statement on Databricks
```
