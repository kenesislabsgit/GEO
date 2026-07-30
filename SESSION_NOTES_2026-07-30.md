# Work session — 30 July 2026

A record of what was investigated, decided and changed in this session, and the
numbers behind those decisions. Written so someone picking this up later knows
why things are the way they are.

---

## 1. How the audit actually works

The product answers one question: **does AI recommend your company?**

Everything is a file pipeline. Each stage reads the previous stage's JSON and
writes its own into one run folder (`GEO/outputs/<timestamp>-<domain>/`), so
every step can be inspected and re-run on its own.

| # | Stage | What it does | Output |
|---|---|---|---|
| 1 | Read website | Firecrawl first, built-in crawler as fallback; the two page sets are merged | `website_snapshot.json` |
| 2 | Extract evidence | Pure keyword/URL matching — pricing page? FAQ? docs? schema? No AI | `website_evidence.json` |
| 3 | Company profile | One AI call, forced to quote the page for every claim; code then deletes unsupported claims | `company_profile.json` |
| 4 | Buyer questions | AI drafts, a second AI pass rewrites weak ones | `customer_prompts.json` |
| 5 | Ask the AI | Questions go to the providers; recommendations, ranks and sources extracted | `ai_recommendations_raw.json` |
| 6 | Count patterns | Mentions, average rank, who won each question the company lost | `recommendation_patterns.json` |
| 7 | Web presence | Independent search; a mention counts only if the page loads and names the company | `web_presence.json` |
| 8 | Competitor evidence | Resolve their real site, crawl it, extract the same evidence as step 2 | `competitor_evidence.json` |
| 9 | Compare | 11 checks, user vs competitors, gaps rated High/Medium/Low | `comparison.json` |
| 10 | Recommend | AI writes actions, restricted to citing a pre-verified evidence catalogue | `audit_recommendations.json` |
| 11 | Report and export | Written report, plus the structured feed the dashboard renders | `final_report.md`, `audit_export.json` |

**The idea that explains the design:** every stage is either deterministic code
or a fenced-in AI call, never both. Facts, counting, scoring and comparison are
plain Python. Judgment and writing are AI, but forced to quote their input, pick
from a pre-verified catalogue, and pass a code-level check afterwards. That is
why there are ~20 intermediate files — each one is the audit trail for a claim
in the final report.

---

## 2. Several people can now audit the same website

### The problem

The first person to audit a website effectively owned it. Everyone after them
was refused. Five separate gates caused this:

1. A domain was **one global record** (unique index on `canonical_domain`).
2. **Ownership lock** — 409 "already owned by another account" on the live
   audit endpoint. This was the error being hit in practice.
3. **30-day re-scan cache** — really a cost control, but it behaved like a lock.
4. **Free-plan caps** — 1 website, 5 checks a month.
5. **Rate limits** — 3 runs per domain per day, so one person's runs locked
   everyone else out.

### The fix

Split the website from the audit of it.

- **The website** is shared and owned by nobody: the pages we fetched, kept for
  seven days and reused.
- **An audit** belongs to one person. Their questions, competitors, score and
  report are theirs alone. Ten people can each have their own audit of the same
  website.

Each account now gets its own record per website. Anonymous visitors always get
a fresh one, so two people auditing the same site at the same moment never
overwrite each other. Claiming a report someone else owns now hands you your own
copy instead of an error. Report links stay unique automatically
(`example-com`, `example-com-2`, …).

**Simultaneous audits of one site:** only one fetch happens. The second audit
waits for it and reuses the result; if the first stalls, the second reads the
site itself rather than failing. Never blocks, never double-charges.

### Correctness problems this exposed

- Public reports, the social preview image and the dashboard were finding the
  latest audit **by domain**, which would have shown one person's audit under
  another person's link. Now resolved by the specific record.
- The per-website rate limit punished user B for user A's runs. Replaced with a
  short 2-minute burst cooldown.

Files: `lib/audit/site-read-cache.ts`, `lib/ai/website/shared-understanding.ts`,
`lib/db/repository.ts`, `lib/db/local-store.ts`,
`supabase/migrations/20260730000000_allow_multiple_audits_per_website.sql`.

---

## 3. The free plan, rebuilt

### What it was doing wrong

The free audit ran on Bedrock Llama, which has **no web search**. Consequences:

- No citations were ever possible, so two panels were permanently empty.
- Every free report showed an amber "Limited evidence" warning.
- "Citation gaps: 5 of 5" blamed the customer for a model that cannot cite.
- "Outdated claims" was **always 0** — nothing ever filled it.
- "Priority actions" was **always 0** — free made one action and the tile showed
  "actions minus the one displayed".

