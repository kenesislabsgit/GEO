# GEO audit handover — 22 August 2026

## Purpose

The product measures whether AI assistants recommend an audited company for
real buyer questions. It counts mentions, identifies the companies that win,
collects public evidence, and writes five website or public-visibility actions.
The web app stores the final export in PostgreSQL and renders it as the audit
report.

This handover describes the state being pushed to `main`, the work completed in
the recent sessions, the latest full audit, and the problems still to solve.

## Local setup

The web app and audit worker run separately from the same folder.

```powershell
cd C:\Users\Dhiya\Desktop\PROJECTS\GEO\frontend\ranking
npm install
npm run dev
```

In a second terminal:

```powershell
cd C:\Users\Dhiya\Desktop\PROJECTS\GEO\frontend\ranking
npm run worker
```

Open `http://localhost:3000`.

The web app needs its local environment settings, including `DATABASE_URL`.
The worker also needs Python and the provider credentials in `GEO/.env`.

```powershell
cd C:\Users\Dhiya\Desktop\PROJECTS\GEO\GEO
python -m pip install -r requirements.txt
```

Never commit either environment file. Audit outputs and experiment run data are
also intentionally ignored because they can contain scraped text and complete
provider responses.

## Current end-to-end audit flow

1. The user enters a website in the web app. The app creates a queued scan in
   PostgreSQL.
2. The separate worker claims the scan and starts the Python audit engine.
3. The audited website is read with the normal crawler first. Firecrawl is used
   only when the normal read fails or returns too little useful text.
4. Candidate site links are ranked. One short AI call selects up to five pages
   that best explain the company. Only those pages are used to build the company
   profile.
5. Buyer context and the complete question set are generated together in one AI
   call. The older multi-call route remains as a fallback when the one-call
   result is invalid.
6. The selected assistants answer their question batches in parallel. Each
   structured answer should contain a common public company name. OpenAI search
   may also provide official websites and citations.
7. OpenAI citation URLs are checked while assistant answers are still running,
   instead of waiting for the entire answer stage to finish.
8. Written company-name variants are grouped. Simple safe candidates are
   prepared first, then an AI review handles ambiguous groups. This is designed
   for cases such as a product name plus its extended public name without
   merging unrelated companies that merely share a word.
9. Two research jobs start together: company-name merging and wider-web
   research. Official competitor websites are also downloaded while wider-web
   research is running. Only missing official websites need a later follow-up.
10. Wider-web research receives the audited company and the top five
    competitors. It learns each company from the available official site,
    searches public mentions, extracts passages around the company name, and
    keeps only pages that refer to the correct company.
11. The system creates the comparison data and source inventory for the final
    writer.
12. The report research agent opens selected questions, requests the relevant
    company source lists, reads page content in batches, and saves an evidence
    note after each useful comparison.
13. A fresh final writing call receives the saved evidence notes and writes five
    recommendations.
14. The backend validates evidence IDs, attaches real URLs, creates the frontend
    export, and imports it into PostgreSQL.

## Main changes completed

### Company profile speed

- Candidate pages are no longer all sent to the profile writer.
- A small selection call chooses at most five useful pages first.
- The profile call receives less text while preserving the pages that explain
  the company, buyers, services and evidence.
- Profile fields that are still used later were preserved.

### Question generation speed

- Buyer analysis and all questions are produced in one call.
- The generated set is validated for count, buyer language, category coverage,
  repeated meaning and company-name leakage.
- The older two-step generation remains as recovery rather than the normal path.
- Tests across earlier audited websites found the one-call questions comparable
  to the older questions at lower latency.

### Assistant answer handling

- Structured answers request a common public company name to reduce easy naming
  variants before merging.
- Citation verification can overlap the provider calls.
- Provider results keep parse errors and citation-check outcomes for debugging.
- A known remaining risk is that an assistant can mention a company in its prose
  but omit it from the structured list. We deliberately did not add brittle
  substring counting because aliases, common words and product names create
  difficult false matches.

### Company-name merging

- The merge call receives grouped candidates instead of a completely flat list.
- Exact lowercase names are grouped first.
- Safe shared-name candidates are presented clearly to the AI while unrelated
  names are kept separate.
- The production flow uses the tested candidate preparation.
- Earlier tests handled cases such as a base name plus a product suffix better
  than the older merge-only method.

### Wider-web research

- The standalone web-mention experiment was connected to the production audit.
- It receives each company name, an official website when available, and one
  real question-and-answer example that recommended the company.
