/**
 * Blog posts live here as plain data so adding one never touches routing.
 * Dates are ISO strings and feed both the sitemap and Article JSON-LD, so
 * bump `updated` whenever a post's content materially changes.
 */

export type PostBlock =
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; label?: string; code: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "stats"; items: Array<{ value: string; label: string }> };

export type BlogCategory =
  "Fundamentals" | "Tactics" | "Measurement" | "Technical";

/** Fixed per-category accent, same convention as the citation-source dots
 * elsewhere in the app: small decorative marks use a literal hex rather than
 * a theme token, since a single dot doesn't need a light/dark variant. */
export const BLOG_CATEGORIES: Record<BlogCategory, { color: string }> = {
  Fundamentals: { color: "var(--arc-accent)" },
  Tactics: { color: "#FD5001" }, // the logo's sun mark
  Measurement: { color: "var(--arc-green)" },
  Technical: { color: "#ff6ea9" },
};

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  category: BlogCategory;
  published: string;
  updated: string;
  readingMinutes: number;
  blocks: PostBlock[];
};

export const blogPosts: BlogPost[] = [
  {
    slug: "what-is-generative-engine-optimization",
    title: "What is generative engine optimization (GEO)?",
    description:
      "GEO is the practice of making your brand visible in AI-generated answers from ChatGPT, Gemini, and Perplexity - here's what it is, why it matters, and how it's measured.",
    category: "Fundamentals",
    published: "2026-08-14",
    updated: "2026-09-22",
    readingMinutes: 9,
    blocks: [
      {
        type: "p",
        text: "Scope and evidence: [Google documents how its Search AI features use website content](https://developers.google.com/search/docs/appearance/ai-features). The practical GEO advice below is our interpretation, not a provider-approved recipe or a guarantee that a mention will produce a sale.",
      },
      {
        type: "p",
        text: "When someone asks an AI assistant to suggest tools for their business, the answer may name products and cite sources. Appearing in that answer creates an opportunity to be considered, not a guaranteed customer. Generative engine optimization (GEO) is the practice of understanding and improving how your brand appears in answers like these.",
      },
      { type: "h2", text: "Why this is different from SEO" },
      {
        type: "p",
        text: "Search engines rank pages; answer engines can synthesize responses and expose sources. An answer may mention a brand, cite its website without naming it, or omit both. Measure those outcomes separately across buyer questions instead of treating a single answer as a complete picture of visibility.",
      },
      {
        type: "p",
        text: 'The second difference is that answers are non-deterministic. Ask the same question twice and the list can change. Any serious measurement has to sample repeatedly and report a rate - "you appear in 6 of 10 runs" - rather than pretend there is a fixed rank.',
      },
      { type: "h2", text: "What actually influences AI answers" },
      {
        type: "p",
        text: "Nobody outside the model providers knows the full picture, and you should distrust anyone selling certainty. But the observable inputs are fairly clear:",
      },
      {
        type: "list",
        items: [
          "Web search grounding. Modern assistants search the live web before answering commercial questions. The sources they retrieve - review sites, comparison articles, documentation, forums - heavily shape who gets named.",
          "Training data. Brands widely discussed across the public web before a model's cutoff are more likely to be recalled even without search.",
          "Entity clarity. Models name brands they can describe. If your site never states plainly what you do, for whom, and how you compare, there is nothing to synthesize.",
          "Third-party corroboration. A claim that exists only on your own site is weak evidence. The same claim echoed on independent sites is strong evidence.",
        ],
      },
      {
        type: "p",
        text: "Retrieved sources and model training are different routes by which information can influence an answer. Updating an accessible page may affect future retrieval, but does not update a deployed model's trained parameters. We cannot know whether a page will enter a later training set. Keep public facts accurate and inspect the sources exposed in each answer.",
      },
      { type: "h2", text: "Why a single check is worthless" },
      {
        type: "p",
        text: "Ask an AI assistant the same buyer question ten times in a row and you won't get the same answer ten times. Providers sample from a distribution, not a lookup table, and web search grounding pulls slightly different sources run to run. A brand that's genuinely well-positioned might show up in 7 of 10 runs; a brand that's marginal might show up in 2. Both numbers look identical in a single screenshot - \"ChatGPT recommended us!\" - and only the repeated sample tells them apart.",
      },
      {
        type: "stats",
        items: [
          {
            value: "1 of 1",
            label: "what a screenshot tells you - nothing repeatable",
          },
          { value: "7 of 10", label: "a brand with real, defensible presence" },
          { value: "2 of 10", label: "a brand that got lucky once" },
        ],
      },
      { type: "h2", text: "The three numbers a real score is built from" },
      {
        type: "p",
        text: "Once you're sampling instead of spot-checking, the results collapse into a small set of numbers worth knowing by name, because every serious GEO report is some version of these three:",
      },
      {
        type: "list",
        items: [
          'Mention rate - the share of sampled answers that named you at all. This is the headline number and the closest thing GEO has to "are we visible."',
          "Position - where you land in the list on the runs where you were named. Being named third or fourth of five is a materially weaker outcome than being named first, even though both count toward mention rate.",
          "Share of voice - your mention rate measured against competitors sampled in the exact same runs, which is the only way the number means anything on its own.",
        ],
      },
      { type: "h2", text: "The practical GEO loop" },
      {
        type: "p",
        text: "GEO in practice is a measurement loop, not a bag of tricks. Write down the questions your buyers actually ask. Sample multiple AI providers with those exact questions, repeatedly. Record who gets named, in what position, with what framing, and which sources the answers cite. Then work on the gap: earn presence on the sources being cited, fix the pages that misdescribe you, and re-measure.",
      },
      {
        type: "p",
        text: "The cited sources are the actionable part. If Perplexity keeps citing a comparison article that omits you, that article is your roadmap. If answers cite your own docs but describe you incorrectly, your docs are the roadmap.",
      },
      {
        type: "p",
        text: "\"Fix the pages that misdescribe you\" usually means rewriting a sentence, not a whole site. A model can only synthesize what's stated plainly - copy that's technically true but built for a human skimming a hero section gives it nothing solid to extract.",
      },
      {
        type: "table",
        headers: ["Vague (not quotable)", "Specific (quotable)"],
        rows: [
          [
            '"Powerful analytics for modern teams"',
            '"Real-time event analytics with a 7-day free trial, from $29/month"',
          ],
          [
            '"Trusted by companies worldwide"',
            '"Used by 400+ e-commerce teams, per our public customer directory"',
          ],
          [
            '"Built for scale"',
            '"Handles 50M events/day on the Team plan; higher tiers remove the cap"',
          ],
        ],
      },
      { type: "h2", text: "What GEO is not" },
      {
        type: "p",
        text: 'It is not prompt injection, not keyword-stuffing pages with "best X" lists about yourself, and not a guarantee. AI answers move as models and their retrieval change. The durable strategy is the boring one: be genuinely well-documented, well-reviewed, and clearly described across the web - and measure often enough to notice when things shift.',
      },
    ],
  },
  {
    slug: "how-to-get-chatgpt-to-recommend-your-brand",
    title: "How to get ChatGPT to recommend your brand",
    description:
      "A practical, no-hype guide to improving the odds that ChatGPT and other AI assistants name your product when buyers ask for recommendations.",
    category: "Tactics",
    published: "2026-08-14",
    updated: "2026-09-22",
    readingMinutes: 11,
    blocks: [
      {
        type: "p",
        text: "These are practical suggestions, not disclosed ChatGPT ranking factors. [Google's people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) supports clear, useful, attributable information in Search; it does not establish a ranking formula for ChatGPT.",
      },
      {
        type: "p",
        text: "First, the honest caveat: nobody can guarantee ChatGPT will recommend you. Answers vary between runs, models update, and the ranking logic is not public. What you can do is stack the observable odds in your favour. Everything below is based on how these systems visibly behave, not on secret tricks.",
      },
      { type: "h2", text: "1. Find out where you stand today" },
      {
        type: "p",
        text: 'For an unbranded discovery baseline, use buyer questions such as "best [category] for [audience]" and "which tools support [need]?" without naming your brand or a competitor. Record mentions, position, citations, model and sample count. Arcanoris asks each question once per provider per audit; repeated comparable audits provide additional observations. See our [measurement methodology](/methodology).',
      },
      {
        type: "p",
        text: 'Write the questions from the buyer\'s vocabulary, not yours. "Best CRM for a five-person agency" is what someone actually types; "enterprise-grade customer relationship management platform" is what your homepage says. If your prompt list reads like your own marketing copy, you\'re measuring how well you describe yourself, not whether buyers find you.',
      },
      {
        type: "p",
        text: 'Branded comparison research is a separate exercise: prompts such as "[your brand] vs [competitor]" or "alternatives to [competitor]" can reveal perceived differences. Because they supply brand names, do not mix those results into an unbranded discovery mention rate.',
      },
      { type: "h2", text: "2. Win the sources the answers already cite" },
      {
        type: "p",
        text: "When ChatGPT searches the web before answering, it leans on a small set of pages per question: comparison posts, review aggregators, community threads, industry lists. Those citations are a literal to-do list. Get reviewed on the aggregators that keep appearing. Pitch the authors of the comparison posts that omit you. Answer the recurring questions in the communities that get cited. This is classic digital PR, aimed with unusual precision.",
      },
      {
        type: "p",
        text: "The precision is the point: instead of guessing which twenty publications matter for your category, your own sampled answers tell you exactly which five to seven pages keep coming up. Rank them by how often they're cited across your question set and work down the list in that order - that's a better prioritization signal than any generic \"top publications in your industry\" list a PR agency will sell you.",
      },
      { type: "h2", text: "3. Make your own site quotable" },
      {
        type: "list",
        items: [
          "State plainly what you are, who you're for, and what you cost. Models synthesize; give them clean sentences to synthesize from.",
          "Publish an honest comparison page. If you don't describe how you differ from competitors, a third party will do it for you, less favourably.",
          'Keep pricing public and current. "Contact us" pages give an assistant nothing to say when someone asks about cost.',
          "Use accurate structured data where it describes visible content. It does not guarantee that an assistant will use or cite the page.",
        ],
      },
      {
        type: "p",
        text: "A minimal FAQ schema block is a few minutes of work and directly answers the shape of question buyers ask an assistant:",
      },
      {
        type: "code",
        label: "FAQPage JSON-LD",
        code: `{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [{
    "@type": "Question",
    "name": "How much does [Product] cost?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "[Product] starts at $29/month for up to 5 users, billed monthly or annually."
    }
  }]
}`,
      },
      { type: "h2", text: "4. Don't block the crawlers" },
      {
        type: "p",
        text: "Make separate choices about training, search crawling and user-requested retrieval. ClaudeBot is not Claude-SearchBot or Claude-User, and Google-Extended is not the control for AI Overviews. Server-rendered facts are easier to inspect, but do not assume every crawler has the same JavaScript capabilities. Our [crawler guide](/blog/how-ai-crawlers-work) explains the controls and links to provider documentation.",
      },
      {
        type: "p",
        text: "Check both robots.txt and your CDN or firewall logs. An allowed path can still be blocked at the network edge. The [crawler guide](/blog/how-ai-crawlers-work) includes a diagnostic request and explains why a spoofed user agent is not proof that a verified provider bot can fetch a page.",
      },
      { type: "h2", text: "5. Feed the durable record" },
      {
        type: "p",
        text: "Keep accurate, attributable information on relevant third-party sites as well as your own. We cannot know whether a particular page will enter a future training set or how much it will affect an answer. Treat this as documentation and discoverability work, not a promise of persistent model memory.",
      },
      { type: "h2", text: "6. Re-measure on a schedule" },
      {
        type: "p",
        text: "Repeat the same question set with the same providers and method. A single scan is a snapshot; a series can reveal changes but does not establish that your edits caused them. Model updates, retrieval changes and sampling variation are alternative explanations. Keep branded research separate from the discovery series.",
      },
      { type: "h2", text: "Mistakes that quietly cancel all of this out" },
      {
        type: "list",
        items: [
          "Changing the question wording between measurements. A different prompt is a different experiment - you can't tell if your mention rate moved because of your work or because you asked a different question.",
          "Optimizing for one provider only. A page written purely to please one assistant's search behavior often does nothing for the others; track providers separately and expect the gains to arrive unevenly.",
          "Publishing a comparison page and never updating it. A stale comparison page is worse than none - it gets cited with numbers that are now wrong, and you don't control the correction.",
          "Treating one good run as proof it worked. Wait for the next full sample before declaring victory; a single favorable answer is exactly the noise this whole approach exists to filter out.",
        ],
      },
    ],
  },
  {
    slug: "geo-vs-seo",
    title: "GEO vs SEO: what actually changes, what doesn't",
    description:
      "Generative engine optimization builds on SEO but breaks its core assumptions - rankings, clicks, and determinism. A clear-eyed comparison.",
    category: "Fundamentals",
    published: "2026-08-14",
    updated: "2026-09-22",
    readingMinutes: 8,
    blocks: [
      {
        type: "p",
        text: "The distinction is not a clean technical boundary: [Google's AI Search guidance](https://developers.google.com/search/docs/appearance/ai-features) says existing SEO practices still apply. This article compares workflows; it does not claim that every assistant retrieves or ranks sources like Google.",
      },
      {
        type: "p",
        text: 'The tempting frame is "GEO is the new SEO". It\'s half right. Most SEO fundamentals still matter, because AI answer engines read the same web Google does. But three assumptions at the heart of SEO break, and they change how you should spend effort.',
      },
      {
        type: "table",
        headers: ["", "SEO", "GEO"],
        rows: [
          [
            "Unit of success",
            "Position in a ranked list",
            "Named or not named",
          ],
          ["Result stability", "Stable for weeks", "Can change run to run"],
          [
            "Where the journey ends",
            "A click to your page",
            "Often the answer itself",
          ],
          [
            "Core metric",
            "Rank, click-through rate",
            "Mention rate, share of voice",
          ],
          [
            "Measurement method",
            "Single query, trusted",
            "Repeated sampling required",
          ],
        ],
      },
      { type: "h2", text: "Broken assumption 1: there is a ranking" },
      {
        type: "p",
        text: "Search results and AI answers present options differently. An AI answer may contain a short list, a longer comparison or links without a brand recommendation. Track mention rate, position and citations separately, then use referral and conversion data to understand their business value. None of these visibility measures alone proves a customer outcome.",
      },
      {
        type: "p",
        text: 'This changes what "winning" even looks like as a target. An SEO roadmap can chase a page from position eight to position four and call that real progress. A GEO roadmap chasing the equivalent - going from "named in 2 of 10 runs" to "named in 3 of 10" - is directionally similar progress, but the finish line that actually matters commercially is much further out: being named reliably enough that it stops being a coin flip whether a given buyer sees you at all.',
      },
      { type: "h2", text: "Broken assumption 2: results are stable" },
      {
        type: "p",
        text: "The same ChatGPT question can name different brands across consecutive runs. A one-off audit shows what happened in that snapshot; repeated comparable runs are needed to assess a trend. Arcanoris samples each question once per provider per audit. Monitoring or manual re-runs gather later observations, using the plan's check allowance.",
      },
      { type: "h2", text: "Broken assumption 3: the click is the prize" },
      {
        type: "p",
        text: "SEO ends with a visit to your page. An AI answer often ends the journey right there: the user asks, reads the recommendation, and acts. Your brand needs to survive being paraphrased. If your positioning only works when someone reads your homepage hero, it doesn't work in this channel at all.",
      },
      {
        type: "p",
        text: "This is the assumption teams underestimate the most, because it means some of your best-converting SEO copy - the kind written to be read in full, with a careful build-up to the offer - is nearly useless as GEO material. What survives paraphrasing is a short, self-contained, factual claim: a price, a specific capability, a named use case. If a sentence needs the three sentences before it to make sense, an assistant summarizing your page will drop the setup and keep only the claim, and that claim needs to stand on its own.",
      },
      { type: "h2", text: "What carries over intact" },
      {
        type: "list",
        items: [
          "Crawlability and clean HTML - AI crawlers are less forgiving than Googlebot, not more.",
          "Authoritative backlinks and third-party mentions - they now double as citation candidates for grounded answers.",
          "Clear, factual on-page copy - it was good for featured snippets; it's essential for synthesis.",
          "Structured data - schema.org markup helps both channels for the same reason.",
        ],
      },
      { type: "h2", text: "How to split your effort" },
      {
        type: "p",
        text: "Don't abandon SEO - the pages that rank are disproportionately the pages AI answers cite, so SEO is upstream of GEO. What changes is measurement and targeting: add AI answer sampling to your reporting, treat cited sources as your outreach list, and judge content by whether an assistant could accurately recommend you from it alone.",
      },
      {
        type: "p",
        text: "In practice that's less a budget reallocation than an additional column on the same spreadsheet. Keep doing the SEO work that earns citable pages - reviews, comparisons, documentation, backlinks. Add one recurring line item that didn't exist before: sampling AI answers on a schedule, the same way you already track rankings, so a shift in what the assistants say doesn't go unnoticed for months.",
      },
    ],
  },
  {
    slug: "how-to-measure-ai-visibility",
    title: "How to measure AI visibility without fooling yourself",
    description:
      "AI answers are non-deterministic, so most casual checks mislead. What a defensible AI visibility measurement needs: sampling, provider labels, position, and citations.",
    category: "Measurement",
    published: "2026-08-14",
    updated: "2026-09-22",
    readingMinutes: 10,
    blocks: [
      {
        type: "p",
        text: "Uncertainty matters: [NIST's guide to confidence intervals for proportions](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm) explains why a measured rate is an estimate. Its statistical assumptions need checking; correlated AI answers, changing retrieval and model updates can make a simple independent-sample interval inappropriate.",
      },
      {
        type: "p",
        text: "The most common way teams check their AI visibility is also the worst: type a question into ChatGPT, screenshot the answer, and draw a conclusion. Run the same question five more times and you'll often get a different list. Measuring a non-deterministic system takes the same discipline as polling - and skipping that discipline produces confident, wrong conclusions.",
      },
      { type: "h2", text: "Sample, don't spot-check" },
      {
        type: "p",
        text: "A single answer describes one observation. Repeating the same question helps estimate how often a brand appears, but even 8 of 10 runs versus 1 of 10 is a sample estimate, not proof of a stable difference. Trends and the effect of changes need repeated comparable measurements and an honest account of uncertainty.",
      },
      {
        type: "stats",
        items: [
          { value: "n = 1", label: "one snapshot, not a trend" },
          {
            value: "n = 10",
            label: "more observations; uncertainty still matters",
          },
          {
            value: "n = 20+",
            label: "more evidence, not a guaranteed stable trend",
          },
        ],
      },
      {
        type: "p",
        text: "There's no universal correct sample size: it trades off against cost and the uncertainty you can accept. Keep the questions, providers and sampling settings comparable, and report the denominator. Rates from 5 and 50 observations can be compared, but they have different uncertainty; a change in rate alone does not establish a trend.",
      },
      { type: "h2", text: "What Arcanoris actually samples" },
      {
        type: "p",
        text: "Within one Arcanoris audit, N = 1: one answer per question per provider. Free uses 5 questions × 1 provider = 5 checks. Plus uses 20 questions × 5 providers = 100 checks, not 100 repetitions of one question. Pro asks 20 questions once per selected provider, up to 10. Each additional audit or monitoring run consumes checks from your plan. Scheduled monitoring repeats selected questions over time; a single audit is a snapshot and should not be presented as evidence of a stable trend.",
      },
      { type: "h2", text: "Hold the method constant" },
      {
        type: "list",
        items: [
          'Label the provider and model. "AI visibility" isn\'t one number - GPT-5 with web search, Gemini, and Perplexity behave differently and should be reported separately.',
          'Keep prompts unbiased. Asking "is Acme good?" tells the model the answer you want. Ask what a buyer would ask, with no brand in the prompt.',
          "Version the methodology. When you change prompts, models, or sample size, mark the break - otherwise you'll read a method change as a market change.",
          "Timestamp everything. Answers drift when models update; a number without a date is unusable.",
        ],
      },
      { type: "h2", text: "Measure more than mentions" },
      {
        type: "p",
        text: "Alongside mentions, record position and citations. Position describes where a name appeared; it does not establish whether a buyer chose it. Citations identify the sources an answer exposes, not every influence on the model. Use them to inspect supporting evidence and content gaps, and measure actual customer outcomes separately.",
      },
      { type: "h2", text: "Track competitors in the same runs" },
      {
        type: "p",
        text: "Your mention rate alone has no scale. Appearing in 40% of answers is excellent if your nearest competitor appears in 10%, and alarming if they appear in 90%. Because competitors get measured in the very same sampled answers, the comparison is apples to apples by construction - you're not comparing your Tuesday sample against their sample from a different week with a different model version behind it.",
      },
      { type: "h2", text: "A minimal setup you can build yourself" },
      {
        type: "p",
        text: "You don't need a platform to start - a script and a spreadsheet gets you a real baseline. The shape of it is a nested loop: for each prompt, for each provider, run N times and record the result.",
      },
      {
        type: "code",
        label: "pseudocode",
        code: `for prompt in buyer_prompts:
  for provider in [openai, anthropic, perplexity, gemini]:
    for run in range(N):
      answer = provider.ask(prompt)          # no brand name in the prompt
      log(
        prompt, provider, run,
        mentioned = brand in answer.named_brands,
        position  = answer.position_of(brand),
        sources   = answer.cited_urls,
        timestamp = now(),
      )`,
      },
      {
        type: "p",
        text: "That log is the whole dataset. Mention rate, position, and cited-source frequency are all just aggregations over those rows - the discipline is entirely in running it the same way every time, not in the analysis.",
      },
      { type: "h2", text: "What a good report looks like" },
      {
        type: "p",
        text: "Provider-labelled mention rates with sample sizes, position when mentioned, the cited sources ranked by frequency, competitor rates from the same runs, and a methodology version plus timestamp on all of it. This is the shape we built Arcanoris's reports around - but the principles hold whether you use a tool or a spreadsheet and an API key.",
      },
      {
        type: "table",
        headers: ["Field", "Why it has to be there"],
        rows: [
          [
            "Provider + model",
            "Rates are meaningless averaged across systems that behave differently",
          ],
          ["Sample size", "n=3 and n=30 don't deserve the same confidence"],
          [
            "Position",
            "Being named last is a much weaker outcome than being named first",
          ],
          [
            "Cited sources, ranked",
            "The only part of the result you can directly act on",
          ],
          [
            "Methodology version + date",
            "Answers drift; an undated number can't be trusted or compared",
          ],
        ],
      },
    ],
  },
  {
    slug: "how-ai-crawlers-work",
    title: "How AI crawlers work: training, search and user requests",
    description:
      "Distinguish ClaudeBot, Claude-SearchBot and Claude-User; Googlebot and Google-Extended; and robots.txt specificity from line order.",
    category: "Technical",
    published: "2026-08-18",
    updated: "2026-09-22",
    readingMinutes: 6,
    blocks: [
      {
        type: "p",
        text: "Training crawlers, search crawlers and user-requested fetchers serve different purposes. Choose access for each purpose independently. Crawl access can enable discovery, but does not guarantee an answer, citation or recommendation.",
      },
      {
        type: "h2",
        text: "Anthropic: three different agents",
      },
      {
        type: "p",
        text: "[Anthropic documents three agents](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler): ClaudeBot collects material for model development; Claude-SearchBot indexes content to improve search results; Claude-User retrieves pages in response to a user request. Their robots.txt controls are separate. Blocking training does not require blocking search or user-requested access.",
      },
      {
        type: "h2",
        text: "Google Search and Google-Extended are separate controls",
      },
      {
        type: "p",
        text: "[Google Search AI features](https://developers.google.com/search/docs/appearance/ai-features), including AI Overviews and AI Mode, use Googlebot access and Search controls such as nosnippet, data-nosnippet, max-snippet and noindex. Googlebot must be able to crawl a page to read its preview directives.",
      },
      {
        type: "p",
        text: "[Google-Extended](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended) is a robots.txt product token, not a separate HTTP crawler identity. It controls use for future Gemini model training and grounding in specified Gemini Apps and Vertex AI services. It does not control inclusion or ranking in Google Search.",
      },
      {
        type: "h2",
        text: "Choose access by purpose",
      },
      {
        type: "table",
        headers: ["Agent or token", "Purpose", "What to consider"],
        rows: [
          [
            "OAI-SearchBot",
            "OpenAI search discovery",
            "Separate from GPTBot training access",
          ],
          [
            "GPTBot",
            "OpenAI model development",
            "A training preference, not a Search opt-in",
          ],
          [
            "ClaudeBot",
            "Anthropic model development",
            "Independent training control",
          ],
          [
            "Claude-SearchBot",
            "Anthropic search indexing",
            "Independent search control",
          ],
          [
            "Claude-User",
            "Anthropic user-requested retrieval",
            "Independent retrieval control",
          ],
          [
            "PerplexityBot",
            "Perplexity search discovery",
            "Separate from Perplexity-User retrieval",
          ],
          [
            "Googlebot",
            "Google Search, including its AI features",
            "Search crawling and preview controls",
          ],
          [
            "Google-Extended",
            "Specified Gemini training and grounding uses",
            "Product-use token; no separate HTTP user agent",
          ],
        ],
      },
      {
        type: "p",
        text: "Check [OpenAI's crawler documentation](https://platform.openai.com/docs/bots) and [Perplexity's crawler documentation](https://docs.perplexity.ai/docs/resources/perplexity-crawlers) for their current identities and verification guidance. Do not treat permission for model training as a prerequisite for search visibility.",
      },
      {
        type: "h2",
        text: "A focused robots.txt example",
      },
      {
        type: "p",
        text: "This example allows Anthropic search and user-requested retrieval while declining ClaudeBot training crawls. Adapt it to your policy and existing private-path restrictions; do not replace an entire robots.txt file blindly.",
      },
      {
        type: "code",
        label: "robots.txt example",
        code: "User-agent: ClaudeBot\nDisallow: /\n\nUser-agent: Claude-SearchBot\nUser-agent: Claude-User\nAllow: /\nDisallow: /account/\n\nSitemap: https://example.com/sitemap.xml",
      },
      {
        type: "h2",
        text: "Specificity, not line order",
      },
      {
        type: "p",
        text: "Under [Google's robots.txt specification](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec), the most specific matching user-agent group applies. Repeated groups for that agent are combined; the wildcard group is not added to a specific group. Within the applicable rules, the longest matching path wins. An equally specific Allow/Disallow conflict resolves to Allow. Moving a rule earlier or later does not change that priority.",
      },
      {
        type: "code",
        label: "Specific-path example",
        code: "User-agent: ExampleBot\nDisallow: /\nAllow: /public/\n\n# /public/article is allowed; /account is disallowed.\n# Reversing these two rules does not change the result.",
      },
      {
        type: "p",
        text: "[RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) defines the Robots Exclusion Protocol and its matching rules. Individual agents can have documented extensions. Robots.txt is a crawl preference, not authentication: protect private data with access controls.",
      },
      {
        type: "h2",
        text: "Check the network edge too",
      },
      {
        type: "p",
        text: "A CDN or firewall can return a challenge even when robots.txt allows a request. Inspect verified bot traffic in your logs and test a public page. Sending a bot user-agent string with curl is only a diagnostic: it does not reproduce the provider's IP address, bot verification or rendering behavior.",
      },
      {
        type: "code",
        label: "Inspect the initial HTML response",
        code: 'curl -A "Claude-SearchBot" -i https://example.com/pricing',
      },
      {
        type: "p",
        text: "Look for the expected status and meaningful page content rather than a challenge or empty shell. A successful curl response does not prove that a provider indexed the page. Do not assign a universal JavaScript capability to all AI crawlers; consult current documentation and test your own rendering.",
      },
    ],
  },
  {
    slug: "schema-markup-for-ai-answer-engines",
    title: "Schema markup for clear, machine-readable product facts",
    description:
      "Structured data doesn't make a model trust you more - it removes ambiguity. Which schema.org types are worth adding, and which ones can quietly work against you.",
    category: "Technical",
    published: "2026-08-18",
    updated: "2026-09-22",
    readingMinutes: 9,
    blocks: [
      {
        type: "p",
        text: "[Google says its Search AI features need no special schema](https://developers.google.com/search/docs/appearance/ai-features). Treat the examples below as ways to describe visible facts, not established ranking factors. [Structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) also require accurate, relevant markup and do not guarantee a rich result.",
      },
      {
        type: "p",
        text: "Schema.org markup doesn't persuade a model of anything - it just says something once, unambiguously, in a shape built to be parsed rather than read. An [Offer](https://schema.org/Offer) can label a price and currency explicitly, but a consuming system still decides whether and how to use those fields. For a system that's synthesizing an answer from many pages under time pressure, that difference is exactly what makes markup worth the hour it takes to add.",
      },
      { type: "h2", text: "Start with the types that answer real questions" },
      {
        type: "table",
        headers: ["Type", "Answers", "Priority"],
        rows: [
          [
            "Organization",
            '"Who makes this?"',
            "Add first - every page benefits",
          ],
          [
            "Product / Offer",
            '"How much does it cost?"',
            "High - price questions are constant",
          ],
          [
            "FAQPage",
            "Direct buyer questions",
            "Optional - no AI visibility guarantee",
          ],
          [
            "BreadcrumbList",
            '"Where does this page sit?"',
            "Low - cheap, mechanical, do it once",
          ],
          [
            "Dataset",
            '"What did you measure?"',
            "Medium - only if you publish data",
          ],
        ],
      },
      {
        type: "p",
        text: "Organization and Product/Offer cover the two questions buyers ask an assistant most - who are you, and what does it cost - so they're worth adding even if you do nothing else. A minimal Offer block looks like this:",
      },
      {
        type: "code",
        label: "Offer JSON-LD",
        code: `{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Team plan",
  "offers": {
    "@type": "Offer",
    "price": "29",
    "priceCurrency": "USD",
    "priceSpecification": {
      "@type": "UnitPriceSpecification",
      "billingDuration": "P1M"
    }
  }
}`,
      },
      {
        type: "h2",
        text: "FAQPage describes content; it does not promise visibility",
      },
      {
        type: "p",
        text: "[Schema.org defines FAQPage](https://schema.org/FAQPage) as a page with frequently asked questions. That vocabulary definition is not a promise that Google will show a rich result or that an assistant will retrieve it. Write useful visible answers first; check current platform eligibility before adding markup for a specific search feature.",
      },
      { type: "h2", text: "Where teams overreach" },
      {
        type: "p",
        text: "Review and AggregateRating schema exist for genuine customer reviews, not for badging your own product with stars it didn't earn from a third party. Google's guidelines are explicit about this, and misuse risks a manual action - a bad trade for a few gold stars in a search snippet. If you don't have real, collected customer reviews, leave that schema out entirely rather than approximate one.",
      },
      { type: "h2", text: "Dataset schema for anything you publish as data" },
      {
        type: "p",
        text: "If you publish benchmark results, a pricing comparison, or market data, Dataset schema with a variableMeasured list turns your numbers into machine-readable claims instead of prose a model has to parse and hope it read correctly:",
      },
      {
        type: "code",
        label: "Dataset JSON-LD",
        code: `{
  "@context": "https://schema.org",
  "@type": "Dataset",
  "name": "Q3 2026 support response time benchmark",
  "description": "Median first-response time across 12 helpdesk tools, sampled weekly.",
  "variableMeasured": [
    { "@type": "PropertyValue", "name": "Median response time", "value": "4.2 hours" }
  ]
}`,
      },
      {
        type: "p",
        text: "It's a small, specific addition, and it's exactly the kind of structured fact an assistant can quote with confidence - a number with a named variable and a source, instead of a claim buried in a paragraph.",
      },
      { type: "h2", text: "Validate before you ship it" },
      {
        type: "p",
        text: "Markup with a typo doesn't degrade gracefully - it just fails silently, and you won't notice unless you check. Run new schema through Google's Rich Results Test or the schema.org validator before it goes live, and again whenever the page it's on changes. Syntactic validity alone does not establish platform eligibility or factual accuracy; also compare the markup with the visible page.",
      },
    ],
  },
  {
    slug: "comparison-pages-ai-answers-cite",
    title: "How to write a comparison page AI answers actually cite",
    description:
      '"X vs Y" is one of the most common questions buyers feed an assistant. If you don\'t answer it yourself, a less favorable third-party page will.',
    category: "Tactics",
    published: "2026-08-18",
    updated: "2026-09-22",
    readingMinutes: 9,
    blocks: [
      {
        type: "p",
        text: "Our recommendation is to make comparisons useful and verifiable. [Google's people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) is a primary reference for trustworthy content in Search; it does not show that a particular comparison format earns more AI citations.",
      },
      {
        type: "p",
        text: "\"[Your product] vs [competitor]\" is one of the most common questions a buyer types into an assistant before making a decision - and if you haven't written the answer, someone else has, or the model is stitching one together from scattered reviews and forum threads. A page you didn't write, framing a comparison you don't control, is the default outcome of not having one.",
      },
      { type: "h2", text: "Name the competitor, plainly" },
      {
        type: "p",
        text: 'Generic "why choose us" copy gives a synthesizing model nothing concrete to extract. A page that names the specific alternative and states specific differences - price, features, deployment model, support - is directly quotable in a way that vague positioning never is.',
      },
      { type: "h2", text: "Concede where you actually lose" },
      {
        type: "quote",
        text: "An honest comparison gives a buyer evidence for choosing either product. That is useful even when an AI answer never cites it.",
      },
      {
        type: "p",
        text: "Explain real tradeoffs with dated, verifiable facts: for example, which product costs less for a specific use case and which supports a required workflow. Disclose that you sell one of the products. This helps readers assess the comparison; it is not evidence that an assistant will prefer or cite the page.",
      },
      { type: "h2", text: "Structure it as a real table" },
      {
        type: "p",
        text: "Feature rows, two columns, plain HTML - not a screenshot, not a PDF, not an image export from a slide deck. A crawler that can't parse your comparison table will build its own from whatever scattered sources it can read instead, and it won't have your framing when it does. A minimal version - illustrative, not a template to copy verbatim - looks like this:",
      },
      {
        type: "table",
        headers: ["", "Us", "Them"],
        rows: [
          ["Starting price", "$29/mo", "$49/mo"],
          ["Free plan", "Yes - 1 project", "No"],
          ["Self-hosted option", "No", "Yes"],
          ["Setup time", "Under 10 minutes", "Typically requires onboarding"],
          [
            "Best for",
            "Small teams shipping fast",
            "Larger orgs needing on-prem",
          ],
        ],
      },
      {
        type: "p",
        text: "Notice the last row concedes a real case where the competitor wins - that's not an accident. A row like that is what makes the other four believable.",
      },
      { type: "h2", text: "A comparison page skeleton" },
      {
        type: "p",
        text: "If you're starting from nothing, this is the order that works: a one-line summary of the honest verdict up top (who should pick which), the comparison table, a short section per major difference explaining the why behind the row, an FAQ block for the specific questions buyers ask about switching, and a low-pressure CTA. Skip the skeleton and most teams either bury the table under paragraphs of preamble, or drop straight into feature rows with no framing - both make the page harder for a model to extract cleanly.",
      },
      {
        type: "table",
        headers: ["Section", "Purpose"],
        rows: [
          [
            "One-line verdict",
            "Gives an assistant a summary sentence to quote directly",
          ],
          [
            "Comparison table",
            "The extractable core - specific, scannable, structured",
          ],
          [
            "Per-difference detail",
            'The "why" behind each row, for the reader who wants it',
          ],
          [
            "FAQ block",
            "Matches the exact question shape buyers ask an assistant",
          ],
          ["CTA", "Low-pressure - this page's job is to inform, not to close"],
        ],
      },
      { type: "h2", text: "Keep it current" },
      {
        type: "p",
        text: "Pricing and feature comparisons rot fast, and a stale comparison page actively misleads whoever cites it. Once an assistant paraphrases an outdated number, that error can keep circulating in answers for as long as the page stays indexed and gets referenced - review comparison pages on the same cadence you review pricing itself.",
      },
      {
        type: "p",
        text: "A visible \"last updated\" date near the top does double duty: it's a small trust signal to a human reader, and it's a plain-text fact a crawler can pick up to judge how current the page's claims are.",
      },
      { type: "h2", text: "Make sure it can actually be found" },
      {
        type: "p",
        text: "A comparison page that only exists at an unlinked URL might as well not exist for a crawler. Link it from your navigation, your footer, or a relevant blog post - the same crawlability rules that apply to every other page on your site apply here too, and this is usually the highest-value page on the site to get right.",
      },
    ],
  },
  {
    slug: "what-is-answer-engine-optimization",
    title:
      "What is answer engine optimization (AEO)? And how it relates to GEO",
    description:
      "AEO didn't start with ChatGPT - it's the older discipline of winning featured snippets and voice answers. Here's where it came from, and where it overlaps with GEO today.",
    category: "Fundamentals",
    published: "2026-08-20",
    updated: "2026-09-22",
    readingMinutes: 9,
    blocks: [
      {
        type: "p",
        text: "Terminology varies by author. For the platform rules, distinguish [Google's featured-snippet documentation](https://developers.google.com/search/docs/appearance/featured-snippets) from [its Search AI guidance](https://developers.google.com/search/docs/appearance/ai-features). The editorial practices below do not guarantee either type of appearance.",
      },
      {
        type: "p",
        text: 'Answer engine optimization is older than the current wave of chatbots, and worth defining properly instead of treating as a synonym someone picked for GEO. Long before ChatGPT, "AEO" meant getting your content chosen as the answer - the boxed paragraph Google shows above the links, the sentence Siri reads aloud, the card a voice speaker answers with instead of listing ten websites. The goal was always the same one GEO chases now: be the answer, not one of ten links. What\'s changed is the machinery doing the choosing.',
      },
      { type: "h2", text: "Where AEO actually came from" },
      {
        type: "list",
        items: [
          'Featured snippets ("position zero") - since around 2014, Google has lifted a single paragraph, list, or table out of a page and displayed it above the normal results, answering the query without a click.',
          "Voice search - Siri, Alexa, and Google Assistant read back one answer, not a list. There's no scrolling past option two on a smart speaker; you're either the answer or you're nothing.",
          "People Also Ask boxes - expandable question-and-answer pairs pulled from indexed pages, directly rewarding content already written in question-and-answer form.",
        ],
      },
      {
        type: "p",
        text: "All three systems do the same core thing: parse a page, find a short self-contained passage that answers a specific question, and surface just that passage. None of them synthesize - they extract. That's the detail that matters for what comes next.",
      },
      { type: "h2", text: "What changed with generative engines" },
      {
        type: "p",
        text: "ChatGPT, Perplexity, and similar assistants don't lift a single passage verbatim. They read several sources and generate a new sentence that blends them, often naming multiple products and citing more than one page. That's a different mechanism from extraction, specific enough that researchers gave it its own name in 2023: generative engine optimization, for the practice of improving visibility inside a generated, synthesized answer rather than an extracted snippet.",
      },
      {
        type: "table",
        headers: ["", "AEO (classic)", "GEO"],
        rows: [
          [
            "Origin",
            "Featured snippets, voice search, ~2014 onward",
            "LLM assistants, named ~2023",
          ],
          [
            "Mechanism",
            "Extracts one passage verbatim",
            "Synthesizes a new answer from many sources",
          ],
          [
            "Example systems",
            "Google snippets, Siri, Alexa",
            "ChatGPT, Perplexity, Gemini",
          ],
          [
            'What "winning" looks like',
            "Your exact paragraph gets shown",
            "You get named, with or without a direct quote",
          ],
          ["Stability", "Same snippet for weeks", "Can vary answer to answer"],
        ],
      },
      { type: "h2", text: "Why the terms are blurring in practice" },
      {
        type: "p",
        text: 'In casual use, most people now say "AEO" to mean "getting cited by ChatGPT" too - and it\'s worth being honest that the industry hasn\'t fully settled the vocabulary. That\'s a reasonable drift, not a mistake: the on-page work that wins a featured snippet and the on-page work that earns a generative citation overlap heavily. Both reward a short, self-contained, factual passage placed near a clear heading. Both punish content that only makes sense after three paragraphs of setup. A page built well for one is usually most of the way to being built well for the other.',
      },
      {
        type: "quote",
        text: "The terminology split is real and worth knowing - but building two separate strategies around it usually isn't.",
      },
      { type: "h2", text: "Where they genuinely diverge" },
      {
        type: "p",
        text: "The gap that still matters: extraction systems reward one perfect paragraph, so classic AEO work is often about a single passage - restructure one section, win the snippet. Generative systems reward being a credible, well-corroborated entity across the whole web, so GEO work leans more on citations, structured data, and presence on the third-party pages an assistant already trusts. If you only have time for one, and your buyers are asking assistants direct commercial questions, the citation-and-corroboration work behind GEO is usually the higher-leverage lane today - but the snippet-style writing habits behind classic AEO are what make any given page usable by either system.",
      },
      { type: "h2", text: "What to actually do about it" },
      {
        type: "list",
        items: [
          "Write the direct answer first, in one to three sentences, before the explanation - useful to a snippet, a voice answer, and a synthesizing model alike.",
          "Mark up FAQ and HowTo content with schema, since both extraction and generative systems can read it unambiguously.",
          "Track both outcome families separately - a featured snippet win and an AI-answer citation are correlated but distinct, and conflating them into one metric hides which lever you actually pulled.",
          "Don't chase snippet-specific tricks (like keyword-stuffed answer boxes) that ignore the fact that a generative model is reading the whole page, not just extracting your optimized paragraph.",
        ],
      },
    ],
  },
  {
    slug: "structuring-content-for-answer-engines",
    title: "How to structure content for answer engines",
    description:
      "The single highest-leverage on-page change for both snippets and AI citations: put the direct answer first. A practical guide to writing extraction-friendly pages.",
    category: "Tactics",
    published: "2026-08-20",
    updated: "2026-09-22",
    readingMinutes: 9,
    blocks: [
      {
        type: "p",
        text: "This structure is an editorial recommendation for clarity, not a confirmed AI ranking factor. [Google's people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) emphasizes helpful, trustworthy content; no heading pattern guarantees a featured snippet or an AI citation.",
      },
      {
        type: "p",
        text: "A featured snippet and a generative AI citation are solved by different machinery, but both are trying to do the same thing to your page: pull out one self-contained answer without reading the whole document. Structure your content for that, and you're optimizing for both at once. This is the practical, on-page half of AEO and GEO - the part that has nothing to do with PR or backlinks and everything to do with how a page is written.",
      },
      { type: "h2", text: "Lead with the direct answer" },
      {
        type: "p",
        text: "Put the answer in the first one to three sentences after the heading, then explain. A snippet algorithm or a synthesizing model that grabs the first plausible-looking passage will grab a far stronger one if the direct answer is sitting right there, instead of buried under a paragraph of throat-clearing.",
      },
      {
        type: "table",
        headers: ["Buried answer", "Direct answer"],
        rows: [
          [
            '"There are many factors to consider when choosing a project management tool, and the right fit depends on team size, budget, and workflow. That said, for small agencies..."',
            '"For a small agency, the best project management tool is one with flat per-project pricing and no per-seat fees. [Product] costs $29/month flat, regardless of team size."',
          ],
        ],
      },
      { type: "h2", text: "Use question-shaped headings" },
      {
        type: "p",
        text: 'Write the H2 as "How much does [Product] cost?" instead of "Pricing." This isn\'t just an AEO trick - it\'s literally how both a Google "People Also Ask" box and a buyer\'s prompt to an assistant are phrased. A heading that already matches the question shape is doing half the extraction work before the answer paragraph even starts.',
      },
      { type: "h2", text: "Give every list a real list" },
      {
        type: "p",
        text: '"How to" content needs a real ordered list, not three sentences with "first," "then," and "finally" buried in prose. "What are the features" content needs a real bulleted list. Structural HTML is what lets a parser lift the list intact - a numbered sequence hidden inside a paragraph has to be inferred, and inference is exactly where extraction fails.',
      },
      {
        type: "code",
        label: "example: a real HowTo structure",
        code: `<h2>How to export your data</h2>
<ol>
  <li>Go to Settings &gt; Export.</li>
  <li>Choose JSON or CSV.</li>
  <li>Click Export - the file downloads immediately.</li>
</ol>`,
      },
      { type: "h2", text: "Keep each answer self-contained" },
      {
        type: "p",
        text: 'A paragraph that says "as mentioned above" or "see the previous section" fails at extraction, because both a snippet algorithm and a generative model frequently isolate one chunk of a page without the surrounding context. If an answer only makes sense next to the paragraph before it, rewrite it so it stands alone - repeat the two words of context it needs rather than pointing backward at them.',
      },
      { type: "h2", text: "Mark it up" },
      {
        type: "p",
        text: "Use structured data only when it accurately describes visible content. A Schema.org type does not itself establish eligibility for a Google rich result or improve AI citations. Our [schema markup guide](/blog/schema-markup-for-ai-answer-engines) explains examples and limitations; [Google's structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) set additional requirements.",
      },
      { type: "h2", text: "One answer per section" },
      {
        type: "p",
        text: 'Resist stacking multiple distinct questions under one heading. A section titled "Pricing and support" that answers two different questions forces an extraction system to guess which sentence belongs to which question - split it into two headings, two direct answers, and let each stand on its own.',
      },
    ],
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}
