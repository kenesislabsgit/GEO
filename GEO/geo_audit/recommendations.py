from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
from json import JSONDecodeError
import re
from typing import Any

from .firecrawl import environment_int
from .json_tools import extract_json_object
from .llm import (
    LLMNotConfigured,
    PROMPT_CACHE_KEY,
    build_anthropic_payload,
    build_chat_payload,
    build_gemini_payload,
    build_openai_response_payload,
    call_bedrock_converse,
    call_anthropic_message,
    call_chat_completion,
    call_gemini_generate_content,
    call_openai_response,
    extract_openai_response_source_urls,
)
from .source_analysis import verify_source_url


RECOMMENDATION_SYSTEM_PROMPT = """You are acting as a neutral assistant helping a customer choose software.

Recommend the companies you genuinely believe best satisfy the user's request.

Do not intentionally diversify recommendations.
Provide a focused shortlist of the 3 to 5 strongest directly relevant options,
not an exhaustive market list. Return fewer when additional options would be
weak or category-adjacent.
If web grounding or search is available, use it.
Include citations or referenced sources whenever available.
Rank recommendations naturally.
Do not attempt to include any company unless it genuinely deserves to appear.

Return only valid JSON with this exact top-level structure:
{
  "recommended_companies": [
    {
      "company_name": "",
      "rank": 1,
      "reasoning": "",
      "citations": [],
      "source_urls": []
    }
  ],
  "overall_reasoning": "",
  "unknowns": []
}
"""

BUYER_ANSWER_SYSTEM_PROMPT = """You are a neutral assistant helping a buyer research software options.

Answer the user's question naturally.
Recommend companies only when the question asks for products, vendors, alternatives, or solutions.
If the question asks for features or comparison criteria, answer that question directly and include example companies only when useful.
Use web grounding/search if available.
Include source URLs when available.
Do not mention that any specific brand is being evaluated.
"""

BATCH_BUYER_ANSWER_SYSTEM_PROMPT = f"""{BUYER_ANSWER_SYSTEM_PROMPT}

Answer every supplied question independently. Do not combine questions or carry recommendations from one answer into another.
Help the buyer form a focused shortlist, not an exhaustive market map.
For vendor-discovery questions, recommend only the 3 to 5 strongest options that directly satisfy the requested use case.
Prefer vendors whose primary product clearly fits the request. Exclude generic technology platforms, component manufacturers, consultants, publishers, discontinued products, and weakly related companies unless the question specifically asks for them.
If fewer than 3 credible options are known, return fewer rather than filling the list with weak matches.
Keep answer_text decision-oriented and concise. Keep each recommendation's reasoning and the overall_reasoning to one concise sentence.
Extract only companies or products that answer_text explicitly recommends.
Do not include companies that are merely mentioned as examples, integrations, customers, publishers, analysts, or technologies.
The evidence_quote must be an exact sentence or phrase copied from answer_text that demonstrates the recommendation.
Return only valid JSON in this structure:
{{
  "answers": [
    {{
      "prompt_index": 1,
      "answer_text": "complete standalone natural answer",
      "recommended_companies": [
        {{
          "company_name": "",
          "rank": 1,
          "reasoning": "",
          "evidence_quote": "",
          "explicitly_recommended": true
        }}
      ],
      "overall_reasoning": "",
      "unknowns": []
    }}
  ]
}}
"""

MISTRAL_BATCH_BUYER_ANSWER_SYSTEM_PROMPT = (
    f"""{BATCH_BUYER_ANSWER_SYSTEM_PROMPT}

Produce a compact buyer-facing result.
Keep answer_text to one short paragraph without introductions, implementation instructions, or repeated feature descriptions.
Keep each recommendation's reasoning to one short sentence and overall_reasoning to one sentence.
Include only material unknowns. Do not repeat the same explanation across fields.
"""
)

OPENAI_SEARCH_BATCH_SYSTEM_PROMPT = f"""{BATCH_BUYER_ANSWER_SYSTEM_PROMPT}

Use web search separately for each supplied question.
Every supplied question is a vendor-discovery question. Recommend 3 to 5 genuine companies or products in every answer.
Keep each answer concise, but make every recommendation explicit in answer_text and recommended_companies.
For each answer, include only source URLs actually returned by web search for that question in source_urls.
For each recommended company, include only the subset of those URLs that directly supports that recommendation.
Do not invent, reconstruct, or guess URLs.

Each answer object must also contain:
"source_urls": ["https://source-used-for-this-answer.example"]

Each recommended company object must also contain:
"source_urls": ["https://source-supporting-this-company.example"]
"""

OPENAI_SEARCH_BATCH_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "answers": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "prompt_index": {"type": "integer"},
                    "answer_text": {"type": "string"},
                    "recommended_companies": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "company_name": {"type": "string"},
                                "rank": {"type": "integer"},
                                "reasoning": {"type": "string"},
                                "evidence_quote": {"type": "string"},
                                "explicitly_recommended": {"type": "boolean"},
                                "source_urls": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                            },
                            "required": [
                                "company_name",
                                "rank",
                                "reasoning",
                                "evidence_quote",
                                "explicitly_recommended",
                                "source_urls",
                            ],
                        },
                    },
                    "overall_reasoning": {"type": "string"},
                    "unknowns": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "source_urls": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": [
                    "prompt_index",
                    "answer_text",
                    "recommended_companies",
                    "overall_reasoning",
                    "unknowns",
                    "source_urls",
                ],
            },
        }
    },
    "required": ["answers"],
}


ANSWER_ANALYSIS_SYSTEM_PROMPT = """Analyze an AI answer for recommendation visibility.

Use only the provided answer text and source URLs.
Do not infer facts from outside knowledge.
Extract companies that are actually recommended as vendors/products.
Do not treat feature headings, generic technologies, or examples as recommendations unless the answer clearly recommends them as options.
Position refers only to the rank/order in an actual recommendation list.
Set explicitly_recommended to true only for actual recommendations.
Copy an exact sentence or phrase from the answer into evidence_quote.

Return only valid JSON:
{
  "recommended_companies": [
    {
      "company_name": "",
      "rank": 1,
      "reasoning": "",
      "evidence_quote": "",
      "explicitly_recommended": true,
      "citations": [],
      "source_urls": []
    }
  ],
  "overall_reasoning": "",
  "unknowns": [],
  "analysis_confidence": 0.0
}
"""


