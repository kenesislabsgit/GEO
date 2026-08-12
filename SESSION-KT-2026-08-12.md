# GEO audit — handover, 12 August 2026

Covers 10–12 August. Written for whoever picks this up on another machine, in
another Claude session, with none of the context that produced it.

Everything below was verified by running it. Where something is unverified it
says so. Do not trust this document over the code — the code moves.

Branch `main`, `github.com/kenesislabsgit/GEO`. Frontend **61 tests pass**,
Python **137 tests pass**, `tsc --noEmit` clean, lint 0 errors / 6 pre-existing
warnings.

Read `SESSION-KT.md` (3 Aug) and `SESSION-KT-2026-08-06.md` first if you have
not. They explain the pipeline itself. This one only covers what changed after.

---

## 0. Read this before anything else

**Two sets of API keys were pasted into a chat window during this stretch and
have not been rotated yet:**

- the AWS access key pair in `GEO/.env`
- the OpenAI key in `GEO/.env`

They were exposed by an editor auto-attaching the file, not by a commit — no
key is in git history. They still need rotating. This is the highest-priority
item in this document and it is not a code change.

---

## 1. Where the project actually stands

| Area | State |
|---|---|
| Audit pipeline (Python) | Works. Free ~80s, Pro ~292s. |
| Frontend dashboard | Works against a **local JSON file**, not a real database. |
| Database schema | Written and checked against real audit data. **Never run against a real Postgres.** |
| Login | Email/password is fake. Google login is built and tested but has no keys. |
| Cloud | Nothing deployed. No queue, no worker. |

The single biggest gap: **an audit runs inside the web request.** If the
browser disconnects, the run dies and nothing is saved. This was observed, not
theorised — a tally.so run died at 25% when the dev server restarted, and the
work up to that point was lost. Fixing this is the launch blocker, and the fix
is a queue plus a worker, not a retry.

---

## 2. What changed, and why

### 2.1 Progress streaming that does not leak how the product works

Before, the progress bar guessed a stage from a percentage and printed the
backend's raw status text on screen. That text named Firecrawl, Bedrock and
"web presence search", which tells a visitor exactly how to rebuild this.

Now the **runner's step name is the truth** and the percentage is only a
fallback. Customer-facing wording lives in one file and nowhere else:

- `frontend/ranking/lib/audit/progress-copy.ts` — every tagline, both plans.
  Change wording here and it changes everywhere.
- `frontend/ranking/components/scan/audit-progress.tsx` — renders it. Each
  stage gets `data-stage` and `data-state` attributes so animation can be added
  later without touching the logic.
- Four stream consumers now track `step`, not `message`:
  `components/scan/domain-scan-form.tsx`,
  `components/dashboard/upgrade-audit-progress.tsx`,
  `components/dashboard/add-brand-scan-form.tsx`,
  `components/dashboard/new-scan-form.tsx`.

Deliberate decisions, all of them the user's calls:

- **Free shows 5 stages, Pro shows 9.** Free used to show the same 6 as Pro.
  It should look like the free tier is doing less, because it is.
- **Models and questions may be shown. The pipeline may not.** So the web
  search step is worded as *"Finding what the internet has taught AI about
  you"* — true, and it does not say we are running searches.
- Provider IDs are mapped to assistant names before display.
  `bedrock_claude` → "Claude". Never show the raw ID.

There is a test that fails if any tagline contains "bedrock", "openai",
"firecrawl", "crawl" or "api". Keep it.

**Known rough edge:** the answering phase is a 2–4 minute silence with no
events. Per-answer progress ("named in 2 of 14 so far") is not built.

### 2.2 The Sources page

The page existed, was styled, was gated — and was **missing from the tab list**,
so the only way to reach it was to type the URL. Added to
`components/dashboard/brand-nav.tsx`.

Then two real bugs behind it:

- **The frontend collapsed every URL to its domain.** `kenesis.ai/products` and
  `kenesis.ai/platform` both rendered as "kenesis.ai", so the page looked full
  of duplicates. Fixed in `lib/audit/source-links.ts`: URLs are canonicalised
  to host + path, dropping scheme, `www.`, trailing slash, `#hash` and tracking
  parameters. Rows are deduped on that, and a row read by several assistants
  shows a "Read by 3" badge instead of appearing three times.
- **The exporter wrote one row per answer that named a company, not per page.**
  A posthog.com run stored **306 mention rows for 45 unique pages**. Fixed in
  `GEO/geo_audit/export.py` (`build_query_results`) with a set that carries a
  page out once, on the first answer that names it.

