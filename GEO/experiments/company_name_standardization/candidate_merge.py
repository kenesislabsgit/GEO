from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Any

from geo_audit.json_tools import extract_json_object
from geo_audit.llm import (
    PROMPT_CACHE_KEY,
    build_chat_payload,
    build_openai_response_payload,
    call_chat_completion,
    call_openai_response,
)
from .experiment import assemble_lowercase_names


GENERIC_FIRST_WORDS = {
    "app",
    "company",
    "form",
    "forms",
    "get",
    "my",
    "online",
    "pro",
    "survey",
    "the",
    "user",
    "web",
}
DOMAIN_SUFFIX_WORDS = {"ai", "com", "io", "co"}

DECISION_SYSTEM_PROMPT = """You resolve candidate company-name groups for recommendation counting.

Code has already placed names together only when they share the same complete brand word. Your job is to decide whether every name in each candidate group belongs to the same underlying company/vendor.

This is COMPANY-LEVEL counting. A vendor name and one of that vendor's branded products should use the vendor's standard public company name. For example, "Formstack Forms" belongs to "Formstack". Different companies must stay separate even when their names look similar. "UserTesting" and "UserTest Pro" are an example of names that must not be merged merely because their spelling looks close.

Use the supplied recommendation reasons and websites. You do not have web search in this step. Set needs_web_search to true whenever the supplied context does not make the company identity certain.

Return one decision for every candidate_id. Copy every input name exactly. If should_merge is true, canonical_company is the current public company/vendor name. If false, canonical_company is empty. Never decide from the first letters or partial string similarity alone.

Return JSON only:
{"decisions":[{"candidate_id":"cg-001","should_merge":true,"canonical_company":"Formstack","input_names":["formstack","formstack forms"],"confidence":"high","needs_web_search":false,"reason":"Both are the same Formstack vendor."}]}"""

WEB_REVIEW_SYSTEM_PROMPT = """You verify important or uncertain company-name groups for recommendation counting.

Use web search. Decide whether every input name in each candidate group belongs to the same underlying company/vendor. This is company-level counting, so a vendor and its own branded product can merge under the vendor. Do not merge different companies because their spelling is similar.

Confirm identity using official websites, redirects, official product pages, or reliable rebrand evidence. Return one decision for every candidate_id and copy all input names exactly. When uncertain, keep the names separate.

Return JSON matching the supplied schema."""

DECISION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "candidate_id": {"type": "string"},
                    "should_merge": {"type": "boolean"},
                    "canonical_company": {"type": "string"},
                    "input_names": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                    },
                    "needs_web_search": {"type": "boolean"},
                    "reason": {"type": "string"},
                },
                "required": [
                    "candidate_id",
                    "should_merge",
                    "canonical_company",
                    "input_names",
                    "confidence",
                    "needs_web_search",
                    "reason",
                ],
            },
        }
    },
    "required": ["decisions"],
}


def normalize_name(value: Any) -> str:
    return " ".join(str(value or "").lower().split())


def name_words(value: Any) -> list[str]:
    return re.findall(r"[a-z0-9]+", normalize_name(value))


def first_brand_word(value: Any) -> str:
    words = name_words(value)
    if not words:
        return ""
    first = words[0]
    if first in GENERIC_FIRST_WORDS or len(first) < 4:
        return ""
    return first


def compact_identity_words(value: Any) -> tuple[str, ...]:
    words = name_words(value)
    return tuple(word for word in words if word not in DOMAIN_SUFFIX_WORDS)


def candidate_anchor(first: str, second: str) -> str:
    """Return a shared whole-brand anchor, never a partial-prefix guess."""
    first_words = name_words(first)
    second_words = name_words(second)
    if not first_words or not second_words:
        return ""
    first_brand = first_brand_word(first)
    second_brand = first_brand_word(second)
    if first_brand and first_brand == second_brand:
        return first_brand
    # A plain vendor name can appear after a product name, often in brackets:
    # "Dragon Anywhere (Nuance)" and "Nuance". This is still a complete brand
    # word, not the dangerous partial-prefix match in UserTesting/UserTest Pro.
    if len(first_words) == 1 and first_brand and first_brand in second_words:
        return first_brand
    if len(second_words) == 1 and second_brand and second_brand in first_words:
        return second_brand
    if compact_identity_words(first) == compact_identity_words(second):
        return " ".join(compact_identity_words(first))
    return ""