BATCH_ANSWER_ANALYSIS_SYSTEM_PROMPT = """Analyze multiple AI answers for recommendation visibility.

Use only the provided answer text and source URLs.
Do not infer facts from outside knowledge.
For each input item, extract companies that are actually recommended as vendors/products.
Do not treat feature headings, generic technologies, or examples as recommendations unless the answer clearly recommends them as options.
Position refers only to the rank/order in an actual recommendation list.
Preserve each input item's prompt_index and assistant exactly.
Set explicitly_recommended to true only for actual recommendations.
Copy an exact sentence or phrase from the answer into evidence_quote.
Attach source_urls to the relevant recommended company when the answer associates a URL with that company.
If source URLs are present but the answer does not map them to a specific company, keep them in provider_source_urls and only copy them to company source_urls when reasonably associated by nearby text.

Return only valid JSON:
{
  "results": [
    {
      "prompt_index": 1,
      "assistant": "",
      "recommended_companies": [
        {
          "company_name": "",
          "rank": 1,
          "reasoning": "",
          "evidence_quote": "",
          "explicitly_recommended": true,
          "citations": [],
          "source_urls": []
        }
      ],
      "overall_reasoning": "",
      "unknowns": [],
      "analysis_confidence": 0.0
    }
  ]
}
"""


def collect_openai_recommendations(
    prompts: list[Any],
    *,
    model: str | None = None,
    limit: int | None = None,
) -> tuple[list[dict[str, Any]] | None, list[dict[str, Any]], str | None]:
    prompt_records = normalize_prompt_records(prompts)
    selected_prompts = prompt_records[:limit] if limit else prompt_records
    prompt_payloads: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []

    for index, prompt_record in enumerate(selected_prompts, start=1):
        prompt = prompt_record["prompt"]
        payload = build_recommendation_payload(prompt, model=model)
        prompt_payloads.append(
            {
                "prompt_index": index,
                "prompt": prompt,
                "category": prompt_record["category"],
                "buying_stage": prompt_record["buying_stage"],
                "payload": payload,
            }
        )

        try:
            raw_response = call_chat_completion(payload)
        except LLMNotConfigured as exc:
            return None, prompt_payloads, str(exc)

        try:
            parsed = extract_json_object(raw_response)
            parse_error = None
        except (JSONDecodeError, ValueError) as exc:
            parsed = {
                "recommended_companies": [],
                "overall_reasoning": "",
                "unknowns": [],
            }
            parse_error = str(exc)

        results.append(
            {
                "prompt_index": index,
                "prompt": prompt,
                "prompt_category": prompt_record["category"],
                "buying_stage": prompt_record["buying_stage"],
                "model": payload["model"],
                "assistant": "openai",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "recommended_companies": normalize_recommendations(
                    parsed.get("recommended_companies", [])
                ),
                "overall_reasoning": parsed.get("overall_reasoning", ""),
                "unknowns": parsed.get("unknowns", []),
                "parse_error": parse_error,
                "raw_response": raw_response,
            }
        )

    return results, prompt_payloads, None


# How many questions travel in one Bedrock call. Small enough that the calls
# run alongside each other, large enough that the question set does not turn
# into one call per question.
BEDROCK_BATCH_SIZE = environment_int("GEO_BEDROCK_BATCH_SIZE", 5)


