# Databricks MCP Agent — Windows Setup Guide

This guide walks through setting up and running `dbx_agent.py` on a Windows laptop (PowerShell). It covers Python, the Databricks CLI login, the environment variables the script needs, and how to run it.

## 1. Prerequisites

- Access to the Azure Databricks workspace: `https://adb-2213359196358168.8.azuredatabricks.net`
- The OpPal SQL Warehouse must be **running** (SQL Warehouses → OpPal SQL Warehouse → Start)
- VS Code with the project folder open (`oppal-enterprise`)
- A Gemini API key (optional; otherwise the script uses the Databricks Claude Sonnet 4.5 endpoint)

## 2. Python 3.12 virtual environment

Python 3.14 does not have prebuilt numpy wheels, so use Python 3.12. If `uv` is not installed, install it first:

```powershell
pip install uv
```

Then, from the `backend` folder, create and activate the venv:

```powershell
cd backend
python -m uv venv .venv312 --python 3.12
.venv312\Scripts\activate
python --version        # should print Python 3.12.x
python -m ensurepip --upgrade
python -m pip install --upgrade databricks-mcp databricks-sdk databricks-openai "mcp>=1.24,<2" openai
```

If an old `.venv` folder gives "Access is denied", just ignore it and use the new `.venv312` name as above.

## 3. Databricks CLI login (OAuth, no token needed)

Install the CLI. If winget reports a Microsoft Store source error, add `--source winget`:

```powershell
winget install Databricks.DatabricksCLI --source winget
```

Close and reopen the terminal (or restart VS Code), re-activate the venv, then confirm:

```powershell
databricks --version
```

Windows may block writes to `C:\Users\<you>\.databrickscfg` and to `Documents`. To avoid that, point the CLI at a config file inside the project folder, then log in:

```powershell
$env:DATABRICKS_CONFIG_FILE = "$PWD\databrickscfg"
databricks auth login --host https://adb-2213359196358168.8.azuredatabricks.net
```

When prompted for the profile name, type `DEFAULT`. A browser window opens for Azure sign-in. You should see `Profile DEFAULT was successfully saved`.

Verify the login works:

```powershell
databricks current-user me
```

## 4. Environment variables (every new terminal session)

These variables are lost when the terminal closes, so set them each time. Run from the project root (`oppal-enterprise`) with `.venv312` activated:

```powershell
$env:DATABRICKS_CONFIG_FILE = "C:\Users\<your-username>\Downloads\oppal-enterprise\oppal-enterprise\backend\databrickscfg"
$env:MCP_SERVER_URL = "https://adb-2213359196358168.8.azuredatabricks.net/api/2.0/mcp/sql"
$env:DATA_SCHEMA = "altitansandbox.altitan"
$env:GEMINI_API_KEY = "<your-gemini-key>"     # optional
```

What each one does:

- `DATABRICKS_CONFIG_FILE` — absolute path to the config file written by `databricks auth login`. Use the absolute path to avoid a doubled `backend\backend` path.
- `MCP_SERVER_URL` — the managed SQL MCP endpoint. This is required: the default `system.ai.dbsql` service name does not resolve on this workspace.
- `DATA_SCHEMA` — the catalog.schema holding the tables. `altitansandbox.oppal` only contains volumes; the tables (e.g. enrollment) are in `altitansandbox.altitan`.
- `GEMINI_API_KEY` — if set, the model runs on Gemini via its OpenAI-compatible API; otherwise it uses `databricks-claude-sonnet-4-5`.

Tip: save the four lines above into a `setup.ps1` file and run `.\setup.ps1` at the start of each session.

## 5. Run the agent

From the project root:

```powershell
python dbx_agent.py "Are there regions with low average enrolled lives?"
python dbx_agent.py "Which region has the highest claim denial rates?" --verbose
```

`--verbose` prints every tool call and result.

## 6. Troubleshooting

- **No module named 'databricks'** — the wrong venv is active. Run `backend\.venv312\Scripts\activate`.
- **Script named databricks.py** — never name the script `databricks.py`; it shadows the SDK package. Keep it as `dbx_agent.py` and delete any `__pycache__` folder.
- **cannot configure default credentials** — `DATABRICKS_CONFIG_FILE` is unset or points to the wrong path. Check the path in the error message.
- **MCP service 'system.ai.dbsql' does not exist** — `MCP_SERVER_URL` is not set. Set it as in section 4.
- **Error listing tools from MCP server** — check the SQL warehouse is running and re-run with `--verbose` to see the underlying error.
- **Agent says the schema is empty** — `DATA_SCHEMA` points at a schema with only volumes. Use `altitansandbox.altitan`.
- **databricks not recognized after install** — restart the shell or VS Code so PATH refreshes.
- **Test the MCP endpoint directly** — create `req.json` containing `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` and run `databricks api post /api/2.0/mcp/sql --json "@req.json"`. It should list `execute_sql`, `execute_sql_read_only` and `poll_sql_result`.
