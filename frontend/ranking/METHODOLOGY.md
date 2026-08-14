# Methodology

Version is stored on every scan as `methodology_version` and on every score
snapshot. **Current: v1.2.0.** The one source of truth for the formula is
`GEO/geo_audit/scoring.py`; golden tests in `GEO/tests/test_scoring_golden.py`
pin the exact numbers. The frontend renders stored breakdowns — it never
recomputes a score. Scores from different versions are shown with a boundary
warning in history and are not directly comparable.

## What we measure

Whether AI answer engines recommend a brand when buyers ask commercial
questions. Questions are generated from the audited website's own evidence
(or supplied by the user as tracked prompts, which are then asked verbatim);
brand names are never injected into discovery questions.

## Provider sampling

| Provider label | Integration |
|----------------|-------------|
| OpenAI Search | Responses API + `web_search` tool |
| Claude | Anthropic API / AWS Bedrock |
| Gemini | Official API |
| Llama, Mistral, Nova | AWS Bedrock |
| Perplexity, Grok, DeepSeek, Kimi, Groq, MiniMax, Sarvam | Official OpenAI-compatible APIs (`GEO/geo_audit/llm.py`, `OPENAI_COMPAT_PROVIDERS`) |

A provider whose API key is not configured answers nothing; its questions
are recorded as errors and the scan is marked partial for it — providers
never silently disappear.

These are **API samples**, not replicas of consumer chat UIs. Every stored
answer records the exact model that produced it.

## Scoring (v1.2.0)

Across a scan's answers:

- **Mention score** = share of answers that name the brand × 100.
- **Position score** = mean of the rank curve over *all* answers
  (100 / 80 / 65 / 50 / 35 for ranks 1–5, 10 for rank 6+, 0 when absent) —
  a coverage-weighted placement score.
- **Citation score** (weight 0 — reported, not scored): 100 when any
  search-grounded answer produced verifiable source URLs.
- **Data confidence** = how complete the evidence is (usable provider
  responses and readable competitor websites).

Overall = mention 65% + position 30% + data confidence 5%.

Sentiment is **not** measured or scored. Earlier copy described a sentiment
component; the engine never computed one, and v1.2.0 removed the fabricated
neutral placeholder from stored results.

## Cost ceilings and partial scans

Every scan carries a spend ceiling. If the estimated cost crosses it, no
further provider calls start and the scan is stored as `partial` with the
skipped questions recorded. Provider failures likewise mark the scan
`partial`, never silently complete.

## Limitations

- Model outputs are non-deterministic; judge trends, not single runs.
- Partial scans occur when providers fail or cost ceilings hit.
- Recommendations are directional, never ranking guarantees.
