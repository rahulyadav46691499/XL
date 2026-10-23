"""SQL agent backend, following https://docs.langchain.com/oss/python/langchain/sql-agent"""

import copy
import json
import operator
import os
import pathlib
import sqlite3
from typing import Annotated

import altair as alt
from dotenv import load_dotenv
from langchain.agents import AgentState, create_agent
from langchain.agents.middleware import ModelRequest, dynamic_prompt
from langchain.chat_models import init_chat_model
from langchain.messages import ToolMessage
from langchain.tools import ToolRuntime, tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

load_dotenv()

DB_PATH = pathlib.Path(__file__).with_name("oppal.db")

# schema_notes.md: text before the first "## " heading goes into the system prompt;
# each "## <table>" section is returned by sql_db_schema alongside that table's schema.
GENERAL_NOTES, *_sections = pathlib.Path(__file__).with_name("schema_notes.md").read_text().split("\n## ")
TABLE_NOTES = {s.split("\n", 1)[0].strip(): "## " + s.strip() for s in _sections}

model = init_chat_model(
    f"google_genai:{os.getenv('GEMINI_MODEL', 'gemini-3.7-flash')}",
    api_key=os.environ["GEMINI_API_KEY"],
)


def _connect():
    # Read-only connection: the database itself rejects any INSERT/UPDATE/DELETE/DROP the model writes.
    return sqlite3.connect(f"{DB_PATH.as_uri()}?mode=ro", uri=True)


@tool
def sql_db_list_tables() -> str:
    """Input is an empty string, output is a comma-separated list of tables in the database."""
    con = _connect()
    try:
        cursor = con.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [row[0] for row in cursor.fetchall() if not row[0].startswith("sqlite_")]
        return ", ".join(tables)
    finally:
        con.close()


@tool
def sql_db_schema(table_names: str) -> str:
    """Input to this tool is a comma-separated list of tables, output is the schema and sample rows for those tables.
    Be sure that the tables actually exist by calling sql_db_list_tables first!
    Example Input: table1, table2, table3"""
    con = _connect()
    try:
        cursor = con.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        valid_tables = {row[0] for row in cursor.fetchall() if not row[0].startswith("sqlite_")}
        results = []
        for table in table_names.split(","):
            table = table.strip()
            if table not in valid_tables:
                results.append(f"Error: table_names {{{table!r}}} not found in database")
                continue
            cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?;", (table,))
            schema_row = cursor.fetchone()
            if schema_row:
                results.append(schema_row[0])
                try:
                    quoted_table = '"' + table.replace('"', '""') + '"'
                    cursor.execute(f"SELECT * FROM {quoted_table} LIMIT 3;")
                    rows = cursor.fetchall()
                    if rows:
                        col_names = [description[0] for description in cursor.description]
                        results.append(
                            f"/*\n3 rows from {table} table:\n"
                            + "\t".join(col_names)
                            + "\n"
                            + "\n".join("\t".join(str(x) for x in row) for row in rows)
                            + "\n*/"
                        )
                except Exception as e:
                    results.append(f"Error fetching sample rows: {e}")
                if table in TABLE_NOTES:
                    results.append(f"Column notes:\n{TABLE_NOTES[table]}")
        return "\n\n".join(results)
    finally:
        con.close()


MAX_ROWS = 100_000


def _merge(old: dict, new: dict) -> dict:
    return {**old, **new}


class SQLAgentState(AgentState):
    """What the agent remembers in a conversation, besides the messages."""

    # chart_id -> {"query", "spec"}: the latest version of every chart drawn, including the user's edits
    # from the Customize controls. A new chart adds a key; an edit replaces that chart's entry.
    charts: Annotated[dict[str, dict], _merge]
    # SQL the user ran themselves in the SQL editor (newest last), so follow-up questions can build on it.
    user_queries: Annotated[list[str], operator.add]


def run_query(query):
    con = _connect()
    try:
        cursor = con.cursor()
        cursor.execute(query)
        # ponytail: MAX_ROWS guards the UI against a runaway join; raise it if real results get bigger
        rows = cursor.fetchmany(MAX_ROWS)
        return [d[0] for d in cursor.description or []], rows
    finally:
        con.close()


