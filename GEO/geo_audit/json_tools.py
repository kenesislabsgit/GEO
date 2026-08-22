from __future__ import annotations

import json
from typing import Any


def extract_json_object(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()

    try:
        value = json.loads(text)
    except json.JSONDecodeError as original_error:
        start = text.find("{")
        if start == -1:
            raise original_error
        try:
            value, _ = json.JSONDecoder().raw_decode(text, start)
        except json.JSONDecodeError:
            end = text.rfind("}")
            if end == -1 or end <= start:
                raise original_error
            value = json.loads(text[start : end + 1])

    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object.")
    return value


def extract_json_array(raw_text: str) -> list[Any]:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()

    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start == -1 or end == -1 or end <= start:
            raise
        value = json.loads(text[start : end + 1])

    if not isinstance(value, list):
        raise ValueError("Expected a JSON array.")
    return value
