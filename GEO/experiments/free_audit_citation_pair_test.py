from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import json
from pathlib import Path
import re
import time
from typing import Any
from urllib.parse import urlparse

from geo_audit.crawler import fetch_html, parse_page
from geo_audit.json_tools import extract_json_object
from geo_audit.llm import build_chat_payload, call_chat_completion

from experiments.free_audit_one_action_test import (
    clean,
    five_search_answers,
    latest_complete_runs,
    normalized_name,
    read_json,
)


SYSTEM_PROMPT = """Create at most one trustworthy website improvement for a free AI visibility audit.

The measured buyer answers identify a lost question and the competitor chosen
instead. You also receive two small page sets: pages cited for that competitor,
and pages already read from the audited company.

Choose the strongest supplied buyer candidate, then choose one audited-company
page whose actual text is directly relevant to the same buyer need. Compare
only what those passages prove. Recommend a
website communication change only when the audited passage proves the company
already supports the subject. Never turn a competitor capability into a new
capability for the audited company. Never infer from a title alone. Never invent
a URL, feature, certification, customer, metric, or page. If both sides do not
support a safe comparison, or if both pages already communicate the same point
equally clearly, return no_action. Do not produce a vague "say this more clearly"
action. State the exact missing explanation, proof, organization, or buyer focus.
Any capability you tell the audited company to communicate must be proven in
the selected audited-company passage. Never copy a competitor detail into the
audited company's action. Include one short exact support quote from each
selected page so the comparison can be checked.
Keep the action under 45 words. It may only reorganize, repeat, connect, or
explain facts present in the audited support quote. Do not add implementation
details, examples, metrics, integrations, compliance claims, or buyer segments
that are absent from that quote.

Return JSON with exactly these fields:
status (action or no_action), title, observation, action, expected_impact,
buyer_candidate_id, audited_page_id, competitor_page_id, confidence,
audited_support_quote, competitor_support_quote, no_action_reason.
Use only supplied page IDs.
"""


def cited_urls(rows: list[dict[str, Any]]) -> list[str]:
    values: list[str] = []
    for row in rows:
        values.extend(str(url) for url in row.get("source_urls", []) if url)
    for row in rows:
        if row.get("official_website"):
            values.append(str(row["official_website"]))
    return list(dict.fromkeys(values))


def fetch_cited_pages(urls: list[str], limit: int = 2) -> list[dict[str, str]]:
    pages: list[dict[str, str]] = []
    for url in urls[:6]:
        try:
            html, status, final_url = fetch_html(url, timeout=12)
            page = parse_page(final_url, html, status)
            text = clean(page.get("main_text") or page.get("text"), 1200)
            if not text:
                continue
            pages.append(
                {
                    "url": final_url,
                    "title": clean(page.get("title"), 240),
                    "content": text,
                }
            )
            if len(pages) >= limit:
                break
        except Exception:  # noqa: BLE001 - try the next citation.
            continue
    return pages


def audited_pages(snapshot: dict[str, Any], limit: int = 6) -> list[dict[str, str]]:
    pages = []
    for page in snapshot.get("pages", []) or []:
        url = str(page.get("final_url") or page.get("url") or "")
        text = clean(
            page.get("text")
            or page.get("main_text")
            or page.get("markdown")
            or page.get("content")
            or page.get("excerpt"),
            900,
        )
        if not url or not text:
            continue
        pages.append(
            {
                "url": url,
                "title": clean(page.get("title"), 240),
                "content": text,
            }
        )
        if len(pages) >= limit:
            break
    return pages


def model_pages(rows: list[dict[str, str]], prefix: str) -> tuple[list[dict[str, str]], dict[str, str]]:
    supplied = []
    lookup = {}
    for index, row in enumerate(rows, start=1):
        page_id = f"{prefix}-{index:02d}"
        lookup[page_id] = row["url"]
        supplied.append(
            {
                "page_id": page_id,
                "url_path": urlparse(row["url"]).path or "/",
                "title": row["title"],
                "content": row["content"],
            }
        )
    return supplied, lookup


