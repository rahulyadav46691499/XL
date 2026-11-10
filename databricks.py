"""Ask a question on the command line; an agent answers it using Databricks MCP tools.

Usage:
    python app.py "How many customers"
    python app.py "How many customers" --verbose     # also show each tool call

Setup (once):
    pip install --upgrade databricks-mcp databricks-sdk databricks-openai "mcp>=1.24,<2"
    databricks auth login --host https://<workspace-hostname> --profile DEFAULT

Optional environment variables:
    MCP_SERVER       MCP service name, <catalog>.<schema>.<service>   (default: system.ai.dbsql)
    MCP_SERVER_URL   Full MCP URL; overrides MCP_SERVER (e.g. a Genie space or Databricks App)
    GEMINI_API_KEY   If set, the model is Gemini instead of a Databricks endpoint
    MODEL_ENDPOINT   Model name (default: gemini-3.6-flash with GEMINI_API_KEY,
                     otherwise databricks-claude-sonnet-4-5)
"""

import json
import os
import sys

from databricks.sdk import WorkspaceClient
from databricks_openai import DatabricksOpenAI, McpServerToolkit
from openai import OpenAI

WORKSPACE_ID = "7474657117851889"  # for reference; the host comes from your CLI login

# Model: if GEMINI_API_KEY is set, use Gemini through its OpenAI-compatible API.
# Otherwise use a Databricks model serving endpoint.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
if GEMINI_API_KEY:
    MODEL_ENDPOINT = os.getenv("MODEL_ENDPOINT", "gemini-3.6-flash")
else:
    MODEL_ENDPOINT = os.getenv("MODEL_ENDPOINT", "databricks-claude-sonnet-4-5")
MCP_SERVER = os.getenv("MCP_SERVER", "system.ai.dbsql")
MAX_TOOL_ROUNDS = 10

# Where the data lives: <catalog>.<schema> and the tables in it.
DATA_SCHEMA = os.getenv("DATA_SCHEMA", "workspace.oppal")
DATA_TABLES = os.getenv("DATA_TABLES", "agent_certifications,agent_commissions,claims").split(",")

SYSTEM_PROMPT = (
    "You are a data assistant. Answer the user's question by calling the available "
    f"tools. The data is in the Unity Catalog schema `{DATA_SCHEMA}`, in these tables: "
    + ", ".join(f"`{DATA_SCHEMA}.{t.strip()}`" for t in DATA_TABLES)
    + ". Always use fully qualified table names. Before writing a query, inspect the "
    "columns of the table you plan to use (DESCRIBE TABLE) instead of guessing them. "
    "Run read-only queries only; never modify data. If none of these tables can "
    "answer the question, say so and say what the tables do contain. Reply with a "
    "short, direct answer that includes the number or result and names the table "
    "and column you used."
)


def log(verbose: bool, *parts) -> None:
    if verbose:
        print(*parts, file=sys.stderr)


def ask(question: str, verbose: bool = False) -> str:
    # Uses the DEFAULT profile created by `databricks auth login`.
    workspace_client = WorkspaceClient()
    host = workspace_client.config.host.rstrip("/")
    server_url = os.getenv("MCP_SERVER_URL") or f"{host}/ai-gateway/mcp-services/{MCP_SERVER}"
    log(verbose, f"[workspace] {host}\n[mcp]       {server_url}\n[model]     {MODEL_ENDPOINT}")

    toolkit = McpServerToolkit(url=server_url, workspace_client=workspace_client)
    tools_by_name = {tool.name: tool for tool in toolkit.get_tools()}
    if not tools_by_name:
        raise RuntimeError(f"No tools found at {server_url}. Check the URL and your access.")
    log(verbose, f"[tools]     {', '.join(tools_by_name)}")

    if GEMINI_API_KEY:
        model_client = OpenAI(api_key=GEMINI_API_KEY, base_url=GEMINI_BASE_URL)
    else:
        model_client = DatabricksOpenAI(workspace_client=workspace_client)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]

    for _ in range(MAX_TOOL_ROUNDS):
        response = model_client.chat.completions.create(
            model=MODEL_ENDPOINT,
            messages=messages,
            tools=[tool.spec for tool in tools_by_name.values()],
        )
        message = response.choices[0].message
        messages.append(message.model_dump(exclude_none=True))

        if not message.tool_calls:  # no more tools needed: this is the answer
            return message.content or ""

        for call in message.tool_calls:
            try:
                tool = tools_by_name.get(call.function.name)
                if tool is None:
                    raise ValueError(f"Unknown tool: {call.function.name}")
                arguments = json.loads(call.function.arguments or "{}")
                if not isinstance(arguments, dict):
                    raise ValueError("Tool arguments must be a JSON object.")
                output = tool.execute(**arguments)
            except Exception as error:  # hand the error back so the model can recover
                output = json.dumps({"error": str(error)})
            log(verbose, f"[tool call] {call.function.name}({call.function.arguments})")
            log(verbose, f"[tool out]  {str(output)[:500]}")
            messages.append({"role": "tool", "tool_call_id": call.id, "content": str(output)})

    raise RuntimeError("The agent reached the tool-calling limit without an answer.")


def main() -> None:
    args = [a for a in sys.argv[1:] if a not in ("--verbose", "-v")]
    verbose = len(args) != len(sys.argv) - 1
    if not args:
        print('Usage: python app.py "How many customers" [--verbose]')
        sys.exit(1)
    print(ask(" ".join(args), verbose=verbose))


if __name__ == "__main__":
    main()
