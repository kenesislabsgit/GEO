# The database, as it actually is

Written to settle confusion. Everything here was read out of the code and the
migrations on 12 August 2026, not remembered. Where something is undecided it
says so rather than guessing.

If you read one section, read section 1. Most confusion about this project's
database comes from not knowing that the database is not being used yet.

---

## 1. Three storage systems, and only one of them is real

| What | Where | Used today? |
|---|---|---|
| Audit data (Postgres schema) | `frontend/ranking/supabase/migrations/*.sql` | **No.** Written, never run. |
| Audit data (what actually runs) | `frontend/ranking/.data/local-store.json` | **Yes.** A JSON file. |
| Login data | `frontend/ranking/.data/auth.db` (SQLite) | **Yes.** Separate from both. |

The switch is one function, `usingLocalDb()` in `lib/db/repository.ts`:

```
export function usingLocalDb(): boolean {
  return !hasServiceRole();
}
```

No Supabase service-role key in the environment means every read and write goes
to the JSON file instead. There is no service-role key set, so **every audit
ever run on this project is in that JSON file and has never touched Postgres.**

This is why the schema can look finished and still be untested. Both are true:
the columns match what the code writes, and not one `insert` has ever been
executed against a real Postgres.

The login database is deliberately a third thing. Better Auth owns
`.data/auth.db` and its four tables (`user`, `session`, `account`,
`verification`). Do not merge it into the audit schema and do not add columns to
it by hand — Better Auth generates them.

---

## 2. The mental model

The product audits a website and asks whether AI assistants recommend it. The
database stores that in five layers, top to bottom:

```
brand            one website, for one account
  ├── competitors        who else keeps getting recommended
  ├── tracked_prompts    the buyer questions we ask on this website's behalf
  └── scan_runs          one audit. A brand has many over time.
        ├── query_results    one row per (question × assistant) = one answer
        ├── score_snapshots  exactly one row per audit
        └── recommendations  the "what to fix" list for that audit
```

Everything the customer sees on the dashboard is one of those seven tables.
The rest of the schema is billing, alerts and plumbing.

**A brand is not a company. It is one account's record of one website.** Two
people auditing `stripe.com` get two brand rows, each with their own questions,
competitors and audit history. This was a deliberate change (migration
`20260730000000`), because the first version gave the website to whoever
audited it first and refused everyone else.

---

## 3. The tables, in plain terms

### The seven that matter

**`brands`** — one website per account. Holds the name, domain, slug, category,
description, target audience and aliases. `owner_id` is null for an anonymous
audit. Unique on `(owner_id, canonical_domain)` when there is an owner; the
domain alone is only indexed, not unique.

**`competitors`** — the companies that beat this brand in the answers. Name,
domain, aliases. **Attached to the brand, not to the audit.** See section 6 —
this is a known problem.

**`tracked_prompts`** — the buyer questions. Free writes 5, Pro writes 20. Each
has a type and a buyer stage. `is_custom` marks a question a user added rather
than one the pipeline generated.

**`scan_runs`** — one audit. `scan_type` is `free`, `manual` or `scheduled` —
note there is **no `pro`**: a paid audit is stored as `manual`. `status` moves
`running → completed`, or `partial` when a provider produced nothing usable.
`summary` is the three- or four-sentence verdict the recommendation step writes.
`step` and `progress` record where a running audit has got to.

**`query_results`** — one row per answer, so questions × assistants. Free is
5 × 5 = 25 rows, Pro is 20 × 5 = 100. Holds the raw answer, whether the brand
was named, its position, and three JSON columns:
- `recommended_brands` — who the assistant named
- `citations` — the pages the assistant cited in its answer
- `sources` — **the web-presence mentions, not the citations.** The export calls
  this `verified_mentions` and the importer renames it to `sources`. Reading the
  wrong one of these two produced a confident wrong conclusion once already.

**`score_snapshots`** — one row per audit, enforced by a unique index on
`scan_run_id`. Overall score plus its four parts, mention rate, average
position, share of voice, and the competitor scores as JSON.

**`recommendations`** — the improvement list. Title, explanation, priority,
estimated impact, and `evidence` as JSON. `affected_prompts` links back to
`tracked_prompts` ids. `status` lets a user tick one off.

### The rest

- **`profiles`** — one row per account. See section 5; this one is a problem.
- **`subscriptions`** — Dodo Payments. Plans are `founder`, `growth`, `agency`.
- **`usage_ledger`** — one row per provider call, for cost tracking, keyed by
  billing period (`YYYY-MM`).
