# RankedByAI

Find out whether AI recommends your company before your competitors.

RankedByAI helps companies measure whether AI answer engines recommend their brand when buyers ask relevant commercial questions.

## Stack

- Next.js App Router + TypeScript (strict)
- Tailwind CSS + shadcn/ui
- Supabase Auth + PostgreSQL + RLS (with local demo persistence fallback)
- OpenAI Responses API (`web_search`), Gemini grounding, Perplexity API
- Inngest jobs, Upstash rate limits, Turnstile, Dodo Payments, Resend
- Vitest + Playwright

## Local setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Without provider/Supabase keys the app runs in labelled **demo mode**:

- AI providers return fixture answers prefixed with `[DEMO MODE]`
- Persistence uses `.data/local-store.json`
- Billing checkout simulates subscriptions with usage limits enforced
- Turnstile is skipped outside production when secret is unset

## Supabase setup

1. Create a Supabase project.
2. Apply `supabase/migrations/20260716000000_init.sql`.
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
4. Enable email auth.

## Provider keys

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Responses API + `web_search` + analysis |
| `OPENAI_SEARCH_MODEL` | default `gpt-5.6` |
| `OPENAI_ANALYSIS_MODEL` | default `gpt-5.6-luna` |
| `GEMINI_API_KEY` | Google Search grounding |
| `PERPLEXITY_API_KEY` | Web-grounded answers |

Never use deprecated Assistants API, `web_search_preview`, or search-preview chat models.

## Background jobs

Inngest route: `/api/inngest`

If `INNGEST_EVENT_KEY` is unset, scans execute inline for local development.

## Dodo Payments test mode

Set `DODO_PAYMENTS_ENVIRONMENT=test_mode` and product IDs from your Dodo dashboard. Webhook endpoint: `/api/billing/webhook`. Without keys, checkout activates a local simulated subscription (Founder trial = 7 days, usage limits still apply).

## Resend

Set `RESEND_API_KEY` and `EMAIL_FROM`. Without keys, alert emails log to the server console as `[email:demo]`.

## Tests

```bash
pnpm test
pnpm test:e2e
pnpm lint
pnpm typecheck
pnpm build
```

## Scoring

Overall score = mention 55% + position 25% + citation 15% + sentiment 5%. See `METHODOLOGY.md` and `lib/ai/scoring/score.ts`.

## Provider APIs vs consumer AI products

Reports sample **OpenAI**, **Gemini**, and **Perplexity** APIs. They are not claimed to be identical to consumer ChatGPT, Gemini, or Perplexity interfaces. Results can vary between runs.

## Docs

- `ARCHITECTURE.md`
- `METHODOLOGY.md`
- `DEPLOYMENT.md`
- `SECURITY.md`
- `BUILD_STATUS.md`

# ranking
