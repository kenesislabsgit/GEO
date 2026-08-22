from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time
from typing import Any
from urllib.parse import urlparse

from experiments.web_mention_agent.agent import run_experiment

from .aggregation import grouped_company_name
from .llm import load_dotenv
from .source_analysis import domain_from_url, same_or_subdomain
from .web_presence import build_search_client, company_aliases, same_company


def normalized_name(value: Any) -> str:
    return " ".join(str(value or "").lower().split())


def usable_root_url(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if not text.startswith(("http://", "https://")):
        text = f"https://{text}"
    parsed = urlparse(text)
    if not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


def official_sites_from_answers(
    raw_results: list[dict[str, Any]],
    aliases: dict[str, str] | None,
) -> dict[str, str]:
    votes: dict[str, Counter[str]] = {}
    for result in raw_results:
        for recommendation in result.get("recommended_companies", []) or []:
            written = str(recommendation.get("company_name", "")).strip()
            site = usable_root_url(recommendation.get("official_website"))
            if not written or not site:
                continue
            company = grouped_company_name(written, aliases)
            votes.setdefault(company, Counter())[site] += 1
    return {
        company: counted.most_common(1)[0][0]
        for company, counted in votes.items()
        if counted
    }


def assistant_answer_example(
    company_name: str,
    raw_results: list[dict[str, Any]],
    aliases: dict[str, str] | None,
) -> dict[str, str]:
    candidates: list[tuple[int, int, int, dict[str, Any]]] = []
    for row in raw_results:
        named = False
        for recommendation in row.get("recommended_companies", []) or []:
            written = str(recommendation.get("company_name", ""))
            grouped = grouped_company_name(written, aliases)
            if normalized_name(grouped) == normalized_name(company_name) or same_company(
                written, company_name
            ):
                named = True
                break
        if not named:
            continue
        answer = str(row.get("raw_response", "")).strip()
        if not answer:
            continue
        candidates.append(
            (
                0 if str(row.get("assistant")) == "openai_search" else 1,
                int(row.get("prompt_index", 999) or 999),
                -len(answer),
                row,
            )
        )
    if not candidates:
        return {"question": "", "answer": ""}
    selected = min(candidates, key=lambda item: item[:3])[3]
    answer = " ".join(str(selected.get("raw_response", "")).split())
    return {
        "question": str(selected.get("prompt", "")).strip(),
        "answer": answer[:3000],
    }


def audited_company_url(company_profile: dict[str, Any]) -> str:
    supporting = company_profile.get("evidence", {}).get("supporting_pages", [])
    candidates = [
        supporting[0] if isinstance(supporting, list) and supporting else "",
        company_profile.get("input_url"),
        company_profile.get("domain"),
    ]
    for candidate in candidates:
        url = usable_root_url(candidate)
        if url:
            return url
    return ""


def build_production_agent_input(
    company_profile: dict[str, Any],
    raw_results: list[dict[str, Any]],
    recommendation_patterns: dict[str, Any],
    *,
    max_competitors: int = 5,
    audited_website_url: str | None = None,
) -> dict[str, Any]:
    user_company = str(company_profile.get("company_name", "")).strip()
    aliases = recommendation_patterns.get("company_name_groups") or {}
    names = [user_company]
    for row in recommendation_patterns.get("top_competitors", []) or []:
        name = str(row.get("company_name", "")).strip()
        if not name or same_company(name, user_company) or name in names:
            continue
        names.append(name)
        if len(names) >= max_competitors + 1:
            break

    sites = official_sites_from_answers(raw_results, aliases)
    companies = []
    for index, name in enumerate(names, start=1):
        if index == 1:
            website = usable_root_url(audited_website_url) or audited_company_url(
                company_profile
            )
        else:
            website = next(
                (
                    url
                    for company, url in sites.items()
                    if normalized_name(company) == normalized_name(name)
                    or same_company(company, name)
                ),
                "",
            )
        companies.append(
            {
                "company_id": f"company-{index:02d}",
                "role": "audited_company" if index == 1 else "competitor",
                "company_name": name,
                "website_url": website or "not_yet_found",
                "assistant_answer_example": assistant_answer_example(
                    name, raw_results, aliases
                ),
            }
        )
    return {
        "task": (
            "Find verified external web mentions for the audited company and "
            "its leading competitors."
        ),
        "companies": companies,
    }


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def collect_web_presence_with_agent(
    company_profile: dict[str, Any],
    raw_results: list[dict[str, Any]],
    recommendation_patterns: dict[str, Any],
    *,
    diagnostics_root: str | Path,
    max_competitors: int = 5,
    audited_website_url: str | None = None,
    gateway_url: str | None = None,
    gateway_tool_name: str | None = None,
) -> dict[str, Any]:
    """Run the tested single-agent mention research and shape its output for
    the existing competitor-evidence and report stages."""
    agent_input = build_production_agent_input(
        company_profile,
        raw_results,
        recommendation_patterns,
        max_competitors=max_competitors,
        audited_website_url=audited_website_url,
    )
    return collect_web_presence_for_agent_input(
        agent_input,
        diagnostics_root=diagnostics_root,
        gateway_url=gateway_url,
        gateway_tool_name=gateway_tool_name,
    )


def collect_web_presence_for_agent_input(
    agent_input: dict[str, Any],
    *,
    diagnostics_root: str | Path,
    gateway_url: str | None = None,
    gateway_tool_name: str | None = None,
) -> dict[str, Any]:
    """Run mention research for an already selected set of companies."""
    load_dotenv(override=True)
    started = time.perf_counter()
    configured_gateway = (
        gateway_url
        or os.getenv("AGENTCORE_GATEWAY_URL")
        or os.getenv("GATEWAY_URL")
    )
    client = build_search_client(configured_gateway, gateway_tool_name)
    agent_run = run_experiment(
        None,
        output_root=Path(diagnostics_root),
        search_client=client,
        experiment_input_override=agent_input,
        private_manifest_override={
            "source_run": "production_pipeline",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "withheld_company": None,
            "withheld_original_url": None,
            "note": "Production pipeline run; no evaluation URL was withheld.",
        },
    )

    validated = read_json(agent_run / "validated_output.json")
    validation = read_json(agent_run / "validation_report.json")
    timing = read_json(agent_run / "timings.json")
    status = read_json(agent_run / "run_status.json")
    searches = read_json(agent_run / "search_results.json")
    output_by_name = {
        normalized_name(row.get("company_name")): row
        for row in validated.get("companies", [])
        if isinstance(row, dict)
    }

    entities = []
    for company in agent_input["companies"]:
        name = str(company["company_name"])
        output = output_by_name.get(normalized_name(name), {})
        website = str(company.get("website_url", ""))
        if website == "not_yet_found":
            website = str(output.get("official_website_url") or "")
        official_domain = domain_from_url(website) if website else ""
        mentions = []
        for mention in output.get("verified_web_mentions", []) or []:
            passages = [
                str(text)
                for text in mention.get("supporting_passages", []) or []
                if str(text).strip()
            ]
            url = str(mention.get("url", ""))
            if official_domain and same_or_subdomain(
                domain_from_url(url), official_domain
            ):
                continue
            mentions.append(
                {
                    "company_name": name,
                    "url": url,
                    "domain": domain_from_url(url),
                    "title": "",
                    "snippet": passages[0][:500] if passages else "",
                    "page_text": "\n\n".join(passages),
                    "passages": passages,
                    "reason_for_choosing": mention.get("reason_for_choosing", ""),
                    "verified": True,
                    "source_type": "external_mention",
                    "provenance": "web_mention_research_agent",
                }
            )
        entities.append(
            {
                "company_name": name,
                "entity_type": (
                    "user_company"
                    if company.get("role") == "audited_company"
                    else "competitor"
                ),
                "aliases": company_aliases(name),
                "known_website": website or None,
                "official_website": website or None,
                "site_discovery": {
                    "official_website": website or None,
                    "confidence": "High" if website else "Unknown",
                    "method": (
                        "assistant_reported_official_website"
                        if website
                        else "agent_left_unresolved"
                    ),
                },
                "verified_mentions": mentions,
            }
        )

    search_errors = []
    for row in searches:
        if row.get("error"):
            search_errors.append(
                {
                    "company_name": row.get("company_id"),
                    "query": row.get("query"),
                    "error": row.get("error"),
                }
            )
        for error in row.get("errors", []) or []:
            search_errors.append(
                {
                    **error,
                    "company_name": row.get("company_id"),
                    "query": row.get("query"),
                }
            )
    verified_count = sum(len(row["verified_mentions"]) for row in entities)
    return {
        "status": status.get("status", "partial"),
        "provider": getattr(client, "provider", "web_search_with_fallback"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": "single_web_mention_research_agent",
        "entities": entities,
        "search_errors": search_errors,
        "agent_diagnostics_dir": str(agent_run.resolve()),
        "summary": {
            "entities_checked": len(entities),
            "queries_run": len(searches),
            "search_errors": len(search_errors),
            "verified_mentions": verified_count,
            "official_websites_resolved": sum(
                1 for entity in entities if entity.get("official_website")
            ),
            "post_validation_rejections": len(
                validation.get("rejected_items", []) or []
            ),
            "model_turns": len(timing.get("model_calls", []) or []),
            "tool_calls": len(timing.get("tool_events", []) or []),
            "agent_seconds": timing.get("total_seconds"),
            "integration_seconds": round(time.perf_counter() - started, 3),
        },
    }


def merge_web_presence_results(
    *results: dict[str, Any],
) -> dict[str, Any]:
    """Combine independently researched company sets without losing evidence."""
    valid = [result for result in results if result]
    entities = [
        entity
        for result in valid
        for entity in result.get("entities", []) or []
    ]
    errors = [
        error
        for result in valid
        for error in result.get("search_errors", []) or []
    ]
    summaries = [result.get("summary") or {} for result in valid]
    additive_fields = (
        "entities_checked",
        "queries_run",
        "search_errors",
        "verified_mentions",
        "official_websites_resolved",
        "post_validation_rejections",
        "model_turns",
        "tool_calls",
    )
    summary = {
        field: sum(int(row.get(field, 0) or 0) for row in summaries)
        for field in additive_fields
    }
    summary["agent_seconds"] = round(
        sum(float(row.get("agent_seconds", 0) or 0) for row in summaries), 3
    )
    summary["integration_seconds"] = round(
        sum(float(row.get("integration_seconds", 0) or 0) for row in summaries),
        3,
    )
    summary["branch_seconds"] = [
        float(row.get("integration_seconds", 0) or 0) for row in summaries
    ]
    return {
        "status": (
            "complete"
            if valid and all(result.get("status") == "complete" for result in valid)
            else "partial"
        ),
        "provider": next(
            (str(result.get("provider")) for result in valid if result.get("provider")),
            "web_search_with_fallback",
        ),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": "parallel_split_web_mention_research",
        "entities": entities,
        "search_errors": errors,
        "agent_diagnostics_dirs": [
            result.get("agent_diagnostics_dir")
            for result in valid
            if result.get("agent_diagnostics_dir")
        ],
        "summary": summary,
    }
