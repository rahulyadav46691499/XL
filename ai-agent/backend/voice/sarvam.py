"""Every Sarvam call this package makes, exactly as docs.sarvam.ai documents them.

Voice Agents API (auth: `X-API-Key`, docs.sarvam.ai/voice-agents/api/introduction):
  - place_call      POST apps.sarvam.ai/api/outbounds/v1/orgs/{org}/workspaces/{ws}/outbounds
                    (Instant Outbound; result arrives later on our webhook)
  - add_known_caller POST apps.sarvam.ai/api/scheduling/v1/orgs/{org}/workspaces/{ws}/
                    deployments/{dep}/cohorts/upload (api/deployments/cohorts/upload)
  - find_attempt    GET  apps.sarvam.ai/api/analytics/v1/{org}/{ws}/{app}/attempts
                    (fallback when the webhook never arrives)
  - inbound_attempts GET the same, filtered to channel_direction=inbound (callbacks)
  - all_attempts    GET the same, unfiltered and paged (what the account spent)
  - transcript      GET  .../{app}/transcripts/{interaction_id}
  - recording       GET  .../{app}/recordings/{interaction_id}   -> audio/wav

Model API (auth: `api-subscription-key`, docs.sarvam.ai/api-reference/text-to-speech/convert):
  - preview_wav     POST api.sarvam.ai/text-to-speech with bulbul:v4-flash

Kept to plain functions over httpx so check.py can swap `_client` for a fake.
"""
import asyncio
import base64
import csv
import io
import json
import os
from datetime import datetime, timedelta, timezone

import httpx

OUTBOUNDS = "https://apps.sarvam.ai/api/outbounds/v1/orgs/{org}/workspaces/{ws}/outbounds"
KNOWN_CALLERS = ("https://apps.sarvam.ai/api/scheduling/v1/orgs/{org}/workspaces/{ws}"
                 "/deployments/{dep}/cohorts/upload")
ANALYTICS = "https://apps.sarvam.ai/api/analytics/v1/{org}/{ws}/{app}"
TTS = "https://api.sarvam.ai/text-to-speech"
# Seconds before the second and third try of a dial Sarvam turned away for now.
RETRY_WAITS = (1, 4)


class SarvamError(RuntimeError):
    pass


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _va_headers() -> dict:
    return {"X-API-Key": env("SARVAM_VOICE_AGENTS_API_KEY")}


def _analytics() -> str:
    return ANALYTICS.format(org=env("SARVAM_ORG_ID"), ws=env("SARVAM_WORKSPACE_ID"),
                            app=env("SARVAM_AGENT_ID"))


def _client() -> httpx.AsyncClient:
    # retries=2: httpx retries only a connection that never opened, which is
    # safe for every request here, a dial included.
    return httpx.AsyncClient(timeout=30, transport=httpx.AsyncHTTPTransport(retries=2))


def missing_config() -> list[str]:
    """What has to be in .env before a call can be placed."""
    need = ["SARVAM_VOICE_AGENTS_API_KEY", "SARVAM_ORG_ID", "SARVAM_WORKSPACE_ID",
            "SARVAM_AGENT_ID", "SARVAM_CONNECTION_ID", "SARVAM_AGENT_PHONE_NUMBER"]
    return [n for n in need if not env(n)]


def _raise_for(resp: httpx.Response, what: str) -> None:
    if resp.status_code >= 400:
        raise SarvamError(f"Sarvam {what} failed ({resp.status_code}): {resp.text[:300]}")


async def place_call(phone: str, app_version: int, agent_variables: dict, greeting: str,
                     webhook_url: str, metadata: dict) -> str:
    """Dial one candidate now, on a committed agent version. Returns Sarvam's attempt_id."""
    body = {
        "app_config": {
            "app_type": "agent",
            "app_id": env("SARVAM_AGENT_ID"),
            "app_version": app_version,
            "connection_config": {
                "connection_id": env("SARVAM_CONNECTION_ID"),
                "agent_phone_number": env("SARVAM_AGENT_PHONE_NUMBER"),
            },
            # The API's own wording: values are "any", but cohort rows take
            # strings only, so send strings and never find out the hard way.
            # The greeting rides as a variable too: the intro is "{{greeting}}",
            # and an outbound call speaks the intro, not initial_bot_message
            # (script.UNKNOWN_CALLER_GREETING says how that was found).
            "agent_variables": {**{k: str(v) for k, v in agent_variables.items()},
                                "greeting": greeting},
            "app_overrides": {"initial_bot_message": greeting},
        },
        "user_config": {"user_phone_number": phone},
    }
    if webhook_url:
        body["webhook_config"] = {"url": webhook_url, "metadata": metadata}
    # Sarvam's advice (deploy/with-code/recipes/instant): retry a 429 or 5xx
    # with backoff, never another 4xx, which fails the same way every time. Nor
    # a read timeout: the call may already be ringing, and a retry rings twice.
    async with _client() as client:
        for wait in (*RETRY_WAITS, None):
            resp = await client.post(
                OUTBOUNDS.format(org=env("SARVAM_ORG_ID"), ws=env("SARVAM_WORKSPACE_ID")),
                headers=_va_headers(), json=body,
            )
            if wait is None or (resp.status_code != 429 and resp.status_code < 500):
                break
            await asyncio.sleep(wait)
    _raise_for(resp, "outbound call")
    attempt_id = (resp.json() or {}).get("attempt_id")
    if not attempt_id:
        raise SarvamError(f"Sarvam outbound call returned no attempt_id: {resp.text[:300]}")
    return attempt_id


