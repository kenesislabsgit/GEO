# GEO audit — handover, 3 August 2026

Everything below was verified by running it. Where a claim is unverified it says
so. Do not treat anything here as true without checking the code, because the
code moves.

Branch `main`, pushed to `github.com/kenesislabsgit/GEO`, head `9c8d2b6`.
Ten commits from `cbe8419`. Python 106 tests pass, frontend 44 tests pass,
`tsc --noEmit` clean.

---

## 1. What the product does

A website is audited for whether AI assistants recommend it. The pipeline:

```
crawl the site
  → profile: what this company is and who buys from it
  → buyer band: the population that buys, and six buyer situations
  → questions: what those buyers would type into an AI assistant
  → answers: ask those questions with web search on, see who gets named
  → competitor evidence: read the winners' websites
  → recommendations: what to change, with citations
  → audit_export.json → the dashboard
```

Two tiers, set in `frontend/ranking/lib/constants.ts`:

| | Free | Pro |
|---|---|---|
| Questions | 5 | 20 |
| Search depth | `low` | `medium` |
| Pages crawled | 6 | 10 |
| Competitors read | 1 | all |
| Actions written | 1 | all |
| Web presence pass | skipped | run |
| **Measured cost** | **$0.075** | **$0.29** |
| **Measured time** | **~80s** | **~292s** |

Cost is 80% web search, and most of that is the flat $0.01-per-search tool fee
rather than tokens. Cutting searches is the only real lever on cost, and it is
also cutting the product.

---

## 2. The rule that governs this codebase

**Every stage is either deterministic code or a fenced-in AI call, never both.**
Facts, counting and scoring live in Python. Judgment and writing live in an AI
call whose output is checked by code.

A corollary learned the hard way this session, which is the single most useful
thing in this document:

> **Remove rules that dictate the shape of an answer. Keep rules that supply a
> fact the model cannot derive.**

Concretely, this session repeatedly found that:

- Telling the model *what to do* in prose often does not stick. It was told
  three times not to use the word "partner" and used it anyway.
- Making the thing *structural* always sticks. Splitting one field into two, or
  correcting the word in code, worked immediately.
- When the model produces a wrong answer, look at the **input** before blaming
  the model. Every single "hallucination" investigated this session turned out
  to be bad input.

---

## 3. Bugs fixed this session, and what caused them

These are worth reading because the same failure modes will recur.

### 3.1 Substring matching on URLs — three separate bugs

- `"makes 2024"` matched the currency code `kes` → the site was read as Kenyan.
- `/legal-tech-solutions` matched `legal` → a legaltech firm's product page was
  treated as a legal notice.
- `?products=` in a checkout link matched `product` → a shopping cart was
  labelled "Product or feature page" and cited in a report as evidence.

**Fix pattern:** match whole path segments, not substrings; require word
boundaries for alphabetic codes; ignore query strings when judging a page.

### 3.2 Flattened markdown

Firecrawl returns structured markdown. `clean_markdown_text` was collapsing it
to a single line — headings, lists and blank lines all gone.

A contact form became prose, so `e.g. Tata Steel` (a form placeholder) was read
as a customer. A head-office address read as a market claim.

**Fixed** in `geo_audit/firecrawl.py` — `markdown_body_text` keeps the shape.
This alone fixed two bugs with no prompt change.

### 3.3 Labels compressing away the answer

The profile had `serves_customer_tiers` — a five-word menu. For wedigistudio it
answered `enterprise`, which was a lossy compression of *Brakes India,
Rajalakshmi Engineering College, Rent Machi, Aura Mental Health, Thiagarajar
Engineering College*. Four of five customers are small or mid-size. The label
picked the largest and the question writer never learned the company sells to
colleges and startups.

**Fixed:** customers are carried as **names**, verified against the page they
came from. `market_position` was deleted entirely.

### 3.4 The wrong competitor

A web search for "Triya" found `drtriya.com` — a doctor's practice — and that
overrode `triya.ai`, which the AI had cited four times while recommending them.

**Fix pattern:** a citation is evidence, a name match is a coincidence.
`preferred_competitor_site` prefers a candidate whose domain appears in the
AI's own citations.