def collect_multi_model_recommendations(
    prompts: list[Any],
    *,
    assistants: list[str],
    limit_per_assistant: int | None = None,
    assistant_prompt_indexes: dict[str, list[int]] | None = None,
    model_overrides: dict[str, str] | None = None,
    analysis_mode: bool = True,
    analyzer_batch_size: int = 5,
    provider_concurrency: int = 4,
    search_context_size: str | None = None,
    openai_search_batch_size: int = 1,
    progress_callback: Any = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, str]]]:
    prompt_records = normalize_prompt_records(prompts)
    model_overrides = model_overrides or {}
    payloads: list[dict[str, Any]] = []
    provider_items: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    tasks: list[tuple[str, int, dict[str, str]]] = []
    for assistant in assistants:
        normalized_assistant = assistant.strip().lower()
        if normalized_assistant not in supported_assistants():
            errors.append(
                {
                    "assistant": assistant,
                    "error": (
                        "Unsupported assistant. Use openai, openai_search, claude, "
                        "gemini, bedrock_claude, bedrock_nova, bedrock_llama, or bedrock_mistral."
                    ),
                }
            )
            continue

        if assistant_prompt_indexes and normalized_assistant in assistant_prompt_indexes:
            indexes = assistant_prompt_indexes[normalized_assistant]
        else:
            # Every assistant answers the same questions. They used to be split
            # — two shared, then a private slice each — which needed
            # 2 + assistants x (limit - 2) questions to work out. A live Pro
            # run asked for 20 each across four assistants, which needs 74, and
            # the writer produces 30. OpenAI Search got its 20, Claude got 12,
            # and Llama and Mistral answered the 2 shared questions and nothing
            # else: 36 answers where 80 were paid for. Worse, the answers could
            # not be compared, because no two assistants had been asked the
            # same thing.
            limit = limit_per_assistant or len(prompt_records)
            indexes = list(range(1, min(limit, len(prompt_records)) + 1))

        for index in indexes:
            if 1 <= index <= len(prompt_records):
                tasks.append((normalized_assistant, index, prompt_records[index - 1]))

    task_groups: list[list[tuple[str, int, dict[str, str]]]] = []
    bedrock_batches: dict[str, list[tuple[str, int, dict[str, str]]]] = {}
    search_tasks: list[tuple[str, int, dict[str, str]]] = []
    for task in tasks:
        assistant = task[0]
        if assistant in bedrock_assistants():
            bedrock_batches.setdefault(assistant, []).append(task)
        elif assistant == "openai_search":
            search_tasks.append(task)
        else:
            task_groups.append([task])

    # Web search is the slowest part of an audit and it runs once per question.
    # Chunking the questions into separate calls lets them run at the same time
    # instead of one after another inside a single response.
    chunk = max(1, openai_search_batch_size)
    for start in range(0, len(search_tasks), chunk):
        task_groups.append(search_tasks[start : start + chunk])

    # The same argument applies to a Bedrock model. All of its questions used
    # to travel in one call, and a model writes its reply one token at a time,
    # so twenty answers in a single response is twenty answers written one
    # after another. Raising the number of workers could not help, because
    # there was only ever one task per model to hand out: a live run went from
    # 36 answers in 298 seconds to 80 answers in 635, with the whole increase
    # inside that one call. Splitting the questions gives the workers
    # something to do in parallel.
    for tasks_for_assistant in bedrock_batches.values():
        for start in range(0, len(tasks_for_assistant), BEDROCK_BATCH_SIZE):
            task_groups.append(
                tasks_for_assistant[start : start + BEDROCK_BATCH_SIZE]
            )

    max_workers = max(1, min(provider_concurrency, len(task_groups) or 1))
    completed_groups = 0
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                collect_recommendation_group,
                group,
                model=model_overrides.get(group[0][0]),
                defer_analysis=analysis_mode,
                search_context_size=search_context_size,
            ): group
            for group in task_groups
        }
        for future in as_completed(futures):
            group = futures[future]
            assistant = group[0][0]
            # Live progress for the caller: which assistant just finished which
            # questions, and how far along collection is. A failing callback
            # must never take the audit down with it.
            completed_groups += 1
            if progress_callback is not None:
                try:
                    progress_callback(
                        {
                            "assistant": assistant,
                            "questions": [item[2].get("prompt", "") for item in group],
                            "completed_groups": completed_groups,
                            "total_groups": len(task_groups),
                        }
                    )
                except Exception:  # noqa: BLE001 - progress is best-effort.
                    pass
            try:
                group_results = future.result()
            except Exception as exc:  # noqa: BLE001 - keep audit running.
                errors.append(
                    {
                        "assistant": assistant,
                        "prompt_index": ",".join(str(item[1]) for item in group),
                        "error": str(exc),
                    }
                )
                continue
            for index, result, payload_preview, error in group_results:
                payloads.append(payload_preview)
                if error:
                    errors.append(
                        {
                            "assistant": assistant,
                            "prompt_index": str(index),
                            "error": error,
                        }
                    )
                elif result:
                    provider_items.append(result)

    payloads.sort(key=lambda item: (item.get("assistant", ""), item.get("prompt_index", 0)))
    provider_items.sort(key=lambda item: (item.get("assistant", ""), item.get("prompt_index", 0)))

    if not analysis_mode:
        return provider_items, payloads, errors

    structured_results = [
        item
        for item in provider_items
        if item.get("collection_mode") == "structured_provider_batch"
    ]
    pending_analysis = [
        item
        for item in provider_items
        if item.get("collection_mode") != "structured_provider_batch"
    ]
    analyzed_results, analysis_errors = batch_analyze_provider_results(
        pending_analysis,
        batch_size=analyzer_batch_size,
    )
    errors.extend(analysis_errors)
    results = sorted(
        [*structured_results, *analyzed_results],
        key=lambda item: (item.get("assistant", ""), item.get("prompt_index", 0)),
    )
    return results, payloads, errors


def collect_recommendation_group(
    group: list[tuple[str, int, dict[str, str]]],
    *,
    model: str | None,
    defer_analysis: bool,
    search_context_size: str | None = None,
) -> list[tuple[int, dict[str, Any] | None, dict[str, Any], str | None]]:
    assistant = group[0][0]
    if assistant == "openai_search":
        try:
            return collect_openai_search_batch(
                group,
                model=model,
                search_context_size=search_context_size,
            )
        except (TimeoutError, JSONDecodeError, ValueError):
            # A malformed or slow structured answer is worth one retry before
            # falling back to the slower prose-plus-analyzer path.
            try:
                return collect_openai_search_batch(
                    group,
                    model=model,
                    search_context_size=search_context_size,
                )
            except (LLMNotConfigured, RuntimeError, JSONDecodeError, ValueError, TimeoutError):
                pass
        except (LLMNotConfigured, RuntimeError):
            pass
        return collect_group_individually(
            group,
            model=model,
            defer_analysis=defer_analysis,
        )

    if assistant not in bedrock_assistants():
        return collect_group_individually(
            group,
            model=model,
            defer_analysis=defer_analysis,
        )

    items = [
        {"prompt_index": index, "question": prompt_record["prompt"]}
        for _, index, prompt_record in group
    ]
    system_prompt = (
        MISTRAL_BATCH_BUYER_ANSWER_SYSTEM_PROMPT
        if assistant == "bedrock_mistral"
        else BATCH_BUYER_ANSWER_SYSTEM_PROMPT
    )
    # Room for every answer in the batch, not a fixed ceiling. One call carries
    # all of an assistant's questions, so the reply grows with the batch. At
    # 4000 tokens a twenty-question batch runs out, the reply comes back
    # missing answers, and the code falls back to asking one question at a
    # time — which is the slowest path in the audit.
    per_answer_tokens = 250 if assistant == "bedrock_mistral" else 320
    ceiling = 6000 if assistant == "bedrock_mistral" else 12000
    max_tokens = min(
        ceiling,
        max(
            3000 if assistant == "bedrock_mistral" else 4000,
            per_answer_tokens * len(group) + 600,
        ),
    )
    try:
        raw_response, metadata = call_bedrock_converse(
            system_prompt,
            json.dumps({"questions": items}, ensure_ascii=False),
            provider=assistant,
            model=model,
            temperature=0.2,
            # The limit is completion headroom, not a requested response length.
            max_tokens=max_tokens,
        )
        parsed = extract_json_object(raw_response)
        answers = parsed.get("answers", [])
        answers_by_index = {
            int(item.get("prompt_index")): item
            for item in answers
            if isinstance(item, dict) and str(item.get("prompt_index", "")).isdigit()
        }
        if any(
            not str(answers_by_index.get(index, {}).get("answer_text", "")).strip()
            for _, index, _ in group
        ):
            raise ValueError("Batched provider response omitted one or more questions.")

        resolved_model = metadata.get("model", model or assistant)
        results = []
        for _, index, prompt_record in group:
            structured_answer = answers_by_index[index]
            answer = str(structured_answer.get("answer_text", "")).strip()
            recommendation_rejections: list[dict[str, Any]] = []
            payload = {
                "provider": assistant,
                "model": resolved_model,
                "system_prompt": system_prompt,
                "questions": items,
            }
            preview = build_payload_preview(
                prompt_record,
                assistant=assistant,
                prompt_index=index,
                model=resolved_model,
                payload=payload,
            )
            recommendations = normalize_recommendations(
                structured_answer.get("recommended_companies", []),
                answer_text=answer,
                require_evidence=True,
                rejection_log=recommendation_rejections,
            )[:5]
            result = {
                "prompt_index": index,
                "prompt": prompt_record["prompt"],
                "prompt_category": prompt_record["category"],
                "buying_stage": prompt_record["buying_stage"],
                "model": resolved_model,
                "assistant": assistant,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "recommended_companies": recommendations,
                "overall_reasoning": str(
                    structured_answer.get("overall_reasoning", "")
                ),
                "unknowns": normalize_string_list(
                    structured_answer.get("unknowns", [])
                ),
                "parse_error": None,
                "analysis_confidence": structured_answer_confidence(
                    recommendations
                ),
                "collection_mode": "structured_provider_batch",
                "provider_source_urls": [],
                "provider_batch": {
                    "question_count": len(group),
                    "usage": metadata.get("usage", {}),
                    "metrics": metadata.get("metrics", {}),
                },
                "provider_structured_answer": structured_answer,
                "recommendation_rejections": recommendation_rejections,
                "raw_response": answer,
            }
            results.append((index, result, preview, None))
        return results
    except (LLMNotConfigured, RuntimeError, JSONDecodeError, ValueError) as exc:
        # Preserve report completeness when a model cannot follow the batch schema.
        fallback_results = collect_group_individually(
            group,
            model=model,
            defer_analysis=defer_analysis,
        )
        for _, result, _, _ in fallback_results:
            if result is not None:
                result["provider_batch_fallback"] = {
                    "used": True,
                    "reason": str(exc),
                }
        return fallback_results


