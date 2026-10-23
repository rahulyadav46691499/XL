"""Streamlit chat UI for the SQL agent. Run: streamlit run app.py"""

import json
import uuid

import pandas as pd
import streamlit as st

from agent import (
    DB_PATH, agent, build_input, chart_types_for, edit_spec, run_query, spec_error, sql_db_list_tables,
)

PALETTES = ["tableau10", "category10", "set2", "dark2", "pastel1", "accent", "paired"]

st.set_page_config(page_title="SQL Agent", page_icon="🗄️")
st.title("🗄️ SQL Agent")


def new_chat():
    st.session_state.messages = []
    # The agent's memory of this chat (messages + SQLAgentState fields) lives under this id in its checkpointer.
    st.session_state.thread_id = uuid.uuid4().hex
    # State changes made outside the agent (chart edits, SQL editor runs) ride along with the next question.
    st.session_state.pending = {"charts": {}, "user_queries": []}


if "messages" not in st.session_state:
    new_chat()


def run_sql():
    """Run the SQL editor's query directly, without the model, and post the result in the chat."""
    sql = st.session_state.sql_editor.strip()
    if not sql:
        return
    st.session_state.messages.append({"role": "user", "content": f"```sql\n{sql}\n```"})
    try:
        columns, rows = run_query(sql)
    except Exception as e:
        st.session_state.messages.append({"role": "assistant", "content": f"Error: {e}"})
        return
    st.session_state.messages.append(
        {"role": "assistant", "content": f"{len(rows)} rows", "table": {"columns": columns, "rows": rows}}
    )
    st.session_state.pending["user_queries"].append(f"{sql}\n-- returned {len(rows)} rows, columns {columns}")


def open_in_editor(sql):
    st.session_state.sql_editor = sql


def apply_edit(chart, widget_key, option):
    """Apply one Customize control to a chart and queue its new version for the agent's state."""
    spec = edit_spec(chart["spec"], **{option: st.session_state[widget_key]})
    # Streamlit silently keeps the old chart when a spec is invalid, so check before applying.
    if spec_error(spec, chart["columns"]):
        st.toast("That change doesn't work for this chart. Ask for it in the chat instead.")
        return
    chart["spec"] = spec
    st.session_state.pending["charts"][chart["chart_id"]] = {"query": chart["query"], "spec": spec}


with st.sidebar:
    st.subheader(f"Database: {DB_PATH.name}")
    st.caption(sql_db_list_tables.invoke({}))
    st.button("Clear chat", on_click=new_chat)
    st.subheader("SQL editor")
    st.text_area("Write a query, run it, change it, run it again.", key="sql_editor", height=180)
    st.button("Run SQL", on_click=run_sql, type="primary")


def render_step(step, key):
    kind, name, body = step
    if kind == "result":
        st.code(body, language="text")
        return
    st.markdown(f"🔧 **{name}**")
    if "query" in body:
        st.code(body["query"], language="sql")
        st.button("Edit in SQL editor", key=key, on_click=open_in_editor, args=(body["query"],))
    if rest := {k: v for k, v in body.items() if k != "query"}:
        st.code(json.dumps(rest, indent=2), language="json")


def render_chart(chart, key):
    st.vega_lite_chart(pd.DataFrame(chart["rows"], columns=chart["columns"]), chart["spec"], width="stretch")
    spec = chart["spec"]
    if "mark" not in spec or "encoding" not in spec:
        return  # layered or faceted chart: customize it by asking in the chat
    mark = spec["mark"] if isinstance(spec["mark"], dict) else {"type": spec["mark"]}
    with st.popover("🎨 Customize"):
        title = spec.get("title", "")
        st.text_input("Title", title if isinstance(title, str) else title.get("text", ""),
                      key=f"{key}-title", on_change=apply_edit, args=(chart, f"{key}-title", "title"))
        if len(types := chart_types_for(spec)) > 1:
            st.selectbox("Chart type", types, format_func=lambda t: "pie" if t == "arc" else t,
                         key=f"{key}-type", on_change=apply_edit, args=(chart, f"{key}-type", "chart_type"))
        if "color" in spec["encoding"]:
            st.selectbox("Color palette", PALETTES, index=None, placeholder="Choose a palette",
                         key=f"{key}-scheme", on_change=apply_edit, args=(chart, f"{key}-scheme", "scheme"))
        else:
            st.color_picker("Color", mark.get("color", "#0068c9"),
                            key=f"{key}-color", on_change=apply_edit, args=(chart, f"{key}-color", "color"))


def render_results(message, i):
    for j, chart in enumerate(message.get("charts", [])):
        render_chart(chart, f"chart-{i}-{j}")
    if table := message.get("table"):
        st.dataframe(pd.DataFrame(table["rows"], columns=table["columns"]))


for i, m in enumerate(st.session_state.messages):
    with st.chat_message(m["role"]):
        if m.get("steps"):
            with st.expander("Agent steps"):
                for j, step in enumerate(m["steps"]):
                    render_step(step, f"step-{i}-{j}")
        st.markdown(m["content"])
        render_results(m, i)

if prompt := st.chat_input("Ask a question about the database"):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    i = len(st.session_state.messages)  # index the assistant's message will get
    with st.chat_message("assistant"):
        # The checkpointer remembers the conversation, so only the new question (plus queued state changes) is sent.
        config = {"configurable": {"thread_id": st.session_state.thread_id}}
        message = {"role": "assistant", "content": "", "steps": [], "table": None, "charts": []}
        with st.status("Thinking...", expanded=True) as status:
            for update in agent.stream(build_input(prompt, **st.session_state.pending), config, stream_mode="updates"):
                for node in update.values():
                    for msg in (node or {}).get("messages", []):
                        if msg.type == "tool":
                            new = [("result", msg.name, str(msg.content)[:2000])]
                            # Keep the last multi-row result; single rows are already fully in the model's answer.
                            if msg.name == "sql_db_query" and msg.artifact and len(msg.artifact["rows"]) > 1:
                                message["table"] = msg.artifact
                            if msg.name == "create_chart" and msg.artifact:
                                message["charts"].append(msg.artifact)
                        elif msg.tool_calls:
                            new = [("call", tc["name"], tc["args"]) for tc in msg.tool_calls]
                        else:
                            message["content"], new = msg.text, []
                        for step in new:
                            render_step(step, f"step-{i}-{len(message['steps'])}")
                            message["steps"].append(step)
            status.update(label=f"Done · {len(message['steps'])} steps", state="complete", expanded=False)
        st.session_state.pending = {"charts": {}, "user_queries": []}
        st.markdown(message["content"])
        render_results(message, i)
    st.session_state.messages.append(message)