So two of four locked tiles always read zero, and the single recommended action
was a fill-in-the-blanks template, not AI writing.

### What it does now

- **OpenAI with web search**, defined once in `lib/constants.ts` so it cannot
  drift again (it had been hard-coded in five places).
- **Five questions**, unchanged.
- **One competitor investigated** — the most-recommended company has its site
  resolved from the AI's own citations, and pages read.
- **The action is written by AI**, tied to specific lost questions and the
  competitor's actual page.
- **Sources are checked for the customer's name**, so the report can honestly
  say "none of these sources mentions you".

### The page

Ends after "Where the AI looked". Removed: the locked tiles, the methodology
block and the example-answer panel. A slim claim strip remains — the only path
from a free report to a paid one.

1. Score header
2. What the AI answered — each question with **your position** and **who was
   recommended ahead of you**
3. Companies the AI recommended — with average position and evidence status
4. The competitor we looked into — their site and quotes from their pages
5. Your best next action
6. Where the AI looked — the sources, and whether they name you
7. Claim strip

Global design untouched: same colour tokens, fonts, spacing and radii.

---

## 4. Bugs found by testing against live runs

Five real defects, none of which showed up in code review:

1. **Competitor URLs were thrown away during aggregation.** The model returns
   each competitor's own URL, but the aggregation step never stored them, so no
   competitor website could ever be resolved. First run: 0 sites found. After
   the fix: all 5.
2. **The template action overrode the AI one.** The fallback finding prepends
   itself, so "keep the top 1" kept the template and discarded the model's work.
3. **A single analyzer timeout emptied an entire audit** — one run produced a
   report with zero companies and a score of 0. Now retried once.
4. **The company's own products were counted as competitors** — "you lost to
   Stripe Connect". Sub-products now count as the company.
5. **Nav junk in quoted excerpts** — "Skip to main content Skip to footer…"
   was being quoted as competitor page content. Now stripped.

---

## 5. Making it faster

### Parallel search calls

Previously all five questions went in **one** call, and the model ran its five
web searches one after another inside it — so we waited for the sum. Now each
question is its own call and they run at the same time, so we wait for the
slowest. A failure now costs one question instead of the whole set.

### Bounded search depth

The web search tool was being sent with **no configuration at all**, which is
exactly why runs were unpredictable. Now:

- `search_context_size`: `low` for free, `medium` for paid.
- Optional `OPENAI_SEARCH_COUNTRY` pins results to one market so repeat runs
  stay comparable.
- Output ceiling scales with the number of questions, so a one-question call is
  not billed a five-question budget.

### Prompt caching

Every call carries a shared cache key, and the long instructions sit first and
unchanged in every request, which is what allows them to be reused rather than
re-billed. Applied to both the search calls and the ordinary ones.

### Result

| | Before | After |
|---|---|---|
| stripe.com | 155–346s | **122s** |
| kenesis.ai | — | **129s** |

Quality went **up**, not down: 24–33 verified sources per run versus 13–17,
because five separate calls each surface their own sources.

---

## 6. Where the remaining time goes

Measured per stage on a real run (113s total, cached crawl):

| Stage | Time | Share |
|---|---|---|
| Read website | 5s | cached — 20–45s cold |
| **Understand the company** | **46s** | **41%** |
| **Write the buyer questions** | **27s** | **24%** |
| Ask OpenAI + verify all sources | 24s | 21% |
| Find and read competitor site | 3s | 3% |
| Write the action | 7s | 6% |
| Score, compare, export | 1s | 1% |

**Web search is no longer the bottleneck.** The two slowest steps are now our
own calls.

### The profile step, measured directly

| | Time | Output |
|---|---|---|
| Current full profile | **73s** | 3,412 tokens |
| Lean version (what free needs) | **11s** | 808 tokens |

The input is small (~3,900 tokens). The cost is entirely in what we ask it to
*write*: personas with organisation types and sizes, regions, buying triggers,
constraints, plus an exact supporting quote for **every** claim, then a second
evidence table. The validator then deletes everything unsupported — the model
wrote 13,648 characters and 6,520 survived. Over half is discarded **by
design**, and that is what keeps the profile honest for the paid audit.

But the free audit uses perhaps a fifth of what survives. **A lean profile for
free runs would save ~60 seconds with nothing lost on the page.** Not yet
implemented.

### The question review pass earns its 13 seconds

Compared drafts against finals: **all five questions were rewritten, none
survived untouched.** The drafts run 28–31 words and read like marketing copy;
the finals run 22–25 and read like something a person would type.

> **Draft:** "Which providers offer on-premise AI video analytics solutions
> specialized in real-time PPE violation and hazard detection for industrial
> facilities using existing CCTV infrastructure?"
>
> **Final:** "Which providers offer on-premise AI video analytics solutions for
> real-time PPE violation and hazard detection using existing CCTV in industrial
> facilities?"

