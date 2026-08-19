# Deployment

Two deployables, one database.

## 1. Database

Managed PostgreSQL (RDS or equivalent). Order on a fresh database:

```bash
npx @better-auth/cli migrate --config lib/auth/auth.ts -y   # auth tables first
npm run db:migrate                                          # app schema
```

On every deploy, run migrations **before** rolling code:

```bash
npm run db:migrate          # applies pending db/migrations/*.sql
npm run db:migrate:check    # in CI: fail the deploy if schema is behind
```

Migrations are additive; take a snapshot/backup before any migration marked
destructive in its header comment. Rollback = restore snapshot + redeploy
previous code (never edit an applied migration).

## 2. Web application

Any Node 20+ host (Vercel, container, EC2). Build and run:

```bash
npm ci && npm run build
npm start
```

### Vercel

The Next.js application is in `frontend/ranking`, not at the repository root.
In the Vercel project, open **Settings > Build and Deployment** and set
**Root Directory** to `frontend/ranking`. Keep the framework preset as
**Next.js**, then clear custom Build Command, Install Command, and Output
Directory overrides so Vercel uses the defaults from this app's `package.json`.

Root Directory is a Vercel project setting. A repository-level build command
that changes directories is not enough because Vercel detects the Next.js
version before it runs the build.

- Set every required variable from `.env.example`; production refuses to
  boot with missing config (`lib/env.ts`).
- Health: `GET /api/health` (DB reachability, worker recency, queue depth).
- Point the Dodo webhook at `https://<domain>/api/billing/webhook` and set
  `DODO_PAYMENTS_WEBHOOK_KEY` to its signing secret.

## 3. Worker

A long-running Node process on a host with Python 3.10+ and the GEO
directory (container or VM — not a serverless function).

```bash
npm ci
pip install -r ../../GEO/requirements.txt
GEO_AUDIT_ROOT=/srv/GEO npm run worker
```

- Same `DATABASE_URL` as the web app; `GEO_AUDIT_ROOT` required.
- Provider keys live in `GEO/.env` on the worker host (the engine loads it
  with override) — the worker passes only an allowlisted environment to
  Python, never its own secrets.
- Health/readiness: `GET :8787/healthz` and `/readyz` (readiness goes 503
  during shutdown). Stop with SIGTERM: children are killed and their jobs
  returned to the queue with the attempt refunded.
- Scale by running more worker processes; the queue is claim-safe. Restrict
  the worker's egress from internal ranges (metadata service included) as
  the second SSRF layer.
- Compatibility: deploy migrations first, then workers, then web. A worker
  older than the schema fails loudly at claim time; `db:migrate:check` in CI
  prevents shipping web code ahead of migrations.

## 4. Post-deploy checks

```bash
curl -fsS https://<domain>/api/health
curl -fsS http://<worker-host>:8787/healthz
```

Then run one free audit end to end and confirm: progress events stream, the
report renders, the usage ledger shows a reservation and settlement, and
`/admin` shows the completed scan.
