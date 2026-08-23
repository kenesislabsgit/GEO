# GEO audit multi-day engineering handover — 23 August 2026

## 1. What this product is trying to achieve

Arcanoris audits how often AI assistants recommend a company for realistic
buyer questions. It is not meant to be a generic SEO checker. Its core value is
to connect four things:

1. A real buyer question.
2. The audited company losing or appearing less often.
3. A competitor being recommended instead.
4. A public-information difference that can be demonstrated from both sides.

The ideal paid recommendation is therefore:

> For this buyer need, the competitor supplied stronger public evidence than
> the audited company. Here are the two pages that prove the observable
> difference, and here is one website or public-visibility change the audited
> company can safely make.

The system must not claim that a page caused an AI recommendation. It can only
say that the competitor was recommended and that its public page provides
clearer evidence for the buyer need. The resulting recommendation is a
defensible possible improvement, not a guarantee of future AI visibility.

The engineering goals throughout these sessions were:

- increase recommendation accuracy and traceability;
- keep free audits useful without making them expensive;
- reduce paid-audit latency without removing evidence checks;
- prevent company-name variants from corrupting counts;
- keep normal web reading as the first choice and Firecrawl as a fallback;
- retain enough intermediate data to investigate every bad result;
- allow several customers to run audits together without one audit owning all
  provider capacity;
- prepare the worker tier to grow and shrink with traffic in AWS.

## 2. The mental model and important terminology

### Audited company

The website entered by the user. Its pages are first-party evidence about what
the company publicly communicates today.

### Assistant answer

The full response returned for a buyer question. The response also contains a
structured list of recommended companies. OpenAI web-search answers can include
official websites and answer-attached citation URLs.

### Mention count

How many measured answers recommended a company. Counting starts from the
structured company list, then name variants are grouped. This is safer than a
simple text search but still depends on assistants returning valid structured
data.

### Official website

The main company website found in the assistant result or later discovered and
verified from company context.

### Own-website pages

Pages belonging to the audited company or a competitor's official website.
These are read to understand products, use cases, buyers, proof, documentation,
pricing, integrations and other public positioning.

### Assistant-cited pages

URLs attached by the searching assistant to a particular answer or recommended
company. They may be official pages or third-party pages. A citation must still
be downloaded and checked before it can support a report claim.

### Wider-web mentions

Independent search results found from search terms created for the audited
company and top competitors. They are separate from assistant citations. The
system extracts passages near the company name and verifies that the passage is
about the correct company rather than another entity with a similar name.

### Evidence page ID

A stable internal ID assigned to a stored page. Models select IDs. The backend
owns the ID-to-URL lookup and should never trust a model to recreate a URL.

### Evidence map

A saved analysis produced after reading question and page batches. It records
the buyer question, winner, audited company, both pages, what each page proves,
the direct difference, why the difference matters, and confidence. It prevents
the final writer from having to remember every page read earlier.

## 3. Current end-to-end paid audit flow

### 3.1 Queue and worker

The web application creates a scan row in PostgreSQL. The request does not run
the Python audit inside the web server. A separate long-running worker claims a
queued scan, records heartbeats, starts the Python engine, imports the finished
export, settles usage and records progress.

The claim query is safe for several worker processes. PostgreSQL row locking
prevents two workers from taking the same scan. A stale-job reaper returns work
to the queue when a worker dies. Cancellation, retries and attempt limits are
stored with the scan.

### 3.2 Website reading

The audited website is read with the standard crawler first. Firecrawl is used
only when the standard read fails or returns too little useful content. Page
reads have bounded timeouts so a single URL cannot wait forever.

The home page and discovered internal links form a candidate set. A small AI
selection call chooses at most five pages that best explain the company. The
profile builder receives those pages rather than every crawled page.

This selection was introduced because sending all pages increased tokens and
latency without reliably improving the fields used later. The selection is not
based on a rigid list of URL words. The model receives a short page inventory
and chooses the pages most useful for understanding that company.

### 3.3 Company profile