### 3.5 One page counted as three

`http://`, `https://` and `www.` of a homepage were stored separately, spending
half a competitor's crawl budget on one page. A first fix only caught
redirects; some sites serve all three independently.

**Fixed:** `same_page_key` in `crawler.py` keys on host + path only.

### 3.6 A keyword gate starving the citations

Triya was recommended in 14 of 20 answers and reached the recommendation step
with **one** citable page — its homepage — because the rest of its site had not
landed in a bucket named after a word in its address. So "you lost on data
sovereignty" was backed by *"Turn Any CCTV Into an AI Video Analytics
Platform"*.

**Fixed:** every page we actually fetched is citable. The model decides which
one proves a point. Also, the AI's own cited URLs are now fetched first.

### 3.7 Describing the customer by what they own, not what they say

Competitors reached the recommendation step as pages with real text. The
company paying for the audit arrived as a headline and a row of true/false
flags. So the model could not tell *"they never mention on-premise"* from
*"they mention it once"* — and told kenesis to publish things it already says.

**Fixed:** the audited site's pages travel with the same treatment, at 700
chars each.

### 3.8 Windows file locks (frontend)

`EPERM: operation not permitted, rename` killed a free audit mid-import.
Replacing a file by renaming a temp over it is correct, but Windows refuses
while anything holds either file open — Defender scanning a just-written file
is enough.

**Fixed:** `lib/utils/atomic-file.ts` retries transient locks (4 attempts,
~300ms), gives up immediately on `ENOSPC`-type errors, always cleans up the
temp file. Three call sites now share it; two of them had been failing silently
inside `catch {}` blocks.

### 3.9 A half-saved audit shown as finished

The import wrote the scan as `completed` on its first line, then stored
answers, score, competitors and actions. When 3.8 killed it midway, the
dashboard showed a finished report with a dash for the score and empty panels.

**Fixed:** recorded as `running`, marked finished only once everything is
stored.

### 3.10 A hardcoded path from another machine

`const geoRoot = process.env.GEO_AUDIT_ROOT ?? "D:\\seo\\GEO"` — Python was
spawned into a directory that does not exist. It failed in under two seconds
and the real error was hidden by an `ERR_INVALID_STATE` crash, because a failed
spawn fires both `error` and `close` and each handler sent then closed.

**Fixed:** default resolves to the `GEO` directory beside the app; the stream
closes once and refuses to write afterwards.

---

## 4. Architecture, file by file

### `GEO/geo_audit/profile.py`

Builds the company profile from the crawl. Key parts:

- `PROFILE_MARKET_RULES` — asks for `named_customers` (name, described_as,
  page_id) and `buying_signals`. **Does not** ask for a size label.
- `normalize_named_customers` — a customer is kept only if its name appears on
  the page it is credited to, and is at most 8 words (longer means the model
  summarised a group, which is the one thing this field must not hold).
- `profile_text_budget` — boilerplate pages (privacy, terms, careers) get 500
  chars, the homepage 9000, everything else 6000. `is_boilerplate_segment`
  requires **every** word in a path segment to be boilerplate or filler, so
  `/legal-tech-solutions` survives.
- `quote_or_verbatim_part` — models stitch two sentences from opposite ends of
  a page; keeps the part that is really there.

### `GEO/geo_audit/site_facts.py` (new this session)

Deterministic. Reads three things off the pages with no model:

- **primary_market** — needs **two independent kinds** of evidence from
  currency-on-a-price, a named regulator/exchange, or a country domain. A tie
  between two markets settles on Unknown. Phone prefixes and addresses are
  deliberately excluded: they say where a company *sits*, not who it sells to.
- **pricing_visible** — a currency symbol or code adjacent to a number.
- **purchase_path** — `self_serve` / `contact_sales` / `both` / `unknown`.
  "Get started" is deliberately **not** a self-serve marker; it sits on agency
  contact forms as often as on signup buttons.

### `GEO/geo_audit/intents.py`

Three AI calls per question set:

1. **`derive_buyer_band`** — who buys. Produces `buyer_words_for_provider`,
   `sector_focus` (specialist/generalist), `sectors_served`,
   `sectors_open_to_it`, and six `buyer_situations`.
