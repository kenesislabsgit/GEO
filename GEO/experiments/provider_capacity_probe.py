from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import statistics
import time
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from geo_audit.llm import (
    DEFAULT_BEDROCK_MODELS,
    DEFAULT_BEDROCK_REGION,
    DEFAULT_OPENAI_SEARCH_MODEL,
    load_dotenv,
)


PROVIDERS = (
    "openai",
    "bedrock_claude",
    "bedrock_nova",
    "bedrock_llama",
    "bedrock_mistral",
)


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int((len(ordered) - 1) * fraction)))
    return round(ordered[index], 3)


def openai_call() -> dict[str, Any]:
    key = os.environ.get("OPENAI_API_KEY") or os.environ.get("LLM_API_KEY")
    if not key:
        raise RuntimeError("OpenAI key is not configured")
    model = os.environ.get("OPENAI_SEARCH_MODEL", DEFAULT_OPENAI_SEARCH_MODEL)
    base = os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1").rstrip("/")
    payload = {
        "model": model,
        "input": "Reply only with OK.",
        "max_output_tokens": 128,
        "reasoning": {"effort": "minimal"},
        "text": {"verbosity": "low"},
    }
    request = Request(
        f"{base}/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urlopen(request, timeout=90) as response:
            body = json.loads(response.read().decode("utf-8"))
            headers = {
                name.lower(): value
                for name, value in response.headers.items()
                if name.lower().startswith("x-ratelimit-")
            }
            completed = body.get("status") == "completed"
            return {
                "ok": completed,
                "seconds": round(time.perf_counter() - started, 3),
                "status": response.status,
                "model": body.get("model", model),
                "response_status": body.get("status"),
                "incomplete_details": body.get("incomplete_details"),
                "error": None if completed else "response did not complete",
                "usage": body.get("usage", {}),
                "rate_limits": headers,
            }
    except HTTPError as exc:
        return {
            "ok": False,
            "seconds": round(time.perf_counter() - started, 3),
            "status": exc.code,
            "error": exc.read().decode("utf-8", errors="replace")[:500],
        }
    except (URLError, TimeoutError) as exc:
        return {
            "ok": False,
            "seconds": round(time.perf_counter() - started, 3),
            "status": "network",
            "error": str(exc)[:500],
        }


def bedrock_caller(provider: str) -> Callable[[], dict[str, Any]]:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    region = os.environ.get("AWS_REGION") or os.environ.get(
        "AWS_DEFAULT_REGION", DEFAULT_BEDROCK_REGION
    )
    model = os.environ.get(f"{provider.upper()}_MODEL", DEFAULT_BEDROCK_MODELS[provider])
    client = boto3.client("bedrock-runtime", region_name=region)

    def call() -> dict[str, Any]:
        started = time.perf_counter()
        try:
            response = client.converse(
                modelId=model,
                system=[{"text": "Be brief."}],
                messages=[{"role": "user", "content": [{"text": "Reply only with OK."}]}],
                inferenceConfig={"temperature": 0, "maxTokens": 8},
            )
            return {
                "ok": True,
                "seconds": round(time.perf_counter() - started, 3),
                "status": response.get("ResponseMetadata", {}).get("HTTPStatusCode"),
                "model": model,
                "region": region,
                "usage": response.get("usage", {}),
                "request_id": response.get("ResponseMetadata", {}).get("RequestId"),
            }
        except (BotoCoreError, ClientError) as exc:
            response = getattr(exc, "response", {})
            error = response.get("Error", {}) if isinstance(response, dict) else {}
            return {
                "ok": False,
                "seconds": round(time.perf_counter() - started, 3),
                "status": response.get("ResponseMetadata", {}).get("HTTPStatusCode"),
                "error_code": error.get("Code"),
                "error": str(error.get("Message") or exc)[:500],
            }

    return call


def bedrock_quotas() -> dict[str, Any]:
    try:
        import boto3

        region = os.environ.get("AWS_REGION") or os.environ.get(
            "AWS_DEFAULT_REGION", DEFAULT_BEDROCK_REGION
        )
        client = boto3.client("service-quotas", region_name=region)
        paginator = client.get_paginator("list_service_quotas")
        terms = ("claude", "nova lite", "llama 3.1 70b", "mistral large")
        matches = []
        for page in paginator.paginate(ServiceCode="bedrock"):
            for quota in page.get("Quotas", []):
                name = str(quota.get("QuotaName", ""))
                lowered = name.lower()
                if any(term in lowered for term in terms) and (
                    "requests per minute" in lowered or "tokens per minute" in lowered
                ):
                    matches.append(
                        {
                            "name": name,
                            "value": quota.get("Value"),
                            "unit": quota.get("Unit"),
                            "adjustable": quota.get("Adjustable"),
                            "code": quota.get("QuotaCode"),
                        }
                    )
        return {"ok": True, "region": region, "quotas": matches}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:500]}


def run_stage(call: Callable[[], dict[str, Any]], concurrency: int) -> dict[str, Any]:
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        results = [future.result() for future in as_completed([pool.submit(call) for _ in range(concurrency)])]
    durations = [float(result.get("seconds", 0)) for result in results]
    return {
        "concurrency": concurrency,
        "wall_seconds": round(time.perf_counter() - started, 3),
        "succeeded": sum(1 for result in results if result.get("ok")),
        "failed": sum(1 for result in results if not result.get("ok")),
        "p50_seconds": round(statistics.median(durations), 3) if durations else 0,
        "p95_seconds": percentile(durations, 0.95),
        "results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Small, bounded provider-capacity probe")
    parser.add_argument("--providers", nargs="+", choices=PROVIDERS, default=list(PROVIDERS))
    parser.add_argument("--max-concurrency", type=int, default=4)
    parser.add_argument("--skip-quotas", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args()

    load_dotenv(".env", override=True)
    maximum = max(1, min(args.max_concurrency, 16))
    stages = []
    value = 1
    while value < maximum:
        stages.append(value)
        value *= 2
    stages.append(maximum)

    report: dict[str, Any] = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "note": "A successful burst proves at least this concurrency; it does not prove the account maximum.",
        "bedrock_service_quotas": (
            {"ok": False, "skipped": True} if args.skip_quotas else bedrock_quotas()
        ),
        "providers": {},
    }
    for provider in args.providers:
        try:
            call = openai_call if provider == "openai" else bedrock_caller(provider)
            provider_stages = []
            for concurrency in stages:
                stage = run_stage(call, concurrency)
                provider_stages.append(stage)
                if stage["failed"]:
                    break
            report["providers"][provider] = {"stages": provider_stages}
        except Exception as exc:
            report["providers"][provider] = {"setup_error": str(exc)[:500]}

    output = Path(args.output) if args.output else Path("outputs") / (
        "provider-capacity-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".json"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(output.resolve())
    for provider, result in report["providers"].items():
        stages_run = result.get("stages", [])
        if not stages_run:
            print(f"{provider}: setup failed")
            continue
        final = stages_run[-1]
        print(
            f"{provider}: concurrency={final['concurrency']} "
            f"success={final['succeeded']} failed={final['failed']} "
            f"wall={final['wall_seconds']}s p95={final['p95_seconds']}s"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
