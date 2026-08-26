# Local work merged on 2026-08-26

This note records the main work completed locally before merging the latest
`main` branch.

## Audit work

- Improved company-name output and merging so naming variations are grouped
  before final mention counts are calculated.
- Added a normal website fetch first and kept Firecrawl as the fallback.
- Reduced company-profile work by selecting a small set of useful pages before
  building the profile.
- Added one-call question generation, user-written questions, and reuse of
  questions from previous audits. Every audit keeps its own question copy.
- Kept the low-cost free audit separate from the full paid audit.
- Improved the paid report research so recommendations use buyer questions,
  audited-company evidence, competitor evidence, and valid page references.

## Product work

- Added weekly monitoring with five saved questions and user-selected AI
  providers.
- Added repeated-change alerts for score, competitor, mention, and citation
  changes. Alerts explain that AI responses may naturally vary.
- Added check reservations, settlements, retry safety, duplicate-run
  prevention, and fair sharing between concurrent audits.
- Added shared Valkey support and production worker guidance for handling
  traffic across several workers.
- Improved sign-in, checkout continuation, audit question selection, data
  export restrictions, monitoring setup, and billing presentation.

## Live checks completed

- Free and paid audits were run through the main flow.
- Kenesis and Tally weekly monitoring ran together successfully.
- Each weekly website run used five questions across three providers: 15
  checks per website and 30 checks for both.
- Three comparable monitoring rounds completed without failures. Duplicate
  weekly runs were blocked and alerts were created only after repeated changes.

## Main-branch plan decision retained

The local proposal used $49/month, two websites, and 700 checks. The latest
`main` branch instead defines Plus as $79/month, one website, 500 included
checks plus 200 early-bird bonus checks. The `main` branch decision was kept.

## Still pending

- Enable and verify Gemini and Perplexity before advertising them as live.
- Add safe Firecrawl backup-key switching and verify the current key.
- Deploy database updates before the new web and worker versions.
- Test the shared Valkey connection and worker scaling inside AWS.
- Run post-deployment checks for sign-in, checkout, email alerts, one free
  audit, one paid audit, and one scheduled monitoring run.