This matters more than it looks: these questions **are** the measuring
instrument. Stuffed questions get unnatural answers, and the score then measures
something no real buyer would ask. Notably the first prompt already says "keep
each question concise" and the drafter ignores it every time — so the reviewer
is compensating for an instruction that does not stick. Merging the two calls
would likely just give us the overstuffed drafts.

---

## 7. Verification

- **Six live audit runs** against stripe.com and kenesis.ai.
- Typecheck clean; **36 of 36 tests pass**.
- New tests: two accounts on one website, anonymous runs staying separate,
  copy-instead-of-refuse, per-record report resolution, shared-read
  single-flight and stall-fallback, plus an end-to-end test that imports a real
  audit export and asserts every panel of the free page has data behind it.

Sample of a real free run (kenesis.ai): mentioned in 2 of 5 questions, ranked
2nd in both, score 39; beaten by Triya, TruEye, Fenec Labs, EdgeTrace, Vizenta;
Triya's site resolved and 4 pages read; 24 sources cited of which **22 never
mention Kenesis**; action written by the model, not a template.

---

## 8. Known issues and what is next

**Not yet done, in order of payoff:**

1. **Lean profile for free runs** — the single biggest remaining win, ~60s.
2. **Stream the report in stages** — score and questions are ready at 102s, the
   competitor and action arrive 11s later. Streaming would make it feel like
   100s rather than a blank wait.
3. **Winners get no action.** When a company is recommended in all five answers
   the model correctly has nothing to fix, and the page falls back to a neutral
   line. Fine for now; a prompt change would fix it.
4. `backend/.env.example` is excluded by the `.env.*` ignore rule. It is a
   placeholder with no real keys and would normally be committed.

**Deliberately left alone:** plan limits (free = 1 website, 5 checks a month).
Those are pricing rules, not collisions.

---

## 9. Configuration

Environment files are **not** in the repository and must not be.

| File | Used by | Variables |
|---|---|---|
| `GEO/.env` | the audit pipeline | `OPENAI_API_KEY`, `CLAUDE_API_KEY`, `GEMINI_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `GATEWAY_ARN`, `GATEWAY_URL`, `GATEWAY_ID`, `FIRECRAWL_API_KEY` |
| `backend/.env` | the older FastAPI prototype | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| *(none)* | the frontend | see below |

The frontend has no env file. With no `SUPABASE_SERVICE_ROLE_KEY` it falls back
to a local JSON database at `frontend/ranking/.data/local-store.json`. When the
dashboard runs an audit it spawns Python with the working directory set to the
GEO folder, so the Python side picks up `GEO/.env`.

To deploy the frontend it will need: `OPENAI_API_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `AUDIT_RUN_TOKEN`, `GEO_AUDIT_ROOT`,
`GEO_AUDIT_PYTHON`. The rest have working defaults.

New settings added this session:

| Setting | Default | Effect |
|---|---|---|
| `SITE_READ_TTL_HOURS` | 168 (7 days) | How long a stored website read stays reusable |
| `SITE_READ_LEASE_SECONDS` | 480 | How long one audit may hold the "reading this site" lease |
| `SITE_READ_WAIT_SECONDS` | 150 | How long a second audit waits before reading the site itself |
| `OPENAI_SEARCH_CONTEXT_SIZE` | `low` | Search depth per question |
| `OPENAI_SEARCH_COUNTRY` | unset | Pins search results to one market |
| `LOCAL_STORE_PATH` | `.data/local-store.json` | Lets tests use a throwaway database |

---

## 10. Repository

The three parts were previously three separate git repositories. They are now
one, pushed to `github.com/kenesislabsgit/GEO`.

- `GEO/` — the Python audit pipeline
- `frontend/ranking/` — the Next.js dashboard and public report pages
- `backend/` — the earlier FastAPI prototype

**Excluded and regenerable:** `.env` files, `node_modules/` (816 MB),
`.next/` (1.6 GB), `GEO/outputs/` (37 audit runs, 22 MB), the local database,
and local screenshots. About 2.4 GB kept out of a 2.9 MB commit.

**Note:** `frontend/ranking` and `GEO` each had their own `.git`, which would
have pushed as empty references rather than code. Those were renamed to
`.git.disabled-20260730` rather than deleted — nothing is lost, and renaming
them back restores the old links. `frontend/ranking` previously pointed at
`zmrishh/ranking`; `GEO` pointed at `Deeks010/GEO`.

The local database was also wiped this session at the owner's request (4
websites, 8 audits and related records), with a backup taken first.