def lost_question_candidates(
    raw: list[dict[str, Any]], aliases: list[str], limit: int = 3
) -> tuple[list[dict[str, Any]], dict[str, str], int]:
    """Use measured losses and answer-attached citations only.

    There is no keyword score or page-type rule here. Questions stay in their
    measured order, companies stay in recommendation-rank order, and a page is
    accepted only because ChatGPT attached it to that recommendation and it
    downloaded successfully.
    """
    own_names = {normalized_name(value) for value in aliases if value}
    candidates: list[dict[str, Any]] = []
    lookup: dict[str, str] = {}
    citations_found = 0
    for answer in raw:
        companies = sorted(
            answer.get("recommended_companies", []) or [],
            key=lambda row: int(row.get("rank", 999) or 999),
        )
        if any(normalized_name(row.get("company_name")) in own_names for row in companies):
            continue
        for company in companies[:2]:
            row = {
                "source_urls": company.get("source_urls") or [],
                "official_website": company.get("official_website"),
            }
            urls = cited_urls([row])
            citations_found += len(urls)
            downloaded = fetch_cited_pages(urls, 1)
            if not downloaded:
                continue
            page = downloaded[0]
            candidate_id = f"candidate-{len(candidates) + 1:02d}"
            page_id = f"competitor-{len(candidates) + 1:02d}"
            lookup[page_id] = page["url"]
            candidates.append(
                {
                    "candidate_id": candidate_id,
                    "question": answer.get("prompt"),
                    "winner": company.get("company_name"),
                    "winner_rank": company.get("rank"),
                    "answer_reason": clean(company.get("reasoning"), 420),
                    "competitor_page": {
                        "page_id": page_id,
                        "url_path": urlparse(page["url"]).path or "/",
                        "title": page["title"],
                        "content": page["content"],
                    },
                }
            )
            break
        if len(candidates) >= limit:
            break
    return candidates, lookup, citations_found


def build_input(
    run: Path,
) -> tuple[dict[str, Any], dict[str, str], dict[str, str], dict[str, Any]]:
    profile = read_json(run / "company_profile.json")
    snapshot = read_json(run / "website_snapshot.json")
    raw = five_search_answers(read_json(run / "ai_recommendations_raw.json"))
    if not raw:
        raise ValueError("No saved ChatGPT answers were available")
    aliases = [str(profile.get("company_name") or "")]
    aliases.extend(str(value) for value in (profile.get("company_name_variants") or []) if value)
    website_host = urlparse(
        str(snapshot.get("normalized_url") or snapshot.get("input_url") or "")
    ).netloc.lower().removeprefix("www.")
    if website_host:
        aliases.append(website_host)
    buyer_candidates, competitor_lookup, citations_found = lost_question_candidates(
        raw, aliases, 3
    )
    own_candidates = audited_pages(snapshot, 6)
    supplied_own, own_lookup = model_pages(own_candidates, "audited")
    lookup = {**competitor_lookup, **own_lookup}
    page_text = {
        str(page["page_id"]): str(page.get("content") or "")
        for page in supplied_own
    }
    page_text.update(
        {
            str((candidate.get("competitor_page") or {}).get("page_id")): str(
                (candidate.get("competitor_page") or {}).get("content") or ""
            )
            for candidate in buyer_candidates
        }
    )
    own_names = {normalized_name(value) for value in aliases if value}
    mentions = sum(
        any(
            normalized_name(row.get("company_name")) in own_names
            for row in (answer.get("recommended_companies") or [])
        )
        for answer in raw
    )
    input_data = {
        "audited_company": profile.get("company_name"),
        "answers_checked": len(raw),
        "audited_company_mentions": mentions,
        "buyer_candidates": buyer_candidates,
        "audited_company_pages": supplied_own,
    }
    meta = {
        "source_run": run.name,
        "company": profile.get("company_name"),
        "buyer_candidates_supplied": len(buyer_candidates),
        "competitor_citations_found": citations_found,
        "competitor_pages_downloaded": len(buyer_candidates),
        "audited_pages_supplied": len(own_candidates),
    }
    return input_data, lookup, page_text, meta


def quote_is_from_page(quote: Any, page_id: str, page_text: dict[str, str]) -> bool:
    wanted = re.sub(r"\s+", " ", str(quote or "")).strip().strip('"').lower()
    source = re.sub(r"\s+", " ", page_text.get(page_id, "")).lower()
    return bool(wanted) and wanted in source