The profile call describes the company, its offer, buyers, category and market
context. Only profile fields used later were retained. The profile provides
context for buyer questions, company identity, competitor interpretation and
web research.

The current profile approach uses two fast calls:

1. Choose up to five useful pages from a short inventory.
2. Build the profile from the downloaded content of those pages.

### 3.4 Buyer-question generation

Buyer context and the full question set are generated in one call. The older
two-call approach remains as recovery if the combined output is invalid.

Generated questions are checked for:

- the requested count;
- natural buyer wording;
- category and use-case spread;
- repeated meaning;
- accidental use of the audited company's name;
- compatibility with the selected market and language.

Tests across earlier audited websites found the single-call questions
comparable to the old set while reducing latency.

### 3.5 Assistant answers

The selected providers answer the same question set so recommendation rates are
comparable. Work is parallelized by provider and question group. OpenAI search
usually uses one question per call, allowing all questions to progress at the
same time. Hosted Bedrock models can answer grouped questions.

The structured result asks for a common public company name. This reduces easy
variants before the merge step. It does not remove the merge step because
independent assistants may still return names such as a base company, product
name, former name, plan name or renamed brand.

OpenAI citation checks begin as soon as an answer arrives. They do not wait for
all assistant calls to finish. Provider failures, parse failures and citation
checks remain stored for debugging.

### 3.6 Company-name grouping and counting

Exact lowercase names are grouped first. Safe candidate groups are then
prepared for AI review. The AI receives the counts and surrounding company
context and decides which names refer to the same public company.

The intended behavior is:

- combine harmless formatting and extended-name variants;
- combine an old and new public name when they clearly refer to one company;
- keep separate products or companies that merely share one word;
- preserve the original answer rows for later checking;
- calculate final mention counts from the reviewed groups.

The system deliberately avoids plain substring matching over answer prose.
Common words, short brand names and product-family names make that unsafe.
Malformed structured output can still omit a company that appears only in
prose. That remains an open counting edge case.

### 3.7 Competitor and wider-web research

After counts are available, the top five competitors are selected. Company-name
merging, wider-web research and official competitor-site downloads overlap
where their dependencies allow it.

The wider-web agent receives:

- audited company and top-five competitor names;
- known official websites, or `not yet found`;
- one real buyer question and answer where each competitor was recommended;
- the reason this research matters to the whole audit;
- tools for web search and passage extraction.

If an official site is missing, the agent performs a broad company search,
reads candidate sites and selects the site consistent with the question and
market context. Failure to find one should not trap the whole run; that company
can be skipped with a recorded reason.

The agent then creates general web-mention search terms. Search results are
downloaded in parallel. For each page, the passage tool looks for the company
name or close aliases and returns nearby text. The agent classifies whether the
passage is really about that company. Accepted output keeps the URL, selection
reason and supporting passage. Rejected and uncertain pages remain only in
debugging data.

Audited-company wider-web mentions and competitor wider-web mentions are both
available to the writer. Assistant citations, official pages and wider-web
mentions remain distinct source types.

### 3.8 Evidence-first paid writer

The paid writer was changed because a single large prompt repeatedly focused on
the audited company, ignored useful competitor pages, produced overlapping
actions or attached the wrong evidence.

The current intended flow is:

1. Read the measured questions and identify genuine losses involving top-five
   competitors.
2. Request the source inventory for the relevant audited company and
   competitor.
3. Choose likely pages using URL address and title.
4. Open actual content. A title is only a hint; it is never proof.
5. If a page is unhelpful, open a better candidate rather than forcing a claim.
6. Save a detailed evidence note after a useful comparison.
7. Group questions that failed for the same underlying reason.
8. Reject weak, unsupported or duplicate candidate gaps.
9. Give a fresh final writing call the evidence map.
10. Write five different website or legitimate public-visibility actions.

Every paid recommendation should identify the lost buyer need and include an
audited-company page plus a competitor page when a two-sided comparison is
available. The model may cite every useful page it actually read. If it cannot
confidently support both sides, it should choose a stronger action instead of
publishing an unsupported one.