def build_candidate_groups(name_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_name = {str(row["normalized_name"]): row for row in name_rows}
    names = list(by_name)
    adjacency: dict[str, set[str]] = {name: set() for name in names}
    anchors: dict[frozenset[str], str] = {}
    for index, first in enumerate(names):
        for second in names[index + 1 :]:
            anchor = candidate_anchor(first, second)
            if not anchor:
                continue
            adjacency[first].add(second)
            adjacency[second].add(first)
            anchors[frozenset((first, second))] = anchor

    groups = []
    visited: set[str] = set()
    for name in names:
        if name in visited or not adjacency[name]:
            continue
        stack = [name]
        members = []
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            members.append(current)
            stack.extend(sorted(adjacency[current] - visited))
        member_rows = [by_name[member] for member in sorted(members)]
        shared_anchors = sorted(
            {
                anchor
                for pair, anchor in anchors.items()
                if pair.issubset(set(members))
            }
        )
        groups.append(
            {
                "candidate_id": f"cg-{len(groups) + 1:03d}",
                "shared_whole_words": shared_anchors,
                "input_names": sorted(members),
                "combined_recommendations": sum(
                    int(row.get("times_recommended", 0) or 0)
                    for row in member_rows
                ),
                "members": member_rows,
            }
        )
    return groups


def top_five_threshold(name_rows: list[dict[str, Any]]) -> int:
    counts = sorted(
        (int(row.get("times_recommended", 0) or 0) for row in name_rows),
        reverse=True,
    )
    return counts[4] if len(counts) >= 5 else (counts[-1] if counts else 0)


def call_normal_decider(
    candidate_groups: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any], str]:
    question = json.dumps({"candidate_groups": candidate_groups}, ensure_ascii=False)
    payload = build_chat_payload(
        DECISION_SYSTEM_PROMPT,
        question,
        temperature=0,
        json_response=True,
    )
    raw_response = call_chat_completion(payload)
    parsed = extract_json_object(raw_response)
    decisions = verify_decisions(parsed.get("decisions"), candidate_groups)
    return decisions, payload, raw_response


def groups_needing_web_review(
    groups: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    *,
    threshold: int,
    audited_company: str,
) -> list[dict[str, Any]]:
    decision_by_id = {row["candidate_id"]: row for row in decisions}
    audited_key = normalize_name(audited_company)
    selected = []
    for group in groups:
        decision = decision_by_id.get(group["candidate_id"], {})
        important = (
            int(group.get("combined_recommendations", 0) or 0) >= threshold
            or any(
                name == audited_key or name.startswith(f"{audited_key} ")
                for name in group.get("input_names", [])
            )
        )
        uncertain = (
            decision.get("confidence") != "high"
            or bool(decision.get("needs_web_search"))
        )
        if important or uncertain:
            selected.append(
                {
                    **group,
                    "first_decision": decision,
                    "review_reason": (
                        "affects audited company or top-five count"
                        if important
                        else "first decision was uncertain"
                    ),
                }
            )
    return selected