- **`free_scan_requests`** — a log of free audits, meant to rate-limit them.
- **`alerts`** — in-app notifications.
- **`webhook_events`** — payment webhooks, unique on `(provider, event_id)` so
  a repeat delivery cannot be processed twice.
- **`app_settings`** — a key/value store. Read section 4.

### Two things that look like tables and are not

`getUserOnboarding` and `getBrandMonitoringSettings` in `repository.ts` read and
write what look like their own tables. **They do not.** Both are rows in
`app_settings`, keyed `onboarding:<userId>` and `brand_monitoring:<brandId>`,
with the whole state as a JSON value.

There is no `user_onboarding` table and no `brand_monitoring_settings` table.
Do not write a migration for them without deciding to change this first.

---

## 4. What one audit writes, in order

From `lib/audit/import-export.ts`. This is the whole write path — there is no
other place audit data enters the database.

1. `upsertBrand` — create or update the brand row.
2. `replacePrompts` — delete this brand's questions, insert the new ones.
   Only questions that were actually answered are kept.
3. `replaceCompetitors` — delete and reinsert. **The old ones are gone.**
4. `createScanRun` with `status: "running"` — deliberately not "completed" yet.
5. `insertQueryResult` for every answer, plus a `usage_ledger` row each if
   somebody is signed in.
6. `upsertScore` — the one score row.
7. `replaceRecommendations` — delete and reinsert for this brand.
8. `recordFreeScan` — the free-audit log row.
9. `updateScanRun` to `completed` or `partial`.

**Step 4 and step 9 are a pair and the order is the point.** An import that dies
halfway used to leave a run already marked `completed` holding answers but no
score, no competitors and no actions, and the dashboard drew that as a finished
audit with empty panels. Nothing is called finished until everything the report
shows is stored. There is still one such row in the data from 3 August.

Note what steps 2, 3 and 7 have in common: **replace, not append.** Questions,
competitors and recommendations only ever reflect the newest audit.

---

## 5. Where this schema fights the rest of the project

These are real conflicts, not style. Decide them before running the migrations
anywhere.

**`profiles.id` points at `auth.users`, which is Supabase's own table.** There
is also a trigger, `on_auth_user_created`, that copies a new Supabase user into
`profiles`. Login has since moved to Better Auth, which writes to a different
database entirely. On plain Postgres this migration **will not even run** —
`auth.users` does not exist. The foreign key and the trigger both have to go,
and `profiles` has to be filled from Better Auth instead.

**Row Level Security is dead weight.** Every policy in the init migration is
written against `auth.uid()`, which only exists inside Supabase. It also never
runs: all 52 database calls in `repository.ts` use the **service role**, which
bypasses RLS by design. Ownership is enforced in application code, not by the
database. Moving to RDS means either deleting these policies or rewriting them —
but nothing depends on them today.

**There is no `pro`.** The plan a customer buys does not appear in `scan_runs`.
A Pro audit is `scan_type = 'manual'`. If you need to tell them apart later,
count the questions or add a column deliberately.

**Which AI models exist is not the database's business.** The original schema
restricted `provider` to three names and the code writes seven. Migration
`20260811000000` drops those checks rather than widening them. Do not add them
back — adding a model already needs code that can call it, and a list here buys
nothing since the database cannot tell a new model from a typo.

---

## 6. Known gaps

- **Competitor history is impossible.** `competitors` hangs off the brand and is
  wiped on every audit, so "who was beating me last month" cannot be answered
  even though History is a sold feature. Fixing it means moving the table to
  `scan_run_id`, or adding a per-audit snapshot table.
- **Free audits are not rate limited.** `recordFreeScan` writes `ip_hash: null`.
  The column, the index and the intent all exist; the value does not. Anyone can
  run unlimited free audits.
- **The schema has never been run.** Not against Supabase, not against RDS. The
  first real run will find things this document cannot.
- **`.data/local-store.json` has no schema and no constraints.** It accepts
  anything. Do not treat "it works locally" as evidence the schema is right.

---

## 7. Rules for changing this

1. **Do not add a column for something that changes often.** Model names,
   wording, plan features. Those are data or code, not schema.
2. **Check `lib/db/local-store.ts` too.** Every repository function has two
   implementations. A column added to one and not the other works locally and
   breaks in production, which is the worst way round.
3. **Nullable for anything added after launch.** Old rows must keep working, as
   `scan_runs.summary` does.
4. **Write why in the migration file.** Every migration here explains what was
   wrong and what was decided. That is why this document could be written at
   all. Keep it up.
5. **Migrations are append-only.** Never edit a migration that has run
   somewhere; add a new one.
