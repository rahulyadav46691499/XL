"""How far a running upload has got, so the browser can name the current step.

An upload is one blocking POST — parse, LLM, embed, store — and the browser can
see none of it until the whole batch returns. Each stage writes its name here
and the frontend polls `GET /upload/{upload_id}/progress` while it waits.

The `upload_id` is minted by the frontend and sent with the files, so the
polling call needs nothing the browser doesn't already have.

Why not LangChain's event streaming: it can only report on the agent call.
Three of the four stages (liteparse, the similarity embedding, the Chroma
write) happen outside it, and streaming would mean turning a plain JSON
endpoint into a stream that every caller has to re-learn. Four `stage()` lines
say more, for less.

ponytail: a process-local dict — correct for one uvicorn worker, which is how
this runs. With `--workers N` a poll can land on a process that never saw the
upload and reads as "no progress yet"; move this to Redis if that day comes.
"""

import time

# In the order they happen. The frontend maps these to the words HR reads, so
# they are identifiers, not copy — append rather than rename.
STAGES = ("parsing", "checking", "analyzing", "embedding", "storing", "done")

# upload_id -> {"total": int, "done": int, "stage": str, "updated": float}
_RUNS: dict[str, dict] = {}

# Entries are dropped by the next upload rather than on a timer — nothing here
# is worth a background task.
TTL_SECONDS = 900


def _prune() -> None:
    cutoff = time.time() - TTL_SECONDS
    for key in [k for k, run in _RUNS.items() if run["updated"] < cutoff]:
        del _RUNS[key]


def start_run(upload_id: str, total: int) -> None:
    """Begin tracking a run of `total` files. A blank id disables tracking."""
    if not upload_id:
        return
    _prune()
    _RUNS[upload_id] = {"total": total, "done": 0, "stage": STAGES[0], "updated": time.time()}


def stage(upload_id: str, name: str) -> None:
    """Name the step now running.

    Files in a batch are processed in parallel, so this is last-writer-wins: it
    reports what the batch is doing *now*, not a per-file breakdown nobody is
    reading four lines of.
    """
    run = _RUNS.get(upload_id)
    if run is None:
        return
    run["stage"] = name
    run["updated"] = time.time()


def finish_one(upload_id: str) -> None:
    """One file is completely stored."""
    run = _RUNS.get(upload_id)
    if run is None:
        return
    run["done"] += 1
    run["updated"] = time.time()
    if run["done"] >= run["total"]:
        run["stage"] = STAGES[-1]


def read(upload_id: str) -> dict:
    """What to tell the poller. Empty when nothing is known about this id."""
    run = _RUNS.get(upload_id)
    if run is None:
        return {}
    return {"total": run["total"], "done": run["done"], "stage": run["stage"]}


if __name__ == "__main__":
    # python3 progress.py
    start_run("u1", 2)
    assert read("u1") == {"total": 2, "done": 0, "stage": "parsing"}
    stage("u1", "analyzing")
    assert read("u1")["stage"] == "analyzing"
    finish_one("u1")
    assert read("u1")["done"] == 1 and read("u1")["stage"] == "analyzing"
    finish_one("u1")
    assert read("u1") == {"total": 2, "done": 2, "stage": "done"}

    # An untracked run must be inert, not an error: `upload_id` is optional and
    # every stage call still fires when a caller omits it.
    stage("", "parsing")
    finish_one("nope")
    assert read("nope") == {}

    _RUNS["old"] = {"total": 1, "done": 0, "stage": "parsing", "updated": time.time() - TTL_SECONDS - 1}
    start_run("u2", 1)
    assert "old" not in _RUNS, "stale runs are pruned when the next upload starts"

    print("progress: all checks passed")
