from __future__ import annotations

import json
import os
from pathlib import Path
import re
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_API_BASE = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-4.1-mini"
DEFAULT_ANTHROPIC_API_BASE = "https://api.anthropic.com"
DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"
DEFAULT_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_OPENAI_SEARCH_MODEL = "gpt-5-mini"
# How much searching and reading one web-search question may do. "low" keeps a
# question predictable; the paid audit can raise it.
DEFAULT_SEARCH_CONTEXT_SIZE = "low"
# Requests sharing a cache key reuse the cached copy of their system prompt.
PROMPT_CACHE_KEY = "geo-audit-v1"
DEFAULT_BEDROCK_REGION = "us-east-1"
DEFAULT_BEDROCK_MODELS = {
    "bedrock_claude": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "bedrock_nova": "amazon.nova-lite-v1:0",
    "bedrock_llama": "us.meta.llama3-1-70b-instruct-v1:0",
    "bedrock_mistral": "mistral.mistral-large-2402-v1:0",
}


class LLMNotConfigured(RuntimeError):
    pass


# ── OpenAI-compatible providers ──────────────────────────────────────────────
# Perplexity, Grok (xAI), DeepSeek, Kimi (Moonshot), Groq, MiniMax, Sarvam and
# Qwen (Alibaba) all speak the OpenAI chat-completions dialect, so one caller
# serves them all. Each entry: accepted key env vars (first present wins), the
# API base (overridable via <ID>_API_BASE), and the default model (overridable
# via <ID>_MODEL). A missing key raises LLMNotConfigured, which the pipeline
# records per-question and reports the provider as partial — same contract
# as every other provider here.

OPENAI_COMPAT_PROVIDERS: dict[str, dict[str, Any]] = {
    "perplexity": {
        "key_envs": ("PERPLEXITY_API_KEY",),
        "base": "https://api.perplexity.ai",
        "model": "sonar",
    },
    "grok": {
        "key_envs": ("XAI_API_KEY", "GROK_API_KEY"),
        "base": "https://api.x.ai/v1",
        "model": "grok-3-mini",
    },
    "deepseek": {
        "key_envs": ("DEEPSEEK_API_KEY",),
        "base": "https://api.deepseek.com/v1",
        "model": "deepseek-chat",
    },
    "kimi": {
        "key_envs": ("MOONSHOT_API_KEY", "KIMI_API_KEY"),
        "base": "https://api.moonshot.ai/v1",
        "model": "kimi-k2-0711-preview",
    },
    "groq": {
        "key_envs": ("GROQ_API_KEY",),
        "base": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
    },
    "minimax": {
        "key_envs": ("MINIMAX_API_KEY",),
        "base": "https://api.minimax.io/v1",
        "model": "MiniMax-M1",
    },
    "sarvam": {
        "key_envs": ("SARVAM_API_KEY",),
        "base": "https://api.sarvam.ai/v1",
        "model": "sarvam-m",
        # Sarvam also accepts its subscription-key header; sending both makes
        # either auth scheme work without configuration.
        "extra_key_header": "api-subscription-key",
    },
    "qwen": {
        "key_envs": ("DASHSCOPE_API_KEY", "QWEN_API_KEY"),
        "base": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
    },
}


def openai_compatible_assistants() -> set[str]:
    return set(OPENAI_COMPAT_PROVIDERS)