async def add_known_caller(name: str, phone: str, agent_variables: dict, greeting: str) -> str:
    """Put one candidate on the inbound deployment's known-caller list, so a call
    from their number starts with these variables and this greeting. Each call
    makes a new list (Sarvam has no update or delete for them). Returns its id.

    A one-row CSV upload, not the JSON stream endpoint: on 2026-10-17 stream
    refused every deployment record, even a bare phone number, with "User
    Identifier is not supported for deployments" (422), through the MCP too.
    """
    # One `greeting` column feeds both the variable the intro is made of and
    # the initial_bot_message override, as place_call sends both.
    agent_variables = {**agent_variables, "greeting": greeting}
    columns = ["phone", *agent_variables]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(columns)
    writer.writerow([phone, *(str(v) for v in agent_variables.values())])
    transformation = {
        "phone_number": {"column_name": "phone", "country_code": "IN"},
        "app_variables": {k: {"column_name": k} for k in agent_variables},
        "app_overrides": {"initial_bot_message": {"column_name": "greeting"}},
    }
    async with _client() as client:
        resp = await client.post(
            KNOWN_CALLERS.format(org=env("SARVAM_ORG_ID"), ws=env("SARVAM_WORKSPACE_ID"),
                                 dep=env("SARVAM_DEPLOYMENT_ID")),
            headers=_va_headers(), data={"name": name},
            files={"cohort_file": ("known_caller.csv", buf.getvalue().encode(), "text/csv"),
                   "cohort_transformation_file": ("transformation.json",
                                                  json.dumps(transformation).encode(),
                                                  "application/json")},
        )
    _raise_for(resp, "known-caller upload")
    return (resp.json() or {}).get("cohort_id", "")


async def inbound_attempts(since: datetime) -> list[dict]:
    """Every inbound call to the agent since `since`: the callbacks.
    `user_contact` on each is the caller's number, unmasked."""
    params = {
        "start_datetime": since.isoformat(timespec="seconds"),
        "end_datetime": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(timespec="seconds"),
        "filter_conditions": json.dumps(
            [{"field": "channel_direction", "operator": "equals", "value": "inbound"}]),
        "limit": 1000,
    }
    async with _client() as client:
        resp = await client.get(_analytics() + "/attempts", headers=_va_headers(), params=params)
    _raise_for(resp, "inbound call lookup")
    return (resp.json() or {}).get("items") or []


async def all_attempts(since: datetime) -> list[dict]:
    """Every attempt on the agent since `since`, connected or not, both
    directions, playground calls included: what the account was billed for.
    Paged at the API's maximum of 1000 (api/analytics/attempts)."""
    params = {
        "start_datetime": since.isoformat(timespec="seconds"),
        "end_datetime": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(timespec="seconds"),
        "limit": 1000, "offset": 0,
    }
    rows: list[dict] = []
    async with _client() as client:
        while True:
            resp = await client.get(_analytics() + "/attempts", headers=_va_headers(), params=params)
            _raise_for(resp, "usage lookup")
            page = resp.json() or {}
            rows += page.get("items") or []
            if not page.get("next_page_uri") or not page.get("items"):
                return rows
            params["offset"] += len(page["items"])


async def find_attempt(attempt_id: str, since: datetime) -> dict | None:
    """The analytics row for one attempt, or None if Sarvam has none yet.

    Tried as `attempt_id`, then as `job_id`: the docs file the id the outbound
    call returns under `attempt_id`, but the one live outbound call we have
    (2026-10-17) stored it as `job_id` with no `attempt_id` field at all, so a
    lookup by `attempt_id` alone never found it. The two are different fields,
    and Sarvam ANDs conditions across fields, hence two requests.
    """
    start = since - timedelta(minutes=5)
    end = datetime.now(timezone.utc) + timedelta(minutes=5)
    async with _client() as client:
        for field in ("attempt_id", "job_id"):
            params = {
                "start_datetime": start.isoformat(timespec="seconds"),
                "end_datetime": end.isoformat(timespec="seconds"),
                "filter_conditions": json.dumps(
                    [{"field": field, "operator": "equals", "value": attempt_id}]),
                "limit": 1,
            }
            resp = await client.get(_analytics() + "/attempts", headers=_va_headers(), params=params)
            _raise_for(resp, "attempt lookup")
            items = (resp.json() or {}).get("items") or []
            if items:
                return items[0]
    return None


async def transcript(interaction_id: str) -> list[dict]:
    """[{"role": "agent"|"user", "en_text": ...}] -- the webhook's own shape."""
    async with _client() as client:
        resp = await client.get(f"{_analytics()}/transcripts/{interaction_id}",
                                headers=_va_headers())
    _raise_for(resp, "transcript")
    return [{"role": "agent" if m.get("role") == "assistant" else "user",
             "en_text": m.get("content") or ""}
            for m in (resp.json() or {}).get("messages") or []]


async def recording(interaction_id: str) -> bytes | None:
    async with _client() as client:
        resp = await client.get(f"{_analytics()}/recordings/{interaction_id}",
                                headers=_va_headers())
    if resp.status_code == 404:
        return None
    _raise_for(resp, "recording")
    return resp.content


async def preview_wav(text: str, speaker: str) -> bytes:
    """A REST Bulbul v4 Flash clip of `speaker` reading `text`, for the HR picker."""
    async with _client() as client:
        resp = await client.post(TTS, headers={"api-subscription-key": env("SARVAM_API_KEY")}, json={
            "text": text,
            "language_code": "en-IN",
            "model": "bulbul:v4-flash",
            "speaker": speaker,
            # Not the call's 8 kHz: HR judges the voice on a laptop speaker.
            "speech_sample_rate": 24000,
            "enable_preprocessing": True,
        })
    _raise_for(resp, "voice preview")
    audios = (resp.json() or {}).get("audios") or []
    if not audios:
        raise SarvamError("Sarvam voice preview returned no audio")
    return base64.b64decode("".join(audios))