- When an official website is missing, it searches broadly for the company,
  reads candidate sites, and selects the one matching the market context.
- It then creates wider-web searches, fetches results in parallel, extracts
  nearby passages, and uses those passages to decide which mentions are valid.
- The result keeps accepted URLs, reasons and supporting passages. Rejected and
  uncertain URLs are retained only in debugging output.
- Audited-company wider-web research and competitor research are separate, so
  both sides can be passed to the final writer.

### Crawling and Firecrawl

- The normal crawler is always attempted first.
- Firecrawl is a fallback for failed or empty pages, including pages selected by
  the final writer.
- Page fetches have bounded timeouts so one bad site does not hold an audit
  indefinitely.
- Competitor website downloads start while company merging and wider-web work
  are running. This removed almost all remaining competitor-fetch tail time in
  the latest full audit.

### Evidence-first final writer

- The writer no longer receives a huge pasted list and immediately writes.
- It can request full answers for selected questions.
- It can request the source inventory for the audited company and each top-five
  competitor.
- It chooses pages using the address and title, then opens the actual text before
  making claims.
- It saves a persistent evidence note after each page batch. Each note records
  the related questions, competitor, both page IDs, summaries, comparison,
  possible action and confidence.
- A fresh writing call receives the evidence notes. It is told to write five
  distinct website or legitimate public-presence actions and not product work.
- The backend resolves page IDs to stored URLs. The model should never create a
  URL from memory.

### Frontend and operations

- Free audits now request five actions instead of three.
- Progress text includes the new evidence and research steps.
- The root page asks Dark Reader not to rewrite icons before React hydration.
  The reported SVG mismatch was caused by Dark Reader adding attributes before
  the client loaded.
- Local scripts can inspect an imported audit and import an engine export into a
  user account in the same form used by the worker.

## Latest production-style audit: Buffer

The newest full run audited `buffer.com` with the Pro+ defaults available in the
local environment.

- Total elapsed time: **419.391 seconds (6 minutes 59.4 seconds)**.
- Website crawl: 10.877 seconds.
- Company profile: 29.314 seconds.
- Question generation: 19.274 seconds.
- Assistant answers plus overlapping citation checks: 112.463 seconds.
- Company-name merge: 20.665 seconds.
- Wider-web research: 50.399 seconds.
- Competitor evidence tail: 0.009 seconds.
- Final evidence research and writer: 172.204 seconds.
- Final checks and export: about 1.7 seconds.

The final writer remains the slowest part. Its 172 seconds buys the page reading,
saved evidence notes and final recommendation call. The earlier steps now overlap
more work, but the whole audit is still above the desired latency.

The run collected 100 answers from five working providers. Four configured
providers failed all 20 questions because these local keys were missing:

- `PERPLEXITY_API_KEY`
- `XAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `MOONSHOT_API_KEY`

The audit therefore finished as partial rather than as a complete nine-provider
Pro+ audit. It scored 49.1 using the five providers that worked. The result was
imported into PostgreSQL under the existing account and appears as Buffer in
Audit history.

## Critical open defect: competitor proof disappears

This is the first issue to fix next.

The research notes for Buffer were correctly saved with question IDs, winning
competitors, competitor page IDs and Buffer page IDs. The fresh writing call
also returned the intended page pairs. However, it placed evidence-note IDs such
as `finding-01` in the field that must contain buyer-question IDs such as `q-03`.

The later safety check could not reconnect `finding-01` to a buyer question. It
therefore could not confirm which competitor won. Because the audited company is
always allowed, the check kept the Buffer page and removed the competitor page.
The frontend consequently shows one Buffer link and zero affected questions for
all five recommendations.

This is not a URL lookup problem. The page ID-to-URL lookup worked. It is a
contract mismatch between the evidence note and the final writing result.

The safe fix is to stop asking the final writer to repeat question and page IDs.
Each evidence note already owns these values. The final writer should return the
stable evidence-note ID and prose only. The backend should copy the question IDs,
competitor, competitor page ID and audited-company page ID from that saved note.
If either page cannot be resolved, the recommendation must be rejected instead
of silently publishing one-sided proof.

### Correct Buffer evidence pairs

1. Community inbox: questions `q-03`, `q-08`, `q-19`; Agorapulse inbox page
   `p-066`; Buffer small-business page `p-017`.
2. Agency approvals: questions `q-05`, `q-10`, `q-15`; Sprout Social agencies
   page `p-051`; Buffer agencies page `p-014`.
3. Content ideas: question `q-07`; Later pricing/features page `p-083`; Buffer
   Ideas help page `p-015`.
4. Agency analytics: question `q-17`; Hootsuite agencies page `p-033`; Buffer
   agencies page `p-014`.
5. Mobile app: question `q-12`; Hootsuite plans page `p-037`; Buffer mobile help
   page `p-022`. The Hootsuite page is weak evidence and should be replaced after
   reading a stronger official mobile page.

The assistants really did name these competitors for the connected questions.
The final rejection was incorrect.

## Recommendation-quality observations

Fixing the IDs will restore the missing questions and competitor links, but it
will not make every recommendation correct by itself.

- Some evidence notes were saved before later parts of the same Buffer page were
  read. The later content was not used to revise the earlier note.
- Missing wording on a page was sometimes treated as proof that Buffer lacked a
  product feature. The writer must recommend documenting only capabilities that
  Buffer genuinely supports today.
- The mobile recommendation used a question where Buffer was named by all five
  working assistants. It was not a real loss and should not have become a gap.
- The Ideas action and mobile-app action overlap.
- The Hootsuite plans page did not clearly prove the mobile claim made from it.
- The agency approval and agency analytics actions both use the same Buffer page.
  They may be distinct, but the uniqueness check should be stricter.

The main cause is upstream evidence selection. The final writer only rewrites
the saved notes, so it cannot recover when those notes are weak. Research should
finish reading the relevant page before saving, reject questions the company did
not lose, and allow a candidate to be marked weak, duplicate or unsupported
instead of manufacturing a fifth gap.

## Other open reliability work

### Provider availability

The Pro+ interface can select providers whose server-side keys are absent. A new
audit then spends work on calls that must fail and finishes partial. The app
should either show only configured providers or reject the audit immediately
with a clear missing-provider message.

### Firecrawl credentials

A first attempt to audit `sentry.io` failed before AI calls. The normal crawler
could not obtain useful content, then Firecrawl returned HTTP 401 for the local
token. Credits do not matter when the token itself is invalid. Replace or verify
the token and keep normal-crawler-first behavior.

### Full mention recovery

Counts mainly use structured company lists. Name merging is working better, but
malformed structured answers can still omit a company that appears in prose.
Do not solve this with simple substring matching. Any future recovery needs
company-aware aliases, word boundaries, conflict handling and tests across many
audits.

### Parallel production load

Parallel work inside one audit is active and was measured. Three simultaneous
Pro audits have not yet been proven under production limits. Before increasing
worker concurrency, measure provider rate limits, database connection use,
normal crawler concurrency, Firecrawl limits, memory and total cost with actual
numbers.

## Recommended next work, in order

1. Make the backend attach questions and evidence pages from the saved evidence
   note. Never let final prose rewrite these IDs.
2. Add a failing test for the Buffer case: a valid competitor page must remain
   attached and affected questions must not be empty.
3. Tighten research acceptance so only genuinely lost questions with a supported
   two-page difference can become findings.
4. Re-run only the Buffer final stage. Confirm all five cards show the correct
   questions and both links. Review the text again after the evidence fix.
5. Make provider selection aware of configured keys.
6. Repair the Firecrawl token and retest a site that the normal crawler cannot
   read.
7. Run two or three new audits across unrelated categories before judging system
   quality. Compare question quality, counts, evidence, repeated actions and
   latency across all runs.

## Tests and debugging data

The code includes focused tests and reusable experiments for:

- common-name output and candidate company merging;
- wider-web company discovery and passage validation;
- profile page selection;
- one-call versus older question generation;
- citation checking during provider execution;
- parallel merge, wider-web and competitor-site work;
- evidence-first and structured final-writer approaches;
- evidence ID validation and frontend export behavior.

Generated experiment runs are not committed. They are large, repeatable, and
may contain full model prompts, responses and scraped website text. A developer
can regenerate them with the experiment entry points after setting the required
credentials.

Before release, run the Python tests, frontend tests, type checking and a real
audit. A previous complete Python run passed 190 checks, with one Windows temp
folder permission cleanup error outside the product logic. Reconfirm after the
next ID fix.

## Handover state

The system is substantially faster and more evidence-aware than the earlier
paste-everything writer. The newest Buffer run proves the full production path,
database import, company-name merge, wider-web agent, overlapping fetches and
tool-based research all execute together. It also exposes the next concrete
work: preserve the saved question/evidence package through the final response,
then strengthen which research findings are allowed to reach the writer.