def run_one(run: Path, output_root: Path, model: str) -> dict[str, Any]:
    started = time.perf_counter()
    input_data, lookup, page_text, meta = build_input(run)
    company_dir = output_root / run.name
    company_dir.mkdir(parents=True, exist_ok=True)
    (company_dir / "input.json").write_text(
        json.dumps(input_data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    if not input_data["buyer_candidates"] or not input_data["audited_company_pages"]:
        action = {
            "status": "no_action",
            "title": "",
            "observation": "",
            "action": "",
            "expected_impact": "",
            "buyer_candidate_id": "",
            "audited_page_id": "",
            "competitor_page_id": "",
            "confidence": "low",
            "audited_support_quote": "",
            "competitor_support_quote": "",
            "no_action_reason": "A usable page was not available from both companies.",
        }
        ai_called = False
    else:
        payload = build_chat_payload(
            SYSTEM_PROMPT,
            json.dumps(input_data, ensure_ascii=False),
            model=model,
            temperature=0.1,
            json_response=True,
        )
        if model.startswith("gpt-5"):
            payload.pop("temperature", None)
        (company_dir / "prompt.json").write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        action = extract_json_object(call_chat_completion(payload))
        ai_called = True

    candidate_id = str(action.get("buyer_candidate_id") or "")
    audited_id = str(action.get("audited_page_id") or "")
    competitor_id = str(action.get("competitor_page_id") or "")
    candidate_pages = {
        str(row.get("candidate_id")): str((row.get("competitor_page") or {}).get("page_id"))
        for row in input_data.get("buyer_candidates", [])
    }
    ids_valid = action.get("status") == "no_action" or (
        candidate_id in candidate_pages
        and candidate_pages[candidate_id] == competitor_id
        and audited_id.startswith("audited-")
        and audited_id in lookup
        and competitor_id in lookup
    )
    quotes_valid = action.get("status") == "no_action" or (
        quote_is_from_page(action.get("audited_support_quote"), audited_id, page_text)
        and quote_is_from_page(
            action.get("competitor_support_quote"), competitor_id, page_text
        )
    )
    if not ids_valid or not quotes_valid:
        action = {
            "status": "no_action",
            "title": "",
            "observation": "",
            "action": "",
            "expected_impact": "",
            "buyer_candidate_id": "",
            "audited_page_id": "",
            "competitor_page_id": "",
            "confidence": "low",
            "audited_support_quote": "",
            "competitor_support_quote": "",
            "no_action_reason": (
                "The AI did not return evidence quotes from its selected pages."
                if ids_valid
                else "The AI selected an invalid evidence page."
            ),
        }
        audited_id = ""
        competitor_id = ""
    result = {
        **meta,
        "model": model,
        "seconds": round(time.perf_counter() - started, 3),
        "ai_called": ai_called,
        "evidence_quotes_valid": quotes_valid,
        "estimated_writer_cost_usd": 0.005 if ai_called else 0.0,
        "audited_page_url": lookup.get(audited_id),
        "competitor_page_url": lookup.get(competitor_id),
        "action": action,
    }
    (company_dir / "result.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--outputs", default="outputs")
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--model", default="gpt-5-mini")
    args = parser.parse_args()
    output_root = Path("experiments/free_audit_citation_pair_runs") / datetime.now().strftime("%Y%m%d-%H%M%S")
    output_root.mkdir(parents=True, exist_ok=True)
    runs = latest_complete_runs(Path(args.outputs))
    results = []
    failures = []
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {
            executor.submit(run_one, run, output_root, args.model): run
            for run in runs
        }
        for future in as_completed(futures):
            run = futures[future]
            try:
                result = future.result()
                results.append(result)
                print(
                    f"{result['company']}: {result['seconds']}s | "
                    f"{result['action'].get('status')} | {result['action'].get('title', '')}"
                )
            except Exception as exc:  # noqa: BLE001 - preserve failed tests.
                failures.append({"source_run": run.name, "error": f"{type(exc).__name__}: {exc}"})
                print(f"{run.name}: FAILED | {type(exc).__name__}: {exc}")
    results.sort(key=lambda row: str(row.get("company", "")))
    summary = {
        "runs_attempted": len(runs),
        "runs_completed": len(results),
        "actions_returned": sum(row["action"].get("status") == "action" for row in results),
        "no_actions": sum(row["action"].get("status") == "no_action" for row in results),
        "wall_seconds": round(time.perf_counter() - started, 3),
        "average_seconds": round(sum(row["seconds"] for row in results) / max(1, len(results)), 3),
        "estimated_total_writer_cost_usd": round(sum(row["estimated_writer_cost_usd"] for row in results), 3),
        "failures": failures,
        "results": results,
    }
    (output_root / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"Saved: {output_root / 'summary.json'}")


if __name__ == "__main__":
    main()
