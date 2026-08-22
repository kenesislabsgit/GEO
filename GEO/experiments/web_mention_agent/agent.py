from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import time
from typing import Any, Callable
from urllib.parse import urlparse

from geo_audit.crawler import parse_page, same_page_key
from geo_audit.json_tools import extract_json_object
from geo_audit.llm import build_chat_payload, call_chat_message, load_dotenv
from geo_audit.netguard import open_url_guarded
from geo_audit.source_analysis import domain_from_url, same_or_subdomain
from geo_audit.web_presence import (
    build_search_client,
    company_aliases,
    contains_phrase,
    mention_windows,
    same_company,
)

from .prompt import SYSTEM_PROMPT, user_prompt


MAX_AGENT_TURNS = 10
MAX_TOOL_CALLS = 24
MAX_SEARCHES = 30
MAX_RESULTS_PER_SEARCH = 2
MAX_OFFICIAL_RESULTS_PER_SEARCH = 5
MAX_SEARCH_CANDIDATES = 6
MAX_EXTERNAL_SEARCHES_PER_COMPANY = 3
MAX_OFFICIAL_SEARCHES_PER_COMPANY = 1
MAX_HOMEPAGE_READS = 14
MAX_PASSAGE_PAGES = 40
FETCH_WORKERS = 12
SEARCH_WORKERS = 12
MAX_HOMEPAGE_TEXT = 6000
MAX_DEBUG_PAGE_TEXT = 12000


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_homepages",
            "description": (
                "Read known or candidate official homepages in parallel. Returns "
                "title, description, headings and compact homepage text."
            ),
            "parameters": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "pages": {
                        "type": "array",
                        "maxItems": MAX_HOMEPAGE_READS,
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "company_id": {"type": "string"},
                                "url": {"type": "string"},
                            },
                            "required": ["company_id", "url"],
                        },
                    }
                },
                "required": ["pages"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "Run searches in parallel. Returns only result URLs grouped by "
                "company, query and purpose."
            ),
            "parameters": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "searches": {
                        "type": "array",
                        "maxItems": MAX_SEARCHES,
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "company_id": {"type": "string"},
                                "query": {"type": "string"},
                                "purpose": {
                                    "enum": ["official_website", "external_mentions"]
                                },
                            },
                            "required": ["company_id", "query", "purpose"],
                        },
                    }
                },
                "required": ["searches"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_company_passages",
            "description": (
                "Download external result URLs in parallel, find supplied company "
                "names, and return compact passages around the matches."
            ),
            "parameters": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "pages": {
                        "type": "array",
                        "maxItems": MAX_PASSAGE_PAGES,
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "company_id": {"type": "string"},
                                "company_name": {"type": "string"},
                                "names_to_find": {
                                    "type": "array",
                                    "minItems": 1,
                                    "maxItems": 6,
                                    "items": {"type": "string"},
                                },
                                "url": {"type": "string"},
                            },
                            "required": [
                                "company_id",
                                "company_name",
                                "names_to_find",
                                "url",
                            ],
                        },
                    }
                },
                "required": ["pages"],
            },
        },
    },
]


FINAL_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "companies": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "company_name": {"type": "string"},
                    "official_website_url": {
                        "type": ["string", "null"]
                    },
                    "verified_web_mentions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "url": {"type": "string"},
                                "reason_for_choosing": {"type": "string"},
                                "supporting_passage_ids": {
                                    "type": "array",
                                    "minItems": 1,
                                    "maxItems": 4,
                                    "items": {"type": "string"},
                                },
                            },
                            "required": [
                                "url",
                                "reason_for_choosing",
                                "supporting_passage_ids",
                            ],
                        },
                    },
                },
                "required": [
                    "company_name",
                    "official_website_url",
                    "verified_web_mentions",
                ],
            },
        }
    },
    "required": ["companies"],
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalized_name(value: Any) -> str:
    return " ".join(str(value or "").lower().split())