@tool(response_format="content_and_artifact")
def sql_db_query(query: str) -> tuple[str, dict | None]:
    """Input to this tool is a detailed and correct SQL query, output is a result from the database.
    If the query is not correct, an error message will be returned.
    If an error is returned, rewrite the query, check the query, and try again.
    If you encounter an issue with Unknown column 'xxxx' in 'field list', use sql_db_schema to query the correct table fields.
    You only see the row count, the column names and the first row. The user sees every row as a table under
    your answer, so never list the rows or try to fetch more of them (e.g. json_group_array, group_concat, extra
    queries with smaller limits); describe the result and refer the user to the table."""
    try:
        columns, rows = run_query(query)
    except Exception as e:
        return f"Error: {e}", None
    # Only the first row goes to the model; the full result rides in the ToolMessage artifact for the UI.
    content = f"{len(rows)}{'+' if len(rows) == MAX_ROWS else ''} rows. Columns: {columns}."
    if rows:
        # 500-char cut stops a packed row (json_group_array etc.) from smuggling the whole result to the model.
        content += f" First row: {str(rows[0])[:500]}."
    if len(rows) > 1:
        content += " The full result is shown to the user as a table."
    return content, {"columns": columns, "rows": rows}


def _spec_values(node, key):
    """Every string value stored under `key` anywhere in a Vega-Lite spec."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key:
                yield from (x for x in (v if isinstance(v, list) else [v]) if isinstance(x, str))
            yield from _spec_values(v, key)
    elif isinstance(node, list):
        for v in node:
            yield from _spec_values(v, key)


def spec_error(spec: dict, columns: list[str]) -> str | None:
    """Why this Vega-Lite spec can't draw a query result with these columns, or None if it can."""
    try:
        alt.TopLevelSpec.from_dict({**spec, "data": {"values": []}})  # validate against the Vega-Lite schema
    except Exception as e:
        return str(e)[:500]
    # A field that isn't a query column (or created by a transform's "as") would silently draw an empty chart.
    missing = set(_spec_values(spec, "field")) - set(columns) - set(_spec_values(spec, "as"))
    if missing:
        return f"fields {sorted(missing)} are not query columns {columns}."
    return None


@tool
def create_chart(query: str, spec: dict, runtime: ToolRuntime) -> Command | str:
    """Draw a chart for the user. Use this whenever the user asks for a chart, graph, plot or visualization,
    and also to change an existing chart (call it again with that chart's query and an edited spec).
    query: a SQL query whose result feeds the chart. Give every computed column a simple alias
    (e.g. SUM(paid_amount) AS total_paid) and check the query with sql_db_query_checker first.
    spec: a Vega-Lite spec WITHOUT "data"; the query result is attached automatically. Refer to the query's
    column names in "field". Example:
    {"mark": "bar", "title": "Paid amount by region",
     "encoding": {"x": {"field": "region", "type": "nominal"}, "y": {"field": "total_paid", "type": "quantitative"}}}
    Any Vega-Lite chart works: bar, line, area, point, arc (pie/donut), rect (heatmap), boxplot, layered and faceted.
    If an error is returned, fix the query or spec and call this tool again."""
    try:
        columns, rows = run_query(query)
    except Exception as e:
        return f"Error in query: {e}"
    if not rows:
        return "Error: the query returned 0 rows, so there is nothing to chart."
    spec = {k: v for k, v in spec.items() if k != "data"}
    if error := spec_error(spec, columns):
        return f"Error in spec: {error}"
    chart_id = f"chart_{runtime.tool_call_id[-6:]}"
    chart = {"query": query, "spec": spec}
    return Command(update={
        "charts": {chart_id: chart},
        "messages": [ToolMessage(
            f"Chart {chart_id} created from {len(rows)} rows (columns {columns}). It is shown under your answer.",
            name="create_chart",
            tool_call_id=runtime.tool_call_id,
            # The rows go to the UI only, like sql_db_query's artifact.
            artifact={"chart_id": chart_id, **chart, "columns": columns, "rows": rows},
        )],
    })


CHART_TYPES = ["bar", "line", "area", "point"]
# Encoding properties that mean the same on every channel; axis, sort, scale and legend don't carry over.
_PORTABLE = ("field", "type", "aggregate", "timeUnit", "title")


def _move(encoding: dict, src: str, dst: str):
    encoding[dst] = {k: v for k, v in encoding.pop(src).items() if k in _PORTABLE}


def chart_types_for(spec: dict) -> list[str]:
    """Chart types the Customize control can switch this spec to, current type first ("arc" = pie)."""
    encoding = spec["encoding"]
    current = spec["mark"]["type"] if isinstance(spec["mark"], dict) else spec["mark"]
    if current == "arc":
        others = CHART_TYPES if {"theta", "color"} <= encoding.keys() else []
    else:
        # A pie has only two slots, so it needs exactly one category (x) and one value (y).
        others = CHART_TYPES + (["arc"] if {"x", "y"} <= encoding.keys() and "color" not in encoding else [])
    return [current] + [t for t in others if t != current]