def call_web_reviewer(
    groups: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    if not groups:
        return [], {}, {}
    payload = build_openai_response_payload(
        WEB_REVIEW_SYSTEM_PROMPT,
        json.dumps({"candidate_groups": groups}, ensure_ascii=False),
        use_web_search=True,
        search_context_size="low",
        cache_key=f"{PROMPT_CACHE_KEY}-candidate-company-review",
    )
    payload["text"] = {
        "format": {
            "type": "json_schema",
            "name": "candidate_company_decisions",
            "strict": True,
            "schema": DECISION_SCHEMA,
        }
    }
    payload["reasoning"] = {"effort": "low"}
    payload["max_output_tokens"] = 5000
    raw_response, metadata = call_openai_response(payload)
    parsed = extract_json_object(raw_response)
    decisions = verify_decisions(parsed.get("decisions"), groups)
    return decisions, payload, metadata


def verify_decisions(
    decisions: Any,
    groups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    expected = {
        group["candidate_id"]: set(group["input_names"])
        for group in groups
    }
    verified = []
    used: set[str] = set()
    for decision in decisions if isinstance(decisions, list) else []:
        if not isinstance(decision, dict):
            continue
        candidate_id = str(decision.get("candidate_id", ""))
        names = {
            normalize_name(name)
            for name in decision.get("input_names", [])
            if normalize_name(name)
        }
        if (
            candidate_id not in expected
            or candidate_id in used
            or names != expected[candidate_id]
        ):
            continue
        used.add(candidate_id)
        should_merge = bool(decision.get("should_merge"))
        canonical = str(decision.get("canonical_company", "")).strip()
        if should_merge and not canonical:
            continue
        verified.append(
            {
                **decision,
                "candidate_id": candidate_id,
                "input_names": sorted(names),
                "should_merge": should_merge,
                "canonical_company": canonical if should_merge else "",
            }
        )
    return verified


def build_final_counts(
    name_rows: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    normal_decisions: list[dict[str, Any]],
    web_decisions: list[dict[str, Any]],
) -> dict[str, Any]:
    decisions = {row["candidate_id"]: row for row in normal_decisions}
    web_decision_ids = {row["candidate_id"] for row in web_decisions}
    decisions.update({row["candidate_id"]: row for row in web_decisions})
    display_by_name = {
        row["normalized_name"]: row.get("display_names", [row["normalized_name"]])[0]
        for row in name_rows
    }
    alias_map = {name: display for name, display in display_by_name.items()}
    applied = []
    for group in groups:
        decision = decisions.get(group["candidate_id"])
        if not decision or not decision.get("should_merge"):
            continue
        # Doubt never changes a customer's count. A normal decision that asks
        # for search must be confirmed by the web reviewer, and the final
        # reviewer itself must be highly confident. Otherwise the names stay
        # separate.
        if decision.get("confidence") != "high":
            continue
        if (
            decision.get("needs_web_search")
            and group["candidate_id"] not in web_decision_ids
        ):
            continue
        canonical = str(decision["canonical_company"])
        for name in group["input_names"]:
            alias_map[name] = canonical
        applied.append(decision)

    counts: dict[str, int] = defaultdict(int)
    members: dict[str, list[str]] = defaultdict(list)
    for row in name_rows:
        name = str(row["normalized_name"])
        canonical = alias_map[name]
        counts[canonical] += int(row.get("times_recommended", 0) or 0)
        members[canonical].append(name)
    final_counts = sorted(
        (
            {
                "company_name": company,
                "times_recommended": count,
                "input_names": sorted(members[company]),
            }
            for company, count in counts.items()
        ),
        key=lambda row: (-row["times_recommended"], row["company_name"].lower()),
    )
    return {
        "alias_map": alias_map,
        "applied_merge_decisions": applied,
        "final_counts": final_counts,
    }


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def prepare_saved_audit(
    audit_run: Path,
    *,
    output_root: Path,
) -> tuple[Path, str]:
    results = json.loads(
        (audit_run / "ai_recommendations_raw.json").read_text(encoding="utf-8")
    )
    profile = json.loads(
        (audit_run / "company_profile.json").read_text(encoding="utf-8")
    )
    company = str(profile.get("company_name", "")).strip()
    rows = assemble_lowercase_names(results)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    slug = re.sub(r"[^a-z0-9.-]+", "-", audit_run.name.lower()).strip("-")
    prepared_run = output_root / f"{timestamp}-{slug}"
    prepared_run.mkdir(parents=True, exist_ok=False)
    write_json(prepared_run / "lowercase_name_groups.json", rows)
    write_json(
        prepared_run / "config.json",
        {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source_audit": str(audit_run.resolve()),
            "audited_company": company,
            "answer_rows": len(results),
            "recommendations": sum(
                len(row.get("recommended_companies", []) or [])
                for row in results
            ),
            "lowercase_name_groups": len(rows),
        },
    )
    return prepared_run, company


def run_candidate_merge(
    source_run: Path,
    *,
    audited_company: str,
    reuse_decisions: bool = False,
) -> Path:
    rows = json.loads(
        (source_run / "lowercase_name_groups.json").read_text(encoding="utf-8")
    )
    output_dir = source_run / "candidate_merge"
    output_dir.mkdir(exist_ok=True)
    groups = build_candidate_groups(rows)
    write_json(output_dir / "candidate_groups.json", groups)

    threshold = top_five_threshold(rows)
    if reuse_decisions:
        normal_decisions = json.loads(
            (output_dir / "normal_decisions.json").read_text(encoding="utf-8")
        )
        web_groups = json.loads(
            (output_dir / "web_review_groups.json").read_text(encoding="utf-8")
        )
        web_decisions = json.loads(
            (output_dir / "web_decisions.json").read_text(encoding="utf-8")
        )
    else:
        normal_decisions, normal_payload, normal_raw = call_normal_decider(groups)
        write_json(output_dir / "normal_decision_prompt.json", normal_payload)
        (output_dir / "normal_decision_raw.txt").write_text(
            normal_raw, encoding="utf-8"
        )
        write_json(output_dir / "normal_decisions.json", normal_decisions)

        web_groups = groups_needing_web_review(
            groups,
            normal_decisions,
            threshold=threshold,
            audited_company=audited_company,
        )
        write_json(output_dir / "web_review_groups.json", web_groups)
        web_decisions, web_payload, web_metadata = call_web_reviewer(web_groups)
        write_json(output_dir / "web_review_prompt.json", web_payload)
        write_json(output_dir / "web_review_response.json", web_metadata)
        write_json(output_dir / "web_decisions.json", web_decisions)

    final = build_final_counts(rows, groups, normal_decisions, web_decisions)
    final["created_at"] = datetime.now(timezone.utc).isoformat()
    final["audited_company"] = audited_company
    final["top_five_threshold_before_merge"] = threshold
    final["candidate_group_count"] = len(groups)
    final["web_review_group_count"] = len(web_groups)
    write_json(output_dir / "final_company_counts.json", final)
    return output_dir


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Resolve whole-word company-name candidates from a saved experiment."
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--source-run", type=Path)
    source.add_argument("--audit-run", type=Path)
    parser.add_argument("--audited-company")
    parser.add_argument(
        "--reuse-decisions",
        action="store_true",
        help="Rebuild final counts from already saved AI decisions without new calls.",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path(__file__).parent / "runs",
    )
    args = parser.parse_args()
    source_run = args.source_run
    audited_company = str(args.audited_company or "").strip()
    if args.audit_run is not None:
        source_run, profile_company = prepare_saved_audit(
            args.audit_run,
            output_root=args.output_root,
        )
        audited_company = audited_company or profile_company
    if not audited_company:
        parser.error("--audited-company is required when it cannot be read from an audit.")
    print(
        run_candidate_merge(
            source_run,
            audited_company=audited_company,
            reuse_decisions=args.reuse_decisions,
        ).resolve()
    )


if __name__ == "__main__":
    main()
