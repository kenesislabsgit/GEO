from __future__ import annotations

import argparse
import json
from pathlib import Path

from .experiment import DEFAULT_ASSISTANTS, run_experiment


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test standard public company names before alias merging."
    )
    parser.add_argument(
        "--assistants",
        nargs="+",
        default=DEFAULT_ASSISTANTS,
        help="Providers to test. Each provider answers the same questions.",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path(__file__).parent / "runs",
    )
    parser.add_argument(
        "--source-run",
        type=Path,
        help="Audit run containing customer_prompts.json.",
    )
    parser.add_argument(
        "--questions-limit",
        type=int,
        help="Optional number of generated audit questions to use.",
    )
    args = parser.parse_args()
    questions = None
    if args.source_run is not None:
        questions_path = args.source_run / "customer_prompts.json"
        questions = json.loads(questions_path.read_text(encoding="utf-8"))
        if args.questions_limit:
            questions = questions[: args.questions_limit]
    output_dir = run_experiment(
        assistants=args.assistants,
        output_root=args.output_root,
        questions=questions,
        source_run=args.source_run,
    )
    print(output_dir.resolve())


if __name__ == "__main__":
    main()