def edit_spec(spec: dict, title: str | None = None, chart_type: str | None = None,
              color: str | None = None, scheme: str | None = None) -> dict:
    """A copy of a single-view Vega-Lite spec with one Customize control's change applied."""
    spec = copy.deepcopy(spec)
    mark = spec["mark"] if isinstance(spec["mark"], dict) else {"type": spec["mark"]}
    encoding = spec["encoding"]
    if title is not None:
        spec["title"] = title
    if chart_type and chart_type != mark["type"]:
        if chart_type == "arc":  # pie: the value sets each slice's angle, the category its color
            horizontal = encoding["x"].get("type") == "quantitative" != encoding["y"].get("type")
            value, category = ("x", "y") if horizontal else ("y", "x")
            _move(encoding, value, "theta")
            _move(encoding, category, "color")
        elif mark["type"] == "arc":
            _move(encoding, "theta", "y")
            _move(encoding, "color", "x")
        mark["type"] = chart_type
    if color:
        mark["color"] = color  # single-series charts
    if scheme:
        encoding["color"]["scale"] = {**encoding["color"].get("scale", {}), "scheme": scheme}  # one color per category
    spec["mark"] = mark
    return spec


@tool
def sql_db_query_checker(query: str) -> str:
    """Use this tool to double check if your query is correct before executing it.
    Always use this tool before executing a query with sql_db_query!"""
    trigger_prompt = """{query}
Double check the sqlite query above for common mistakes, including:
- Using NOT IN with NULL values
- Using UNION when UNION ALL should have been used
- Using BETWEEN for exclusive ranges
- Data type mismatch in predicates
- Properly quoting identifiers
- Using the correct number of arguments for functions
- Casting to the correct data type
- Using the proper columns for joins

If there are any of the above mistakes, rewrite the query. If there are no mistakes, just reproduce the original query.

Output the final SQL query only.

SQL Query: """.format(query=query)

    response = model.invoke(trigger_prompt)
    return response.text.strip()


tools = [sql_db_list_tables, sql_db_schema, sql_db_query, sql_db_query_checker, create_chart]

system_prompt = """
You are an agent designed to interact with a SQL database.
Given an input question, create a syntactically correct {dialect} query to run,
then look at the results of the query and return the answer.

You can order the results by a relevant column to return the most interesting
examples in the database. Never query for all the columns from a specific table,
only ask for the relevant columns given the question.

You MUST double check your query before executing it. If you get an error while
executing a query, rewrite the query and try again.

DO NOT make any DML statements (INSERT, UPDATE, DELETE, DROP etc.) to the
database.

To start you should ALWAYS look at the tables in the database to see what you
can query. Do NOT skip this step.

Then you should query the schema of the most relevant tables.
""".format(dialect="sqlite") + "\n" + GENERAL_NOTES



@dynamic_prompt
def sql_agent_prompt(request: ModelRequest) -> str:
    """The system prompt plus what this conversation's state holds: charts drawn so far and the user's own SQL."""
    prompt = system_prompt
    # ponytail: every chart's spec goes into each prompt; list only the last few if chats get long.
    if charts := request.state.get("charts"):
        prompt += (
            "\n\nCURRENT versions of the charts in this conversation. The user may have changed a chart with the "
            "app's Customize controls after you drew it (chart type, colors, title), so these can differ from your "
            "earlier create_chart calls, and they override them. To change a chart, call create_chart with its query "
            "and an edited copy of the spec below, keeping everything the user didn't ask to change:\n"
            + "\n".join(f"- {chart_id}: {json.dumps(chart)}" for chart_id, chart in charts.items())
        )
    if queries := request.state.get("user_queries"):
        prompt += "\n\nSQL the user ran themselves in the SQL editor, newest last:\n" + "\n\n".join(queries[-3:])
    return prompt


def build_input(question: str, charts: dict, user_queries: list[str]) -> dict:
    """Agent input for one question, carrying the state changes the user made in the app since the last one."""
    messages = [{"role": "user", "content": question}]
    if charts:
        # The edit must also show up in the conversation: told only through the prompt, the model keeps
        # copying its own earlier create_chart call.
        note = f"(I changed {', '.join(charts)} with the app's Customize controls; the current version is in your instructions.)"
        messages.insert(0, {"role": "user", "content": note})
    return {"messages": messages, "charts": charts, "user_queries": user_queries}


