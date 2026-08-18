# Arcanoris

Measures whether AI answer engines recommend a company when buyers ask
commercial questions, and what to do about it.

## Architecture in one paragraph

A Next.js App Router app (this directory) handles accounts, billing,
dashboards and reports against **PostgreSQL**. Audits are executed by a
**separately deployed worker** (`worker/`) that claims queued `scan_runs`
rows and runs the **Python audit engine** (`../../GEO/geo_audit`) as a child
process — the web server never spawns Python. All scan state, progress
events, and results live in Postgres; a web restart cannot lose or orphan an
audit. See `ARCHITECTURE.md`.

## Stack

- Next.js App Router + TypeScript (strict), Tailwind + shadcn/ui
- PostgreSQL via `pg` (no ORM; SQL in `lib/db/repository.ts`)
- Better Auth (email/password + Google) — sessions in the same Postgres
- Python `geo_audit` engine: crawl → questions → providers → scoring → export
- Dodo Payments (hosted checkout + signed webhooks; no simulation anywhere)
- Resend for email; Vitest + Playwright for tests

## Local setup

```bash
npm install
cp .env.example .env.local            # fill DATABASE_URL at minimum
npx @better-auth/cli migrate --config lib/auth/auth.ts -y   # creates auth tables
npm run db:migrate                    # applies db/migrations/*.sql
npm run dev                           # web app
npm run worker                        # audit worker (separate terminal)
```

The Python engine needs its own keys in `GEO/.env` (see `GEO/README.md`).
Python deps: `pip install -r ../../GEO/requirements.txt`.

## Commands

| Command | What |
|---|---|
| `npm run dev` / `build` / `start` | web app |
| `npm run worker` | audit worker (claims queue, runs engine, imports results) |
| `npm run db:migrate` | apply pending SQL migrations |
| `npm run db:migrate:check` | fail if unapplied migrations exist (CI/deploy) |
| `npm test` | Vitest unit + integration (needs local Postgres, geo_test DB) |
| `npm run test:e2e` | Playwright smoke tests |
| `npm run lint` / `typecheck` | ESLint / tsc |

Python tests: `PYTHONPATH=<repo>/GEO python tests/test_pipeline_changes.py`
(plus `test_scoring_golden.py`, `test_netguard.py`). `pytest` is not used.

## Test database

Integration tests run against `geo_test`, a schema clone of `geo_dev`:

```bash
psql -U postgres -c "drop database if exists geo_test with (force)"
psql -U postgres -c "create database geo_test"
pg_dump -U postgres --schema-only geo_dev | psql -U postgres -d geo_test
```

Re-clone after every schema migration.

## Scoring

One source of truth: `GEO/geo_audit/scoring.py`, pinned by golden tests.
Every score snapshot stores its full breakdown and methodology version; the
frontend renders stored numbers and never recomputes. See `METHODOLOGY.md`.

## Production notes

- `lib/env.ts` makes production refuse to boot without required config
  (database, auth, Dodo, Resend, IP salt). There are no demo fallbacks.
- Deploy web and worker separately; both need `DATABASE_URL`. The worker
  machine needs Python + the GEO directory. See `DEPLOYMENT.md`.
- Operational procedures: `../../docs/RUNBOOK.md`.
