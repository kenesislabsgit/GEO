# Launch implementation checklist

Working document for the production-readiness overhaul, 14 August 2026.
Maps every required change to real files.

**FINAL STATUS: all phases implemented and verified.** Frontend: tsc clean,
eslint 0/0, 77 vitest tests, 6 Playwright tests, production build green.
Python: 137 + 8 golden + 12 netguard tests green. A real free audit ran end
to end through the queue → worker → engine → transactional import (scan
30546a4a…, $0.15 estimated). Known conditions listed in the final report:
key rotation (GEO/.env), CI authored but not yet run on GitHub, scheduler/
alert logic tested at unit level only, flat-estimate cost model, no object
storage (worker-disk artifacts + retention sweep, documented).

## Phase 2 — schema and migrations

- [x] Migration runner `scripts/migrate.mjs` + `npm run db:migrate` / `db:migrate:check`;
      `schema_migrations` table; advisory lock; baseline detection for existing DBs.
- [x] `db/migrations/0002_durable_audits.sql`: queue columns on `scan_runs`
      (queued/heartbeat/last_error timestamps, attempts, claimed_by,
      cancel_requested_at, failure_reason, trigger_source, input_snapshot,
      idempotency_key, cost ceiling/estimate, worker_version), new states
      `cancel_requested`/`timed_out`, one-active-scan-per-brand unique index,
      idempotency unique index, `scan_run_events` table, score
      `methodology_version` + `breakdown`, `brand_monitoring` table (migrated
      from app_settings), `domain_verifications`, prompt dedupe + unique index,
      alert `dedupe_key` + `scan_run_id`, usage reservation uniqueness,
      webhook status columns, `admin_audit_log`.
- [x] `lib/db/pg.ts`: `withTransaction` via AsyncLocalStorage — repository
      functions join ambient transactions without signature changes.
- [x] Applied to geo_dev; geo_test recloned.

## Phase 3 — durable worker + queue (files to create/change)

- Worker process `worker/index.ts` (+ `worker/run-audit.ts`, `worker/scheduler.ts`):
  claims via `update … where id = (select … for update skip locked)`,
  heartbeats, cancellation kill, retries with attempt caps, stale-job reaper,
  graceful shutdown requeue, health endpoint, monitoring scheduler loop.
- `lib/scans/enqueue.ts`: single enqueue path — atomic scan creation
  (unique index races → join existing), idempotency key, usage reservation
  in one transaction, input snapshot frozen.
- `lib/audit/runner.ts`: Python spawn logic moves into the worker; Next.js
  never spawns Python. Env passed to Python is allowlisted, not `process.env`.
- `lib/audit/progress-events.ts` (memory ring buffer) → `scan_run_events` table.
- `app/api/audit-run/start/route.ts`: validate → entitle → enqueue → return id.
- New routes: `app/api/scans/[id]/cancel`, `app/api/scans/[id]/retry`,
  `app/api/health` (web), worker `/healthz`.
- `SCAN_COST_CEILING_USD` enforced in the Python pipeline (new
  `GEO/geo_audit/costs.py`, `--max-cost-usd`), estimate exported and settled
  into `scan_runs.estimated_cost_usd` + `usage_ledger`.

## Phase 4 — one engine

- Delete TS engine path: `lib/jobs/run-scan.ts`, `lib/jobs/inngest.ts`,
  `app/api/inngest/route.ts`, `app/api/scans/manual/route.ts`,
  `app/api/scans/dashboard/start/route.ts`, `lib/ai/providers/*` (registry,
  openai/gemini/perplexity adapters, demo fixtures), `lib/ai/analysis`,
  `lib/ai/scoring`, `lib/ai/recommendations`, `lib/ai/matching` — after
  migrating remaining callers (prompt generation for dashboards uses
  `lib/ai/prompts/generate.ts` — decide keep/replace).
- Scheduled monitoring runs through the worker scheduler → same enqueue path,
  `brand_monitoring` table settings (frequency, day, hour, timezone,
  providers, country, language, alerts).
- Retry button re-enqueues the same `input_snapshot` (never crosses engines).
- Onboarding complete → enqueue with curated prompt snapshot.
- Python CLI gains `--questions-file` so curated prompts are executed, and
  import no longer wipes user-curated prompts/competitors.

## Phase 5 — scoring integrity

- Canonical formula = `GEO/geo_audit/scoring.py`. Bump methodology version.
- Remove sentiment from methodology/pricing/report copy or implement it:
  decision — **remove as scored component; keep per-answer sentiment label as
  unscored data only if actually computed**. `import-export.ts` stops
  hardcoding `"neutral"`.
- Store full breakdown in `score_snapshots.breakdown` + `methodology_version`.
- Frontend stops recomputing mention rate / competitor matching
  (`app/dashboard/brands/[id]/page.tsx:112,134-156`), labels match stored
  components, history shows methodology boundaries.
