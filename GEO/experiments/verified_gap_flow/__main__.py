from __future__ import annotations

import argparse
import json
from pathlib import Path

from .flow import VerifiedGapFlow, default_output_dir


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the isolated verified-gap experiment.")
    parser.add_argument("--source-run", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--candidate-count", type=int, default=14)
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--model")
    args = parser.parse_args()
    output_dir = args.output_dir or default_output_dir(args.source_run)
    flow = VerifiedGapFlow(
        args.source_run,
        output_dir,
        candidate_count=args.candidate_count,
        max_workers=args.max_workers,
        model=args.model,
    )
    try:
        summary = flow.run()
    except Exception as exc:
        output_dir.mkdir(parents=True, exist_ok=True)
        failure = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}
        (output_dir / "failure.json").write_text(
            json.dumps(failure, indent=2), encoding="utf-8"
        )
        print(json.dumps({**failure, "output_dir": str(output_dir)}, indent=2))
        return 1
    print(json.dumps({"status": "complete", "output_dir": str(output_dir), **summary}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
