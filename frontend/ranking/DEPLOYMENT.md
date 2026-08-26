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
- Set `ELASTICACHE_HOST`, `ELASTICACHE_PORT` (normally `6379`), and
  `ELASTICACHE_USERNAME`. Inject `ELASTICACHE_PASSWORD` from AWS Secrets
  Manager; never store it in the image or repository. The cache must be AWS
  ElastiCache Serverless Valkey, reachable from the worker VPC over TLS. Every
  worker then shares the same AI-provider capacity instead of multiplying it.
- Provider keys live in `GEO/.env` on the worker host (the engine loads it
  with override) — the worker passes only an allowlisted environment to
  Python, never its own secrets.
- Health/readiness: `GET :8787/healthz` and `/readyz` (readiness goes 503
  during shutdown). Stop with SIGTERM: children are killed and their jobs
  returned to the queue with the attempt refunded.
- Scale by running more worker processes; the queue is claim-safe. Restrict
  the worker's egress from internal ranges (metadata service included) as
  the second SSRF layer.
- Keep at least one worker running at all times. It checks monitoring schedules
  every five minutes. A weekly run always uses the five saved questions. If a
  worker restarts after the selected hour, it catches up during that week.
  Database idempotency prevents duplicate runs and duplicate check charges
  when several workers observe the same schedule.
- For ECS, deploy the worker as its own service with a dedicated CloudWatch
  log group. `infra/ecs-audit-worker-autoscaling.yml` keeps two workers warm,
  adds workers when scans wait, and removes them only after the whole queue is
  idle for ten minutes. Each worker must use the same database and Valkey.
- `MAX_ACTIVE_AUDITS` controls how many audits one worker advances together
  (default 3). AI calls are scheduled fairly between them. Provider limits are
  configured independently: `AI_OPENAI_MAX_CONCURRENT`, `AI_OPENAI_RPM`,
  `AI_OPENAI_TPM`, and the same pattern for `ANTHROPIC`, `GEMINI`, each
  `BEDROCK_*` provider, and other configured providers. Copy RPM/TPM values
  from the provider dashboards; `0` disables that rate check. The safe
  concurrency defaults still apply when RPM/TPM are unset.
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