def collect_openai_search_batch(
    group: list[tuple[str, int, dict[str, str]]],
    *,
    model: str | None,
    search_context_size: str | None = None,
) -> list[tuple[int, dict[str, Any] | None, dict[str, Any], str | None]]:
    """Answers a group of questions with web search. Groups of one run side by
    side, so five questions take as long as the slowest one rather than the sum,
    and a failure costs one question instead of the whole set."""
    items = [
        {"prompt_index": index, "question": prompt_record["prompt"]}
        for _, index, prompt_record in group
    ]
    payload = build_openai_response_payload(
        OPENAI_SEARCH_BATCH_SYSTEM_PROMPT,
        json.dumps({"questions": items}, ensure_ascii=False),
        model=model,
        use_web_search=True,
        search_context_size=search_context_size,
        cache_key=PROMPT_CACHE_KEY,
    )
    payload["text"] = {
        "format": {
            "type": "json_schema",
            "name": "batch_buyer_recommendations",
            "strict": True,
            "schema": OPENAI_SEARCH_BATCH_SCHEMA,
        }
    }
    payload["reasoning"] = {"effort": "low"}
    # One question needs far fewer tokens than five, so a single-question call
    # is not billed a five-question ceiling.
    payload["max_output_tokens"] = min(8000, 1800 + 1400 * len(group))

    raw_response, metadata = call_openai_response(payload)
    parsed = extract_json_object(raw_response)
    answers = parsed.get("answers", [])
    answers_by_index = {
        int(item.get("prompt_index")): item
        for item in answers
        if isinstance(item, dict) and str(item.get("prompt_index", "")).isdigit()
    }
    if any(
        not str(answers_by_index.get(index, {}).get("answer_text", "")).strip()
        for _, index, _ in group
    ):
        raise ValueError("OpenAI batch response omitted one or more questions.")

    annotated_urls = extract_openai_response_source_urls(metadata)
    citation_origin = (
        "native_openai_annotation"
        if annotated_urls
        else "structured_web_search_output_pending_verification"
    )
    resolved_model = str(metadata.get("model") or payload["model"])
    results = []
    for _, index, prompt_record in group:
        structured_answer = answers_by_index[index]
        answer = str(structured_answer.get("answer_text", "")).strip()
        reported_source_urls = normalize_http_urls(
            structured_answer.get("source_urls", [])
        )
        answer_source_urls = (
            filter_annotated_urls(reported_source_urls, annotated_urls)
            if annotated_urls
            else reported_source_urls
        )
        recommendation_items = []
        for recommendation in structured_answer.get("recommended_companies", []):
            if not isinstance(recommendation, dict):
                continue
            recommendation_items.append(
                {
                    **recommendation,
                    "source_urls": filter_annotated_urls(
                        recommendation.get("source_urls", []),
                        answer_source_urls,
                    ),
                }
            )
        recommendations = normalize_recommendations(
            recommendation_items,
            answer_text=answer,
            require_evidence=False,
        )
        preview = build_payload_preview(
            prompt_record,
            assistant="openai_search",
            prompt_index=index,
            model=resolved_model,
            payload=payload,
        )
        result = {
            "prompt_index": index,
            "prompt": prompt_record["prompt"],
            "prompt_category": prompt_record["category"],
            "buying_stage": prompt_record["buying_stage"],
            "model": resolved_model,
            "assistant": "openai_search",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "recommended_companies": recommendations,
            "overall_reasoning": str(
                structured_answer.get("overall_reasoning", "")
            ),
            "unknowns": normalize_string_list(
                structured_answer.get("unknowns", [])
            ),
            "parse_error": None,
            "analysis_confidence": structured_answer_confidence(
                recommendations
            ),
            "collection_mode": "structured_provider_batch",
            "provider_source_urls": answer_source_urls,
            "provider_citation_origin": citation_origin,
            "provider_batch": {
                "response_id": metadata.get("id"),
                "question_count": len(group),
                "usage": metadata.get("usage", {}),
            },
            "raw_response": answer,
        }
        results.append((index, result, preview, None))
    return results