def is_http_url(value: Any) -> bool:
    parsed = urlparse(str(value or "").strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def compact(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[:limit].rstrip() + "..."


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def fetch_experiment_html(url: str) -> tuple[str, int, str]:
    """Guarded fetch with conservative HTML sniffing for missing headers."""
    final_url, headers, body = open_url_guarded(
        url,
        timeout=15,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0 Safari/537.36 GEOAuditExperiment/0.1"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    content_type = next(
        (
            str(value)
            for key, value in headers.items()
            if str(key).lower() == "content-type"
        ),
        "",
    )
    sample = body[:4096].lstrip().lower()
    looks_like_html = any(
        marker in sample for marker in (b"<!doctype html", b"<html", b"<head", b"<body")
    )
    if (
        "text/html" not in content_type.lower()
        and "application/xhtml+xml" not in content_type.lower()
        and not (not content_type and looks_like_html)
    ):
        raise ValueError(f"Unsupported content type: {content_type}")
    charset = "utf-8"
    match = re.search(r"charset=([A-Za-z0-9_-]+)", content_type)
    if match:
        charset = match.group(1)
    return body.decode(charset, errors="replace"), 200, final_url


def build_experiment_input(
    source_run: str | Path,
    *,
    remove_link_for: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build the six-company input only from one saved production audit.

    The withheld URL is kept only in the private evaluation manifest. It never
    reaches the agent.
    """
    run_dir = Path(source_run)
    profile = json.loads((run_dir / "company_profile.json").read_text(encoding="utf-8"))
    patterns = json.loads(
        (run_dir / "recommendation_patterns.json").read_text(encoding="utf-8")
    )
    answers = json.loads(
        (run_dir / "ai_recommendations_raw.json").read_text(encoding="utf-8")
    )
    evidence = json.loads(
        (run_dir / "competitor_evidence.json").read_text(encoding="utf-8")
    )
    snapshot = json.loads(
        (run_dir / "website_snapshot.json").read_text(encoding="utf-8")
    )

    audited_name = str(profile.get("company_name", "")).strip()
    audited_url = str(
        snapshot.get("normalized_url")
        or snapshot.get("input_url")
        or "not_yet_found"
    ).strip()
    competitor_urls = {
        normalized_name(row.get("company_name")): str(
            row.get("website_url") or "not_yet_found"
        ).strip()
        for row in evidence.get("competitors", [])
    }
    names = [audited_name] + [
        str(row.get("company_name", "")).strip()
        for row in patterns.get("top_competitors", [])[:5]
    ]
    names = [name for name in names if name]
    if len(names) != 6:
        raise ValueError(f"Expected audited company plus top five competitors, got {names!r}.")

    requested_remove = remove_link_for or names[-1]
    if normalized_name(requested_remove) == normalized_name(audited_name):
        raise ValueError("The audited company's trusted input URL cannot be withheld.")
    matched_remove = next(
        (name for name in names[1:] if same_company(name, requested_remove)), None
    )
    if not matched_remove:
        raise ValueError(f"Cannot withhold unknown competitor {requested_remove!r}.")

    companies = []
    withheld_original = None
    for index, name in enumerate(names, start=1):
        website = (
            audited_url
            if index == 1
            else competitor_urls.get(normalized_name(name), "not_yet_found")
        )
        if not website or website.lower() == "unknown":
            website = "not_yet_found"
        if name == matched_remove:
            withheld_original = website if website != "not_yet_found" else None
            website = "not_yet_found"
        example = recommendation_example(name, answers)
        companies.append(
            {
                "company_id": f"company-{index:02d}",
                "role": "audited_company" if index == 1 else "competitor",
                "company_name": name,
                "website_url": website,
                "assistant_answer_example": example,
            }
        )

    experiment_input = {
        "task": (
            "Find verified external web mentions for the audited company and "
            "its top five competitors."
        ),
        "companies": companies,
    }
    private_manifest = {
        "source_run": str(run_dir.resolve()),
        "created_at": utc_now(),
        "withheld_company": matched_remove,
        "withheld_original_url": withheld_original,
        "note": "The withheld URL is evaluation-only and was not sent to the agent.",
    }
    return experiment_input, private_manifest


def recommendation_example(
    company_name: str,
    answers: list[dict[str, Any]],
) -> dict[str, str]:
    candidates = []
    for row in answers:
        if not any(
            same_company(company_name, str(item.get("company_name", "")))
            for item in row.get("recommended_companies", [])
        ):
            continue
        raw = str(row.get("raw_response", "")).strip()
        if not raw:
            continue
        candidates.append(
            (
                1 if str(row.get("assistant")) == "openai_search" else 0,
                len(raw),
                int(row.get("prompt_index", 999)),
                row,
            )
        )
    if not candidates:
        raise ValueError(f"No assistant answer example found for {company_name}.")
    row = min(candidates, key=lambda item: item[:3])[3]
    return {
        "question": str(row.get("prompt", "")),
        "answer": compact(row.get("raw_response", ""), 3000),
    }


@dataclass
class ExperimentState:
    run_dir: Path
    experiment_input: dict[str, Any]
    private_manifest: dict[str, Any]
    search_client: Any
    fetcher: Callable[[str], tuple[str, int, str]] = fetch_experiment_html
    parser: Callable[[str, str, int], dict[str, Any]] = parse_page
    conversation: list[dict[str, Any]] = field(default_factory=list)
    model_calls: list[dict[str, Any]] = field(default_factory=list)
    tool_events: list[dict[str, Any]] = field(default_factory=list)
    search_results: list[dict[str, Any]] = field(default_factory=list)
    homepage_reads: list[dict[str, Any]] = field(default_factory=list)
    passage_results: list[dict[str, Any]] = field(default_factory=list)
    downloaded_pages: list[dict[str, Any]] = field(default_factory=list)
    external_urls: dict[str, set[str]] = field(default_factory=dict)
    official_candidate_urls: dict[str, set[str]] = field(default_factory=dict)
    official_domains: dict[str, set[str]] = field(default_factory=dict)
    passage_index: dict[tuple[str, str], dict[str, str]] = field(default_factory=dict)
    search_counts: dict[tuple[str, str], int] = field(default_factory=dict)
    total_tool_calls: int = 0

    def __post_init__(self) -> None:
        self.companies = {
            str(row["company_id"]): row for row in self.experiment_input["companies"]
        }
        self.external_urls = {company_id: set() for company_id in self.companies}
        self.official_candidate_urls = {
            company_id: set() for company_id in self.companies
        }
        self.official_domains = {company_id: set() for company_id in self.companies}
        for company_id, company in self.companies.items():
            url = str(company.get("website_url", ""))
            if is_http_url(url):
                self.official_candidate_urls[company_id].add(same_page_key(url))
                domain = domain_from_url(url)
                if domain:
                    self.official_domains[company_id].add(domain)

    def checkpoint(self) -> None:
        write_json(self.run_dir / "conversation.json", self.conversation)
        write_json(self.run_dir / "model_calls.json", self.model_calls)
        write_json(self.run_dir / "tool_events.json", self.tool_events)
        write_json(self.run_dir / "search_results.json", self.search_results)
        write_json(self.run_dir / "homepage_reads.json", self.homepage_reads)
        write_json(self.run_dir / "passage_results.json", self.passage_results)
        write_json(self.run_dir / "downloaded_pages.json", self.downloaded_pages)


def run_experiment(
    source_run: str | Path | None,
    *,
    output_root: str | Path,
    remove_link_for: str | None = None,
    search_client: Any | None = None,
    message_caller: Callable[[dict[str, Any]], dict[str, Any]] = call_chat_message,
    experiment_input_override: dict[str, Any] | None = None,
    private_manifest_override: dict[str, Any] | None = None,
) -> Path:
    load_dotenv(override=True)
    started = time.perf_counter()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = Path(output_root) / stamp
    run_dir.mkdir(parents=True, exist_ok=False)
    if experiment_input_override is None:
        if source_run is None:
            raise ValueError("source_run is required without an input override.")
        experiment_input, private_manifest = build_experiment_input(
            source_run, remove_link_for=remove_link_for
        )
    else:
        experiment_input = experiment_input_override
        private_manifest = private_manifest_override or {
            "source_run": "production_pipeline",
            "created_at": utc_now(),
            "withheld_company": None,
            "withheld_original_url": None,
            "note": "Production run; no website was withheld for evaluation.",
        }
    configured_gateway = os.getenv("AGENTCORE_GATEWAY_URL") or os.getenv("GATEWAY_URL")
    client = search_client or build_search_client(configured_gateway)
    state = ExperimentState(run_dir, experiment_input, private_manifest, client)

    (run_dir / "system_prompt.txt").write_text(SYSTEM_PROMPT, encoding="utf-8")
    write_json(run_dir / "input_sent_to_agent.json", experiment_input)
    write_json(run_dir / "private_evaluation_manifest.json", private_manifest)
    write_json(run_dir / "tool_definitions.json", TOOLS)

    payload = build_chat_payload(
        SYSTEM_PROMPT,
        user_prompt(experiment_input),
        temperature=0.1,
        json_response=True,
    )
    payload["tools"] = TOOLS
    payload["parallel_tool_calls"] = True
    payload["response_format"] = {
        "type": "json_schema",
        "json_schema": {
            "name": "verified_web_mentions",
            "strict": True,
            "schema": FINAL_SCHEMA,
        },
    }
    state.conversation = payload["messages"]
    raw_output = ""
    failure = None
    minimum_search_reminder_sent = False
    try:
        for turn in range(1, MAX_AGENT_TURNS + 1):
            call_started = time.perf_counter()
            message = message_caller(payload)
            state.model_calls.append(
                {
                    "turn": turn,
                    "started_at": utc_now(),
                    "duration_seconds": round(time.perf_counter() - call_started, 3),
                    "message": message,
                }
            )
            assistant_message = {
                "role": "assistant",
                "content": message.get("content"),
            }
            calls = message.get("tool_calls") or []
            if calls:
                assistant_message["tool_calls"] = calls
            state.conversation.append(assistant_message)
            state.checkpoint()
            if not calls:
                missing_searches = missing_minimum_external_searches(state)
                if missing_searches and not minimum_search_reminder_sent:
                    reminder = {
                        "role": "user",
                        "content": (
                            "The official-website lookup phase is finished. Do not "
                            "retry it. Continue even if a website remains unresolved. "
                            "Before answering, run two external_mentions searches for "
                            "each of these companies: "
                            + ", ".join(missing_searches)
                            + ". Then inspect returned pages with get_company_passages."
                        ),
                    }
                    state.conversation.append(reminder)
                    minimum_search_reminder_sent = True
                    state.checkpoint()
                    continue
                raw_output = str(message.get("content") or "")
                if missing_searches:
                    failure = (
                        "Agent ended before completing two external searches for: "
                        + ", ".join(missing_searches)
                    )
                break
            for call in calls:
                state.total_tool_calls += 1
                if state.total_tool_calls > MAX_TOOL_CALLS:
                    result = {"error": "Agent exceeded tool-call limit."}
                else:
                    result = execute_tool_call(state, call)
                state.conversation.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id"),
                        "content": json.dumps(result, ensure_ascii=False),
                    }
                )
                state.checkpoint()
        else:
            failure = f"Agent exceeded {MAX_AGENT_TURNS} model turns."
    except Exception as exc:  # noqa: BLE001 - experiment must preserve diagnostics.
        failure = f"{type(exc).__name__}: {exc}"
    finally:
        state.checkpoint()

    (run_dir / "raw_agent_output.txt").write_text(raw_output, encoding="utf-8")
    parsed: dict[str, Any] = {}
    parse_error = None
    if raw_output:
        try:
            parsed = extract_json_object(raw_output)
        except Exception as exc:  # noqa: BLE001 - recorded below.
            parse_error = f"{type(exc).__name__}: {exc}"
    else:
        parse_error = failure or "Agent returned no final output."
    write_json(run_dir / "raw_agent_output.json", parsed)
    validated, validation = validate_output(state, parsed)
    write_json(run_dir / "validated_output.json", validated)
    write_json(run_dir / "validation_report.json", validation)
    evaluation = evaluate_withheld_site(state)
    write_json(run_dir / "withheld_site_evaluation.json", evaluation)
    timing = {
        "started_at": private_manifest["created_at"],
        "finished_at": utc_now(),
        "total_seconds": round(time.perf_counter() - started, 3),
        "model_calls": state.model_calls,
        "tool_events": [
            {
                "tool": row.get("tool"),
                "duration_seconds": row.get("duration_seconds"),
                "error": row.get("error"),
            }
            for row in state.tool_events
        ],
    }
    write_json(run_dir / "timings.json", timing)
    write_json(
        run_dir / "run_status.json",
        {
            "status": "complete" if not failure and not parse_error else "partial",
            "failure": failure,
            "parse_error": parse_error,
            "validated_mentions": sum(
                len(row["verified_web_mentions"])
                for row in validated["companies"]
            ),
        },
    )
    write_summary(run_dir, state, validated, validation, evaluation, timing, failure, parse_error)
    return run_dir


def execute_tool_call(state: ExperimentState, call: dict[str, Any]) -> dict[str, Any]:
    function = call.get("function") or {}
    name = str(function.get("name", ""))
    try:
        arguments = json.loads(function.get("arguments") or "{}")
    except (TypeError, ValueError):
        arguments = {}
    started = time.perf_counter()
    error = None
    try:
        if name == "read_homepages":
            result = tool_read_homepages(state, arguments)
        elif name == "web_search":
            result = tool_web_search(state, arguments)
        elif name == "get_company_passages":
            result = tool_get_company_passages(state, arguments)
        else:
            result = {"error": f"Unknown tool {name!r}."}
    except Exception as exc:  # noqa: BLE001 - tool failure returns to agent.
        error = f"{type(exc).__name__}: {exc}"
        result = {"error": error}
    state.tool_events.append(
        {
            "tool": name,
            "started_at": utc_now(),
            "duration_seconds": round(time.perf_counter() - started, 3),
            "arguments": arguments,
            "result": result,
            "error": error,
        }
    )
    return result


def missing_minimum_external_searches(state: ExperimentState) -> list[str]:
    return [
        str(company["company_name"])
        for company_id, company in state.companies.items()
        if state.search_counts.get((company_id, "external_mentions"), 0) < 2
    ]


def tool_read_homepages(state: ExperimentState, arguments: dict[str, Any]) -> dict[str, Any]:
    requests = valid_page_requests(state, arguments.get("pages", []), MAX_HOMEPAGE_READS)
    rows = parallel_map(requests, lambda row: read_homepage(state, row), FETCH_WORKERS)
    state.homepage_reads.extend(rows)
    for row in rows:
        company_id = str(row.get("company_id", ""))
        requested_url = str(row.get("requested_url", ""))
        if same_page_key(requested_url) not in state.official_candidate_urls.get(
            company_id, set()
        ):
            continue
        for url in (requested_url, str(row.get("final_url", ""))):
            domain = domain_from_url(url) if is_http_url(url) else ""
            if domain:
                state.official_domains[company_id].add(domain)
    return {"pages": [homepage_for_agent(row) for row in rows]}


def read_homepage(state: ExperimentState, request: dict[str, str]) -> dict[str, Any]:
    row = {
        "company_id": request["company_id"],
        "requested_url": request["url"],
        "fetched_at": utc_now(),
    }
    try:
        html, status, final_url = state.fetcher(request["url"])
        parsed = state.parser(final_url, html, status)
        row.update(
            {
                "status": "ok",
                "final_url": final_url,
                "http_status": status,
                "title": parsed.get("title"),
                "meta_description": parsed.get("meta_description"),
                "headings": compact_headings(parsed.get("headings")),
                "main_text": compact(parsed.get("main_text", ""), MAX_DEBUG_PAGE_TEXT),
            }
        )
        state.downloaded_pages.append({"kind": "homepage", **row})
    except Exception as exc:  # noqa: BLE001 - one failed page does not stop batch.
        row.update({"status": "error", "error": f"{type(exc).__name__}: {exc}"})
    return row


def homepage_for_agent(row: dict[str, Any]) -> dict[str, Any]:
    if row.get("status") != "ok":
        return row
    return {
        "company_id": row.get("company_id"),
        "requested_url": row.get("requested_url"),
        "final_url": row.get("final_url"),
        "status": "ok",
        "title": row.get("title"),
        "meta_description": row.get("meta_description"),
        "headings": row.get("headings"),
        "homepage_text": compact(row.get("main_text", ""), MAX_HOMEPAGE_TEXT),
    }


def compact_headings(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(level): [compact(item, 300) for item in items[:4]]
            for level, items in value.items()
            if isinstance(items, list) and items
        }
    if isinstance(value, list):
        return [compact(item, 300) for item in value[:12]]
    return []


def tool_web_search(state: ExperimentState, arguments: dict[str, Any]) -> dict[str, Any]:
    raw = arguments.get("searches", [])
    if not isinstance(raw, list):
        return {"error": "searches must be a list", "results": []}
    accepted = []
    rejected = []
    for item in raw[:MAX_SEARCHES]:
        company_id = str(item.get("company_id", "")) if isinstance(item, dict) else ""
        requested_query = compact(
            item.get("query", "") if isinstance(item, dict) else "", 200
        )
        purpose = str(item.get("purpose", "")) if isinstance(item, dict) else ""
        if company_id not in state.companies or not requested_query or purpose not in {
            "official_website",
            "external_mentions",
        }:
            rejected.append(
                {"company_id": company_id, "query": requested_query, "reason": "invalid"}
            )
            continue
        query = requested_query
        if purpose == "official_website":
            company_name = str(state.companies[company_id]["company_name"])
            query = f'"{company_name}" official website'
        key = (company_id, purpose)
        limit = (
            MAX_EXTERNAL_SEARCHES_PER_COMPANY
            if purpose == "external_mentions"
            else MAX_OFFICIAL_SEARCHES_PER_COMPANY
        )
        if state.search_counts.get(key, 0) >= limit:
            rejected.append({"company_id": company_id, "query": query, "reason": "limit"})
            continue
        state.search_counts[key] = state.search_counts.get(key, 0) + 1
        accepted.append(
            {
                "company_id": company_id,
                "query": query,
                "requested_query": requested_query,
                "purpose": purpose,
            }
        )

    rows = parallel_map(accepted, lambda row: run_one_search(state, row), SEARCH_WORKERS)
    state.search_results.extend(rows)
    for row in rows:
        for result in row.get("results", []):
            key = same_page_key(result["url"])
            if row["purpose"] == "external_mentions":
                state.external_urls[row["company_id"]].add(key)
            else:
                state.official_candidate_urls[row["company_id"]].add(key)
    return {
        "results": [
            {
                "company_id": row["company_id"],
                "query": row["query"],
                "purpose": row["purpose"],
                "urls": [result["url"] for result in row.get("results", [])],
                **({"error": row["error"]} if row.get("error") else {}),
            }
            for row in rows
        ],
        "rejected_searches": rejected,
        "next_step": (
            "Read plausible official candidates once, then continue to external "
            "mention searches even if no official website is confirmed."
            if any(row.get("purpose") == "official_website" for row in rows)
            or any(
                item.get("company_id") in state.companies
                and state.search_counts.get(
                    (item.get("company_id"), "official_website"), 0
                )
                for item in rejected
            )
            else None
        ),
    }


def run_one_search(state: ExperimentState, request: dict[str, str]) -> dict[str, Any]:
    row = {**request, "searched_at": utc_now(), "results": []}
    try:
        response = state.search_client.search(
            request["query"], max_results=MAX_SEARCH_CANDIDATES
        )
        results = response.get("results", []) if isinstance(response, dict) else response or []
        row["provider"] = response.get("provider") if isinstance(response, dict) else getattr(
            state.search_client, "provider", "unknown"
        )
        row["errors"] = response.get("errors", []) if isinstance(response, dict) else []
        candidates = [
            {
                "url": str(result.get("url", "")),
                "title": str(result.get("title", "")),
                "snippet": str(result.get("snippet") or result.get("body") or ""),
                "search_rank": result.get("search_rank", index),
            }
            for index, result in enumerate(results[:MAX_SEARCH_CANDIDATES], start=1)
            if is_http_url(result.get("url"))
        ]
        row["filtered_results"] = []
        seen = set()
        result_limit = (
            MAX_OFFICIAL_RESULTS_PER_SEARCH
            if request["purpose"] == "official_website"
            else MAX_RESULTS_PER_SEARCH
        )
        for result in candidates:
            key = same_page_key(result["url"])
            if key in seen:
                row["filtered_results"].append(
                    {**result, "filter_reason": "duplicate_url"}
                )
                continue
            seen.add(key)
            if request["purpose"] == "external_mentions" and any(
                same_or_subdomain(domain_from_url(result["url"]), official_domain)
                for official_domain in state.official_domains.get(
                    request["company_id"], set()
                )
            ):
                row["filtered_results"].append(
                    {**result, "filter_reason": "known_official_domain"}
                )
                continue
            row["results"].append(result)
            if len(row["results"]) >= result_limit:
                break
    except Exception as exc:  # noqa: BLE001 - recorded and returned.
        row["error"] = f"{type(exc).__name__}: {exc}"
    return row


def tool_get_company_passages(
    state: ExperimentState,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    raw = arguments.get("pages", [])
    if not isinstance(raw, list):
        return {"error": "pages must be a list", "pages": []}
    accepted = []
    rejected = []
    seen = set()
    for item in raw[:MAX_PASSAGE_PAGES]:
        if not isinstance(item, dict):
            continue
        company_id = str(item.get("company_id", ""))
        url = str(item.get("url", "")).strip()
        if company_id not in state.companies or not is_http_url(url):
            rejected.append({"company_id": company_id, "url": url, "reason": "invalid"})
            continue
        key = (company_id, same_page_key(url))
        if key in seen:
            continue
        seen.add(key)
        if key[1] not in state.external_urls.get(company_id, set()):
            rejected.append(
                {
                    "company_id": company_id,
                    "url": url,
                    "reason": "url_was_not_returned_by_external_search",
                }
            )
            continue
        supplied_name = str(state.companies[company_id]["company_name"])
        names = [supplied_name]
        for name in item.get("names_to_find", []) or []:
            clean = str(name).strip()
            if clean and clean not in names:
                names.append(clean)
        accepted.append(
            {
                "company_id": company_id,
                "company_name": supplied_name,
                "names_to_find": names[:6],
                "url": url,
            }
        )
    rows = parallel_map(accepted, lambda row: get_passages(state, row), FETCH_WORKERS)
    state.passage_results.extend(rows)
    for row in rows:
        if row.get("status") != "ok":
            continue
        state.passage_index[(row["company_id"], same_page_key(row["url"]))] = {
            str(passage["passage_id"]): str(passage["text"])
            for passage in row.get("passages", [])
        }
    return {"pages": [passages_for_agent(row) for row in rows], "rejected_requests": rejected}


def get_passages(state: ExperimentState, request: dict[str, Any]) -> dict[str, Any]:
    row = {**request, "fetched_at": utc_now()}
    try:
        html, status, final_url = state.fetcher(request["url"])
        parsed = state.parser(final_url, html, status)
        text = str(parsed.get("main_text", ""))
        if any(
            same_or_subdomain(domain_from_url(final_url), official_domain)
            for official_domain in state.official_domains.get(
                request["company_id"], set()
            )
        ):
            row.update(
                {
                    "status": "rejected",
                    "final_url": final_url,
                    "http_status": status,
                    "title": parsed.get("title"),
                    "reason": "redirected_to_known_official_domain",
                    "matched_names": [],
                    "passages": [],
                    "main_text": compact(text, MAX_DEBUG_PAGE_TEXT),
                }
            )
            state.downloaded_pages.append({"kind": "external_mention", **row})
            return row
        names = request["names_to_find"]
        windows = mention_windows(text, names)
        matched = [name for name in names if contains_phrase(text, name)]
        row.update(
            {
                "status": "ok",
                "url": request["url"],
                "final_url": final_url,
                "http_status": status,
                "title": parsed.get("title"),
                "matched_names": matched,
                "passages": [
                    {"passage_id": f"passage-{index:02d}", "text": passage}
                    for index, passage in enumerate(windows, start=1)
                ],
                "main_text": compact(text, MAX_DEBUG_PAGE_TEXT),
            }
        )
        state.downloaded_pages.append({"kind": "external_mention", **row})
    except Exception as exc:  # noqa: BLE001 - one failed page does not stop batch.
        row.update({"status": "error", "error": f"{type(exc).__name__}: {exc}"})
    return row


def passages_for_agent(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in row.items()
        if key not in {"main_text", "names_to_find", "fetched_at"}
    }


def valid_page_requests(
    state: ExperimentState,
    raw: Any,
    limit: int,
) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    rows = []
    seen = set()
    for item in raw[:limit]:
        if not isinstance(item, dict):
            continue
        company_id = str(item.get("company_id", ""))
        url = str(item.get("url", "")).strip()
        key = (company_id, same_page_key(url)) if is_http_url(url) else None
        if company_id not in state.companies or key is None or key in seen:
            continue
        seen.add(key)
        rows.append({"company_id": company_id, "url": url})
    return rows


def parallel_map(
    rows: list[dict[str, Any]],
    worker: Callable[[dict[str, Any]], dict[str, Any]],
    max_workers: int,
) -> list[dict[str, Any]]:
    if not rows:
        return []
    ordered: list[dict[str, Any] | None] = [None] * len(rows)
    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(rows)))) as executor:
        futures = {executor.submit(worker, row): index for index, row in enumerate(rows)}
        for future in as_completed(futures):
            index = futures[future]
            try:
                ordered[index] = future.result()
            except Exception as exc:  # noqa: BLE001 - preserve position and error.
                ordered[index] = {**rows[index], "status": "error", "error": str(exc)}
    return [row for row in ordered if row is not None]


def validate_output(
    state: ExperimentState,
    parsed: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    output_by_name = {
        normalized_name(row.get("company_name")): row
        for row in parsed.get("companies", [])
        if isinstance(row, dict)
    }
    accepted_companies = []
    rejected = []
    for company_id, company in state.companies.items():
        name = str(company["company_name"])
        output = output_by_name.get(normalized_name(name), {})
        supplied_official = str(company.get("website_url", "")).strip()
        selected_official = (
            supplied_official if is_http_url(supplied_official) else ""
        )
        if not selected_official:
            proposed_official = str(
                output.get("official_website_url") or ""
            ).strip()
            proposed_key = (
                same_page_key(proposed_official)
                if is_http_url(proposed_official)
                else ""
            )
            candidate_was_searched_and_read = any(
                same_page_key(str(row.get("requested_url", "")))
                in state.official_candidate_urls.get(company_id, set())
                and proposed_key
                in {
                    same_page_key(str(url))
                    for url in (row.get("requested_url"), row.get("final_url"))
                    if is_http_url(url)
                }
                for row in state.homepage_reads
                if row.get("company_id") == company_id
                and row.get("status") == "ok"
            )
            if candidate_was_searched_and_read:
                selected_official = proposed_official
        mentions = []
        seen = set()
        for mention in output.get("verified_web_mentions", []) or []:
            if not isinstance(mention, dict):
                continue
            url = str(mention.get("url", "")).strip()
            key = same_page_key(url) if is_http_url(url) else ""
            reasons = []
            if not key or key not in state.external_urls.get(company_id, set()):
                reasons.append("url_not_from_external_search")
            if key in seen:
                reasons.append("duplicate_url")
            reason = str(mention.get("reason_for_choosing", "")).strip()
            if not reason:
                reasons.append("missing_reason")
            available = state.passage_index.get((company_id, key), {})
            supplied_ids = [
                str(value).strip()
                for value in mention.get("supporting_passage_ids", []) or []
                if str(value).strip()
            ]
            matched = [available[passage_id] for passage_id in supplied_ids if passage_id in available]
            if not matched:
                reasons.append("supporting_passage_id_not_returned_by_tool")
            if any(
                same_or_subdomain(domain_from_url(url), official_domain)
                for official_domain in state.official_domains.get(company_id, set())
            ):
                reasons.append("known_official_domain_is_not_external")
            if reasons:
                rejected.append(
                    {"company_name": name, "url": url, "reasons": reasons}
                )
                continue
            seen.add(key)
            mentions.append(
                {
                    "url": url,
                    "reason_for_choosing": reason,
                    "supporting_passages": matched[:4],
                }
            )
        accepted_companies.append(
            {
                "company_name": name,
                "official_website_url": selected_official or None,
                "verified_web_mentions": mentions,
            }
        )
    missing = [
        str(company["company_name"])
        for company in state.companies.values()
        if normalized_name(company["company_name"]) not in output_by_name
    ]
    return {"companies": accepted_companies}, {"rejected_items": rejected, "missing_companies": missing}


def official_domain_for_input(company: dict[str, Any]) -> str:
    url = str(company.get("website_url", ""))
    return domain_from_url(url) if is_http_url(url) else ""


def evaluate_withheld_site(state: ExperimentState) -> dict[str, Any]:
    company = str(state.private_manifest.get("withheld_company") or "")
    expected_url = str(state.private_manifest.get("withheld_original_url") or "")
    company_id = next(
        (
            company_id
            for company_id, row in state.companies.items()
            if same_company(str(row["company_name"]), company)
        ),
        None,
    )
    expected_domain = domain_from_url(expected_url) if is_http_url(expected_url) else ""
    search_hits = [
        result["url"]
        for row in state.search_results
        if row.get("company_id") == company_id and row.get("purpose") == "official_website"
        for result in row.get("results", [])
        if expected_domain
        and same_or_subdomain(domain_from_url(result.get("url", "")), expected_domain)
    ]
    homepage_hits = [
        str(row.get("final_url") or row.get("requested_url") or "")
        for row in state.homepage_reads
        if row.get("company_id") == company_id
        and expected_domain
        and same_or_subdomain(
            domain_from_url(str(row.get("final_url") or row.get("requested_url") or "")),
            expected_domain,
        )
    ]
    return {
        "company_name": company,
        "withheld_original_url": expected_url or None,
        "official_search_found_expected_domain": bool(search_hits),
        "matching_search_urls": search_hits,
        "agent_read_expected_homepage": bool(homepage_hits),
        "matching_homepage_reads": homepage_hits,
    }


def write_summary(
    run_dir: Path,
    state: ExperimentState,
    validated: dict[str, Any],
    validation: dict[str, Any],
    evaluation: dict[str, Any],
    timing: dict[str, Any],
    failure: str | None,
    parse_error: str | None,
) -> None:
    counts = [
        f"- {row['company_name']}: {len(row['verified_web_mentions'])} verified mentions"
        for row in validated["companies"]
    ]
    lines = [
        "# Web-mention agent experiment",
        "",
        f"- Status: {'complete' if not failure and not parse_error else 'partial'}",
        f"- Total time: {timing['total_seconds']} seconds",
        f"- Model turns: {len(state.model_calls)}",
        f"- Tool calls: {state.total_tool_calls}",
        f"- Search requests: {len(state.search_results)}",
        f"- Homepage reads: {len(state.homepage_reads)}",
        f"- Passage pages: {len(state.passage_results)}",
        f"- Post-validation rejections: {len(validation['rejected_items'])}",
        "",
        "## Withheld website test",
        "",
        f"- Company: {evaluation.get('company_name')}",
        f"- Expected domain found by search: {evaluation.get('official_search_found_expected_domain')}",
        f"- Expected homepage read: {evaluation.get('agent_read_expected_homepage')}",
        "",
        "## Final verified mentions",
        "",
        *counts,
    ]
    if failure or parse_error:
        lines.extend(["", "## Errors", "", f"- Agent: {failure}", f"- Parse: {parse_error}"])
    lines.extend(
        [
            "",
            "## Debug files",
            "",
            "All visible agent messages, tool calls and tool results are in conversation.json.",
            "The API does not expose hidden chain-of-thought; no hidden reasoning is claimed or stored.",
        ]
    )
    (run_dir / "run_summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
