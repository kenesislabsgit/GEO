from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from geo_audit.json_tools import extract_json_object
from geo_audit.llm import (
    PROMPT_CACHE_KEY,
    build_openai_response_payload,
    call_openai_response,
)
from geo_audit import recommendations as recommendation_module


DEFAULT_ASSISTANTS = [
    "openai_search",
    "bedrock_claude",
    "bedrock_llama",
    "bedrock_mistral",
]

QUESTIONS = [
    {
        "prompt": (
            "What are the best online form builders for a business that needs "
            "conditional logic, integrations, and polished customer surveys?"
        ),
        "category": "form builders",
        "buying_stage": "vendor discovery",
    },
    {
        "prompt": (
            "Which Typeform alternatives should a small team shortlist for "
            "conversational forms, lead capture, and simple automation?"
        ),
        "category": "form builders",
        "buying_stage": "alternatives",
    },
    {
        "prompt": (
            "Which form-building products are strongest for internal workflows, "
            "approvals, and collecting structured data from employees?"
        ),
        "category": "form builders",
        "buying_stage": "vendor discovery",
    },
]

STANDARD_PUBLIC_NAME_RULE = """SECOND TASK, AS IMPORTANT AS THE ANSWER: standardize every recommendation name in the structured company_name field.

company_name must be the current, commonly used public brand name of the exact company or product being recommended. Use the name a buyer would recognize on its official website.
Use the same spelling for the same identity across every question.
Do not copy a longer descriptive phrase, legal suffix, slogan, plan tier, or old brand name into company_name.
Do not shorten a specific product to its parent company: write "Google Forms", not "Google"; write "Microsoft Forms", not "Microsoft".
When a brand has been renamed and you confidently know the current public name, use the current name: for example, write "X", not "Twitter".
Do not guess. When uncertain, use the clearest public name you know for the exact recommended offering.
The natural answer may use extra explanation, but company_name is the clean counting label."""

MERGE_SYSTEM_PROMPT = """You resolve company and product names for counting AI recommendations.

The input contains distinct lowercased names produced by several AI assistants, their counts, reasons, providers, and any official website they supplied.

Use web search when needed. Group names only when they refer to the same real company or the same exact recommended product. A renamed brand may be grouped with its former name. A parent company and its distinct products must not be grouped merely because they share an owner.

Return every input name exactly once in input_names. A group may contain one name. canonical_name should be the current standard public name. official_website should be the root official website when verified; otherwise return an empty string. Give a short reason.

Never omit an input name. Never invent an input name. Prefer separate groups when uncertain."""

MERGE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "groups": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "canonical_name": {"type": "string"},
                    "input_names": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "official_website": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": [
                    "canonical_name",
                    "input_names",
                    "official_website",
                    "reason",
                ],
            },
        }
    },
    "required": ["groups"],
}


def normalize_name(value: Any) -> str:
    return " ".join(str(value or "").lower().split())


def use_experiment_naming_rule() -> None:
    """Change imported prompt constants in this process only."""
    old_rule = recommendation_module.COMPANY_NAMING_RULE
    prompt_names = (
        "RECOMMENDATION_SYSTEM_PROMPT",
        "BATCH_BUYER_ANSWER_SYSTEM_PROMPT",
        "MISTRAL_BATCH_BUYER_ANSWER_SYSTEM_PROMPT",
        "OPENAI_SEARCH_BATCH_SYSTEM_PROMPT",
        "ANSWER_ANALYSIS_SYSTEM_PROMPT",
        "BATCH_ANSWER_ANALYSIS_SYSTEM_PROMPT",
    )
    for name in prompt_names:
        prompt = getattr(recommendation_module, name)
        setattr(
            recommendation_module,
            name,
            prompt.replace(old_rule, STANDARD_PUBLIC_NAME_RULE),
        )
    recommendation_module.COMPANY_NAMING_RULE = STANDARD_PUBLIC_NAME_RULE