The five actions must be meaningfully different. If several questions share one
root problem, they belong in one action. The writer must then investigate other
lost questions and other gap types rather than splitting the same idea into
several cards.

Recommendations are limited to communication, website and legitimate
public-presence improvements. The writer must not invent product capabilities
or tell the company to build a feature merely because a competitor has it.

## 4. Paid-writer problem that remains important

The Buffer production-style run proved that useful evidence can still disappear
after research.

Research correctly saved question IDs, competitor page IDs and audited-company
page IDs. The final call then put evidence-note IDs such as `finding-01` into a
field that expected buyer-question IDs such as `q-03`. The later safety check
could not reconnect the recommendation to the measured winner. It removed the
competitor source while retaining the audited-company source.

This was not a bad URL lookup. The lookup worked. It was a contract mismatch
between saved research and final output.

The durable fix should be:

- the final writer returns a stable evidence-note ID and prose;
- backend code copies question IDs, winner and both page IDs from that saved
  evidence note;
- backend code resolves real URLs from the stored catalog;
- a recommendation is rejected if its required evidence package cannot be
  resolved;
- the writer is not asked to repeat IDs already owned by the evidence note.

The co-founder is currently working on this paid final layer. Coordinate before
editing the same area.

## 5. Free audit design and current production path

The free audit is intentionally separate from the paid research writer. Its
goal is one trustworthy preview at low cost, not five deep findings.

The free path now does:

1. Read up to six audited-company pages.
2. Build the smaller company profile.
3. Generate five buyer questions.
4. Ask ChatGPT with web search for those five questions.
5. Count mentions from those five answers.
6. Skip the expensive company-name merge because one provider supplies the
   small free set.
7. Skip independent wider-web research.
8. Find up to three genuine lost-question candidates.
9. Download an answer-attached citation for the recommended competitor.
10. Give one small call those competitor passages and a small set of audited
    pages.
11. Produce at most one evidence-backed website action.

The free writer may return no action. It is better to show no recommendation
than manufacture one without two usable pages.

The free action must:

- use a real lost question;
- use the competitor that was actually recommended for that question;
- quote exact supporting text from the selected competitor page;
- quote exact supporting text from the selected audited-company page;
- only recommend communicating a capability proven on the audited site;
- use stored page IDs and backend-owned URLs;
- stay short enough to be a useful preview.

The backend checks that both returned quotes appear in the selected page text.
Invalid IDs or invented quotes cause the action to be discarded.

### Free audit cost and normal latency

The engine estimates approximately **$0.15 per free audit** with the current
five-question configuration. An earlier individual Buffer run took 110.134
seconds:

- website crawl: 12.394 seconds;
- profile: 27.964 seconds;
- question generation: 13.054 seconds;
- answers and citation checks: 33.266 seconds;
- final free writer: 23.321 seconds.

Individual free audits should normally be described as roughly 1.5–2 minutes,
not as a guaranteed time.

## 6. Traffic handling implemented in this session

### 6.1 Why the traffic control was needed

Starting many audits with unrestricted `gather` calls can let one audit consume
all provider capacity. A per-process semaphore is insufficient once AWS runs
several worker tasks because every task would believe it owns the full limit.

The chosen near-term solution keeps the existing audit steps and controls every
AI call through one shared capacity layer. It avoids a risky rewrite into a
large persistent task graph immediately before deployment.

### 6.2 Local worker controller

Each worker exposes an internal loopback-only acquire/release endpoint. Python
requests a lease before every OpenAI, compatible-provider, Anthropic, Gemini or
Bedrock call and releases it afterward. The child receives an audit ID so calls
can be grouped fairly.

Within one worker, pending calls are stored per audit and selected in rotating
order. This prevents one busy audit from repeatedly taking every newly freed
slot.

When only one audit is active, it can use all configured spare slots. Capacity
is not reserved for imaginary traffic. When several audits are active, each
continues receiving turns.

### 6.3 Shared Valkey control