- Golden fixtures for scoring.py.
- Fix `vv1.1.0` on methodology page.

## Phase 6 — entitlements

- Atomic scan creation + reservation (`reserve_checks`/`settle_checks` ledger
  ops, per-user advisory lock in transaction).
- Free accounts auto-request free mode (new-scan form), free cooldown enforced
  server-side; crafted provider/question/geo params clamped (partially exists
  in `lib/billing/enforce.ts` — extend with per-scan provider cap, question
  cap, geo flag, brand cap on claim path).
- Claim flow requires domain verification (Phase 9) and respects brand limits.

## Phase 7 — crawling + route security

- Python-side safe-fetch guard (SSRF) for crawler/firecrawl fallback/web
  presence fetches: scheme/port/credentials checks, DNS resolve + private
  range block per redirect, size/time caps. Tests.
- Security headers in `next.config.ts`; safe error responses (no stderr
  passthrough in progress route); `/api/audit-import` fail-closed always;
  rate limits on audit start, claim, export, auth-adjacent routes.
- `hashIp` salt from dedicated env var, fail-fast in production.

## Phase 8 — billing

- Checkout: no simulated subscriptions ever — missing config = 503 in every
  environment; email from session; portal simulated path removed.
- Webhook: keep signature verify; fail-closed in production without key;
  record processing status/error instead of delete-then-retry; handle
  payment events without subscription_id safely.
- Startup env validation (`lib/env.ts`) — production fails fast on missing
  Dodo/Resend/DB/auth config.
- Downgrade behaviour: block new creation over limit, keep data, pause excess
  monitoring.

## Phase 9 — product flows

- Onboarding: curated prompts + locale actually run (via snapshot);
  monitoring settings editable post-onboarding in brand settings UI.
- Alerts: score change + competitor appear/disappear + citation source
  add/loss + scan failure; dedupe keys; before/after values in metadata;
  emailed_at written on confirmed send; respect prefs.
- Export: full account data (brands, settings, prompts, competitors, scans,
  inputs, scores+methodology, answers, citations, actions, alerts,
  subscription+usage, verification records).
- Deletion: transactional; cancels active scans; deletes monitoring rows,
  usage, verification tokens, webhook-linked personal data; revokes Better
  Auth sessions properly + clears the session cookie; idempotent.
- Admin: real freeScanCount, provider disable + maintenance mode enforced,
  queue/worker health, stale jobs, retry/cancel controls, audit log.

## Phase 10 — copy/docs truthfulness

- Remove/label unimplemented Agency features (team seats, white-label,
  client dashboards, custom branding, bulk import, webhooks, priority
  scanning) from `PLAN_CONFIG` descriptions + landing/pricing.
- OG image visibility fix; "Public report" badge fix; footer "Free scan"
  label fix; unauth CTA goes to signup, not `/#plans` scroll.
- Rewrite README/ARCHITECTURE/DEPLOYMENT/SECURITY/BUILD_STATUS/
  PRODUCT_COMPLETION/docs/DATABASE.md; complete `.env.example`.

## Phase 11 — cleanup

- Delete: `backend/` FastAPI prototype, `lib/db/supabase/*`,
  `supabase/migrations/*` (archived note), `lib/db/local-store.ts` (+ its
  tests replaced), Supabase branch in `proxy.ts`, `@supabase/*`,
  `@libsql/*`, `inngest`, `@dodopayments/nextjs`, `dodopayments` (unused)
  deps, `components/scan/domain-scan-form.tsx`, `/scan/[id]` route,
  `rbai_local_user` cookie clears, stale e2e assertions.
- One package manager: npm (package-lock present at root+app; remove
  pnpm-lock.yaml + pnpm-workspace.yaml).

## Phase 12 — CI, observability, tests

- `.github/workflows/ci.yml`: install, lint, typecheck, vitest, Python
  tests, build, migration check.
- Structured logger (`lib/log.ts`), request IDs, worker logs.
- Runbook `docs/RUNBOOK.md`.
- New tests per §28 (entitlements, races, worker lifecycle, import
  transactionality, scoring goldens, billing, private reports, deletion).

## Cross-cutting decisions

- Inngest removed; the worker owns scheduling (fewer unconfigured externals).
- Package manager: npm.
- No object storage in stack: audit artifacts stay on worker disk with a
  retention sweep; raw exports stored in Postgres via import. Documented.
- Sentiment removed from scoring copy (not computed by the real engine).
- Claim feature: implement DNS TXT / well-known verification; until verified,
  no ownership transfer.

## Non-launch items consciously deferred (documented, not hidden)

- Real per-token cost accounting for Bedrock (flat per-call estimates used).
- Timezone-precise scheduling honours stored timezone at day granularity.
- CAPTCHA/Turnstile: wired only if keys provided; signup protected by Better
  Auth rate limits + audit-start rate limits.
