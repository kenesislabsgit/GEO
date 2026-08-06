# GEO audit — handover, 6 August 2026

Read `SESSION-KT.md` first. That document describes the pipeline, the rule that
governs the codebase, and the bugs fixed on 3 August. This one only covers what
changed after it.

Everything below was verified by running it. Where something is unverified it
says so, in those words. Two predictions in this session turned out to be wrong
and were corrected by measurement — both are written up, because the reasoning
that produced them looked sound at the time.

Branch `main`. Python 121 tests pass, frontend 44 tests pass, `tsc --noEmit`
clean, eslint clean on changed files.

---

## 1. The one-line summary

The audit produced a report nobody could act on: it cited the wrong companies,
printed internal reference codes at the reader, and threw away a completed run
over a missing field. A Pro audit charged for 80 AI answers and collected 36.
All of that is fixed. The Pro run got slower before it got faster, and the
final speed fix is **not yet verified end to end** — see section 9.

---

## 2. A finished audit was being thrown in the bin

**Symptom:** the frontend showed `audit_export.brand.domain is required` after
about eighty seconds. Every answer, competitor, score and recommendation had
been computed and written to disk. All of it was discarded.

**Cause:** `export.py` read the audited company's domain out of
`company_profile.evidence.supporting_pages` — a list the *model* fills in. On
that run the model produced no validated field evidence, so the list was empty,
so the export wrote `"domain": null`, so the importer refused it.

Meanwhile `website_snapshot.json` from the same run held `"domain":
"kenesis.ai"`. The domain was the input to the audit. It was never in doubt.

**Fixed** in two layers:

- `export.audited_domain()` takes the domain from the crawl — `domain`, then
  `normalized_url`, then `input_url`, then the first crawled page URL — and
  falls back to the model's evidence only if all of those are empty. `cli.py`
  passes the snapshot in, from both `run` and the standalone `export` command.
- `app/api/audit-run/stream/route.ts` fills in the domain it asked for if the
  export still arrives without one. A completed audit can no longer be lost to
  this.

`host_from_value` handles both forms the snapshot uses: `domain` is a bare host
and `urlparse` returns an empty netloc for those, which is why a URL-only
parser had nothing to work with.

---

## 3. The improvements page was three unrelated blocks

A live free audit told kenesis.ai:

> Finding: you lost this question to **Triya, Visionify and Witvix**
> Supporting page: **AtomVision** — a company that came *fifth* in that same question

Three separate faults produced that.

### 3.1 The wrong competitor's website was read

A free audit reads one competitor's website. It picked by **mention count**.
AtomVision led that list with three mentions — but two were in questions
Kenesis had already won, and the third placed it fifth. Triya was named twice
and came **first both times**, in questions Kenesis was absent from.

So the audit read the website of a company that also lost, and then cited it.

**Fixed:** `aggregation.rank_for_investigation()` scores placement
(1st=100, 2nd=80, 3rd=60, 4th=40, 5th=20) **inside the lost questions only**,
and publishes `investigation_priority`. `competitor_evidence` reads that list
to decide whose site to crawl, and pulls in a priority company that sits
outside `top_competitors` so it can still be reached.

On the live run: Triya 200, Avigilon 100, AtomVision 20. Triya gets crawled.

**`top_competitors` is deliberately unchanged.** It answers "who does AI
recommend", AtomVision genuinely leads it, and that is what the dashboard's
competitor list should show. Two different questions, two different orders.

A first attempt at this also counted questions the company appeared in but
ranked below someone. That pulled AtomVision back above Triya. Lost questions
now win outright; the weaker signal is used only when nothing was lost at all.

### 3.2 A finding could cite a company that lost the same question

**Fixed:** `keep_evidence_from_the_companies_that_won()` runs after evidence
and losses are resolved, and drops any cited page whose company is not a winner
of the cited question. Rejections are recorded, not silently dropped.

The first version tested "was this company in the answer". That is not enough:
when the audited company is absent, *every* name in the answer is nominally
ahead of it, so a fifth-placed company still passed. It now tests against
`winners` — the top three placements — and falls back to the full list only for
older runs that predate that field.

### 3.3 It never said *why* the question was lost

The assistant already explains its choice in the answer. That text was being
discarded. `user_prompt_losses` now carries `winners` — company, rank and the
assistant's own reason — through `compact_recommendation_patterns` and
`resolve_affected_prompts` to the export and the dashboard. No extra AI call.