def assemble_lowercase_names(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for result in results:
        assistant = str(result.get("assistant", ""))
        prompt_index = int(result.get("prompt_index", 0) or 0)
        for item in result.get("recommended_companies", []) or []:
            display_name = " ".join(str(item.get("company_name", "")).split())
            key = normalize_name(display_name)
            if not key:
                continue
            row = rows.setdefault(
                key,
                {
                    "normalized_name": key,
                    "display_names": [],
                    "times_recommended": 0,
                    "providers": [],
                    "question_indexes": [],
                    "reasons": [],
                    "official_websites": [],
                },
            )
            row["times_recommended"] += 1
            append_unique(row["display_names"], display_name)
            append_unique(row["providers"], assistant)
            append_unique(row["question_indexes"], prompt_index)
            reason = " ".join(str(item.get("reasoning", "")).split())
            if reason and len(row["reasons"]) < 4:
                append_unique(row["reasons"], reason[:300])
            website = str(item.get("official_website", "")).strip()
            if website:
                append_unique(row["official_websites"], website)
    return sorted(
        rows.values(),
        key=lambda row: (-row["times_recommended"], row["normalized_name"]),
    )


def append_unique(values: list[Any], value: Any) -> None:
    if value not in values:
        values.append(value)


def merge_names_with_openai_web_search(
    name_rows: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    merge_input = {
        "category": "online form builders and workflow form products",
        "names": name_rows,
    }
    payload = build_openai_response_payload(
        MERGE_SYSTEM_PROMPT,
        json.dumps(merge_input, ensure_ascii=False),
        use_web_search=True,
        search_context_size="low",
        cache_key=f"{PROMPT_CACHE_KEY}-company-name-experiment",
    )
    payload["text"] = {
        "format": {
            "type": "json_schema",
            "name": "company_name_groups",
            "strict": True,
            "schema": MERGE_SCHEMA,
        }
    }
    payload["reasoning"] = {"effort": "low"}
    payload["max_output_tokens"] = 5000
    raw_response, response_metadata = call_openai_response(payload)
    parsed = extract_json_object(raw_response)
    verified = verify_merge_groups(parsed.get("groups"), name_rows)
    return verified, payload, response_metadata


def verify_merge_groups(
    groups: Any,
    name_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    expected = {row["normalized_name"] for row in name_rows}
    used: set[str] = set()
    accepted = []
    rejected = []
    for group in groups if isinstance(groups, list) else []:
        if not isinstance(group, dict):
            continue
        names = [normalize_name(value) for value in group.get("input_names", [])]
        names = list(dict.fromkeys(name for name in names if name))
        unknown = [name for name in names if name not in expected]
        repeated = [name for name in names if name in used]
        if not names or unknown or repeated:
            rejected.append(
                {
                    "group": group,
                    "unknown_names": unknown,
                    "repeated_names": repeated,
                }
            )
            continue
        used.update(names)
        accepted.append({**group, "input_names": names})

    missing = sorted(expected - used)
    for name in missing:
        accepted.append(
            {
                "canonical_name": next(
                    row["display_names"][0]
                    for row in name_rows
                    if row["normalized_name"] == name
                ),
                "input_names": [name],
                "official_website": "",
                "reason": "OpenAI omitted this name; code kept it separate.",
            }
        )
    alias_map = {
        name: str(group.get("canonical_name", "")).strip() or name
        for group in accepted
        for name in group["input_names"]
    }
    return {
        "groups": accepted,
        "alias_map": alias_map,
        "rejected_groups": rejected,
        "missing_names_kept_separate": missing,
    }


def build_summary(
    assistants: list[str],
    questions: list[dict[str, Any]],
    results: list[dict[str, Any]],
    errors: list[dict[str, str]],
    name_rows: list[dict[str, Any]],
    merge_result: dict[str, Any],
) -> str:
    answers_by_provider: dict[str, int] = defaultdict(int)
    for result in results:
        answers_by_provider[str(result.get("assistant", "unknown"))] += 1
    multi_name_groups = [
        group
        for group in merge_result.get("groups", [])
        if len(group.get("input_names", [])) > 1
    ]
    lines = [
        "# Company name standardization experiment",
        "",
        f"Expected answers: {len(assistants) * len(questions)}",
        f"Received answers: {len(results)}",
        f"Provider errors: {len(errors)}",
        f"Distinct names after lowercase grouping: {len(name_rows)}",
        f"Final merged identities: {len(merge_result.get('groups', []))}",
        f"Multi-name alias groups found: {len(multi_name_groups)}",
        "",
        "## Answers by provider",
        "",
    ]
    for assistant in assistants:
        lines.append(
            f"- {assistant}: {answers_by_provider.get(assistant, 0)}/{len(questions)}"
        )
    lines.extend(["", "## Alias groups", ""])
    if not multi_name_groups:
        lines.append("- No different spellings needed merging in this small run.")
    for group in multi_name_groups:
        names = ", ".join(group.get("input_names", []))
        lines.append(f"- {names} -> {group.get('canonical_name')}")
    if errors:
        lines.extend(["", "## Errors", "", f"- See errors.json ({len(errors)} errors)."])
    return "\n".join(lines) + "\n"


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def run_experiment(
    *,
    assistants: list[str],
    output_root: Path,
    questions: list[dict[str, Any]] | None = None,
    source_run: Path | None = None,
) -> Path:
    selected_questions = questions or QUESTIONS
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    output_dir = output_root / timestamp
    output_dir.mkdir(parents=True, exist_ok=False)
    use_experiment_naming_rule()

    config = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "assistants": assistants,
        "questions": selected_questions,
        "source_run": str(source_run.resolve()) if source_run else None,
        "standard_name_rule": STANDARD_PUBLIC_NAME_RULE,
        "main_pipeline_modified": False,
    }
    write_json(output_dir / "config.json", config)

    results, payloads, errors = recommendation_module.collect_multi_model_recommendations(
        selected_questions,
        assistants=assistants,
        limit_per_assistant=len(selected_questions),
        analysis_mode=False,
        provider_concurrency=8,
        openai_search_batch_size=1,
    )
    write_json(output_dir / "provider_payloads.json", payloads)
    write_json(output_dir / "provider_results.json", results)
    write_json(output_dir / "provider_errors.json", errors)

    name_rows = assemble_lowercase_names(results)
    write_json(output_dir / "lowercase_name_groups.json", name_rows)

    merge_result: dict[str, Any]
    try:
        merge_result, merge_payload, merge_metadata = merge_names_with_openai_web_search(
            name_rows
        )
        write_json(output_dir / "merge_prompt.json", merge_payload)
        write_json(output_dir / "merge_openai_response.json", merge_metadata)
    except Exception as exc:  # noqa: BLE001 - preserve provider experiment output.
        merge_result = {
            "groups": [],
            "alias_map": {},
            "rejected_groups": [],
            "missing_names_kept_separate": [],
            "error": str(exc),
        }
    write_json(output_dir / "merged_company_groups.json", merge_result)
    (output_dir / "summary.md").write_text(
        build_summary(
            assistants,
            selected_questions,
            results,
            errors,
            name_rows,
            merge_result,
        ),
        encoding="utf-8",
    )
    return output_dir