agent = create_agent(
    model,
    tools,
    state_schema=SQLAgentState,
    middleware=[sql_agent_prompt],
    # ponytail: in-memory, so conversations (including result rows inside tool artifacts) vanish on restart;
    # use a SqliteSaver/PostgresSaver to keep them.
    checkpointer=InMemorySaver(),
    # Seeing only the first row, the model sometimes runs extra probing queries; 25 steps (the default) isn't enough.
).with_config(recursion_limit=50)


if __name__ == "__main__":
    assert "readonly" in sql_db_query.invoke({"query": "DELETE FROM users"}), "DB must be read-only"
    assert set(TABLE_NOTES) <= set(sql_db_list_tables.invoke({}).split(", ")), "notes heading doesn't match a table"
    assert "Column notes:\n## claims" in sql_db_schema.invoke({"table_names": "claims"})
    msg = sql_db_query.invoke({"name": "sql_db_query", "args": {"query": "SELECT claim_id FROM claims"}, "id": "t", "type": "tool_call"})
    assert msg.content.startswith("31317 rows") and "C-0000002" not in msg.content, "model must see only the first row"
    assert len(msg.artifact["rows"]) == 31317, "artifact must carry every row"
    packed = sql_db_query.invoke({"query": "SELECT group_concat(claim_id) FROM claims"})
    assert len(packed) < 700, "a packed row must not reach the model in full"
    from types import SimpleNamespace

    chart_q = "SELECT region, SUM(paid_amount) AS total_paid FROM claims GROUP BY region"
    bar = {"mark": "bar", "encoding": {"x": {"field": "region", "type": "nominal"}, "y": {"field": "total_paid", "type": "quantitative"}}}
    command = create_chart.func(chart_q, bar, SimpleNamespace(tool_call_id="call_abc123"))
    assert command.update["charts"] == {"chart_abc123": {"query": chart_q, "spec": bar}}, "chart must be saved in state"
    assert len(command.update["messages"][0].artifact["rows"]) == 5, "chart rows go to the UI artifact"
    typo = {**bar, "encoding": {**bar["encoding"], "y": {"field": "paid", "type": "quantitative"}}}
    assert "['paid'] are not query columns" in create_chart.func(chart_q, typo, None)
    assert create_chart.func(chart_q, {**bar, "mark": "barz"}, None).startswith("Error in spec")

    assert chart_types_for(bar) == ["bar", "line", "area", "point", "arc"]
    pie = edit_spec(bar, chart_type="arc")
    assert set(pie["encoding"]) == {"theta", "color"} and chart_types_for(pie)[0] == "arc"
    assert edit_spec(pie, chart_type="bar")["encoding"] == bar["encoding"], "pie -> bar must restore the axes"
    assert edit_spec(pie, scheme="set2")["encoding"]["color"]["scale"]["scheme"] == "set2"
    red = edit_spec(bar, color="#ff0000", title="Paid")
    assert red["mark"] == {"type": "bar", "color": "#ff0000"} and red["title"] == "Paid" and bar["mark"] == "bar"
    # Specs the model writes carry axis/sort settings that a pie's slots reject.
    real = {"mark": {"type": "bar", "tooltip": True}, "encoding": {
        "x": {"field": "region", "type": "nominal", "sort": "-y", "axis": {"labelAngle": 0}},
        "y": {"field": "total_paid", "type": "quantitative", "title": "Paid"}}}
    real_pie = edit_spec(real, chart_type="arc")
    sideways = {**real, "encoding": {"x": real["encoding"]["y"], "y": real["encoding"]["x"]}}
    assert edit_spec(sideways, chart_type="arc")["encoding"]["theta"]["field"] == "total_paid", "horizontal bars: value -> angle"
    for edited in (pie, red, real_pie, edit_spec(real_pie, chart_type="line"), edit_spec(real_pie, scheme="dark2")):
        assert spec_error(edited, ["region", "total_paid"]) is None, edited

    assert len(build_input("q", {}, [])["messages"]) == 1
    assert "chart_x" in build_input("q", {"chart_x": {}}, [])["messages"][0]["content"], "UI edits must be noted in the chat"

    result = agent.invoke(
        {"messages": [{"role": "user", "content": "How many claims are there?"}]},
        {"configurable": {"thread_id": "self-check"}},
    )
    print(result["messages"][-1].text)