AWS ElastiCache Serverless Valkey is the shared source of provider capacity
across worker replicas. Every worker connects with TLS and the same credentials.

The shared controller tracks, per provider:

- active call leases;
- active audits;
- active leases belonging to each audit;
- request tokens replenished over time;
- estimated model-token capacity replenished over time.

For each request it:

1. Removes expired leases.
2. Registers the waiting audit.
3. Checks total concurrent calls.
4. Calculates a fair per-audit share from current active audits.
5. Checks that audit's active calls.
6. Checks request-per-minute capacity.
7. Checks estimated token-per-minute capacity.
8. Atomically grants or delays the lease.

All keys involved in one atomic operation use the same Valkey cluster hash tag,
which is required for serverless cluster operation.

Leases expire automatically if a process dies before releasing them. Losing
Valkey temporarily falls back to the safer local limit so paid audits do not
stop completely. This fallback cannot enforce a true global limit across
several machines, so Valkey availability must be monitored.

### 6.4 Retries and failure handling

Provider calls share retry behavior. Temporary network failures, rate limits
and selected 5xx errors retry up to three times with backoff and jitter.
Permanent request errors are not blindly retried. Provider request IDs are
logged when available. The capacity lease is held only for the attempted call
and is released afterward.

### 6.5 Worker scaling

Workers emit structured queue measurements every 30 seconds:

- queued audits;
- running audits;
- total outstanding audits;
- oldest queued age;
- local active audits;
- local free audit slots.

An AWS deployment template was added for a dedicated ECS worker service. It
keeps two workers warm, can scale to ten, adds workers when audits remain queued,
and removes one only after no audit is queued or running for ten minutes.

The metric uses the maximum value in a minute because several workers report
the same database-wide queue depth. Summing those samples would falsely
multiply demand.

The worker service must remain separate from the web service. It needs the same
database, the same Valkey cache, Python, audit code and provider credentials.

### 6.6 AWS cache state

An ElastiCache Serverless Valkey cache and restricted cache user were created.
The password is stored in AWS Secrets Manager. The password itself must never be
placed in Git or baked into an image.

The ECS task needs these runtime values:

- `ELASTICACHE_HOST`;
- `ELASTICACHE_PORT=6379`;
- `ELASTICACHE_USERNAME`;
- `ELASTICACHE_PASSWORD` injected from Secrets Manager.

The cache security group should allow inbound Valkey traffic only from the ECS
worker security group. Outbound traffic from the worker remains controlled by
its own security group. The cache is private to the VPC, so a local laptop
cannot perform the real multi-worker cache test without private network access.

## 7. Traffic and provider tests completed

### 7.1 Controller tests

The local controller tests cover:

- rotating turns between waiting audits;
- independent limits for different providers;
- one audit using every spare slot under low traffic;
- five busy audits all progressing without exceeding capacity;
- releasing capacity during shutdown.

All five frontend controller tests passed. Type checking and targeted linting
also passed. The Python retry and provider-slot tests passed four checks.

### 7.2 OpenAI account capacity

A bounded live probe used the configured OpenAI key and `gpt-5-mini`. A completed
response reported:

- 30,000 requests per minute;
- 180,000,000 tokens per minute.

Four simultaneous completed calls succeeded. An earlier eight-call acceptance
probe also succeeded, but it used too-small output limits and returned
incomplete responses; it should not be treated as the completed-response proof.

These headers apply to the tested account, project and model at that time. They
can change. Production settings should remain configurable rather than copying
these values permanently into code.

### 7.3 Bedrock capacity

Tiny completed calls were tested against the configured Claude, Nova, Llama and
Mistral Bedrock routes. Every model succeeded with 16 simultaneous calls and no
throttling.

This proves a lower bound of 16 concurrent tiny requests for the tested routes.
It does not prove the maximum sustained requests or tokens per minute. The AWS
user lacks `servicequotas:ListServiceQuotas`, so exact account quotas could not
be read. Grant read-only Service Quotas access or inspect the AWS console before
setting sustained production limits.

