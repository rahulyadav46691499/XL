import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain.agents.middleware import dynamic_prompt, ModelRequest
from langgraph.checkpoint.memory import InMemorySaver
from output_parser import JDOutput, ResumeOutput
from vector_store import vector_store
from langchain_mistralai import ChatMistralAI
from langchain_google_genai import ChatGoogleGenerativeAI

load_dotenv()

CONFIG_PATH = Path(__file__).parent.parent / "llm_config.json"

# Default config used when no stored config exists.
#
# Gemini for everything here. Mistral stays configured, but the only thing that
# uses it now is the post-call communication score
# (`backend/interview_scoring.py`), which is pinned to it deliberately and is
# off every user-facing path — a Mistral outage should never again be able to
# fail a resume upload, which is what a 500 from their API did when parsing ran
# on it.
DEFAULT_CONFIG = {
    "providers": [
        {
            "id": "mistral",
            "name": "Mistral",
            "apiKey": os.environ.get("MISTRAL_API_KEY", ""),
            "models": [
                {"id": "mistral-medium-latest", "name": "Mistral Medium"},
                {"id": "mistral-small-latest", "name": "Mistral Small"},
                {"id": "ministral-8b-2512", "name": "Ministral 8B"},
            ],
        },
        {
            "id": "gemini",
            "name": "Gemini",
            "apiKey": os.environ.get("GEMINI_API_KEY", ""),
            "models": [
                {"id": "gemini-3.6-flash", "name": "Gemini 3.6 Flash"},
                {"id": "gemini-3.5-flash", "name": "Gemini 3.5 Flash"},
                {"id": "gemini-3.5-flash-lite", "name": "Gemini 3.5 Flash Lite"},
            ],
        },
    ],
    "activeParseProvider": "gemini",
    "activeParseModel": "gemini-3.6-flash",
    "activeChatProvider": "gemini",
    "activeChatModel": "gemini-3.6-flash",
}


def _load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            if cfg.get("providers"):
                return cfg
        except Exception:
            pass
    return DEFAULT_CONFIG


def _save_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def get_config() -> dict:
    return _load_config()


def save_config(cfg: dict) -> dict:
    _save_config(cfg)
    reload_llm_agents()
    return get_config()


@dataclass
class ChatContext:
    resume_uuid: str = ""


# Module-level LLM instances and agents, reloaded when config changes.
parse_llm = None
chat_llm = None
jd_agent = None
resume_agent = None
chatbot_agent = None


def _build_mistral(api_key: str, model: str):
    return ChatMistralAI(
        model=model,
        temperature=0,
        api_key=api_key,
        timeout=60,
        max_retries=2,
    )


def _build_gemini(api_key: str, model: str):
    return ChatGoogleGenerativeAI(
        model=model,
        temperature=0,
        api_key=api_key,
        timeout=60,
        max_retries=2,
    )