The page intro was cut from three paragraphs to two sentences, matching the
streaming wording: AI learned about the market by reading the internet, here is
every page it read.

### 2.3 Database

There is a schema in `frontend/ranking/supabase/migrations/`. Everything the
app writes has a column. It has **never been run against a real database** —
the app has been reading and writing `frontend/ranking/.data/local-store.json`
this whole time.

Checking the schema against real audit output found one real break, fixed in
`20260811000000_models_are_data_not_schema.sql`:

> `query_results.provider` and `usage_ledger.provider` only allowed
> `openai | gemini | perplexity`. The app writes `openai_search`,
> `bedrock_claude`, `bedrock_llama`, `bedrock_mistral`. Every insert would have
> failed on day one.

The fix drops those checks rather than extending them. **Which models exist is
data, not schema** — adding a model should not need a migration. The same
migration adds `step` and `progress` to `scan_runs` so a resumed page can show
where a run got to.

Verified end to end: a free audit of tally.so through the real API route stored
the brand, the run (5/5 complete), 5 questions, 5 answers all linked, the
score, 11 competitors, 1 action, the summary, and 37 citations with no
duplicates. No required field was empty.

### 2.4 Google login

Built with **Better Auth** (`better-auth@1.6.26`), sessions in a local SQLite
file via `@libsql/client`. `better-sqlite3` was tried first and cannot compile
on this Windows box — do not go back to it.

New files:

- `lib/auth/auth.ts` — the config, and `googleConfigured`, which is `true` only
  when both Google keys are present.
- `app/api/auth/[...all]/route.ts` — the handler.
- `lib/auth/client.ts` — browser side.
- `app/login/google-button.tsx` — the button, with Google's mark inlined as SVG
  so no third-party asset loads.

Changed files:

- `lib/auth/session.ts` — asks Better Auth **first**, then falls back to the old
  cookie and Supabase paths, so nobody currently signed in gets logged out.
- `middleware.ts` — the gate reads the session cookie through Better Auth's own
  helper. Reading it by name silently fails in production, where the cookie name
  gets a `__Secure-` prefix.
- `app/login/page.tsx` and `login-form.tsx` — the button renders above the email
  form, and only when the keys exist. The decision is made on the server, so the
  browser never learns whether they are configured and a button that cannot work
  is never drawn.

Verified against a running server: signup returned an app-minted user ID,
`get-session` returned that user, the dashboard let them in, signed-out access
redirected to `/login?returnTo=…`, and with no keys the Google route returns
`PROVIDER_NOT_FOUND` and the page renders zero Google buttons. The test user was
deleted afterwards.

**What is missing: the keys.** See section 4.

**What is still fake: email and password.** The form still posts to
`/api/auth/local`, which accepts any email with a non-empty password. Better
Auth is already configured to handle email sign-up properly — the form just has
not been pointed at it. This is the next auth job.

---

## 3. Setting this up on another machine

Nothing secret is in the repository. Two files must be recreated by hand.

1. `git clone https://github.com/kenesislabsgit/GEO.git`
2. Create **`GEO/.env`** with these names:
   `OPENAI_API_KEY`, `CLAUDE_API_KEY`, `GEMINI_API_KEY`, `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `GATEWAY_ARN`, `GATEWAY_URL`,
   `GATEWAY_ID`, `FIRECRAWL_API_KEY`.
   Use freshly rotated values — see section 0.
3. Create **`frontend/ranking/.env.local`**:
   - `BETTER_AUTH_SECRET` — any 32 random bytes, generate it locally
   - `BETTER_AUTH_URL=http://localhost:3000`
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — section 4
4. `cd frontend/ranking && npm install`
5. `npx @better-auth/cli migrate --config lib/auth/auth.ts -y`
   Creates `user`, `session`, `account`, `verification` in `.data/auth.db`.
6. `npm run dev`

**Audits already run on the old laptop live in
`frontend/ranking/.data/local-store.json`, which is gitignored.** Copy that file
across if you want the existing dashboard data. Otherwise you start empty, which
is fine.

Only one Next dev server may run per directory. Next 16 refuses a second one
with a confusing message; kill the first.

---

## 4. Getting the Google keys

Free, unlimited, no card. Do this once per environment.

1. console.cloud.google.com → pick or create a project.
2. **APIs & Services → OAuth consent screen** → **External** → app name and
   support email → save.