---

## 4. The report was written for a machine, not a reader

- **Internal ids reached the page.** A live report read "...suitable for
  industrial sites (ev-004, ev-005, ev-006)." and "Lost loss-001 to Triya".
  `strip_internal_references()` removes them from every written field and from
  the summary. A bracketed run of ids goes whole — removing only the ids left a
  stranded `)`. The prompt also forbids writing them, so stripping is a net
  rather than the primary defence.
- **Competitor quotes opened with website furniture.** Three quotes began "Skip
  to main content" and one began "##". There were two excerpt paths and
  `audit_recommendations.page_excerpt` skipped the cleaner that already
  existed. They share `evidence.readable_excerpt` now, which also strips
  markdown marks and restores the space in `"One appliance.Every camera"`.
  Words fused without punctuation (`"PPEbeforethe"`) are left alone — splitting
  them needs a guess, and a wrong guess mangles real words like `CCTVs`.
- **The proof block quoted competitor pages.** It now shows company, page title
  and link only. The extract added nothing the title did not, and carried all
  of the above.
- **"firecrawl verified"** was rendered as a badge under every proof page. That
  is the scraping vendor's name. The badge is gone; the stored value is
  untouched because nothing renders it now.
- **The "content" badge** said the same word on every row — `action_type` is
  always `content` for audit-written actions. Gone.
- **"1 of 1 competitors have this"** is a sample of one dressed as a pattern,
  and on a free audit it can never be anything else. Hidden below three
  competitors checked.
- **The card was reordered** to read as one story: the question you lost → who
  won it and why → action needed → observed evidence → proof.

---

## 5. Pro was charging for 80 answers and collecting 36

**No Pro audit had ever run on this machine.** Every one of the twelve runs on
disk was 5 questions, 1 action, 1 competitor site. The Pro figures in
`SESSION-KT.md` were measured elsewhere. The first Pro run happened in this
session.

It collected **36 answers, not 80**:

| Provider | Asked | Should be |
|---|---|---|
| openai_search | 20 | 20 |
| bedrock_claude | 12 | 20 |
| bedrock_llama | **2** | 20 |
| bedrock_mistral | **2** | 20 |

**Cause:** `recommendations.py` gave each assistant 2 shared questions plus its
own private slice of `limit - 2`. Four assistants at 20 each needs
`2 + 4×18 = 74` questions. The writer produces 30. So openai_search took 1-20,
Claude took 1, 2 and 21-30, and the last two assistants got the 2 shared
questions and nothing else. `collection_errors` was 0 throughout.

Worse than the waste: no two assistants answered the same question, so the
dashboard's provider comparison matrix could never mean anything, which is the
thing Pro is sold on.

**Fixed:** every assistant answers the same first N questions. The splitting
branch is gone.

---

## 6. Two wrong predictions about latency, and what was actually true

This is the most useful part of the document, because the reasoning was
plausible both times.

### Prediction 1: "raise the concurrency and it will speed up"

A Pro run creates 20 openai_search tasks (one per question) and 3 Bedrock
tasks. `--provider-concurrency` was 5, so 23 jobs queued in waves. Raising it
to 20 looked obviously right.

**Measured: 298s → 635s.** Worse, not better.

### What was actually happening

Each Bedrock model sends **one call containing all of its questions**, and a
model writes its reply one token at a time. Twenty answers in one response is
twenty answers written one after another. There was only ever *one job per
model to hand out*, so more workers had nothing to give them. Giving each model
20 questions instead of 2 made that single call three times longer.

Two of the three models could not hold the required JSON shape at 20 questions
and fell into a slower prose-plus-analyser path, adding more.

### The fix that worked

Chunk each Bedrock model's questions into groups of five, so they become
separate jobs that run alongside each other. `BEDROCK_BATCH_SIZE = 5`,
overridable via `GEO_BEDROCK_BATCH_SIZE`.

**A/B measured on identical questions, Bedrock only, no web search:**

```
A  one big call per model   443s   60 answers   20 of 60 used the fast path
B  chunks of 5               45s   60 answers   60 of 60 used the fast path
```

Ten times faster, and better output: at five questions per call all three
models held the structured format, so nothing fell back.

`max_tokens` for a Bedrock batch now scales with the batch size rather than
sitting at a flat 4000, so a larger batch cannot truncate into the
one-question-at-a-time fallback.

