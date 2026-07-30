# Methodology

Version is stored on every scan as `methodology_version` (currently `v1.0.0`).

## What we measure

Whether AI answer engines recommend a brand when buyers ask commercial questions across awareness, problem discovery, purchase intent, alternatives, comparison, pricing, industry, geography, and integration themes.

## Prompt rules

- Free scans use 10 generated discovery prompts
- Customer brand names are not injected into general discovery prompts
- Premium users may add custom prompts grouped by buyer stage

## Provider sampling

| Provider label | Integration |
|----------------|-------------|
| OpenAI | Responses API + `tools: [{ type: "web_search" }]` |
| Gemini | Official SDK + Google Search grounding |
| Perplexity | Official API/SDK web-grounded models |

These are **API samples**, not replicas of consumer ChatGPT / Gemini / Perplexity UIs.

## Analysis

Each answer is analyzed with a Zod-validated structured extraction plus deterministic alias/domain matching. Casual mentions are not treated as recommendations. Position only counts recommendation-list position.

## Scoring

Per query:

- Mention: 100 if recommended/meaningfully included, else 0
- Position: 100/80/60/40/20/10/0 for ranks 1–5 / 6+ / absent
- Citation: 100 if own domain or clearly supporting source cited
- Sentiment: positive 100, neutral 60, mixed 40, negative 10, absent 0

Overall weights: mention 55%, position 25%, citation 15%, sentiment 5%.

Raw decimals are stored; rounding is display-only.

## Limitations

- Non-deterministic model outputs
- Partial scans when providers fail or cost ceilings hit
- Recommendations are directional, never ranking guarantees
