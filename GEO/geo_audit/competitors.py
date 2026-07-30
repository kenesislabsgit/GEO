from __future__ import annotations

import json
from typing import Any

from .json_tools import extract_json_array
from .llm import LLMNotConfigured, build_chat_payload, call_chat_completion


COMPETITOR_SYSTEM_PROMPT = """You are a market research analyst.

Given this company profile, identify the companies that most likely compete in the same market.

This is only a hypothesis list, not the final AI competitor list.

Return only companies that genuinely compete.
Do not include companies unless they serve a similar customer need.

Return only a valid JSON array with exactly this object shape:
[
  {
    "company_name": "",
    "reason": "",
    "confidence": "High | Medium | Low"
  }
]

Return up to 10 competitors.
"""


def build_competitor_seed_payload(company_profile: dict[str, Any]) -> dict[str, Any]:
    user_prompt = json.dumps(company_profile, indent=2, ensure_ascii=False)
    return build_chat_payload(COMPETITOR_SYSTEM_PROMPT, user_prompt, temperature=0.2)


def generate_competitor_seeds(
    company_profile: dict[str, Any],
) -> tuple[list[dict[str, Any]] | None, dict[str, Any], str | None]:
    payload = build_competitor_seed_payload(company_profile)
    try:
        raw_response = call_chat_completion(payload)
    except LLMNotConfigured as exc:
        return None, payload, str(exc)

    competitors = extract_json_array(raw_response)
    return [normalize_competitor(item) for item in competitors], payload, None


def normalize_competitor(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        return {
            "company_name": str(item),
            "reason": "Unknown",
            "confidence": "Low",
        }
    return {
        "company_name": str(item.get("company_name", "Unknown")),
        "reason": str(item.get("reason", "Unknown")),
        "confidence": normalize_confidence(item.get("confidence", "Low")),
    }


def normalize_confidence(value: Any) -> str:
    text = str(value).strip().title()
    return text if text in {"High", "Medium", "Low"} else "Low"