def call_openai_compatible(
    provider: str,
    system_prompt: str,
    user_prompt: str,
    *,
    model: str | None = None,
    temperature: float = 0.2,
) -> tuple[str, dict[str, Any]]:
    load_dotenv(override=True)
    config = OPENAI_COMPAT_PROVIDERS[provider]
    env_prefix = provider.upper()

    api_key = next(
        (os.environ[name] for name in config["key_envs"] if os.environ.get(name)),
        None,
    )
    if not api_key:
        raise LLMNotConfigured(
            f"Set {config['key_envs'][0]} to query {provider}."
        )

    api_base = (
        os.environ.get(f"{env_prefix}_API_BASE") or config["base"]
    ).rstrip("/")
    resolved_model = (
        model or os.environ.get(f"{env_prefix}_MODEL") or config["model"]
    )

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    extra_header = config.get("extra_key_header")
    if extra_header:
        headers[extra_header] = api_key

    payload = {
        "model": resolved_model,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    request = Request(
        f"{api_base}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"{provider} request failed: {exc.code} {detail[:500]}"
        ) from exc
    except URLError as exc:
        raise RuntimeError(f"{provider} request failed: {exc}") from exc

    content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not content:
        raise RuntimeError(f"{provider} returned an empty answer.")
    metadata = {
        "model": body.get("model") or resolved_model,
        "usage": body.get("usage") or {},
    }
    return content, metadata


def build_chat_payload(
    system_prompt: str,
    user_prompt: str,
    *,
    model: str | None = None,
    temperature: float = 0.2,
    json_response: bool = False,
) -> dict[str, Any]:
    load_dotenv(override=True)
    payload = {
        "model": model or os.environ.get("LLM_MODEL", DEFAULT_MODEL),
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        # Every audit re-sends the same long instructions. Sharing a cache key
        # lets the provider reuse them instead of billing the full prefix again.
        "prompt_cache_key": PROMPT_CACHE_KEY,
    }
    if json_response:
        payload["response_format"] = {"type": "json_object"}
    return payload


def call_chat_completion(payload: dict[str, Any]) -> str:
    load_dotenv(override=True)
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise LLMNotConfigured(
            "Set LLM_API_KEY or OPENAI_API_KEY to run LLM generation."
        )

    api_base = os.environ.get("LLM_API_BASE", DEFAULT_API_BASE).rstrip("/")
    request = Request(
        f"{api_base}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM request failed: {exc.code} {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"LLM request failed: {exc}") from exc

    return body.get("choices", [{}])[0].get("message", {}).get("content", "") or ""


def call_chat_message(payload: dict[str, Any]) -> dict[str, Any]:
    """The whole assistant message, not just its text.

    A model that has been offered tools answers with tool_calls and no content.
    Callers that run a tool loop need that message back intact so they can
    append it to the conversation alongside the tool results.
    """
    load_dotenv(override=True)
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise LLMNotConfigured(
            "Set LLM_API_KEY or OPENAI_API_KEY to run LLM generation."
        )

    api_base = os.environ.get("LLM_API_BASE", DEFAULT_API_BASE).rstrip("/")
    request = Request(
        f"{api_base}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM request failed: {exc.code} {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"LLM request failed: {exc}") from exc

    return body["choices"][0]["message"]


def build_openai_response_payload(
    system_prompt: str,
    user_prompt: str,
    *,
    model: str | None = None,
    use_web_search: bool = True,
    search_context_size: str | None = None,
    cache_key: str | None = None,
    country: str | None = None,
) -> dict[str, Any]:
    """The system prompt is always first and identical between calls, which is
    what lets the provider reuse a cached copy of it instead of charging for it
    on every question. cache_key groups requests that share that prefix."""
    load_dotenv(override=True)
    payload: dict[str, Any] = {
        "model": model or os.environ.get("OPENAI_SEARCH_MODEL", DEFAULT_OPENAI_SEARCH_MODEL),
        "input": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    if use_web_search:
        tool: dict[str, Any] = {"type": "web_search"}
        # Bound how much searching and reading one question may do. Without this
        # the provider decides, and a single question can stall a whole run.
        size = (
            search_context_size
            or os.environ.get("OPENAI_SEARCH_CONTEXT_SIZE")
            or DEFAULT_SEARCH_CONTEXT_SIZE
        ).strip().lower()
        if size in {"low", "medium", "high"}:
            tool["search_context_size"] = size
        # A per-call country (geo market questions) beats the env-wide pin.
        # Pinning results to one market keeps repeat runs comparable.
        location = (country or os.environ.get("OPENAI_SEARCH_COUNTRY", "")).strip()
        if location:
            tool["user_location"] = {"type": "approximate", "country": location}
        payload["tools"] = [tool]
    if cache_key:
        payload["prompt_cache_key"] = cache_key
    return payload


def call_openai_response(payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    load_dotenv(override=True)
    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("LLM_API_KEY")
    if not api_key:
        raise LLMNotConfigured(
            "Set OPENAI_API_KEY or LLM_API_KEY to run OpenAI Responses generation."
        )

    api_base = os.environ.get("OPENAI_API_BASE", DEFAULT_API_BASE).rstrip("/")
    request = Request(
        f"{api_base}/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=180) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI Responses request failed: {exc.code} {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"OpenAI Responses request failed: {exc}") from exc

    return extract_openai_response_text(body), body


def extract_openai_response_text(body: dict[str, Any]) -> str:
    if body.get("output_text"):
        return str(body["output_text"])
    chunks = []
    for output in body.get("output", []):
        for content in output.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                chunks.append(str(content["text"]))
    return "\n".join(chunks)


def extract_openai_response_source_urls(body: dict[str, Any]) -> list[str]:
    urls = []
    for output in body.get("output", []):
        for content in output.get("content", []):
            for annotation in content.get("annotations", []):
                url = annotation.get("url")
                if url:
                    urls.append(str(url))
    return list(dict.fromkeys(urls))


def call_bedrock_converse(
    system_prompt: str,
    user_prompt: str,
    *,
    provider: str,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 2000,
) -> tuple[str, dict[str, Any]]:
    load_dotenv(override=True)
    try:
        import boto3
        from botocore.exceptions import BotoCoreError, ClientError
    except ImportError as exc:
        raise LLMNotConfigured("Install boto3 to use AWS Bedrock providers.") from exc

    selected_model = model or os.environ.get(
        f"{provider.upper()}_MODEL",
        DEFAULT_BEDROCK_MODELS.get(provider, ""),
    )
    if not selected_model:
        raise LLMNotConfigured(f"No Bedrock model configured for {provider}.")

    region = os.environ.get("AWS_REGION") or os.environ.get(
        "AWS_DEFAULT_REGION", DEFAULT_BEDROCK_REGION
    )
    client = boto3.client("bedrock-runtime", region_name=region)
    try:
        response = client.converse(
            modelId=selected_model,
            system=[{"text": system_prompt}],
            messages=[
                {
                    "role": "user",
                    "content": [{"text": user_prompt}],
                }
            ],
            inferenceConfig={
                "temperature": temperature,
                "maxTokens": max_tokens,
            },
        )
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Bedrock {provider} request failed: {exc}") from exc

    text = "\n".join(
        part.get("text", "")
        for part in response.get("output", {}).get("message", {}).get("content", [])
        if part.get("text")
    )
    metadata = {
        "model": selected_model,
        "region": region,
        "usage": response.get("usage", {}),
        "metrics": response.get("metrics", {}),
    }
    return text, metadata


def call_bedrock_tool_message(
    payload: dict[str, Any],
    *,
    model: str | None = None,
) -> dict[str, Any]:
    """Run the OpenAI-shaped writer conversation through Bedrock Converse.

    The writer keeps one internal message format. This adapter translates its
    visible conversation and function tools to Bedrock, then translates the
    response back so the same validated tool loop works for Claude Haiku.
    """
    load_dotenv(override=True)
    try:
        import boto3
        from botocore.exceptions import BotoCoreError, ClientError
    except ImportError as exc:
        raise LLMNotConfigured("Install boto3 to use AWS Bedrock providers.") from exc

    selected_model = (
        model
        or os.environ.get("AUDIT_WRITER_BEDROCK_MODEL")
        or DEFAULT_BEDROCK_MODELS["bedrock_claude"]
    )
    region = os.environ.get("AWS_REGION") or os.environ.get(
        "AWS_DEFAULT_REGION", DEFAULT_BEDROCK_REGION
    )
    system_parts: list[dict[str, str]] = []
    bedrock_messages: list[dict[str, Any]] = []

    def append_message(role: str, content: list[dict[str, Any]]) -> None:
        if bedrock_messages and bedrock_messages[-1]["role"] == role:
            bedrock_messages[-1]["content"].extend(content)
        else:
            bedrock_messages.append({"role": role, "content": content})

    for index, message in enumerate(payload.get("messages") or []):
        role = str(message.get("role") or "")
        if role == "system" and index == 0:
            system_parts.append({"text": str(message.get("content") or "")})
            continue
        if role == "system":
            append_message(
                "user",
                [{"text": "[SYSTEM PROGRESS]\n" + str(message.get("content") or "")}],
            )
        elif role == "user":
            append_message("user", [{"text": str(message.get("content") or "")}])
        elif role == "assistant":
            content: list[dict[str, Any]] = []
            if message.get("content"):
                content.append({"text": str(message.get("content"))})
            for call in message.get("tool_calls") or []:
                function = call.get("function") or {}
                try:
                    tool_input = json.loads(function.get("arguments") or "{}")
                except (TypeError, ValueError):
                    tool_input = {}
                content.append(
                    {
                        "toolUse": {
                            "toolUseId": str(call.get("id") or ""),
                            "name": str(function.get("name") or ""),
                            "input": tool_input,
                        }
                    }
                )
            if content:
                append_message("assistant", content)
        elif role == "tool":
            try:
                tool_content = json.loads(str(message.get("content") or "{}"))
            except (TypeError, ValueError):
                tool_content = {"text": str(message.get("content") or "")}
            append_message(
                "user",
                [
                    {
                        "toolResult": {
                            "toolUseId": str(message.get("tool_call_id") or ""),
                            "content": [{"json": tool_content}],
                        }
                    }
                ],
            )

    request: dict[str, Any] = {
        "modelId": selected_model,
        "system": system_parts,
        "messages": bedrock_messages,
        "inferenceConfig": {"maxTokens": 10000, "temperature": 0.2},
    }
    writer_tools = payload.get("tools") or payload.get("_writer_tools")
    if writer_tools:
        request["toolConfig"] = {
            "tools": [
                {
                    "toolSpec": {
                        "name": str(tool.get("function", {}).get("name") or ""),
                        "description": str(
                            tool.get("function", {}).get("description") or ""
                        ),
                        "inputSchema": {
                            "json": tool.get("function", {}).get("parameters") or {}
                        },
                    }
                }
                for tool in writer_tools or []
            ]
        }

    client = boto3.client("bedrock-runtime", region_name=region)
    try:
        response = client.converse(**request)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Bedrock writer request failed: {exc}") from exc

    output = response.get("output", {}).get("message", {})
    text_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    for part in output.get("content", []) or []:
        if part.get("text"):
            text_parts.append(str(part["text"]))
        if part.get("toolUse"):
            tool_use = part["toolUse"]
            tool_calls.append(
                {
                    "id": str(tool_use.get("toolUseId") or ""),
                    "type": "function",
                    "function": {
                        "name": str(tool_use.get("name") or ""),
                        "arguments": json.dumps(
                            tool_use.get("input") or {}, ensure_ascii=False
                        ),
                    },
                }
            )
    return {
        "content": "\n".join(text_parts) or None,
        "tool_calls": tool_calls,
        "model": selected_model,
        "usage": response.get("usage") or {},
    }


def build_anthropic_payload(
    system_prompt: str,
    user_prompt: str,
    *,
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 2000,
) -> dict[str, Any]:
    load_dotenv(override=True)
    return {
        "model": model or os.environ.get("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL),
        "max_tokens": max_tokens,
        "temperature": temperature,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }


def call_anthropic_message(payload: dict[str, Any]) -> str:
    load_dotenv(override=True)
    api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CLAUDE_API_KEY")
    if not api_key:
        raise LLMNotConfigured(
            "Set ANTHROPIC_API_KEY or CLAUDE_API_KEY to run Claude generation."
        )

    api_base = os.environ.get("ANTHROPIC_API_BASE", DEFAULT_ANTHROPIC_API_BASE).rstrip("/")
    request = Request(
        f"{api_base}/v1/messages",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "x-api-key": api_key,
            "anthropic-version": os.environ.get("ANTHROPIC_VERSION", "2023-06-01"),
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Claude request failed: {exc.code} {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Claude request failed: {exc}") from exc

    return "\n".join(
        part.get("text", "")
        for part in body.get("content", [])
        if part.get("type") == "text"
    )


def build_gemini_payload(
    system_prompt: str,
    user_prompt: str,
    *,
    temperature: float = 0.2,
    json_response: bool = False,
    use_google_search: bool = True,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {"temperature": temperature},
    }
    if json_response:
        payload["generationConfig"]["responseMimeType"] = "application/json"
    if use_google_search:
        payload["tools"] = [{"google_search": {}}]
    return payload


def call_gemini_generate_content(
    payload: dict[str, Any],
    *,
    model: str | None = None,
) -> tuple[str, dict[str, Any]]:
    load_dotenv(override=True)
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise LLMNotConfigured(
            "Set GEMINI_API_KEY or GOOGLE_API_KEY to run Gemini generation."
        )

    selected_model = model or os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    api_base = os.environ.get("GEMINI_API_BASE", DEFAULT_GEMINI_API_BASE).rstrip("/")
    request = Request(
        f"{api_base}/models/{selected_model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "x-goog-api-key": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        retry_seconds = parse_retry_delay(detail)
        if exc.code == 429 and retry_seconds and retry_seconds <= 20:
            time.sleep(retry_seconds + 1)
            try:
                with urlopen(request, timeout=120) as response:
                    body = json.loads(response.read().decode("utf-8"))
            except HTTPError as retry_exc:
                retry_detail = retry_exc.read().decode("utf-8", errors="replace")
                raise RuntimeError(
                    f"Gemini request failed: {retry_exc.code} {retry_detail}"
                ) from retry_exc
        else:
            raise RuntimeError(f"Gemini request failed: {exc.code} {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Gemini request failed: {exc}") from exc

    candidates = body.get("candidates", [])
    if not candidates:
        return "", body

    parts = candidates[0].get("content", {}).get("parts", [])
    text = "\n".join(part.get("text", "") for part in parts if "text" in part)
    return text, body


def parse_retry_delay(detail: str) -> int | None:
    match = re.search(r'"retryDelay"\s*:\s*"(\d+)s"', detail)
    if match:
        return int(match.group(1))
    match = re.search(r"retry in ([0-9.]+)s", detail, flags=re.IGNORECASE)
    if match:
        return int(float(match.group(1)))
    return None


def load_dotenv(path: str = ".env", override: bool = False) -> None:
    """override=True lets the .env win over ambient variables. A stale AWS key
    in the Windows user environment silently beat a freshly rotated .env for a
    whole day of audits — the engine's own .env is its source of truth."""
    env_path = Path(path)
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if name and (override or name not in os.environ):
            os.environ[name] = value