def collect_group_individually(
    group: list[tuple[str, int, dict[str, str]]],
    *,
    model: str | None,
    defer_analysis: bool,
) -> list[tuple[int, dict[str, Any] | None, dict[str, Any], str | None]]:
    def collect(
        task: tuple[str, int, dict[str, str]],
    ) -> tuple[int, dict[str, Any] | None, dict[str, Any], str | None]:
        assistant, index, prompt_record = task
        return (
            index,
            *collect_single_recommendation(
                prompt_record,
                assistant=assistant,
                prompt_index=index,
                model=model,
                analysis_mode=False,
                defer_analysis=defer_analysis,
            ),
        )

    workers = max(1, min(4, len(group)))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        results = list(executor.map(collect, group))
    return results


def filter_annotated_urls(
    candidate_urls: Any,
    annotated_urls: list[str],
) -> list[str]:
    if not isinstance(candidate_urls, list):
        return []
    annotated = {
        str(url).strip().rstrip("/"): str(url).strip()
        for url in annotated_urls
        if str(url).strip()
    }
    filtered = []
    for candidate in candidate_urls:
        key = str(candidate).strip().rstrip("/")
        if key in annotated:
            filtered.append(annotated[key])
    return list(dict.fromkeys(filtered))


def normalize_http_urls(candidate_urls: Any) -> list[str]:
    if not isinstance(candidate_urls, list):
        return []
    return list(
        dict.fromkeys(
            str(candidate).strip()
            for candidate in candidate_urls
            if str(candidate).strip().startswith(("http://", "https://"))
        )
    )


def collect_single_recommendation(
    prompt_record: dict[str, str],
    *,
    assistant: str,
    prompt_index: int,
    model: str | None = None,
    analysis_mode: bool = False,
    defer_analysis: bool = False,
) -> tuple[dict[str, Any] | None, dict[str, Any], str | None]:
    prompt = prompt_record["prompt"]
    payload: dict[str, Any]
    raw_response = ""
    provider_metadata: dict[str, Any] = {}
    resolved_model = model

    try:
        if assistant == "openai":
            payload = (
                build_buyer_answer_payload(prompt, model=model)
                if analysis_mode
                else build_recommendation_payload(prompt, model=model)
            )
            resolved_model = payload["model"]
            raw_response = call_chat_completion(payload)
        elif assistant == "openai_search":
            payload = build_openai_search_answer_payload(prompt, model=model)
            resolved_model = payload["model"]
            raw_response, provider_metadata = call_openai_response(payload)
        elif assistant == "claude":
            payload = (
                build_claude_buyer_answer_payload(prompt, model=model)
                if analysis_mode
                else build_claude_recommendation_payload(prompt, model=model)
            )
            resolved_model = payload["model"]
            raw_response = call_anthropic_message(payload)
        elif assistant in bedrock_assistants():
            raw_response, provider_metadata = call_bedrock_converse(
                BUYER_ANSWER_SYSTEM_PROMPT if (analysis_mode or defer_analysis) else RECOMMENDATION_SYSTEM_PROMPT,
                prompt,
                provider=assistant,
                model=model,
                temperature=0.2,
            )
            payload = {
                "provider": assistant,
                "model": provider_metadata.get("model", model or "default"),
                "system_prompt": BUYER_ANSWER_SYSTEM_PROMPT
                if (analysis_mode or defer_analysis)
                else RECOMMENDATION_SYSTEM_PROMPT,
                "prompt": prompt,
            }
            resolved_model = provider_metadata.get("model", model or assistant)
        elif assistant == "gemini":
            payload = build_gemini_recommendation_payload(prompt)
            raw_response, provider_metadata = call_gemini_generate_content(
                payload,
                model=model,
            )
            resolved_model = model or provider_metadata.get("modelVersion") or "gemini"
        else:
            return None, {}, f"Unsupported assistant: {assistant}"
    except (LLMNotConfigured, RuntimeError) as exc:
        payload_preview = build_payload_preview(
            prompt_record,
            assistant=assistant,
            prompt_index=prompt_index,
            model=resolved_model,
            payload={},
        )
        return None, payload_preview, str(exc)

    payload_preview = build_payload_preview(
        prompt_record,
        assistant=assistant,
        prompt_index=prompt_index,
        model=resolved_model,
        payload=payload,
    )
    result = normalize_recommendation_response(
        raw_response,
        prompt_record,
        assistant=assistant,
        prompt_index=prompt_index,
        model=resolved_model or assistant,
        provider_metadata=provider_metadata,
        analysis_mode=analysis_mode,
        defer_analysis=defer_analysis,
    )
    return result, payload_preview, None


def build_recommendation_payload(prompt: str, *, model: str | None = None) -> dict[str, Any]:
    return build_chat_payload(
        RECOMMENDATION_SYSTEM_PROMPT,
        prompt,
        model=model,
        temperature=0.2,
        json_response=True,
    )


def build_buyer_answer_payload(prompt: str, *, model: str | None = None) -> dict[str, Any]:
    return build_chat_payload(
        BUYER_ANSWER_SYSTEM_PROMPT,
        prompt,
        model=model,
        temperature=0.2,
        json_response=False,
    )


def build_openai_search_answer_payload(prompt: str, *, model: str | None = None) -> dict[str, Any]:
    return build_openai_response_payload(
        BUYER_ANSWER_SYSTEM_PROMPT,
        prompt,
        model=model,
        use_web_search=True,
    )


def build_claude_recommendation_payload(prompt: str, *, model: str | None = None) -> dict[str, Any]:
    return build_anthropic_payload(
        RECOMMENDATION_SYSTEM_PROMPT,
        prompt,
        model=model,
        temperature=0.2,
    )


def build_claude_buyer_answer_payload(prompt: str, *, model: str | None = None) -> dict[str, Any]:
    return build_anthropic_payload(
        BUYER_ANSWER_SYSTEM_PROMPT,
        prompt,
        model=model,
        temperature=0.2,
    )


def build_gemini_recommendation_payload(prompt: str) -> dict[str, Any]:
    return build_gemini_payload(
        RECOMMENDATION_SYSTEM_PROMPT,
        prompt,
        temperature=0.2,
        json_response=False,
        use_google_search=True,
    )


