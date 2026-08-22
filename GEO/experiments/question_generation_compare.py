from __future__ import annotations

import argparse
import json
import re
import time
from datetime import datetime
from pathlib import Path

from geo_audit.intents import (
    build_customer_intent_review_payload,
    build_question_profile_context,
    normalize_buyer_band,
    sanitize_prompt_records,
)
from geo_audit.json_tools import extract_json_array, extract_json_object
from geo_audit.llm import build_chat_payload, call_chat_completion


UNIFIED_QUESTION_PROMPT = """Create natural, unbranded buyer questions for an
AI visibility audit. Infer who buys this kind of offering from the supplied
company facts, then write the complete question set.

Each question must ask an AI assistant to recommend suitable products or
providers. Never name the audited company, its website, or its customers. Use
the buyer's words, not the company's marketing language. Make each question a
short single sentence about one real need, with only the buyer details that
change the answer. Keep it under 25 words. Avoid generic category questions,
implementation questions, repeated meaning, and structurally different
providers. Spread the set across distinct buyer situations, organization
sizes, needs, and discovery, comparison, and decision stages.

Return only JSON:
{
  "buyer_band": {
    "band_summary": "",
    "buyer_words_for_provider": "",
    "sector_focus": "specialist|generalist",
    "sector_focus_reason": "",
    "organization_sizes": [],
    "sectors_served": [],
    "sectors_open_to_it": [],
    "geography": "",
    "decision_makers": [],
    "band_confidence": "High|Medium|Low",
    "band_evidence": [],
    "buyer_situations": [
      {
        "situation_id": "",
        "role": "",
        "organization": "",
        "trigger": "",
        "constraint": "",
        "words_they_use": []
      }
    ]
  },
  "questions": [
    {
      "category": "",
      "buying_stage": "",
      "persona_id": "",
      "intent": "",
      "profile_evidence": [],
      "prompt": ""
    }
  ]
}
The questions array must contain exactly requested_question_count items."""


EVALUATOR_PROMPT = """Judge two buyer-question sets for an AI visibility
audit. The company name is hidden from assistants, so questions must be
unbranded, natural, relevant to the company, specific enough to produce useful
provider recommendations, and limited to direct peers. Reward distinct buyer
needs and buyer coverage. Penalize repeated meaning, seller language,
overstuffed questions, implementation questions, and unsupported buyers.

Score each set from 0 to 100. Judge the supplied sets independently. Return
only JSON:
{
  "set_a": {"score": 0, "strengths": [], "problems": []},
  "set_b": {"score": 0, "strengths": [], "problems": []},
  "better_set": "A|B|tie",
  "reason": ""
}"""


def read_json(path: Path) -> dict | list:
    return json.loads(path.read_text(encoding="utf-8"))


