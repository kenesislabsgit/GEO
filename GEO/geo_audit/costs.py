"""Spend tracking for one audit run.

The pipeline has no exact meter — providers bill per token at prices that
change — so this uses conservative flat estimates per call, the same numbers
the operator dashboard shows. The point is the ceiling: when the estimate
crosses --max-cost-usd, no further provider calls start and the run finishes
with what it has, marked partial.
"""

from __future__ import annotations

import threading

# Conservative per-call estimates in USD. Search-grounded calls read pages,
# so they cost several times a plain completion.
PER_CALL_USD: dict[str, float] = {
    "openai_search": 0.030,
    "openai": 0.005,
    "claude": 0.010,
    "gemini": 0.005,
    "bedrock_claude": 0.012,
    "bedrock_nova": 0.003,
    "bedrock_llama": 0.005,
    "bedrock_mistral": 0.005,
    "perplexity": 0.010,
    "grok": 0.008,
    "deepseek": 0.003,
    "kimi": 0.005,
    "groq": 0.003,
    "minimax": 0.005,
    "sarvam": 0.003,
}
DEFAULT_CALL_USD = 0.010


def per_call_usd(provider: str) -> float:
    return PER_CALL_USD.get(provider, DEFAULT_CALL_USD)


class CostTracker:
    """Thread-safe running estimate for the current process's audit."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._total = 0.0
        self._ceiling: float | None = None
        self._tripped = False

    def reset(self, ceiling: float | None) -> None:
        with self._lock:
            self._total = 0.0
            self._ceiling = ceiling if ceiling and ceiling > 0 else None
            self._tripped = False

    def add_calls(self, provider: str, calls: int) -> None:
        with self._lock:
            self._total += per_call_usd(provider) * max(calls, 0)
            if self._ceiling is not None and self._total >= self._ceiling:
                self._tripped = True

    def add_usd(self, amount: float) -> None:
        with self._lock:
            self._total += max(amount, 0.0)
            if self._ceiling is not None and self._total >= self._ceiling:
                self._tripped = True

    @property
    def total_usd(self) -> float:
        with self._lock:
            return round(self._total, 4)

    def exceeded(self) -> bool:
        with self._lock:
            return self._tripped


# One tracker per pipeline process. The CLI resets it at the start of a run.
tracker = CostTracker()