def normalize_recommendation_response(
    raw_response: str,
    prompt_record: dict[str, str],
    *,
    assistant: str,
    prompt_index: int,
    model: str,
    provider_metadata: dict[str, Any] | None = None,
    analysis_mode: bool = False,
    defer_analysis: bool = False,
) -> dict[str, Any]:
    provider_metadata = provider_metadata or {}
    grounding_urls = extract_gemini_grounding_urls(provider_metadata)
    if defer_analysis:
        parsed = {
            "recommended_companies": [],
            "overall_reasoning": "",
            "unknowns": [],
            "analysis_confidence": None,
        }
        parse_error = None
    elif analysis_mode:
        parsed, parse_error = analyze_provider_answer(raw_response, grounding_urls)
    else:
        try:
            parsed = extract_json_object(raw_response)
            parse_error = None
        except (JSONDecodeError, ValueError) as exc:
            fallback_recommendations = parse_markdown_recommendations(raw_response)
            parsed = {
                "recommended_companies": fallback_recommendations,
                "overall_reasoning": "",
                "unknowns": [],
            }
            parse_error = None if fallback_recommendations else str(exc)

    recommendations = normalize_recommendations(
        parsed.get("recommended_companies", []),
        answer_text=raw_response,
    )[:5]

    return {
        "prompt_index": prompt_index,
        "prompt": prompt_record["prompt"],
        "prompt_category": prompt_record["category"],
        "buying_stage": prompt_record["buying_stage"],
        "model": model,
        "assistant": assistant,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "recommended_companies": recommendations,
        "overall_reasoning": parsed.get("overall_reasoning", ""),
        "unknowns": parsed.get("unknowns", []),
        "parse_error": parse_error,
        "analysis_confidence": parsed.get("analysis_confidence"),
        "collection_mode": "provider_answer_pending_analysis"
        if defer_analysis
        else "provider_answer_analysis"
        if analysis_mode
        else "structured_provider_json",
        "provider_source_urls": grounding_urls,
        "raw_response": raw_response,
    }


def batch_analyze_provider_results(
    provider_results: list[dict[str, Any]],
    *,
    batch_size: int = 5,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    analyzed_results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    batches = [
        (batch_start, provider_results[batch_start : batch_start + batch_size])
        for batch_start in range(0, len(provider_results), batch_size)
    ]
    if not batches:
        return analyzed_results, errors

    with ThreadPoolExecutor(max_workers=min(4, len(batches))) as executor:
        futures = {
            executor.submit(analyze_provider_answer_batch, batch): (batch_start, batch)
            for batch_start, batch in batches
        }
        completed_batches = []
        for future in as_completed(futures):
            batch_start, batch = futures[future]
            try:
                analysis, error = future.result()
            except Exception as exc:  # noqa: BLE001 - preserve fallback parsing.
                analysis, error = [], str(exc)
            completed_batches.append((batch_start, batch, analysis, error))

    for batch_start, batch, analysis, error in sorted(completed_batches):
        analysis_by_key = {
            (item.get("prompt_index"), item.get("assistant")): item
            for item in analysis
        }
        if error:
            errors.append(
                {
                    "assistant": "analyzer",
                    "prompt_index": f"{batch_start + 1}-{batch_start + len(batch)}",
                    "error": error,
                }
            )

        for result in batch:
            key = (result.get("prompt_index"), result.get("assistant"))
            parsed = analysis_by_key.get(key)
            if parsed is None:
                fallback_recommendations = parse_markdown_recommendations(
                    result.get("raw_response", "")
                )
                parsed = {
                    "recommended_companies": fallback_recommendations,
                    "overall_reasoning": "Fallback parser used.",
                    "unknowns": ["Batch analyzer did not return this item."],
                    "analysis_confidence": 0.35 if fallback_recommendations else 0.1,
                }

            normalized = dict(result)
            recommendations = normalize_recommendations(
                parsed.get("recommended_companies", []),
                answer_text=result.get("raw_response", ""),
            )
            normalized.update(
                {
                    "recommended_companies": recommendations,
                    "overall_reasoning": parsed.get("overall_reasoning", ""),
                    "unknowns": parsed.get("unknowns", []),
                    "analysis_confidence": parsed.get("analysis_confidence"),
                    "parse_error": None
                    if recommendations or parsed.get("overall_reasoning")
                    else result.get("parse_error"),
                    "collection_mode": "provider_answer_batch_analysis",
                }
            )
            analyzed_results.append(normalized)

    analyzed_results.sort(
        key=lambda item: (item.get("assistant", ""), item.get("prompt_index", 0))
    )
    return analyzed_results, errors


def verify_provider_citations(
    provider_results: list[dict[str, Any]],
    *,
    concurrency: int = 6,
    match_terms: tuple[str, ...] = (),
) -> list[dict[str, Any]]:
    """Drop cited URLs that do not load. When match_terms are supplied, each
    surviving citation also records whether that page names the audited
    company, which is what lets the report say a source never mentions them."""
    urls = list(
        dict.fromkeys(
            str(url)
            for result in provider_results
            for url in result.get("provider_source_urls", [])
            if str(url).strip()
        )
    )
    if not urls:
        return provider_results

    verification: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(
        max_workers=max(1, min(concurrency, len(urls)))
    ) as executor:
        futures = {
            executor.submit(verify_source_url, url, match_terms=match_terms): url
            for url in urls
        }
        for future in as_completed(futures):
            url = futures[future]
            try:
                verification[url] = future.result()
            except Exception as exc:  # noqa: BLE001 - reject unverified URL.
                verification[url] = {
                    "url": url,
                    "verified": False,
                    "error": str(exc),
                }

    verified_results = []
    for result in provider_results:
        item = dict(result)
        checks = [
            verification[str(url)]
            for url in result.get("provider_source_urls", [])
            if str(url) in verification
        ]
        item["provider_citation_verification"] = checks
        item["provider_source_urls"] = list(
            dict.fromkeys(
                str(check.get("resolved_url") or check.get("url"))
                for check in checks
                if check.get("verified")
            )
        )
        if item["provider_source_urls"]:
            origin = str(item.get("provider_citation_origin", ""))
            if origin == "structured_web_search_output_pending_verification":
                item["provider_citation_origin"] = (
                    "structured_web_search_output_verified"
                )
            elif origin == "native_openai_annotation":
                item["provider_citation_origin"] = (
                    "native_openai_annotation_verified"
                )
        verified_results.append(item)
    return verified_results


def analyze_provider_answer_batch(
    provider_results: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], str | None]:
    items = [
        {
            "prompt_index": result.get("prompt_index"),
            "assistant": result.get("assistant"),
            "model": result.get("model"),
            "prompt": result.get("prompt"),
            "answer": result.get("raw_response", ""),
            "provider_source_urls": result.get("provider_source_urls", []),
        }
        for result in provider_results
    ]
    payload = build_chat_payload(
        BATCH_ANSWER_ANALYSIS_SYSTEM_PROMPT,
        json.dumps({"items": items}, indent=2, ensure_ascii=False),
        temperature=0,
        json_response=True,
    )
    # This call turns raw answers into the recommended companies the whole audit
    # is built on. A single timeout here used to empty the entire report, so a
    # transient failure is retried once before giving up.
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            raw_analysis = call_chat_completion(payload)
            parsed = extract_json_object(raw_analysis)
            results = parsed.get("results", [])
            return results if isinstance(results, list) else [], None
        except (TimeoutError, JSONDecodeError, ValueError) as exc:
            last_error = exc
            continue
        except (LLMNotConfigured, RuntimeError) as exc:
            return [], str(exc)
    return [], str(last_error)