### 7.4 Ten simultaneous free audits

Ten different websites were launched at the same time through the Python free
path. This deliberately tested concurrent end-to-end website reads and OpenAI
work. It did not use the deployed PostgreSQL queue, ECS workers or shared Valkey,
so it is not the final production-worker proof.

All ten completed and produced exports. Their measured total engine times were:

- ClickUp: 104.696 seconds;
- Airtable: 129.822 seconds;
- SurveyMonkey: 134.835 seconds;
- Basecamp: 137.026 seconds;
- Intercom: 150.663 seconds;
- DocuSign: 157.396 seconds;
- Webflow: 214.067 seconds;
- Loom: 329.310 seconds;
- Hotjar: 344.727 seconds;
- Freshworks: 348.772 seconds.

Median duration was about 154 seconds. The last three were slowed by individual
OpenAI web-search calls near four minutes. Each logged one temporary network
failure, retried and completed. There were no rate-limit failures.

This result corrects the earlier partial observation made while seven had
finished: parallel free audits are not always all complete within three minutes.
Most were, while three took about 5.5–5.8 minutes due to slow web-search calls.

An earlier monitoring attempt was interrupted because its PowerShell exit-code
check treated a completed process as still pending. That first attempt was not
used as proof. The corrected run above completed all ten.

## 8. What is proven and what is not

### Proven locally

- The dedicated free path generates at most one checked recommendation.
- Ten direct free audits can run at once and all recover from temporary OpenAI
  network failures.
- The local fair controller advances five audits without exceeding its limit.
- One audit can use spare capacity when no other audit is waiting.
- All configured Bedrock routes accepted 16 simultaneous tiny calls.
- The OpenAI key has much higher published request and token limits than the
  current controller defaults.
- Type checking, linting and focused Python/TypeScript tests pass.

### Not yet proven

- Ten full Pro audits through the actual website, PostgreSQL queue, multiple ECS
  worker tasks and Valkey.
- Automatic ECS scale-out and scale-in under a real queue spike.
- Global fairness between separate AWS worker tasks.
- Sustained Bedrock RPM and TPM, as opposed to a short concurrency burst.
- Gemini and Perplexity traffic because billing/keys were not yet available in
  this environment.
- Stable behavior after worker replacement, cache interruption or an AWS task
  being killed mid-audit.

The implementation is strong enough for deployment testing, but it must not be
described as 100% production-proven until the AWS tests above pass.

## 9. Known defects and operational risks

### Paid recommendation evidence contract

The most important product defect is still the paid final-layer ID mismatch
described earlier. It can remove competitor proof even when research found the
right pair.

### Firecrawl credential

The configured local Firecrawl token returned HTTP 401 during fallback tests.
Normal-crawler-first behavior works for most sites, but a site that cannot be
read normally may fail completely until the token is replaced. Credits do not
help if authentication itself is invalid.

### Provider availability

The interface may offer providers whose backend keys are missing. A Pro audit
then spends time on guaranteed failures and becomes partial. Provider choices
should eventually reflect server configuration or fail clearly before an audit
starts.

### Counting malformed answers

The name merge is much better, but an assistant can still mention a company in
prose and omit it from structured output. A future recovery step must use
company-aware aliases and conflict checks. Do not add broad substring matching.

### Local and AWS code differ

The ECS service currently runs an older backend revision. The cache exists, but
the new worker and traffic code must be built into a new image and deployed
before AWS can exercise it.

### AWS permissions

The Bedrock API user can invoke models but cannot read Service Quotas or validate
CloudFormation. Deployment should use a role with the minimum permissions
needed for ECS, CloudWatch, Application Auto Scaling and Secrets Manager. Do not
expand the Bedrock runtime user's permissions merely for convenience.

## 10. Required AWS deployment sequence

1. Build the new web/worker image from the pushed main branch.
2. Run database migrations before rolling application code.
3. Create or update a dedicated ECS worker task definition.
4. Inject database, audit-root, provider and Valkey settings.
5. Inject the Valkey password from Secrets Manager, not plain environment text.
6. Place the worker in the same VPC and selected subnets as the cache.
7. Attach the ECS worker security group, not the load-balancer group, to the
   cache inbound rule.