def question_metrics(rows: list[dict], company_name: str) -> dict:
    prompts = [str(row.get("prompt") or "") for row in rows]
    token_sets = [
        set(re.findall(r"[a-z0-9]+", prompt.casefold())) for prompt in prompts
    ]
    similar_pairs = []
    for left in range(len(token_sets)):
        for right in range(left + 1, len(token_sets)):
            union = token_sets[left] | token_sets[right]
            similarity = len(token_sets[left] & token_sets[right]) / max(1, len(union))
            if similarity >= 0.7:
                similar_pairs.append([left + 1, right + 1, round(similarity, 2)])
    brand = company_name.casefold().strip()
    return {
        "count": len(rows),
        "average_words": round(
            sum(len(prompt.split()) for prompt in prompts) / max(1, len(prompts)), 1
        ),
        "over_25_words": sum(len(prompt.split()) > 25 for prompt in prompts),
        "over_30_words": sum(len(prompt.split()) > 30 for prompt in prompts),
        "brand_named": sum(bool(brand and brand in prompt.casefold()) for prompt in prompts),
        "unique_stages": len(
            {str(row.get("buying_stage") or "").casefold() for row in rows}
        ),
        "unique_personas": len(
            {str(row.get("persona_id") or "").casefold() for row in rows}
        ),
        "high_similarity_pairs": similar_pairs,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_run", type=Path)
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--count", type=int, default=20)
    args = parser.parse_args()

    source = args.source_run.resolve()
    profile_path = args.profile.resolve() if args.profile else source / "company_profile.json"
    profile = read_json(profile_path)
    if not isinstance(profile, dict):
        raise SystemExit("Profile must be a JSON object.")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output = Path("experiments/question_generation_runs") / stamp
    output.mkdir(parents=True, exist_ok=False)

    first_payload = build_chat_payload(
        UNIFIED_QUESTION_PROMPT,
        json.dumps(
            {
                "requested_question_count": args.count,
                "company_facts": build_question_profile_context(profile),
            },
            ensure_ascii=False,
        ),
        temperature=0.2,
        json_response=True,
    )
    first_started = time.perf_counter()
    first_raw = call_chat_completion(first_payload)
    first_seconds = round(time.perf_counter() - first_started, 3)
    first_object = extract_json_object(first_raw)
    buyer_band = normalize_buyer_band(first_object.get("buyer_band"), 6)
    one_call = sanitize_prompt_records(
        first_object.get("questions") if isinstance(first_object.get("questions"), list) else [],
        profile,
    )
    (output / "one_call.json").write_text(
        json.dumps(
            {
                "seconds": first_seconds,
                "buyer_band": buyer_band,
                "questions": one_call,
                "request": first_payload,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    review_payload = build_customer_intent_review_payload(
        profile,
        one_call,
        count=args.count,
        buyer_band=buyer_band,
    )
    review_started = time.perf_counter()
    review_raw = call_chat_completion(review_payload)
    review_seconds = round(time.perf_counter() - review_started, 3)
    two_call = sanitize_prompt_records(extract_json_array(review_raw), profile)
    (output / "two_call.json").write_text(
        json.dumps(
            {
                "total_seconds": round(first_seconds + review_seconds, 3),
                "review_seconds": review_seconds,
                "questions": two_call,
                "request": review_payload,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    evaluator_payload = build_chat_payload(
        EVALUATOR_PROMPT,
        json.dumps(
            {
                "company_facts": build_question_profile_context(profile),
                "set_a": one_call,
                "set_b": two_call,
            },
            ensure_ascii=False,
        ),
        temperature=0,
        json_response=True,
    )
    evaluation_started = time.perf_counter()
    try:
        evaluation = extract_json_object(call_chat_completion(evaluator_payload))
        evaluation_error = None
    except (RuntimeError, TimeoutError, ValueError) as exc:
        evaluation = {}
        evaluation_error = str(exc)
    evaluation_seconds = round(time.perf_counter() - evaluation_started, 3)

    result = {
        "source_run": str(source),
        "profile": str(profile_path),
        "requested_count": args.count,
        "one_call": {
            "seconds": first_seconds,
            "metrics": question_metrics(one_call, str(profile.get("company_name") or "")),
            "questions": one_call,
        },
        "two_call": {
            "seconds": round(first_seconds + review_seconds, 3),
            "review_seconds": review_seconds,
            "metrics": question_metrics(two_call, str(profile.get("company_name") or "")),
            "questions": two_call,
        },
        "evaluation": evaluation,
        "evaluation_error": evaluation_error,
        "evaluation_seconds_not_counted": evaluation_seconds,
        "buyer_band": buyer_band,
        "requests": {"first": first_payload, "review": review_payload},
    }
    (output / "result.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "output": str(output),
                "one_call_seconds": first_seconds,
                "two_call_seconds": round(first_seconds + review_seconds, 3),
                "one_call_metrics": result["one_call"]["metrics"],
                "two_call_metrics": result["two_call"]["metrics"],
                "evaluation": evaluation,
                "evaluation_error": evaluation_error,
                "evaluation_seconds_not_counted": evaluation_seconds,
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
