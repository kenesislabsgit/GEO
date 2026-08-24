from __future__ import annotations

from typing import Any


CHECKS = (
    ("homepage_headline", "Clear product explanation"),
    ("target_audience_clarity", "Clear target audience"),
    ("industry_clarity", "Industry focus"),
    ("use_case_pages_found", "Use case coverage"),
    ("feature_pages_found", "Feature coverage"),
    ("pricing_page_found", "Pricing clarity"),
    ("documentation_found", "Documentation"),
    ("faq_page_found", "FAQ"),
    ("schema_json_ld_found", "Schema / structured data"),
    ("comparison_pages_found", "Comparison pages"),
    ("testimonials_or_case_studies_found", "Testimonials / case studies"),
)


def compare_user_to_competitors(
    user_evidence: dict[str, Any],
    competitor_evidence: dict[str, Any],
) -> dict[str, Any]:
    competitors = competitor_evidence.get("competitors", [])
    checks = []

    for field, label in CHECKS:
        user_result = evaluate_field(user_evidence, field)
        competitor_results = [
            {
                "company_name": competitor.get("company_name", "Unknown"),
                "result": evaluate_field(competitor.get("website_evidence") or {}, field),
                "collection_status": competitor.get("collection_status", "Unknown"),
            }
            for competitor in competitors
        ]
        checks.append(
            {
                "field": field,
                "label": label,
                "user_result": user_result,
                "competitor_results": competitor_results,
                "gap": determine_gap(user_result, competitor_results),
            }
        )

    return {
        "summary": build_summary(checks, competitors),
        "recurring_competitor_patterns": build_recurring_patterns(checks, competitors),
        "differential_analysis": build_differential_analysis(checks, competitors),
        "checks": checks,
    }


def evaluate_field(evidence: dict[str, Any], field: str) -> dict[str, Any]:
    value = evidence.get(field)
    if value is None:
        return {"status": "Unknown", "evidence": "Not collected"}

    if isinstance(value, dict):
        if "found" in value:
            return {
                "status": "Present" if value["found"] else "Missing",
                "evidence": value,
            }
        if "level" in value:
            return {"status": value["level"], "evidence": value}

    if isinstance(value, str):
        if value and value != "Unknown":
            return {"status": "Present", "evidence": value}
        return {"status": "Missing", "evidence": value or "Unknown"}

    return {"status": "Present", "evidence": value}


def determine_gap(
    user_result: dict[str, Any],
    competitor_results: list[dict[str, Any]],
) -> dict[str, Any]:
    user_score = score_status(user_result["status"])
    competitor_scores = [
        score_status(item["result"]["status"])
        for item in competitor_results
        if item["result"]["status"] != "Unknown"
    ]
    if not competitor_scores:
        return {"level": "Unknown", "reason": "No competitor website evidence collected."}

    competitor_average = sum(competitor_scores) / len(competitor_scores)
    if competitor_average - user_score >= 1.5:
        level = "High"
    elif competitor_average > user_score:
        level = "Medium"
    else:
        level = "Low"

    return {
        "level": level,
        "user_score": user_score,
        "competitor_average_score": round(competitor_average, 2),
    }


def score_status(status: str) -> int:
    return {
        "High": 3,
        "Present": 3,
        "Medium": 2,
        "Low": 1,
        "Missing": 0,
        "Unknown": 0,
    }.get(status, 0)


def positive_status(status: str) -> bool:
    return status in {"High", "Present", "Medium"}


def missing_status(status: str) -> bool:
    return status in {"Low", "Missing"}