8. Start two worker tasks and check worker health.
9. Deploy the queue-based scaling stack for that worker service and log group.
10. Run one free audit and one Pro audit end to end.
11. Run ten queued Pro audits and confirm several workers become active.
12. Confirm every audit advances, no scan is claimed twice and provider calls
    are shared fairly.
13. Confirm scale-in happens only after no queued or running audit remains.
14. Review 429, retry, cache, queue-age, duration, memory, database connection
    and cost logs.

## 11. Recommended production settings process

Do not hard-code one guessed number for every provider.

For each provider and model:

1. Read the real account RPM and TPM.
2. Start below the measured safe capacity.
3. Configure global concurrent, RPM and TPM limits independently.
4. Run realistic prompts, not only tiny probes.
5. Increase slowly while watching 429 responses and latency.
6. Leave headroom for retries and interactive traffic.
7. Re-measure after adding a provider, changing a model or upgrading an account.

`MAX_ACTIVE_AUDITS` controls how many audits one worker advances. It is not a
provider limit. The number of active audits, worker count and provider call
limit must be tuned together.

## 12. Immediate next work, in order

1. Finish the paid evidence-package fix with the co-founder. Make the backend,
   not the final writer, attach question and page IDs.
2. Replace the invalid Firecrawl token and test a site that rejects normal
   crawling.
3. Deploy the separate worker service with Valkey settings and two warm tasks.
4. Deploy worker scaling and verify its CloudWatch measurements.
5. Grant read-only quota visibility or record Bedrock quotas manually.
6. Configure conservative provider limits from those measurements.
7. Run ten Pro audits through the web-facing queue. Record duration for every
   stage and every audit.
8. Test one worker termination during a running audit and verify requeue.
9. Test a temporary Valkey interruption and verify safe local fallback.
10. Add Gemini and Perplexity only after keys, billing, limits and small traffic
    tests succeed.
11. Review free-audit long-tail latency. Three of ten web-search runs took about
    four minutes in the answer stage even without rate limiting.
12. Add dashboards or alarms for oldest queued age, provider retries, 429s,
    failure rate, audit duration and estimated cost.

## 13. Local commands

Web application:

```powershell
cd C:\Users\Dhiya\Desktop\PROJECTS\GEO\frontend\ranking
npm install
npm run dev
```

Worker in another terminal:

```powershell
cd C:\Users\Dhiya\Desktop\PROJECTS\GEO\frontend\ranking
npm run worker
```

Python setup:

```powershell
cd C:\Users\Dhiya\Desktop\PROJECTS\GEO\GEO
python -m pip install -r requirements.txt
```

Important checks before deployment:

```powershell
cd C:\Users\Dhiya\Desktop\PROJECTS\GEO\frontend\ranking
npm run typecheck
npm test
npm run lint

cd C:\Users\Dhiya\Desktop\PROJECTS\GEO\GEO
python -m unittest discover -s tests
```

Never commit `.env`, `.env.local`, raw audit outputs, scraped content or model
responses. Provider probes intentionally store reports under the ignored output
folder.

## 14. Final handover position

The system now has two intentionally different products:

- Free: five ChatGPT web-search questions and one small, two-page checked action.
- Pro: multi-provider measurement, identity merging, top-five competitor and
  wider-web research, evidence mapping and five deep actions.

Latency improvements were made at profile generation, question generation,
assistant citation checking, merge/web-search overlap and competitor fetching.
The paid final research remains the slowest high-value step. It should be
optimized only after the evidence contract is correct.

Traffic handling code is implemented: durable queue, several workers, fair
provider turns, shared Valkey capacity, retry/backoff, queue measurements and
AWS worker scaling. Local tests and direct traffic tests are positive. The last
required proof is a real AWS run with multiple worker tasks and ten queued Pro
audits.