`--provider-concurrency` is now `AUDIT_PROVIDER_CONCURRENCY` (default 20) in
`lib/constants.ts`. It was necessary but useless on its own.

---

## 7. Web presence (step 7) — what it is for, and why it was measuring the wrong thing

The user's framing, which is the right one: this step measures **how much the
internet writes about a company**, because that published footprint is what AI
assistants have read. A company nobody writes about is a company no assistant
can describe.

Against that goal, the three template queries were close to backwards:

```
"X" official website        ← asks for their own site
"X" <category>              ← usually returns their own site
site:reddit.com "X"         ← third-party, often empty
```

Two of three aimed at the company's own website. On a live run **18 of 22
"mentions" were the company's own pages**. The number was measuring crawl
depth, not presence.

### 7.1 Search terms are now written per company

`generate_presence_queries()` makes **one call per company, all in parallel**,
each returning exactly 3 queries. The templates still run underneath, so a
failed or unusable response costs the extra reach and nothing else.

The prompt leads with *what the task is for* rather than the rules, and that
changed the output — it now reaches for comparison articles, review
directories, forums and industry press, and uses site filters.

**One call for all six companies was tried first and abandoned.** From
identical input it answered for 6 companies, then 3, then 1. Telling it to
cover every company did not stick — the same failure this codebase has already
paid for. One call per company cannot skip a company. It is also faster
(1.3-1.8s against 2-4s).

Code checks each query before use: must contain the company name, under ten
words, not a duplicate. Rejections are recorded.

### 7.2 A gate, because the only test was "is the name on the page"

That is how `vintracapital.com` (an investment firm) and `vintranordic.com`
(a website and chatbot builder) were both counted as mentions of Vintra, a
video analytics company.

`gate_entity_mentions()`:

1. Two or more industry words on the page → keep, no model needed.
2. Everything else → one model call per company, covering all its unclear
   pages, asking only "is this page about *this* company".
3. No answer for a page → dropped and marked `unchecked`.

Rejected pages are kept on the entity as `rejected_mentions` with a reason, so
a thin result can be read as "we found junk and removed it" rather than "this
company has no presence".

**The first version auto-accepted any page on the company's own domain. Do not
reintroduce that.** It waved `vintracapital.com` straight through, because the
pipeline had resolved *that* as Vintra's official website. The official domain
is itself a guess made from name similarity, so it cannot be the strongest
signal.

### 7.3 Measured, full flow

```
                        third-party mentions   total   elapsed
old templates, no gate           4              22      ~15s
written queries + gate          13              36      ~42s
```

Found for the first time: `"Avigilon vs Axis Communications"`,
`"Verkada vs Axis vs Coram"`, a Memoori analyst report on Hikvision,
`"Top Vintra Alternatives"` on CB Insights, and a Frost Radar score for Vintra
in Campus Safety Magazine.

The gate dropped four, all correctly: both wrong Vintras, and two vendor
marketing blogs that name-drop competitors to sell themselves.

Cost: ~12 small `gpt-4.1-mini` calls, about 30 extra seconds on a Pro run.

---

## 8. Frontend problems found by reviewing every page with real data

The app was run with two real audits imported into a scratch database and every
page opened as both a Free and a Pro account. Fixed:

- **The upgrade page started a paid Pro audit on page load.** A refresh, a
  back-then-forward, or a second tab each paid for another run. It now waits
  for a click and offers a retry if the run fails.
- **Question counts were the old Pro size.** "Estimated AI checks" capped at 5
  where a Pro run asks 20, so the monthly allowance was under-counted four
  times over. The progress widget said "5 questions" during a 20-question run.
- **The add-website box promised Pro users "Five buyer questions"** while
  sending 20. The page heading did the same.
- **Country and language pickers did nothing.** They were held in state and
  never sent, and `geo_audit` has no flag for either. Removed, with a comment
  saying to restore them when the runner supports them.
- **"Buyer question library" implied the listed questions would be asked.**
  Every run writes fresh questions and replaces them. Relabelled "Questions
  from your last audit", with a line saying what will actually happen.
- **A website whose first audit failed could never be audited again** — the
  start button was disabled on an empty question list, and questions only exist
  after a successful run.

---

## 9. What is NOT done

Ordered by what I would do next.

1. **The Bedrock chunking fix has not been verified in a full Pro run.** The
   10× improvement was measured on the answering step alone (A/B, Bedrock only,
   no web search). A full run should land near 4 minutes with 80 answers,
   against 635s for the broken version and 298s for 36 answers. **Run it and
   confirm before trusting the number.**