def concise_evidence(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        if "matched_terms" in value:
            return {
                "matched_terms": value.get("matched_terms", [])[:8],
                "level": value.get("level"),
            }
        if "urls" in value or "matches" in value or "pages" in value:
            urls = value.get("urls") or value.get("pages") or []
            examples = []
            for match in value.get("matches", [])[:2]:
                examples.append(
                    {
                        "url": match.get("url"),
                        "title": match.get("text"),
                        "excerpt": match.get("excerpt"),
                    }
                )
            return {
                "found": value.get("found"),
                "urls": urls[:3],
                "examples": examples,
            }
        return {key: value.get(key) for key in sorted(value, key=str)[:5]}
    if isinstance(value, str):
        return {"text": " ".join(value.split())[:240]}
    return {"value": value}


def build_differential_analysis(
    checks: list[dict[str, Any]],
    competitors: list[dict[str, Any]],
) -> dict[str, Any]:
    competitors_with_evidence = {
        item.get("company_name", "Unknown")
        for item in competitors
        if item.get("website_evidence")
    }
    total = len(competitors_with_evidence)
    coverage_by_check = []
    competitor_advantages = []
    audited_company_advantages = []
    shared_strengths = []
    uncertain_or_uncollected = []

    for check in checks:
        user_result = check["user_result"]
        user_status = user_result.get("status", "Unknown")
        competitor_rows = [
            result
            for result in check.get("competitor_results", [])
            if result.get("company_name") in competitors_with_evidence
        ]
        known_competitor_rows = [
            result
            for result in competitor_rows
            if result.get("result", {}).get("status") != "Unknown"
        ]
        positive_competitor_rows = [
            result
            for result in known_competitor_rows
            if positive_status(result.get("result", {}).get("status", "Unknown"))
        ]
        missing_competitor_rows = [
            result
            for result in known_competitor_rows
            if missing_status(result.get("result", {}).get("status", "Unknown"))
        ]
        checked = len(known_competitor_rows)
        competitor_presence_rate = (
            len(positive_competitor_rows) / checked if checked else 0
        )
        row = {
            "field": check["field"],
            "label": check["label"],
            "audited_company_status": user_status,
            "audited_company_evidence": concise_evidence(user_result.get("evidence")),
            "competitors_checked": checked,
            "competitors_with_signal": len(positive_competitor_rows),
            "competitors_without_signal": len(missing_competitor_rows),
            "competitor_presence_rate": round(competitor_presence_rate, 2),
            "example_competitors_with_signal": [
                {
                    "company_name": item.get("company_name", "Unknown"),
                    "status": item.get("result", {}).get("status", "Unknown"),
                    "evidence": concise_evidence(item.get("result", {}).get("evidence")),
                }
                for item in positive_competitor_rows[:3]
            ],
            "example_competitors_without_signal": [
                {
                    "company_name": item.get("company_name", "Unknown"),
                    "status": item.get("result", {}).get("status", "Unknown"),
                }
                for item in missing_competitor_rows[:3]
            ],
        }
        coverage_by_check.append(row)

        if not checked or user_status == "Unknown":
            uncertain_or_uncollected.append(
                {
                    "field": check["field"],
                    "label": check["label"],
                    "reason": (
                        "Audited company evidence was not collected."
                        if user_status == "Unknown"
                        else "No comparable competitor evidence was collected."
                    ),
                }
            )
            continue

        if missing_status(user_status) and competitor_presence_rate >= 0.5:
            competitor_advantages.append(
                {
                    "field": check["field"],
                    "label": check["label"],
                    "audited_company_status": user_status,
                    "competitors_with_signal": len(positive_competitor_rows),
                    "competitors_checked": checked,
                    "example_competitors": [
                        item.get("company_name", "Unknown")
                        for item in positive_competitor_rows[:5]
                    ],
                    "evidence": row["example_competitors_with_signal"],
                }
            )
        elif positive_status(user_status) and competitor_presence_rate <= 0.34:
            audited_company_advantages.append(
                {
                    "field": check["field"],
                    "label": check["label"],
                    "audited_company_status": user_status,
                    "audited_company_evidence": row["audited_company_evidence"],
                    "competitors_with_signal": len(positive_competitor_rows),
                    "competitors_checked": checked,
                }
            )
        elif positive_status(user_status) and competitor_presence_rate >= 0.5:
            shared_strengths.append(
                {
                    "field": check["field"],
                    "label": check["label"],
                    "audited_company_status": user_status,
                    "competitors_with_signal": len(positive_competitor_rows),
                    "competitors_checked": checked,
                    "example_competitors": [
                        item.get("company_name", "Unknown")
                        for item in positive_competitor_rows[:5]
                    ],
                }
            )

    return {
        "basis": {
            "competitors_compared": len(competitors),
            "competitors_with_website_evidence": total,
            "comparison_rule": (
                "Only crawled website evidence is used. Unknown means the scan did "
                "not collect enough evidence, not that the company lacks the item."
            ),
        },
        "competitor_advantages": competitor_advantages,
        "audited_company_advantages": audited_company_advantages,
        "shared_strengths": shared_strengths,
        "uncertain_or_uncollected": uncertain_or_uncollected,
        "coverage_by_check": coverage_by_check,
    }


def build_summary(
    checks: list[dict[str, Any]],
    competitors: list[dict[str, Any]],
) -> dict[str, Any]:
    high_gaps = [check["label"] for check in checks if check["gap"]["level"] == "High"]
    medium_gaps = [check["label"] for check in checks if check["gap"]["level"] == "Medium"]
    return {
        "competitors_compared": len(competitors),
        "competitors_with_website_evidence": sum(
            1 for item in competitors if item.get("website_evidence")
        ),
        "high_priority_gaps": high_gaps,
        "medium_priority_gaps": medium_gaps,
    }


def build_recurring_patterns(
    checks: list[dict[str, Any]],
    competitors: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    total = sum(1 for item in competitors if item.get("website_evidence"))
    compared_names = {
        item.get("company_name", "Unknown")
        for item in competitors
        if item.get("website_evidence")
    }
    patterns = []
    for check in checks:
        present = 0
        examples = []
        for result in check["competitor_results"]:
            if result["company_name"] not in compared_names:
                continue
            status = result["result"]["status"]
            if status in {"Present", "High", "Medium"}:
                present += 1
                examples.append(result["company_name"])
        patterns.append(
            {
                "pattern": check["label"],
                "competitors_with_pattern": present,
                "competitors_checked": total,
                "user_status": check["user_result"]["status"],
                "gap_level": check["gap"]["level"],
                "example_competitors": examples[:5],
            }
        )
    patterns.sort(
        key=lambda item: (
            -item["competitors_with_pattern"],
            {"High": 0, "Medium": 1, "Low": 2, "Unknown": 3}.get(
                item["gap_level"], 3
            ),
        )
    )
    return patterns
