# The database

One PostgreSQL database holds everything: accounts (Better Auth's `"user"`,
`session`, `account`, `verification` tables), audits, billing, monitoring,
and the audit queue itself. There is no JSON store, no SQLite, no Supabase —
those eras are over and their code is deleted. A missing `DATABASE_URL` is
fatal on purpose.

## Where things are defined

- Schema: `frontend/ranking/db/migrations/*.sql`, applied in filename order
  by `npm run db:migrate` (`scripts/migrate.mjs`, tracked in
  `schema_migrations`, advisory-locked, auto-baselines existing databases).
- Better Auth's tables come from `npx @better-auth/cli migrate` and must
  exist before `0001_init.sql` (which references `"user"`).
- All queries: `frontend/ranking/lib/db/repository.ts` (plain SQL over `pg`).
- Transactions: `withTransaction` in `lib/db/pg.ts` — AsyncLocalStorage
  carries the client, so repository calls made inside it join automatically.

## Things that mislead on sight

- **`scan_runs` is also the job queue.** `status='queued'` rows are jobs;
  workers claim them with `FOR UPDATE SKIP LOCKED`. Heartbeats, attempts,
  the frozen `input_snapshot`, and the idempotency key are columns on the
  same row. A partial unique index allows one active scan per brand.
- **A paid audit is `scan_type='manual'`** — there is no `pro` value; the
  mode lives in `input_snapshot.mode`.
- **`query_results` has two similar columns**: `citations` (provider-grounded
  URLs) and `sources` (independently verified web mentions).
- **Prompts and discovered competitors are replaced per audit**, but rows
  with `is_custom=true` (user-created) always survive. Historical
  competitor data lives in `score_snapshots.competitor_scores` per scan.
- **`usage_ledger` is append-only**: `reserve_checks` at enqueue,
  `settle_checks` on completion (units adjust reservation to actual), both
  unique per scan. Monthly allowance = sum over the billing period.
- **Monitoring settings** live in the `brand_monitoring` table (cascades
  with the brand). `app_settings` holds only `user_onboarding:*` blobs,
  `maintenance_mode`, and `providers_disabled` — and the latter two are
  actually read by the enqueue path.
- **`rate_limits` is unlogged** — counters are disposable by design.

## Test database

Integration tests use `geo_test`, a `pg_dump --schema-only` clone of
`geo_dev` (see `tests/integration/pg-test-db.ts`). **Re-clone it after every
migration** or integration tests fail on missing columns.