3. **Credentials → Create credentials → OAuth client ID** → **Web application**.
4. Authorised redirect URI, exactly:
   `http://localhost:3000/api/auth/callback/google`
   For production add `https://<your-domain>/api/auth/callback/google`.
5. Copy the client ID and secret into `.env.local`. Restart the dev server.
6. The consent screen starts in **Testing**, capped at 100 users. Press
   **Publish app** to lift it. We only ask for name and email, which are basic
   scopes, so there is no Google review and it goes live immediately.

---

## 5. Numbers measured this stretch

| | Before | After |
|---|---|---|
| Progress stages | guessed from a percentage | driven by the real step |
| Free stage count | 6, same as Pro | **5** (Pro 9) |
| Raw backend text on screen | shown | removed |
| Mentions stored, posthog run | **306 rows for 45 pages** | one row per page |
| Sources intro | 3 paragraphs | 2 sentences |
| Frontend tests | 44 | **61** |
| Python tests | 136 | **137** |

**OpenAI batching, real API calls, both orders run to cancel out warm-up:**

| Approach | Time |
|---|---|
| 10 calls, one question each | **25.0s** |
| 2 calls, five questions each | 55.9s |

One question per call is **2.2× faster**, which is what the code already does.
The batching idea was tested and rejected on evidence. Do not redo this.

---

## 6. What to do next, in order

1. **Rotate the AWS and OpenAI keys.** Section 0.
2. **Add the Google keys** and confirm the button appears. Section 4.
3. **Point email sign-up at Better Auth.** The form still uses the fake local
   login. Small job, mostly deleting `/api/auth/local`.
4. **Queue plus worker.** SQS and a Fargate worker. The audit must survive the
   browser closing. Everything else on this list is smaller than this one.
5. **Rewrite `lib/db/repository.ts` from Supabase to `pg`** for RDS. 55
   functions. Mechanical but long — the schema is already agreed, so this is
   translation, not design.
6. **Run the migrations against a real Postgres** and re-run one free and one
   Pro audit against it. The schema has only ever been checked on paper.
7. Per-answer progress events, to fill the 2–4 minute silence.

Smaller things, worth doing when nearby:

- The site-read lock has no timeout. A stale lock cost 151 seconds on a retry.
- `recordFreeScan` writes `ip_hash: null`, so free audits are not actually rate
  limited. Anyone can run unlimited free audits.
- Competitors are stored per brand, not per audit, so competitor History cannot
  work as sold.
- `call_chat_completion` (`GEO/geo_audit/llm.py:83`) has no retry. Only Gemini
  has one, for 429s, at `llm.py:350`.
- `middleware.ts` is deprecated in Next 16 and should become `proxy.ts`.
- One old run from 3 August is marked `completed` with no score and no actions.

---

## 7. Things that are true and easy to get wrong

- **`frontend/ranking/AGENTS.md` says this is not the Next.js you know.** Read
  the guide in `node_modules/next/dist/docs/` before writing Next code. That is
  how the `middleware.ts` → `proxy.ts` deprecation was found.
- **`pytest` is not installed.** Run Python tests with
  `PYTHONPATH=<repo>/GEO python tests/test_pipeline_changes.py`. There is no
  `tests/__init__.py`, so `unittest discover` also fails.
- **Mentions are exported under `verified_mentions`, not `sources`.** Measuring
  the wrong key produced a confident wrong conclusion during this stretch.
- **Google login is free. Supabase login is not free at scale**, and it mints
  the user ID itself, which is why it was dropped. AWS Cognito has the same
  ID-ownership problem. Better Auth mints the ID into our own table, so the user
  ID stays ours whichever sign-in method is used. That was the whole reason for
  the choice.
- **The local JSON store is not a database.** Everything that looks like it
  works in the dashboard today is working against a file.

---

## 8. How this stretch worked

Four of the changes here came from being pushed back on, and each pushback was
right:

- *"we don't need to completely disclose what our architecture is in the
  frontend"* → the whole progress-copy split, which is now the cleanest part of
  the frontend.
- *"it should look like we are doing only some in the free tier"* → free cut
  from 6 stages to 5.
- *"a problem like that only comes when more than 100 users click audit at the
  same time"* → correct. The rate-limit argument for queueing was dropped; the
  real argument is the dropped connection, which had already been observed.
- *"supabase login would make problems in terms of the id of the user"* →
  correct, and it killed the recommendation that was on the table.

One thing was stated wrongly during this stretch and is worth recording: the
Python audit was described as continuing to run after a browser disconnect. It
does not. The tally.so run proved it. Do not assume the pipeline outlives the
request until the worker exists.