2. **Draft** — writes the questions.
3. **Critic** — rewrites generic ones and strips vendor wording.

Plus a **repair round** if the checks dropped too many.

Important design points, each of which exists because something failed:

- **`sectors_served` vs `sectors_open_to_it`.** A generalist's past customers
  are its history, not its market. Five clients became five questions, one per
  client's industry, so the audit measured the company's back catalogue.
  Asking in prose did not work — the band wrote "generalist" and then listed the
  same five sectors. Splitting the field made diversifying something it must
  *produce*. Code strips any repeated sector for a generalist.
- **`buyer_words_for_provider`** is corrected in code: a trailing "partner" or
  "partners" becomes "company". The list is deliberately **two words only** —
  longer lists deleted phrases buyers really use ("payment platform", "cloud
  provider", "SEO specialist").
- **`question_batches`** — over 10 questions splits into parallel batches of 10,
  each given its own slice of the buyer situations. 20 questions: 98s → 64s.
- **Deterministic rejects** in `sanitize_prompt_records`: over 30 words, names
  the company, names a customer, or borrows a 3+ word marketing phrase.

### `GEO/geo_audit/competitor_evidence.py`

- Five competitors read **in parallel** (`COMPETITOR_CONCURRENCY = 5`), order
  preserved because rank is read off the list.
- `priority_firecrawl_urls` puts the AI's own cited URLs first.
- `preferred_competitor_site` — see 3.4.

### `GEO/geo_audit/audit_recommendations.py`

- `build_verified_evidence_catalog` — every fetched page is citable.
- `readable_evidence_row` — strips **our** guess about what kind of page it is.
  The model gets address, real page title, extract. Nothing else.
- The prompt defines what a good citation is in general terms: a page a buyer
  could reach, quoting something the company *states* rather than interface
  wording, and *cite nothing rather than the nearest thing*.
- `user_page_excerpts` — the audited site's own pages, 700 chars each.
- **`summary`** — three or four sentences saying where the company stands,
  written in this same call at no extra cost. This is what the dashboard shows.

### `frontend/ranking`

- `app/api/audit-run/stream/route.ts` — spawns the Python CLI, streams progress
  as newline-delimited JSON, then imports the export. **This is the only route
  the UI uses**; `app/api/audit-run/route.ts` exists but nothing calls it.
- `lib/audit/import-export.ts` — `audit_export.json` is the **only** thing that
  crosses from Python to the frontend. It is split into database tables and the
  dashboard reads the database, never files.
- `lib/utils/atomic-file.ts` — see 3.8.

---

## 5. Things that are true and easy to get wrong

- **`final_report.md` is not used.** The dashboard builds every screen from
  `audit_export.json`. Generation is off via `--skip-final-report`; the code
  remains for inspecting a run by hand.
- **The crawl page text field is `main_text`**, not `text`.
- **`normalize_evidence_text` lowercases and turns punctuation into spaces**, so
  `"India's largest"` becomes `"india s largest"`. Test fixtures must be
  pre-normalised or they will not match.
- **The local dev database path env var is `LOCAL_STORE_PATH`**, and it is read
  once when `lib/db/local-store.ts` is first imported. Tests must set it
  **before** importing anything that touches the store — use dynamic imports.
  Two tests set a non-existent `LOCAL_DB_DIR` and silently wrote into the
  developer's real `.data` store.
- **Environment files are not in the repository and must not be.**
  `GEO/.env` holds `OPENAI_API_KEY`, `CLAUDE_API_KEY`, `GEMINI_API_KEY`,
  AWS keys, gateway config, `FIRECRAWL_API_KEY`. `backend/.env` holds
  `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. Never read or print
  their contents.
- **The frontend has no `.env` file at all** on the machine this was developed
  on. `GEO_AUDIT_ROOT` now defaults correctly, but other settings may need one.
- **Running the Python tests:** `cd GEO && PYTHONPATH=. python
  tests/test_pipeline_changes.py`. Do **not** use `python -m unittest
  tests.test_pipeline_changes` — an installed package called `tests` shadows it
  and drags in torch.
- **Next.js is 16.2.10** and `frontend/ranking/AGENTS.md` warns it differs from
  training data. Read `node_modules/next/dist/docs/` before touching a
  Next.js API.

---

## 6. Verified results, for comparison

Live runs, all reproducible.

**Profile — named customers**

| Site | Found | Correct? |
|---|---|---|
| wedigistudio.com | 5 | ✅ |
| stripe.com | 9 | ✅ |
| zoho.com | 8 | ✅ |
| kenesis.ai | 0 | ✅ names nobody |
| zerodha.com | 0 | ✅ B2C |

**Deterministic market**

| Site | Market | Prices | Path |
|---|---|---|---|
| zerodha | India (₹ + SEBI/NSE/BSE) | yes | self_serve |
| stripe | Unknown | yes | both |
| zoho | Unknown | yes | both |
| kenesis | Unknown | no | contact_sales |
| wedigistudio | Unknown | no | unknown |

**Pro audit of kenesis.ai, 20 questions**

```
score 40.3 | mention rate 30% (6/20) | average rank 1.83
Triya 14 mentions (avg rank 1.93), Camlytics 7, Witvix 7, AtomVision 5
```

The free 5-question run of the same site reported average rank **3.5** — it
caught the two worst placements. This is the clearest evidence that 5 questions
cannot measure anything.

---

## 7. What is NOT done

Ordered by what I would do next.

1. **Apply the database migration.** `frontend/ranking/supabase/migrations/
   20260803000000_add_scan_summary.sql` adds `summary text` to `scan_runs`.
   **Until this runs, the summary paragraph will not appear** — the dashboard
   falls back to the old sentence. Additive and nullable, so nothing breaks.

2. **Nobody has reviewed the frontend properly.** I only ever looked at
   `audit_export.json` and one screenshot. The dashboard may have other panels
   that are empty, mislabelled or reading stale fields.

3. **Three sites untested end to end** — zerodha, stripe, zoho have only been
   tested as far as question generation. Zerodha is B2C, Stripe is huge, Zoho
   has 50 products; each will probably expose something.

4. **The score barely rewards ranking.** Kenesis ranked **first** in 3 of its 6
   mentions and its 20-question score (32.1) came out *lower* than the noisy
   5-question one (36.3), because the score is dominated by mention rate. A
   customer upgrading may watch their score fall while the measurement improves.
   Product decision, not a bug.

5. **Two accuracy issues left in the recommendations:**
   - The model names a good URL in its prose and then cites a weaker one.
   - It was asked to quote the customer's own thin line back at them
     (*"your homepage says this once, the competitor devotes a page to it"*) and
     does not. Today's lesson says a **field** would work where an instruction
     does not.

6. **Wrong-entity web mentions.** Searching "AtomVision" matched two unrelated
   scientific GitHub repos because the word "Manufacturing" appeared on the
   page. They sit in the evidence catalog. The model has so far ignored them.

7. **Run-to-run variation.** Same site, same day, different questions and
   slightly different scores. The user decided this is acceptable because free
   is one run per account — but it matters the moment Pro tracks a site over
   time, since "your score dropped 36 → 22" would be noise presented as signal.

8. **Perceived latency.** The score and competitor list genuinely exist at about
   4 minutes of a ~5 minute Pro run; the rest is recommendations. Showing
   results as they land would cut the felt wait substantially. Frontend work.

9. **Untracked in git:** `TASKS.md` (the user's own notes),
   `frontend/ranking/package-lock.json` (unrelated), `image.png` (a screenshot).
   Left alone deliberately. There is also
   `frontend/ranking/.data/local-store.json.backup` — a backup taken before
   removing two test-created records; `.data` is gitignored.

---

## 8. How the user works

- Wants brief answers in simple English. No long explanations unless asked.
- Wants a recommendation, then makes the decision themselves.
- Challenges reasoning hard and is usually right to. Several of the most
  valuable changes this session came from the user pushing back:
  - "over-strict prompts limit the model" → led to removing overfitted rules
  - "the clients show the level, not the market" → led to the sectors split
  - "why three calls for five questions?" → led to measuring it (three won)
  - "is it just assembled data?" → led to finding the summary was a threshold
- Expects claims to be tested, not asserted. Every "this is better" in this
  document was measured against a live run.