def analyze_provider_answer(
    raw_response: str,
    source_urls: list[str],
) -> tuple[dict[str, Any], str | None]:
    payload = build_chat_payload(
        ANSWER_ANALYSIS_SYSTEM_PROMPT,
        json.dumps(
            {
                "answer": raw_response,
                "source_urls": source_urls,
            },
            indent=2,
            ensure_ascii=False,
        ),
        temperature=0,
        json_response=True,
    )
    try:
        raw_analysis = call_chat_completion(payload)
        parsed = extract_json_object(raw_analysis)
        return parsed, None
    except (LLMNotConfigured, RuntimeError, JSONDecodeError, ValueError) as exc:
        fallback_recommendations = parse_markdown_recommendations(raw_response)
        return (
            {
                "recommended_companies": fallback_recommendations,
                "overall_reasoning": "Fallback parser used.",
                "unknowns": ["LLM answer analysis unavailable."],
                "analysis_confidence": 0.35 if fallback_recommendations else 0.1,
            },
            str(exc) if not fallback_recommendations else None,
        )


def extract_gemini_grounding_urls(metadata: dict[str, Any]) -> list[str]:
    if metadata.get("output"):
        return extract_openai_response_source_urls(metadata)
    urls: list[str] = []
    for candidate in metadata.get("candidates", []):
        grounding = candidate.get("groundingMetadata", {})
        for chunk in grounding.get("groundingChunks", []):
            web = chunk.get("web", {})
            uri = web.get("uri")
            if uri:
                urls.append(str(uri))
    return list(dict.fromkeys(urls))


def supported_assistants() -> set[str]:
    return {
        "openai",
        "openai_search",
        "claude",
        "gemini",
        *bedrock_assistants(),
    }


def bedrock_assistants() -> set[str]:
    return {
        "bedrock_claude",
        "bedrock_nova",
        "bedrock_llama",
        "bedrock_mistral",
    }


def add_fallback_source_urls(
    recommendations: list[dict[str, Any]],
    source_urls: list[str],
) -> list[dict[str, Any]]:
    if not recommendations:
        return recommendations
    updated = []
    for recommendation in recommendations:
        item = dict(recommendation)
        if not item.get("source_urls"):
            item["source_urls"] = source_urls
        updated.append(item)
    return updated


def parse_markdown_recommendations(raw_response: str) -> list[dict[str, Any]]:
    lines = raw_response.splitlines()
    recommendations: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    capture_reasoning = False
    in_recommendations = False

    for raw_line in lines:
        line = raw_line.strip()
        if "recommended companies" in line.lower():
            in_recommendations = True
            continue
        if not in_recommendations:
            continue

        heading_match = re.match(r"^(?:\d+[\.)]\s+|[-*]\s+)?\*\*(.+?)\*\*", line)
        if heading_match:
            name = heading_match.group(1).strip()
            label = name.rstrip(":").lower()
            if label == "rank":
                rank_match = re.search(r"\*\*Rank:\*\*\s*(\d+)", line, flags=re.IGNORECASE)
                if current and rank_match:
                    current["rank"] = int(rank_match.group(1))
                capture_reasoning = False
                continue
            if label == "reasoning":
                if current:
                    current["reasoning"] = re.sub(
                        r"^\*?\s*\*\*Reasoning:\*\*\s*",
                        "",
                        line,
                        flags=re.IGNORECASE,
                    ).strip()
                capture_reasoning = True
                continue
            if label in {"citations", "source urls"}:
                if current:
                    urls = re.findall(r"https?://\S+", line)
                    current["source_urls"].extend(clean_urls(urls))
                capture_reasoning = False
                continue
            if current:
                recommendations.append(current)
            current = {
                "company_name": name,
                "rank": len(recommendations) + 1,
                "reasoning": "",
                "citations": [],
                "source_urls": [],
            }
            capture_reasoning = False
            continue

        if not current:
            continue

        rank_match = re.search(r"\*\*Rank:\*\*\s*(\d+)", line, flags=re.IGNORECASE)
        if rank_match:
            current["rank"] = int(rank_match.group(1))
            capture_reasoning = False
            continue

        if re.search(r"\*\*Reasoning:\*\*", line, flags=re.IGNORECASE):
            current["reasoning"] = re.sub(
                r"^\*?\s*\*\*Reasoning:\*\*\s*",
                "",
                line,
                flags=re.IGNORECASE,
            ).strip()
            capture_reasoning = True
            continue

        if re.search(r"\*\*(Citations|Source URLs):\*\*", line, flags=re.IGNORECASE):
            capture_reasoning = False
            urls = re.findall(r"https?://\S+", line)
            current["source_urls"].extend(clean_urls(urls))
            continue

        urls = re.findall(r"https?://\S+", line)
        if urls:
            current["source_urls"].extend(clean_urls(urls))
            capture_reasoning = False
            continue

        if capture_reasoning and line and not line.startswith("*"):
            current["reasoning"] = f"{current['reasoning']} {line}".strip()

    if current:
        recommendations.append(current)

    return [
        {
            **item,
            "source_urls": list(dict.fromkeys(item["source_urls"])),
        }
        for item in recommendations
        if item.get("company_name")
    ]