2. **The web presence changes have not run inside a full audit either.** They
   were exercised by calling `collect_web_presence` directly with a previous
   run's inputs. Nothing suggests trouble, but the wiring has not been proven
   from `cli.py run`.

3. **Own-site pages are still counted as mentions.** IntelliSee shows 7, all
   `intellisee.com`. Vintra shows 3, all third-party and worth far more. These
   need to be two separate numbers before the comparison means anything. This
   is the smallest change with the largest effect on the measurement.

4. **`official_website` resolution is wrong for ambiguous names.** Vintra
   resolved to `vintracapital.com`. Step 8 crawls that resolved site for
   competitor evidence, so an investment firm's website was one step away from
   being quoted as proof about a video analytics company. Feed the same-company
   check into site resolution.

5. **DuckDuckGo fails on every query** — 36 of 36 on the last run, 18 of 18
   before that. The AWS AgentCore fallback catches all of them, so nothing
   breaks and nothing warns. You have no primary search provider.

6. **Nothing records what a run costs.** Every `estimated_cost` is null. The
   $0.075 and $0.29 figures in `SESSION-KT.md` were measured by hand. A paid
   product cannot price itself this way.

7. **The Sources & Mentions page is unreachable.** `/dashboard/brands/[id]/
   citations` is complete and Pro-gated but appears in no navigation —
   `brand-nav.tsx` has five tabs and this is not one of them. The "Sources
   found" tile on the summary page is not a link either.

8. **The paywall leaks.** "Audit Details" is not Pro-gated and shows every raw
   AI answer and every citation URL, while the Sources page is locked and the
   summary tile says "Details available on Pro". Decide which is true.

9. **The competitor chart recomputes mentions by substring name matching**
   (`brands/[id]/page.tsx`), so bar lengths can disagree with the numbers
   printed beside them, and an empty name matches everything. Python already
   has the correct counts.

10. **kenesis.ai yields only 3 pages** (`/`, `/about`, `/contact`) even at
    `--max-pages 10`. A July run also read `/platform`. So "you have no
    use-case pages" is being judged from three pages. Either the page is gone
    or the crawler is missing it.

11. **Public report footer claims the wrong providers** — "Sampled from OpenAI,
    Gemini, and Perplexity APIs" on a public, shareable page. The summary
    header's "audited <date>" shows the import date, not the audit date.

12. **About one answer in six yields no company names.** Unchanged between the
    A and B runs, so unrelated to the batching work.

---

## 10. Things that are true and easy to get wrong

- **`investigation_priority` and `top_competitors` are different orders on
  purpose.** Do not "fix" one to match the other.
- **`affected_prompts` sits at the top level of a recommendation in the Python
  export, and under `evidence` in the database.** The frontend importer moves
  it. Checking the wrong one wasted time in this session.
- **`evidence_validation.requested_refs` legitimately contains `ev-00N`.** It
  is internal bookkeeping and nothing renders it. Only the written fields were
  ever the problem.
- **PowerShell variable names are case-insensitive.** `$b` overwrote `$B` and
  cost a test run. Use distinct names.
- **A Bedrock "group" is one API call carrying every question in it**, not one
  call per question. This is the fact both latency predictions got wrong.
- **`--max-competitors-crawled` has no default**, so Pro passes `None`, so the
  investigation priority is not consulted on Pro — it crawls the top five by
  mention count. A winner outside that five is still missed on Pro.
- **`frontend/ranking/db/migrations/0001_init.sql` is untracked and is not from
  this session.** It is the AWS migration work. Left alone deliberately.

---

## 11. How this session worked, for whoever picks it up

The user is right to push. Three of the most valuable changes came from being
corrected:

- *"the goal is to know why one's website is not there but someone else's is"* →
  led to scoring competitors inside lost questions instead of overall mentions.
- *"the search is used to know how active the company names are on the internet"*
  → reframed step 7 from verification to measurement, which is what exposed
  that 18 of 22 mentions were the company's own pages.
- *"can we use the old questions and just test the answering part"* → turned a
  ten-minute full-run guess into a cheap A/B that produced the 443s → 45s
  number.

Two claims made in this session were wrong and were caught by measuring:
raising concurrency would speed up Pro (it doubled the time), and Bedrock calls
were sequential per question (they are one call for all of them). Measure
before believing a latency argument, including one that sounds obvious.