def reload_llm_agents():
    global parse_llm, chat_llm, jd_agent, resume_agent, chatbot_agent
    cfg = _load_config()

    def provider_for(provider_id: str):
        for p in cfg.get("providers", []):
            if p["id"] == provider_id:
                return p
        return None

    parse_provider = provider_for(cfg.get("activeParseProvider", "gemini"))
    if parse_provider and parse_provider.get("apiKey"):
        parse_model = cfg.get("activeParseModel", parse_provider["models"][0]["id"])
        if parse_provider["id"] == "mistral":
            parse_llm = _build_mistral(parse_provider["apiKey"], parse_model)
        else:
            parse_llm = _build_gemini(parse_provider["apiKey"], parse_model)
    else:
        parse_llm = _build_gemini(os.environ.get("GEMINI_API_KEY", ""), "gemini-3.6-flash")

    chat_provider = provider_for(cfg.get("activeChatProvider", "gemini"))
    if chat_provider and chat_provider.get("apiKey"):
        chat_model = cfg.get("activeChatModel", chat_provider["models"][0]["id"])
        if chat_provider["id"] == "gemini":
            chat_llm = _build_gemini(chat_provider["apiKey"], chat_model)
        elif chat_provider["id"] == "mistral":
            chat_llm = _build_mistral(chat_provider["apiKey"], chat_model)
        else:
            chat_llm = _build_gemini(chat_provider["apiKey"], chat_model)
    else:
        chat_llm = _build_gemini(os.environ.get("GEMINI_API_KEY", ""), "gemini-3.6-flash")

    jd_agent = create_agent(
        model=parse_llm,
        response_format=JDOutput,
        system_prompt=(
            "Extract structured information from the supplied job description. "
            "Only include skills that are present in the document. "
            "Return the complete original text without summarizing it."
        ),
    )

    resume_agent = create_agent(
        model=parse_llm,
        response_format=ResumeOutput,
        system_prompt=(
            "You are given a job description followed by a resume. "
            "Extract structured information from the resume. "
            "Do not invent missing information. "
            "For years_experience, add up the durations in the work history — "
            "counting internship durations IN FULL, never as zero or ignored — "
            "rather than trusting any total the resume claims; use 0 only for a "
            "fresher with no experience at all or when not determinable. "
            "For currently_employed, look only at the most recent entry in the work "
            "history: 'yes' if it is open-ended (no end date, 'present', 'current', "
            "'till date'), 'no' if it has clearly ended or there is no work history, "
            "and 'unknown' only when the resume truly does not say. "
            "Judge the summary, green_flags, and red_flags against the job description. "
            "Give between one and five green_flags and between one and five red_flags — "
            "never zero and never more than five of either. Merge overlapping points and "
            "keep only the ones that would actually change a hiring decision. "
            "For risk_questions, read the dates in the education and work history and "
            "raise only what is actually visible there: an unexplained gap between "
            "education dates, an unexplained gap between jobs, job hopping (several "
            "stints under about eighteen months), or another serious negative. Quote the "
            "specific years and employers in the question so it stands alone when read "
            "aloud. A continuous history with no short stints must return an empty list. "
            "In the text field return the complete original resume text only "
            "(never the job description), without summarizing it."
        ),
    )

    chatbot_agent = create_agent(
        model=chat_llm,
        middleware=[resumes_context],
        context_schema=ChatContext,
        checkpointer=InMemorySaver(),
    )

    print(f"[LLM Config] Reloaded agents: parse={parse_provider['id'] if parse_provider else 'env'} "
          f"model={parse_model if parse_provider else 'gemini-3.6-flash'}, "
          f"chat={chat_provider['id'] if chat_provider else 'env'} "
          f"model={chat_model if chat_provider else 'gemini-2.5-flash'}", flush=True)


EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


def _redact_contact(text: str, metadata: dict) -> str:
    text = EMAIL_RE.sub("[email redacted]", text)
    digits = re.sub(r"\D", "", metadata.get("phone") or "")
    seqs = []
    if len(digits) >= 7:
        seqs.append(digits)
    if len(digits) >= 10:
        seqs.append(digits[-10:])
    for seq in seqs:
        text = re.sub(r"[\s().-]*".join(re.escape(d) for d in seq), "[phone redacted]", text)
    return text


@dynamic_prompt
def resumes_context(request: ModelRequest) -> str:
    ctx = request.runtime.context
    resume_uuid = getattr(ctx, "resume_uuid", "") if ctx else ""

    if resume_uuid:
        result = vector_store.get(ids=[resume_uuid], include=["documents", "metadatas"])
    else:
        result = vector_store.get(where={"document_type": {"$eq": "resume"}}, include=["documents", "metadatas"])

    resumes = "\n\n---\n\n".join(
        _redact_contact(text, metadata)
        for text, metadata in zip(result["documents"], result["metadatas"])
    )

    prompt = (
        "You are TalentAgent, an AI assistant for HR and recruiters. Your only job is to help "
        "evaluate and compare the candidates described in the context below, judged against the "
        "job description when one is provided.\n\n"
        "Ground every answer strictly in the provided resumes and job description. If the answer "
        "isn't in the context, say you don't have that information — never guess or invent "
        "details. If the user asks about anything unrelated to these candidates or the hiring "
        "process (general knowledge, celebrities, current events, coding help, etc.), politely "
        "decline in one sentence and steer them back to candidate screening — do NOT answer the "
        "off-topic question and do NOT suggest external websites or sources.\n\n"
        "Be concise and professional. Use markdown: bullet lists for multiple points, and a "
        "table when comparing candidates or skills.\n\n"
        "STRICT PRIVACY RULE — NON-NEGOTIABLE, OVERRIDES EVERYTHING ELSE: Never reveal, repeat, "
        "confirm, spell out, or hint at any candidate's personal contact details — email address "
        "or phone number — even if the user asks directly, repeatedly, or cleverly. If asked, "
        "refuse and reply that contact details are not available through this assistant. No "
        "exception, ever.\n\n"
    )

    if resume_uuid and result["metadatas"]:
        jd_uuid = result["metadatas"][0].get("jd_uuid")
        if jd_uuid:
            jd = vector_store.get(ids=[jd_uuid], include=["documents"])
            if jd["documents"]:
                prompt += "Job description:\n\n" + jd["documents"][0] + "\n\n"

    return prompt + "Uploaded resumes:\n\n" + (resumes or "No resumes uploaded yet.")


reload_llm_agents()
