from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.parse import urlparse

from .aggregation import aggregate_recommendations
from .audit_recommendations import (
    build_free_preview_recommendations,
    generate_audit_recommendations,
)
from .comparison import compare_user_to_competitors
from .competitors import generate_competitor_seeds
from .competitor_evidence import build_competitor_evidence
from .crawler import crawl_website, ensure_url
from .evidence import build_website_evidence
from .export import build_frontend_export
from .firecrawl import (
    FirecrawlClient,
    canonical_url,
    enrich_user_snapshot,
    environment_int,
    should_enrich_user_snapshot,
)
from .intents import (
    generate_customer_intents,
    generate_free_customer_intents,
    question_profile_issue,
)
from .profile import generate_company_profile
from .quality import build_quality_summary
from .recommendations import (
    collect_multi_model_recommendations,
    collect_openai_recommendations,
    save_prompt_payloads_preview,
    supported_assistants,
    verify_provider_citations,
)
from .report import generate_final_report
from .utils import make_run_dir
from .web_presence import collect_web_presence


CRAWL_CONTEXT_PATH_TERMS = (
    "about",
    "case-stud",
    "customer",
    "industr",
    "pricing",
    "product",
    "service",
    "solution",
    "use-case",
)


def emit_run_progress(step: str, progress: int, message: str, **extra: object) -> None:
    print(
        json.dumps(
            {
                "event": "progress",
                "step": step,
                "progress": progress,
                "message": message,
                **extra,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


def save_firecrawl_usage(
    output_dir: Path,
    client: FirecrawlClient | None,
) -> None:
    usage = (
        client.usage_summary()
        if client is not None
        else {"enabled": False, "requests": 0, "reported_credits": 0, "events": []}
    )
    (output_dir / "firecrawl_usage.json").write_text(
        json.dumps(usage, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def collect_user_website_snapshot(
    url: str,
    *,
    max_pages: int,
    firecrawl_client: FirecrawlClient | None,
) -> tuple[dict[str, object], dict[str, object]]:
    normalized_url = ensure_url(url)
    domain = urlparse(normalized_url).netloc.lower()
    snapshot: dict[str, object] = {
        "input_url": url,
        "normalized_url": normalized_url,
        "domain": domain,
        "allowed_domains": sorted(
            {domain, domain.removeprefix("www."), f"www.{domain.removeprefix('www.')}"}
        ),
        "pages": [],
        "failed_pages": [],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "max_pages": max_pages,
    }
    firecrawl_result: dict[str, object] = {
        "attempted": False,
        "reason": "Firecrawl is not configured",
        "mapped_urls": 0,
        "pages_added": 0,
        "pages_replaced": 0,
        "errors": [],
        "standard_fallback_used": False,
    }

    if firecrawl_client is not None:
        snapshot, firecrawl_result = enrich_user_snapshot(
            firecrawl_client,
            normalized_url,
            snapshot,
            max_pages=min(
                max_pages,
                environment_int("FIRECRAWL_USER_PROFILE_MAX_PAGES", 6),
            ),
        )
        if firecrawl_result.get("pages_added") or firecrawl_result.get("pages_replaced"):
            firecrawl_result["reason"] = "Firecrawl returned usable website content"
        elif firecrawl_result.get("errors"):
            firecrawl_result["reason"] = "Firecrawl did not return usable website content"
        else:
            firecrawl_result["reason"] = "Firecrawl returned incomplete website context"
        firecrawl_result["standard_fallback_used"] = False

    firecrawl_incomplete = (
        not snapshot.get("pages")
        or should_enrich_user_snapshot(snapshot)
    )
    if firecrawl_client is None or firecrawl_incomplete:
        standard_snapshot = crawl_website(url, max_pages=max_pages)
        snapshot = merge_user_snapshots(
            snapshot,
            standard_snapshot,
            max_pages=max_pages,
        )
        firecrawl_result["standard_fallback_used"] = True
        firecrawl_result["standard_fallback_reason"] = (
            "Firecrawl is not configured"
            if firecrawl_client is None
            else "Firecrawl returned incomplete website context"
        )
        firecrawl_result["standard_failed_pages"] = list(
            standard_snapshot.get("failed_pages", [])
        )

    crawl_quality = assess_crawl_quality(snapshot)
    snapshot["crawl_quality"] = crawl_quality
    firecrawl_result["crawl_quality"] = crawl_quality
    snapshot["firecrawl_enrichment"] = firecrawl_result
    return snapshot, firecrawl_result


def merge_user_snapshots(
    primary: dict[str, object],
    fallback: dict[str, object],
    *,
    max_pages: int,
) -> dict[str, object]:
    merged = dict(primary)
    pages = list(primary.get("pages", []))
    seen = {
        canonical_url(str(page.get("url", "")))
        for page in pages
        if isinstance(page, dict)
    }
    for page in fallback.get("pages", []):
        if not isinstance(page, dict):
            continue
        key = canonical_url(str(page.get("url", "")))
        if not key:
            continue
        if key in seen:
            for index, existing in enumerate(pages):
                if not isinstance(existing, dict):
                    continue
                if canonical_url(str(existing.get("url", ""))) == key:
                    pages[index] = merge_page_versions(existing, page)
                    break
            continue
        seen.add(key)
        pages.append(page)
    merged["pages"] = pages[:max_pages]
    merged["failed_pages"] = list(primary.get("failed_pages", [])) + list(
        fallback.get("failed_pages", [])
    )
    for field in (
        "input_url",
        "normalized_url",
        "domain",
        "allowed_domains",
        "generated_at",
        "max_pages",
    ):
        if fallback.get(field) is not None:
            merged[field] = fallback[field]
    return merged


def merge_page_versions(
    primary: dict[str, object],
    fallback: dict[str, object],
) -> dict[str, object]:
    primary_text = str(primary.get("main_text", "")).strip()
    fallback_text = str(fallback.get("main_text", "")).strip()
    preferred, secondary = (
        (fallback, primary)
        if len(fallback_text) > len(primary_text)
        else (primary, fallback)
    )
    merged = dict(preferred)
    for field in (
        "title",
        "meta_description",
        "headings",
        "schema_json_ld",
        "navigation",
        "internal_links",
        "external_links",
        "image_alt_text",
    ):
        if not merged.get(field) and secondary.get(field):
            merged[field] = secondary[field]
    providers = {
        str(value).strip()
        for value in (
            primary.get("fetch_provider"),
            fallback.get("fetch_provider"),
        )
        if str(value or "").strip()
    }
    if providers:
        merged["fetch_providers"] = sorted(providers)
    return merged


def assess_crawl_quality(snapshot: dict[str, object]) -> dict[str, object]:
    pages = [
        page
        for page in snapshot.get("pages", [])
        if isinstance(page, dict)
    ]
    usable_pages = [
        page
        for page in pages
        if len(str(page.get("main_text", "")).strip()) >= 200
        and int(page.get("status_code") or 200) < 400
    ]
    total_text_characters = sum(
        len(str(page.get("main_text", "")).strip())
        for page in usable_pages
    )
    context_pages = [
        str(page.get("url", ""))
        for page in usable_pages
        if any(
            term in urlparse(str(page.get("url", ""))).path.lower()
            for term in CRAWL_CONTEXT_PATH_TERMS
        )
    ]
    providers = sorted(
        {
            str(provider).strip()
            for page in usable_pages
            for provider in (
                page.get("fetch_providers")
                if isinstance(page.get("fetch_providers"), list)
                else [page.get("fetch_provider") or "standard"]
            )
            if str(provider or "").strip()
        }
    )
    reasons = []
    if not usable_pages:
        status = "failed"
        reasons.append("No page contained enough readable website text.")
    elif total_text_characters < 1500:
        status = "weak"
        reasons.append("The readable website text is too limited for a reliable profile.")
    elif not context_pages and len(usable_pages) < 3:
        status = "weak"
        reasons.append("No detailed product, service, industry, or company page was found.")
    else:
        status = "good"
    return {
        "status": status,
        "pages_found": len(pages),
        "usable_pages": len(usable_pages),
        "total_text_characters": total_text_characters,
        "context_pages": context_pages,
        "providers": providers,
        "reasons": reasons,
    }


def load_reusable_snapshot(
    path: str,
    url: str,
) -> tuple[dict[str, object] | None, str | None]:
    """Load a previously crawled snapshot so a repeat audit of the same website
    does not have to read the site again. Returns (snapshot, reason_rejected)."""
    source = Path(path)
    if not source.exists():
        return None, f"Shared website read not found at {source}"
    try:
        snapshot = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, f"Shared website read could not be loaded: {exc}"
    if not isinstance(snapshot, dict) or not snapshot.get("pages"):
        return None, "Shared website read contained no pages"

    expected_domain = urlparse(ensure_url(url)).netloc.lower().removeprefix("www.")
    found_domain = str(snapshot.get("domain", "")).lower().removeprefix("www.")
    if expected_domain and found_domain and expected_domain != found_domain:
        return None, (
            f"Shared website read is for {found_domain}, not {expected_domain}"
        )

    snapshot["reused_website_read"] = {
        "reused": True,
        "source_path": str(source),
        "originally_collected_at": snapshot.get("generated_at"),
        "note": (
            "Only the website read was reused. The company profile, buyer "
            "questions, and AI provider answers were generated for this run."
        ),
    }
    return snapshot, None


def website_crawl_failure_message(
    url: str,
    firecrawl_result: dict[str, object],
    *,
    firecrawl_configured: bool,
) -> str:
    errors = firecrawl_result.get("errors")
    if isinstance(errors, list):
        for item in errors:
            if not isinstance(item, dict):
                continue
            detail = " ".join(str(item.get("error", "")).split()).strip()
            if detail:
                return (
                    f"Website content could not be read for {url}. "
                    f"Firecrawl reported: {detail[:600]} "
                    "Verify that the domain is correct and publicly accessible."
                )
    if not firecrawl_configured:
        return (
            f"Website content could not be read for {url}. Firecrawl is not "
            "configured and the standard crawler returned no pages. Configure "
            "FIRECRAWL_API_KEY or verify the domain."
        )
    standard_errors = firecrawl_result.get("standard_failed_pages")
    if isinstance(standard_errors, list):
        for item in standard_errors:
            if not isinstance(item, dict):
                continue
            detail = " ".join(str(item.get("error", "")).split()).strip()
            if detail:
                return (
                    f"Website content could not be read for {url}. "
                    f"The standard crawler reported: {detail[:600]} "
                    "Firecrawl also returned no usable content."
                )
    return (
        f"Website content could not be read for {url}. Firecrawl and the "
        "standard crawler returned no usable pages. Verify that the domain is "
        "correct, publicly accessible, and does not require authentication."
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="geo-audit",
        description="Run the AI recommendation audit MVP pipeline.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    crawl_parser = subparsers.add_parser(
        "crawl",
        help="Step 1: crawl a website and create a website snapshot.",
    )
    crawl_parser.add_argument("url", help="Company website URL")
    crawl_parser.add_argument(
        "--output-dir",
        default="outputs",
        help="Directory where audit outputs should be saved.",
    )
    crawl_parser.add_argument(
        "--max-pages",
        type=int,
        default=12,
        help="Maximum same-domain pages to crawl.",
    )

    evidence_parser = subparsers.add_parser(
        "evidence",
        help="Step 2a: create website evidence from a website snapshot.",
    )
    evidence_parser.add_argument(
        "snapshot",
        help="Path to website_snapshot.json.",
    )

    profile_parser = subparsers.add_parser(
        "profile",
        help="Step 2b: create company_profile.json from a snapshot and evidence.",
    )
    profile_parser.add_argument("snapshot", help="Path to website_snapshot.json.")
    profile_parser.add_argument(
        "--evidence",
        help="Path to website_evidence.json. Defaults to the snapshot folder.",
    )
    profile_parser.add_argument(
        "--lean",
        action="store_true",
        help=(
            "Ask for the single strongest buyer persona instead of several. "
            "The free audit uses this."
        ),
    )

    intents_parser = subparsers.add_parser(
        "intents",
        help="Step 3: create customer_prompts.json from a company profile.",
    )
    intents_parser.add_argument("profile", help="Path to company_profile.json.")

    competitors_parser = subparsers.add_parser(
        "competitors",
        help="Step 2c: create probable_competitors.json from a company profile.",
    )
    competitors_parser.add_argument("profile", help="Path to company_profile.json.")

    collect_parser = subparsers.add_parser(
        "collect",
        help="Step 4: collect OpenAI recommendation results for customer prompts.",
    )
    collect_parser.add_argument("prompts", help="Path to customer_prompts.json.")
    collect_parser.add_argument(
        "--limit",
        type=int,
        help="Limit prompt count while testing cost and output quality.",
    )
    collect_parser.add_argument(
        "--model",
        help="OpenAI model override. Defaults to LLM_MODEL or built-in default.",
    )
    collect_parser.add_argument(
        "--assistants",
        nargs="+",
        choices=sorted(supported_assistants()),
        help=(
            "Assistants to query. Example: --assistants openai_search "
            "bedrock_claude bedrock_llama bedrock_mistral"
        ),
    )
    collect_parser.add_argument(
        "--limit-per-assistant",
        type=int,
        help="Prompt limit per assistant for multi-model testing.",
    )
    collect_parser.add_argument("--openai-model", help="OpenAI model override.")
    collect_parser.add_argument(
        "--openai-search-model",
        help="OpenAI Responses API model override for web-grounded search.",
    )
    collect_parser.add_argument("--claude-model", help="Claude model override.")
    collect_parser.add_argument("--gemini-model", help="Gemini model override.")
    collect_parser.add_argument("--bedrock-claude-model", help="AWS Bedrock Claude model ID override.")
    collect_parser.add_argument("--bedrock-nova-model", help="AWS Bedrock Nova model ID override.")
    collect_parser.add_argument("--bedrock-llama-model", help="AWS Bedrock Llama model ID override.")
    collect_parser.add_argument("--bedrock-mistral-model", help="AWS Bedrock Mistral model ID override.")
    collect_parser.add_argument(
        "--analyzer-batch-size",
        type=int,
        default=5,
        help="Number of raw provider answers to normalize per analyzer call.",
    )
    collect_parser.add_argument(
        "--provider-concurrency",
        type=int,
        default=4,
        help="Number of provider prompt calls to run in parallel.",
    )
    collect_parser.add_argument(
        "--structured-provider-json",
        action="store_true",
        help="Ask providers for structured JSON directly instead of using batch answer analysis.",
    )

    aggregate_parser = subparsers.add_parser(
        "aggregate",
        help="Step 5: aggregate raw recommendation results.",
    )
    aggregate_parser.add_argument(
        "raw_results",
        help="Path to ai_recommendations_raw.json.",
    )
    aggregate_parser.add_argument(
        "--top-n",
        type=int,
        default=5,
        help="Number of recurring competitors to select.",
    )
    aggregate_parser.add_argument(
        "--profile",
        help="Optional company_profile.json used to track whether the user company was recommended.",
    )
    aggregate_parser.add_argument(
        "--alias",
        action="append",
        default=[],
        help="Additional company alias to count as the user company. Can be repeated.",
    )

    competitor_evidence_parser = subparsers.add_parser(
        "competitor-evidence",
        help="Step 6: collect evidence for top competitors.",
    )
    competitor_evidence_parser.add_argument(
        "patterns",
        help="Path to recommendation_patterns.json.",
    )
    competitor_evidence_parser.add_argument(
        "--sites",
        help="Optional JSON mapping of competitor names to official website URLs.",
    )
    competitor_evidence_parser.add_argument(
        "--max-pages",
        type=int,
        default=8,
        help="Maximum pages to crawl per competitor website.",
    )

    compare_parser = subparsers.add_parser(
        "compare",
        help="Step 7: compare user website evidence against competitors.",
    )
    compare_parser.add_argument("user_evidence", help="Path to website_evidence.json.")
    compare_parser.add_argument(
        "competitor_evidence",
        help="Path to competitor_evidence.json.",
    )

    audit_recommendations_parser = subparsers.add_parser(
        "recommend",
        help="Step 8: generate evidence-backed audit recommendations.",
    )
    audit_recommendations_parser.add_argument("profile", help="Path to company_profile.json.")
    audit_recommendations_parser.add_argument("user_evidence", help="Path to website_evidence.json.")
    audit_recommendations_parser.add_argument(
        "competitor_evidence",
        help="Path to competitor_evidence.json.",
    )
    audit_recommendations_parser.add_argument("comparison", help="Path to comparison.json.")
    audit_recommendations_parser.add_argument(
        "--patterns",
        help="Path to recommendation_patterns.json. Defaults to the profile folder.",
    )

    report_parser = subparsers.add_parser(
        "report",
        help="Step 9: generate final Markdown audit report.",
    )
    report_parser.add_argument("profile", help="Path to company_profile.json.")
    report_parser.add_argument("user_evidence", help="Path to website_evidence.json.")
    report_parser.add_argument("patterns", help="Path to recommendation_patterns.json.")
    report_parser.add_argument(
        "competitor_evidence",
        help="Path to competitor_evidence.json.",
    )
    report_parser.add_argument("comparison", help="Path to comparison.json.")
    report_parser.add_argument(
        "recommendations",
        help="Path to audit_recommendations.json.",
    )

    quality_parser = subparsers.add_parser(
        "quality",
        help="Inspect intermediate audit quality before trusting a report.",
    )
    quality_parser.add_argument("raw_results", help="Path to ai_recommendations_raw.json.")
    quality_parser.add_argument("patterns", help="Path to recommendation_patterns.json.")
    quality_parser.add_argument(
        "competitor_evidence",
        help="Path to competitor_evidence.json.",
    )
    quality_parser.add_argument("comparison", help="Path to comparison.json.")

    export_parser = subparsers.add_parser(
        "export",
        help="Create dashboard/frontend-ready audit_export.json from pipeline outputs.",
    )
    export_parser.add_argument("profile", help="Path to company_profile.json.")
    export_parser.add_argument("prompts", help="Path to customer_prompts.json.")
    export_parser.add_argument("raw_results", help="Path to ai_recommendations_raw.json.")
    export_parser.add_argument("patterns", help="Path to recommendation_patterns.json.")
    export_parser.add_argument("competitor_evidence", help="Path to competitor_evidence.json.")
    export_parser.add_argument("comparison", help="Path to comparison.json.")
    export_parser.add_argument("recommendations", help="Path to audit_recommendations.json.")
    export_parser.add_argument(
        "--quality",
        help="Path to quality_summary.json. Defaults to the raw results folder.",
    )

    run_parser = subparsers.add_parser(
        "run",
        help="Run the complete audit pipeline and create audit_export.json.",
    )
    run_parser.add_argument("url", help="Company website URL or domain.")
    run_parser.add_argument(
        "--output-dir",
        default="outputs",
        help="Directory where audit outputs should be saved.",
    )
    run_parser.add_argument("--max-pages", type=int, default=12)
    run_parser.add_argument("--competitor-max-pages", type=int, default=8)
    run_parser.add_argument(
        "--max-competitors-crawled",
        type=int,
        help=(
            "Read the websites of only the first N recurring competitors. The "
            "free audit uses 1. Others are still listed from the AI answers."
        ),
    )
    run_parser.add_argument(
        "--max-recommendations",
        type=int,
        help="Keep only the top N generated improvement actions. The free audit uses 1.",
    )
    run_parser.add_argument("--top-n", type=int, default=5)
    run_parser.add_argument(
        "--assistants",
        nargs="+",
        choices=sorted(supported_assistants()),
        default=["openai_search", "bedrock_claude", "bedrock_llama", "bedrock_mistral"],
    )
    run_parser.add_argument("--limit-per-assistant", type=int, default=5)
    run_parser.add_argument("--model", help="Generic OpenAI model override.")
    run_parser.add_argument("--openai-model", help="OpenAI chat model override.")
    run_parser.add_argument("--openai-search-model", help="OpenAI search model override.")
    run_parser.add_argument("--claude-model", help="Claude model override.")
    run_parser.add_argument("--gemini-model", help="Gemini model override.")
    run_parser.add_argument("--bedrock-claude-model", help="AWS Bedrock Claude model ID override.")
    run_parser.add_argument("--bedrock-nova-model", help="AWS Bedrock Nova model ID override.")
    run_parser.add_argument("--bedrock-llama-model", help="AWS Bedrock Llama model ID override.")
    run_parser.add_argument("--bedrock-mistral-model", help="AWS Bedrock Mistral model ID override.")
    run_parser.add_argument("--analyzer-batch-size", type=int, default=5)
    run_parser.add_argument("--provider-concurrency", type=int, default=4)
    run_parser.add_argument(
        "--search-context-size",
        choices=["low", "medium", "high"],
        help=(
            "How much searching and reading each web-search question may do. "
            "The free audit uses low to keep runs predictable."
        ),
    )
    run_parser.add_argument(
        "--openai-search-batch-size",
        type=int,
        default=1,
        help=(
            "Questions per web-search call. 1 runs every question at the same "
            "time, which is fastest and isolates failures."
        ),
    )
    run_parser.add_argument(
        "--web-presence-max-competitors",
        type=int,
        default=5,
        help="Maximum recurring competitors to research with deterministic web search.",
    )
    run_parser.add_argument(
        "--skip-web-presence",
        action="store_true",
        help="Skip independent web-presence search and URL verification.",
    )
    run_parser.add_argument(
        "--resume-from",
        help="Reuse website/profile/question artifacts and provider results from a previous run directory.",
    )
    run_parser.add_argument(
        "--reuse-snapshot",
        help=(
            "Reuse a previously crawled website_snapshot.json for this domain instead "
            "of crawling again. Only the website read is reused; profile, buyer "
            "questions, and provider answers are still generated for this run."
        ),
    )
    run_parser.add_argument(
        "--skip-audit-recommendations",
        action="store_true",
        help="Skip the final recommendation-writing LLM call for faster preview scans.",
    )
    run_parser.add_argument(
        "--skip-final-report",
        action="store_true",
        help="Skip Markdown report generation; frontend still uses audit_export.json.",
    )
    run_parser.add_argument(
        "--free-preview",
        action="store_true",
        help="Use the fast five-question free audit path.",
    )

    args = parser.parse_args()

    if args.command == "crawl":
        run_dir = make_run_dir(Path(args.output_dir), args.url)
        firecrawl_client = FirecrawlClient.from_environment()
        snapshot, firecrawl_result = collect_user_website_snapshot(
            args.url,
            max_pages=args.max_pages,
            firecrawl_client=firecrawl_client,
        )

        snapshot_path = run_dir / "website_snapshot.json"
        snapshot_path.write_text(
            json.dumps(snapshot, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        (run_dir / "user_site_firecrawl.json").write_text(
            json.dumps(firecrawl_result, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        save_firecrawl_usage(run_dir, firecrawl_client)

        print(f"Saved website snapshot: {snapshot_path}")
        print(f"Pages crawled: {len(snapshot['pages'])}")
        print(f"Pages failed: {len(snapshot['failed_pages'])}")

    if args.command == "evidence":
        snapshot_path = Path(args.snapshot)
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        evidence = build_website_evidence(snapshot)

        evidence_path = snapshot_path.parent / "website_evidence.json"
        evidence_path.write_text(
            json.dumps(evidence, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        print(f"Saved website evidence: {evidence_path}")

    if args.command == "profile":
        snapshot_path = Path(args.snapshot)
        evidence_path = (
            Path(args.evidence)
            if args.evidence
            else snapshot_path.parent / "website_evidence.json"
        )
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))

        profile, payload, error = generate_company_profile(
            snapshot,
            evidence,
            lean=args.lean,
        )

        payload_path = snapshot_path.parent / "company_profile_prompt.json"
        payload_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        if profile is None:
            print(f"Saved company profile prompt: {payload_path}")
            print(f"Company profile not generated: {error}")
            return

        profile_path = snapshot_path.parent / "company_profile.json"
        profile_path.write_text(
            json.dumps(profile, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"Saved company profile: {profile_path}")

    if args.command == "competitors":
        profile_path = Path(args.profile)
        company_profile = json.loads(profile_path.read_text(encoding="utf-8"))

        competitors, payload, error = generate_competitor_seeds(company_profile)

        payload_path = profile_path.parent / "probable_competitors_prompt.json"
        payload_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        if competitors is None:
            print(f"Saved competitor seed prompt: {payload_path}")
            print(f"Competitor seeds not generated: {error}")
            return

        competitors_path = profile_path.parent / "probable_competitors.json"
        competitors_path.write_text(
            json.dumps(competitors, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"Saved probable competitors: {competitors_path}")
        print(f"Competitors generated: {len(competitors)}")

    if args.command == "intents":
        profile_path = Path(args.profile)
        company_profile = json.loads(profile_path.read_text(encoding="utf-8"))

        prompts, payload, error = generate_customer_intents(company_profile)

        payload_path = profile_path.parent / "customer_prompts_prompt.json"
        payload_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        if prompts is None:
            print(f"Saved customer prompts prompt: {payload_path}")
            print(f"Customer prompts not generated: {error}")
            return

        prompts_path = profile_path.parent / "customer_prompts.json"
        prompts_path.write_text(
            json.dumps(prompts, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"Saved customer prompts: {prompts_path}")
        print(f"Prompts generated: {len(prompts)}")

    if args.command == "collect":
        prompts_path = Path(args.prompts)
        prompts = json.loads(prompts_path.read_text(encoding="utf-8"))

        if args.assistants:
            results, payloads, errors = collect_multi_model_recommendations(
                prompts,
                assistants=args.assistants,
                limit_per_assistant=args.limit_per_assistant or args.limit,
                model_overrides={
                    "openai": args.openai_model or args.model,
                    "openai_search": args.openai_search_model or args.model,
                    "claude": args.claude_model,
                    "gemini": args.gemini_model,
                    "bedrock_claude": args.bedrock_claude_model,
                    "bedrock_nova": args.bedrock_nova_model,
                    "bedrock_llama": args.bedrock_llama_model,
                    "bedrock_mistral": args.bedrock_mistral_model,
                },
                analysis_mode=not args.structured_provider_json,
                analyzer_batch_size=args.analyzer_batch_size,
                provider_concurrency=args.provider_concurrency,
            )
            error = None
        else:
            results, payloads, error = collect_openai_recommendations(
                prompts,
                model=args.model,
                limit=args.limit,
            )
            errors = []

        payload_path = prompts_path.parent / "ai_recommendation_prompts.json"
        payload_path.write_text(
            json.dumps(save_prompt_payloads_preview(payloads), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        errors_path = prompts_path.parent / "ai_recommendation_errors.json"
        errors_path.write_text(
            json.dumps(errors, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        if results is None:
            print(f"Saved AI recommendation prompt payloads: {payload_path}")
            print(f"AI recommendations not collected: {error}")
            return

        results = verify_provider_citations(
            results,
            concurrency=args.provider_concurrency,
        )
        provider_raw_path = prompts_path.parent / "ai_provider_answers_raw.json"
        provider_raw_path.write_text(
            json.dumps(
                [
                    {
                        "prompt_index": item.get("prompt_index"),
                        "prompt": item.get("prompt"),
                        "prompt_category": item.get("prompt_category"),
                        "buying_stage": item.get("buying_stage"),
                        "assistant": item.get("assistant"),
                        "model": item.get("model"),
                        "provider_source_urls": item.get("provider_source_urls", []),
                        "raw_response": item.get("raw_response", ""),
                        "collection_mode": item.get("collection_mode"),
                    }
                    for item in results
                ],
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        raw_path = prompts_path.parent / "ai_recommendations_raw.json"
        raw_path.write_text(
            json.dumps(results, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"Saved AI recommendation results: {raw_path}")
        print(f"Saved raw provider answers: {provider_raw_path}")
        print(f"Responses collected: {len(results)}")
        if errors:
            print(f"Collection errors: {len(errors)}")
            print(f"Saved collection errors: {errors_path}")

    if args.command == "aggregate":
        raw_path = Path(args.raw_results)
        raw_results = json.loads(raw_path.read_text(encoding="utf-8"))
        user_company = None
        aliases = list(args.alias)
        if args.profile:
            profile = json.loads(Path(args.profile).read_text(encoding="utf-8"))
            user_company = profile.get("company_name")
            if user_company:
                aliases.append(user_company)
        aggregate = aggregate_recommendations(
            raw_results,
            top_n=args.top_n,
            user_company=user_company,
            user_aliases=aliases,
        )

        aggregate_path = raw_path.parent / "recommendation_patterns.json"
        aggregate_path.write_text(
            json.dumps(aggregate, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"Saved recommendation patterns: {aggregate_path}")
        print(f"Unique companies: {aggregate['summary']['unique_companies']}")
        print(f"Top competitors: {aggregate['summary']['top_competitor_count']}")
        print(
            "User mentions: "
            f"{aggregate['user_recommendation_summary']['user_mentions']}/"
            f"{aggregate['user_recommendation_summary']['responses_analyzed']}"
        )

    if args.command == "competitor-evidence":
        patterns_path = Path(args.patterns)
        patterns = json.loads(patterns_path.read_text(encoding="utf-8"))
        site_mapping = {}
        if args.sites:
            site_mapping = json.loads(Path(args.sites).read_text(encoding="utf-8"))

        firecrawl_client = FirecrawlClient.from_environment()
        evidence = build_competitor_evidence(
            patterns,
            competitor_sites=site_mapping,
            max_pages=args.max_pages,
            firecrawl_client=firecrawl_client,
        )

        evidence_path = patterns_path.parent / "competitor_evidence.json"
        evidence_path.write_text(
            json.dumps(evidence, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"Saved competitor evidence: {evidence_path}")
        print(f"Competitors checked: {evidence['summary']['competitors_checked']}")
        print(f"With website evidence: {evidence['summary']['with_website_evidence']}")
        save_firecrawl_usage(patterns_path.parent, firecrawl_client)

    if args.command == "compare":
        user_evidence_path = Path(args.user_evidence)
        competitor_evidence_path = Path(args.competitor_evidence)
        user_evidence = json.loads(user_evidence_path.read_text(encoding="utf-8"))
        competitor_evidence = json.loads(
            competitor_evidence_path.read_text(encoding="utf-8")
        )

        comparison = compare_user_to_competitors(user_evidence, competitor_evidence)
        comparison_path = user_evidence_path.parent / "comparison.json"
        comparison_path.write_text(
            json.dumps(comparison, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"Saved comparison: {comparison_path}")
        print(
            "High priority gaps: "
            f"{len(comparison['summary']['high_priority_gaps'])}"
        )

    if args.command == "recommend":
        profile_path = Path(args.profile)
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        user_evidence = json.loads(Path(args.user_evidence).read_text(encoding="utf-8"))
        patterns_path = (
            Path(args.patterns)
            if args.patterns
            else profile_path.parent / "recommendation_patterns.json"
        )
        patterns = json.loads(patterns_path.read_text(encoding="utf-8"))
        competitor_evidence = json.loads(
            Path(args.competitor_evidence).read_text(encoding="utf-8")
        )
        comparison = json.loads(Path(args.comparison).read_text(encoding="utf-8"))

        firecrawl_client = FirecrawlClient.from_environment()
        recommendations, payload, error = generate_audit_recommendations(
            profile,
            user_evidence,
            patterns,
            competitor_evidence,
            comparison,
            firecrawl_client=firecrawl_client,
        )

        payload_path = profile_path.parent / "audit_recommendations_prompt.json"
        payload_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        if recommendations is None:
            print(f"Saved audit recommendations prompt: {payload_path}")
            print(f"Audit recommendations not generated: {error}")
            return

        recommendations_path = profile_path.parent / "audit_recommendations.json"
        recommendations_path.write_text(
            json.dumps(recommendations, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        save_firecrawl_usage(profile_path.parent, firecrawl_client)
        print(f"Saved audit recommendations: {recommendations_path}")
        print(f"Recommendations generated: {len(recommendations)}")

    if args.command == "report":
        profile_path = Path(args.profile)
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        user_evidence = json.loads(Path(args.user_evidence).read_text(encoding="utf-8"))
        patterns = json.loads(Path(args.patterns).read_text(encoding="utf-8"))
        competitor_evidence = json.loads(
            Path(args.competitor_evidence).read_text(encoding="utf-8")
        )
        comparison = json.loads(Path(args.comparison).read_text(encoding="utf-8"))
        recommendations = json.loads(Path(args.recommendations).read_text(encoding="utf-8"))

        report, payload, error = generate_final_report(
            profile,
            user_evidence,
            patterns,
            competitor_evidence,
            comparison,
            recommendations,
        )

        payload_path = profile_path.parent / "final_report_prompt.json"
        payload_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        if report is None:
            print(f"Saved final report prompt: {payload_path}")
            print(f"Final report not generated: {error}")
            return

        report_path = profile_path.parent / "final_report.md"
        report_path.write_text(report, encoding="utf-8")
        print(f"Saved final report: {report_path}")

    if args.command == "quality":
        raw_path = Path(args.raw_results)
        raw_results = json.loads(raw_path.read_text(encoding="utf-8"))
        patterns = json.loads(Path(args.patterns).read_text(encoding="utf-8"))
        competitor_evidence = json.loads(
            Path(args.competitor_evidence).read_text(encoding="utf-8")
        )
        comparison = json.loads(Path(args.comparison).read_text(encoding="utf-8"))

        quality = build_quality_summary(
            raw_results,
            patterns,
            competitor_evidence,
            comparison,
        )
        quality_path = raw_path.parent / "quality_summary.json"
        quality_path.write_text(
            json.dumps(quality, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"Saved quality summary: {quality_path}")
        print(f"Responses by assistant: {quality['responses_by_assistant']}")
        print(
            "Parsed recommendations by assistant: "
            f"{quality['parsed_recommendations_by_assistant']}"
        )
        print(f"Warnings: {len(quality['warnings'])}")

    if args.command == "export":
        profile_path = Path(args.profile)
        raw_path = Path(args.raw_results)
        quality_path = (
            Path(args.quality)
            if args.quality
            else raw_path.parent / "quality_summary.json"
        )
        web_presence_path = raw_path.parent / "web_presence.json"
        export = build_frontend_export(
            json.loads(profile_path.read_text(encoding="utf-8")),
            json.loads(Path(args.prompts).read_text(encoding="utf-8")),
            json.loads(raw_path.read_text(encoding="utf-8")),
            json.loads(Path(args.patterns).read_text(encoding="utf-8")),
            json.loads(Path(args.competitor_evidence).read_text(encoding="utf-8")),
            json.loads(Path(args.comparison).read_text(encoding="utf-8")),
            json.loads(Path(args.recommendations).read_text(encoding="utf-8")),
            json.loads(quality_path.read_text(encoding="utf-8"))
            if quality_path.exists()
            else {},
            json.loads(web_presence_path.read_text(encoding="utf-8"))
            if web_presence_path.exists()
            else {},
        )
        export_path = raw_path.parent / "audit_export.json"
        export_path.write_text(
            json.dumps(export, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"Saved frontend export: {export_path}")
        print(f"Overall score: {export['score']['overall_score']}")

    if args.command == "run":
        run_dir = make_run_dir(Path(args.output_dir), args.url)
        firecrawl_client = FirecrawlClient.from_environment()
        resume_dir = Path(args.resume_from).resolve() if args.resume_from else None
        existing_results: list[dict[str, object]] = []
        assistant_prompt_indexes = None
        collect_assistants = list(args.assistants)

        if resume_dir:
            emit_run_progress(
                "resume_free_audit",
                35,
                "Reusing website profile and buyer questions from the free audit",
                run_dir=str(run_dir),
            )

            def load_resume_json(name: str):
                source = resume_dir / name
                if not source.exists():
                    raise SystemExit(f"Cannot resume: missing {source}")
                value = json.loads(source.read_text(encoding="utf-8"))
                (run_dir / name).write_text(
                    json.dumps(value, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
                return value

            snapshot = load_resume_json("website_snapshot.json")
            user_evidence = load_resume_json("website_evidence.json")
            profile = load_resume_json("company_profile.json")
            prompts = load_resume_json("customer_prompts.json")
            existing_results = load_resume_json("ai_recommendations_raw.json")
            existing_assistants = {
                str(item.get("assistant", "")).strip().lower()
                for item in existing_results
            }
            collect_assistants = [
                assistant
                for assistant in args.assistants
                if assistant.strip().lower() not in existing_assistants
            ]
            assistant_prompt_indexes = {}
            unique_start = 6
            for assistant in collect_assistants:
                assistant_prompt_indexes[assistant] = [1, 2, unique_start, unique_start + 1, unique_start + 2]
                unique_start += 3
        else:
            reused_snapshot = None
            reuse_rejected = None
            if args.reuse_snapshot:
                reused_snapshot, reuse_rejected = load_reusable_snapshot(
                    args.reuse_snapshot,
                    args.url,
                )

            if reused_snapshot is not None:
                snapshot = reused_snapshot
                firecrawl_profile_result = {
                    "attempted": False,
                    "reason": "Reused a recent website read for this domain",
                    "mapped_urls": 0,
                    "pages_added": 0,
                    "pages_replaced": 0,
                    "errors": [],
                    "standard_fallback_used": False,
                    "reused_website_read": snapshot.get("reused_website_read", {}),
                    "crawl_quality": snapshot.get("crawl_quality", {}),
                }
                emit_run_progress(
                    "crawl_user_site",
                    12,
                    "Reusing a recent read of this website",
                    run_dir=str(run_dir),
                    pages_reused=len(snapshot.get("pages", [])),
                )
            else:
                emit_run_progress(
                    "crawl_user_site",
                    5,
                    (
                        "Reading website with Firecrawl"
                        if firecrawl_client is not None
                        else "Firecrawl unavailable; using standard crawler"
                    ),
                    run_dir=str(run_dir),
                    reuse_skipped=reuse_rejected,
                )
                snapshot, firecrawl_profile_result = collect_user_website_snapshot(
                    args.url,
                    max_pages=args.max_pages,
                    firecrawl_client=firecrawl_client,
                )
            if firecrawl_profile_result.get("standard_fallback_used"):
                emit_run_progress(
                    "crawl_user_site",
                    10,
                    "Using standard crawler to complete missing website context",
                )
            (run_dir / "website_snapshot.json").write_text(
                json.dumps(snapshot, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            (run_dir / "user_site_firecrawl.json").write_text(
                json.dumps(
                    firecrawl_profile_result,
                    indent=2,
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            if not snapshot.get("pages"):
                save_firecrawl_usage(run_dir, firecrawl_client)
                raise SystemExit(
                    website_crawl_failure_message(
                        args.url,
                        firecrawl_profile_result,
                        firecrawl_configured=firecrawl_client is not None,
                    )
                )
            user_evidence = build_website_evidence(snapshot)
            emit_run_progress(
                "extract_user_evidence",
                15,
                "Extracting structured website evidence",
                pages_crawled=len(snapshot.get("pages", [])),
                pages_failed=len(snapshot.get("failed_pages", [])),
            )
            (run_dir / "website_evidence.json").write_text(
                json.dumps(user_evidence, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            profile, profile_payload, profile_error = generate_company_profile(
                snapshot,
                user_evidence,
                lean=args.free_preview,
            )
            emit_run_progress("company_profile", 25, "Generating company profile")
            (run_dir / "company_profile_prompt.json").write_text(
                json.dumps(profile_payload, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            if profile is None:
                raise SystemExit(f"Company profile not generated: {profile_error}")
            (run_dir / "company_profile.json").write_text(
                json.dumps(profile, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            profile_issue = question_profile_issue(profile)
            (run_dir / "company_profile_validation.json").write_text(
                json.dumps(
                    {
                        "ready_for_questions": profile_issue is None,
                        "error": profile_issue,
                    },
                    indent=2,
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            if profile_issue:
                save_firecrawl_usage(run_dir, firecrawl_client)
                raise SystemExit(profile_issue)
            if args.free_preview:
                competitor_seeds = []
                (run_dir / "probable_competitors_skipped.txt").write_text(
                    "Skipped because competitor seeds are not used by the free preview.",
                    encoding="utf-8",
                )
                emit_run_progress(
                    "competitor_seeds",
                    32,
                    "Skipping unused competitor seed generation",
                )
            else:
                competitor_seeds, competitor_payload, competitor_error = (
                    generate_competitor_seeds(profile)
                )
                emit_run_progress(
                    "competitor_seeds",
                    32,
                    "Generating probable competitor seeds",
                )
                (run_dir / "probable_competitors_prompt.json").write_text(
                    json.dumps(competitor_payload, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
            if competitor_seeds is not None and not args.free_preview:
                (run_dir / "probable_competitors.json").write_text(
                    json.dumps(competitor_seeds, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
            elif not args.free_preview:
                (run_dir / "probable_competitors_error.txt").write_text(
                    str(competitor_error),
                    encoding="utf-8",
                )
            if args.free_preview:
                prompts, prompts_payload, prompts_error = (
                    generate_free_customer_intents(profile)
                )
            else:
                prompts, prompts_payload, prompts_error = (
                    generate_customer_intents(profile)
                )
            emit_run_progress("buyer_prompts", 40, "Generating buyer questions")
            (run_dir / "customer_prompts_prompt.json").write_text(
                json.dumps(prompts_payload, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            if prompts is None:
                raise SystemExit(f"Customer prompts not generated: {prompts_error}")
            (run_dir / "customer_prompts.json").write_text(
                json.dumps(prompts, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

        emit_run_progress(
            "provider_questions",
            48,
            "Asking AI providers",
            providers=len(collect_assistants),
        )
        new_results, payloads, errors = collect_multi_model_recommendations(
            prompts,
            assistants=collect_assistants,
            limit_per_assistant=args.limit_per_assistant,
            assistant_prompt_indexes=assistant_prompt_indexes,
            model_overrides={
                "openai": args.openai_model or args.model,
                "openai_search": args.openai_search_model or args.model,
                "claude": args.claude_model,
                "gemini": args.gemini_model,
                "bedrock_claude": args.bedrock_claude_model,
                "bedrock_nova": args.bedrock_nova_model,
                "bedrock_llama": args.bedrock_llama_model,
                "bedrock_mistral": args.bedrock_mistral_model,
            },
            analyzer_batch_size=args.analyzer_batch_size,
            provider_concurrency=args.provider_concurrency,
            search_context_size=args.search_context_size,
            openai_search_batch_size=args.openai_search_batch_size,
        )
        # Cited pages are fetched to confirm they load, and checked for the
        # audited company's name so the report can say which sources ignore it.
        raw_results = verify_provider_citations(
            existing_results + new_results,
            concurrency=args.provider_concurrency,
            match_terms=tuple(
                value
                for value in (
                    str(profile.get("company_name", "")).strip(),
                    urlparse(ensure_url(args.url)).netloc.lower().removeprefix("www."),
                )
                if value
            ),
        )
        emit_run_progress(
            "provider_questions",
            65,
            "Collected AI provider answers",
            responses_collected=len(raw_results),
            collection_errors=len(errors),
        )
        (run_dir / "ai_recommendation_prompts.json").write_text(
            json.dumps(save_prompt_payloads_preview(payloads), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        (run_dir / "ai_recommendation_errors.json").write_text(
            json.dumps(errors, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        raw_path = run_dir / "ai_recommendations_raw.json"
        raw_path.write_text(
            json.dumps(raw_results, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        (run_dir / "ai_provider_answers_raw.json").write_text(
            json.dumps(
                [
                    {
                        "prompt_index": item.get("prompt_index"),
                        "prompt": item.get("prompt"),
                        "prompt_category": item.get("prompt_category"),
                        "buying_stage": item.get("buying_stage"),
                        "assistant": item.get("assistant"),
                        "model": item.get("model"),
                        "provider_source_urls": item.get("provider_source_urls", []),
                        "raw_response": item.get("raw_response", ""),
                        "collection_mode": item.get("collection_mode"),
                    }
                    for item in raw_results
                ],
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        aliases = [profile.get("company_name")] if profile.get("company_name") else []
        patterns = aggregate_recommendations(
            raw_results,
            top_n=args.top_n,
            user_company=profile.get("company_name"),
            user_aliases=aliases,
        )
        emit_run_progress("pattern_analysis", 72, "Aggregating recommendation patterns")
        patterns_path = run_dir / "recommendation_patterns.json"
        patterns_path.write_text(
            json.dumps(patterns, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        if args.skip_web_presence:
            web_presence = {
                "status": "skipped",
                "provider": "duckduckgo_with_agentcore_fallback",
                "entities": [],
                "summary": {
                    "entities_checked": 0,
                    "queries_run": 0,
                    "search_errors": 0,
                    "provider_queries": {},
                    "fallback_queries": 0,
                    "verified_mentions": 0,
                    "official_websites_resolved": 0,
                },
            }
        else:
            emit_run_progress(
                "web_presence",
                76,
                "Finding and verifying company mentions across the web",
            )
            web_presence = collect_web_presence(
                profile,
                prompts,
                raw_results,
                patterns,
                max_competitors=args.web_presence_max_competitors,
                search_concurrency=args.provider_concurrency,
                fetch_concurrency=args.provider_concurrency,
                error_log_path=run_dir / "web_search_errors.log",
            )
        (run_dir / "web_presence.json").write_text(
            json.dumps(web_presence, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        competitor_evidence = build_competitor_evidence(
            patterns,
            web_presence=web_presence,
            max_pages=args.competitor_max_pages,
            crawl_limit=args.max_competitors_crawled,
            firecrawl_client=firecrawl_client,
        )
        emit_run_progress(
            "competitor_evidence",
            82,
            "Collecting competitor/source evidence",
            competitors_checked=competitor_evidence.get("summary", {}).get("competitors_checked", 0),
            websites_crawled=competitor_evidence.get("summary", {}).get("with_website_evidence", 0),
        )
        competitor_evidence_path = run_dir / "competitor_evidence.json"
        competitor_evidence_path.write_text(
            json.dumps(competitor_evidence, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        comparison = compare_user_to_competitors(user_evidence, competitor_evidence)
        emit_run_progress("comparison", 88, "Comparing user website against competitors")
        comparison_path = run_dir / "comparison.json"
        comparison_path.write_text(
            json.dumps(comparison, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        if args.skip_audit_recommendations:
            audit_recs = (
                build_free_preview_recommendations(profile, patterns)
                if args.free_preview
                else []
            )
            (run_dir / "audit_recommendations_skipped.txt").write_text(
                (
                    "Used deterministic free-preview insight."
                    if args.free_preview
                    else "Skipped for fast preview scan."
                ),
                encoding="utf-8",
            )
        else:
            emit_run_progress("improvement_recommendations", 91, "Generating improvement recommendations")
            audit_recs, rec_payload, rec_error = generate_audit_recommendations(
                profile,
                user_evidence,
                patterns,
                competitor_evidence,
                comparison,
                # The free audit already reads the one competitor page it cites,
                # so it skips the extra Firecrawl re-check to stay fast.
                firecrawl_client=None if args.free_preview else firecrawl_client,
                limit=args.max_recommendations,
            )
            (run_dir / "audit_recommendations_prompt.json").write_text(
                json.dumps(rec_payload, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            if audit_recs is None:
                audit_recs = []
                (run_dir / "audit_recommendations_error.txt").write_text(
                    str(rec_error),
                    encoding="utf-8",
                )
            if args.max_recommendations and audit_recs:
                audit_recs = audit_recs[: args.max_recommendations]
        audit_recs_path = run_dir / "audit_recommendations.json"
        audit_recs_path.write_text(
            json.dumps(audit_recs, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        save_firecrawl_usage(run_dir, firecrawl_client)

        if args.skip_final_report:
            (run_dir / "final_report_skipped.txt").write_text(
                "Skipped for fast preview scan.",
                encoding="utf-8",
            )
        else:
            emit_run_progress("final_report", 95, "Writing final Markdown report")
            report, report_payload, report_error = generate_final_report(
                profile,
                user_evidence,
                patterns,
                competitor_evidence,
                comparison,
                audit_recs,
            )
            (run_dir / "final_report_prompt.json").write_text(
                json.dumps(report_payload, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            if report is not None:
                (run_dir / "final_report.md").write_text(report, encoding="utf-8")
            else:
                (run_dir / "final_report_error.txt").write_text(
                    str(report_error),
                    encoding="utf-8",
                )

        quality = build_quality_summary(
            raw_results,
            patterns,
            competitor_evidence,
            comparison,
        )
        quality_path = run_dir / "quality_summary.json"
        quality_path.write_text(
            json.dumps(quality, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        export = build_frontend_export(
            profile,
            prompts,
            raw_results,
            patterns,
            competitor_evidence,
            comparison,
            audit_recs,
            quality,
            web_presence,
            free_preview=args.free_preview,
        )
        export_path = run_dir / "audit_export.json"
        export_path.write_text(
            json.dumps(export, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        emit_run_progress("frontend_export", 98, "Created frontend export", audit_export_path=str(export_path))

        print(
            json.dumps(
                {
                    "event": "complete",
                    "run_dir": str(run_dir),
                    "audit_export_path": str(export_path),
                    "final_report_path": str(run_dir / "final_report.md"),
                    "responses_collected": len(raw_results),
                    "collection_errors": len(errors),
                    "overall_score": export["score"]["overall_score"],
                },
                ensure_ascii=False,
            )
        )
