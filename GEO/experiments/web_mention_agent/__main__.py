from __future__ import annotations

import argparse
from pathlib import Path

from .agent import run_experiment


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the isolated single-agent web-mention experiment."
    )
    parser.add_argument("--source-run", required=True, type=Path)
    parser.add_argument("--output-root", type=Path, default=Path(__file__).parent / "runs")
    parser.add_argument("--remove-link", default=None)
    args = parser.parse_args()
    output = run_experiment(
        args.source_run,
        output_root=args.output_root,
        remove_link_for=args.remove_link,
    )
    print(output.resolve())


if __name__ == "__main__":
    main()