def clean_urls(urls: list[str]) -> list[str]:
    return [url.rstrip(").,]") for url in urls]


def build_payload_preview(
    prompt_record: dict[str, str],
    *,
    assistant: str,
    prompt_index: int,
    model: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return {
        "prompt_index": prompt_index,
        "assistant": assistant,
        "model": model or "default",
        "prompt": prompt_record["prompt"],
        "category": prompt_record["category"],
        "buying_stage": prompt_record["buying_stage"],
        "payload": payload,
    }


def normalize_prompt_records(prompts: list[Any]) -> list[dict[str, str]]:
    records = []
    for item in prompts:
        if isinstance(item, dict):
            prompt = str(item.get("prompt", "")).strip()
            category = str(item.get("category", "Unknown")).strip() or "Unknown"
            buying_stage = str(item.get("buying_stage", "Unknown")).strip() or "Unknown"
        else:
            prompt = str(item).strip()
            category = "Unknown"
            buying_stage = "Unknown"

        if prompt:
            records.append(
                {
                    "prompt": prompt,
                    "category": category,
                    "buying_stage": buying_stage,
                }
            )
    return records


NON_VENDOR_NAMES = {
    "ai",
    "artificial intelligence",
    "computer vision",
    "cctv",
    "machine learning",
    "software",
    "platform",
    "solution",
    "gartner",
    "forrester",
    "idc",
}


def normalize_recommendations(
    items: Any,
    *,
    answer_text: str = "",
    require_evidence: bool = False,
    rejection_log: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []

    normalized = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            company_name = str(item).strip()
            if not is_plausible_vendor_name(company_name):
                continue
            normalized.append(
                {
                    "company_name": company_name,
                    "rank": index,
                    "reasoning": "",
                    "evidence_quote": "",
                    "explicitly_recommended": True,
                    "extraction_confidence": 0.4,
                    "citations": [],
                    "source_urls": [],
                }
            )
            continue

        company_name = str(item.get("company_name", "Unknown")).strip()
        explicitly_recommended = item.get("explicitly_recommended", True) is not False
        evidence_quote = str(item.get("evidence_quote", "")).strip()
        quote_verified = quote_appears_in_answer(evidence_quote, answer_text)
        company_appears = company_name_appears_in_answer(company_name, answer_text)
        rejection_reason = None
        if not explicitly_recommended:
            rejection_reason = "not_explicitly_recommended"
        elif not is_plausible_vendor_name(company_name):
            rejection_reason = "implausible_vendor_name"
        elif require_evidence and not quote_verified and not company_appears:
            rejection_reason = "company_and_evidence_quote_absent_from_answer"
        if rejection_reason:
            if rejection_log is not None:
                rejection_log.append(
                    {
                        "company_name": company_name,
                        "reason": rejection_reason,
                        "evidence_quote": evidence_quote,
                    }
                )
            continue
        if not quote_verified and company_appears:
            evidence_quote = evidence_sentence_for_company(answer_text, company_name)

        normalized.append(
            {
                "company_name": company_name,
                "rank": coerce_rank(item.get("rank"), index),
                "reasoning": str(item.get("reasoning", "")),
                "evidence_quote": evidence_quote,
                "explicitly_recommended": explicitly_recommended,
                "extraction_confidence": 0.95
                if quote_verified
                else 0.85
                if company_appears and evidence_quote
                else 0.5,
                "citations": normalize_string_list(item.get("citations", [])),
                "source_urls": normalize_string_list(item.get("source_urls", [])),
            }
        )
    return [item for item in normalized if item["company_name"] and item["company_name"] != "Unknown"]


def quote_appears_in_answer(quote: str, answer_text: str) -> bool:
    if not quote or not answer_text:
        return False
    normalized_quote = " ".join(quote.lower().split())
    normalized_answer = " ".join(answer_text.lower().split())
    return normalized_quote in normalized_answer


def company_name_appears_in_answer(company_name: str, answer_text: str) -> bool:
    if not company_name or not answer_text:
        return False
    return bool(
        re.search(
            rf"(?<![A-Za-z0-9]){re.escape(company_name)}(?![A-Za-z0-9])",
            answer_text,
            flags=re.IGNORECASE,
        )
    )


def evidence_sentence_for_company(answer_text: str, company_name: str) -> str:
    chunks = re.split(r"(?<=[.!?])\s+|\n+", answer_text)
    for chunk in chunks:
        candidate = " ".join(chunk.split()).strip()
        if company_name_appears_in_answer(company_name, candidate):
            return candidate[:600]
    return ""


def is_plausible_vendor_name(value: str) -> bool:
    normalized = " ".join(value.lower().split()).strip(" .,:;")
    if not normalized or normalized == "unknown" or normalized in NON_VENDOR_NAMES:
        return False
    if "/" in value or re.search(r"\([^)]{12,}\)", value):
        return False
    return bool(re.search(r"[a-z0-9]", normalized)) and len(normalized) <= 120


def structured_answer_confidence(
    recommendations: list[dict[str, Any]],
) -> float:
    if not recommendations:
        return 0.8
    return round(
        sum(float(item.get("extraction_confidence", 0.5)) for item in recommendations)
        / len(recommendations),
        2,
    )


def coerce_rank(value: Any, fallback: int) -> int:
    try:
        rank = int(value)
    except (TypeError, ValueError):
        return fallback
    return rank if rank > 0 else fallback


def normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def save_prompt_payloads_preview(payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "prompt_index": item["prompt_index"],
            "assistant": item.get("assistant", "openai"),
            "model": item.get("model", "default"),
            "prompt": item["prompt"],
            "payload": item["payload"],
        }
        for item in payloads
    ]
