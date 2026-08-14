/**
 * Blog posts live here as plain data so adding one never touches routing.
 * Dates are ISO strings and feed both the sitemap and Article JSON-LD, so
 * bump `updated` whenever a post's content materially changes.
 */

export type PostBlock =
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "list"; items: string[] };

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
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
    published: "2026-08-14",
    updated: "2026-08-14",
    readingMinutes: 6,
    blocks: [
      {
        type: "p",
        text: "When someone asks ChatGPT for \"the best project management tool for a small agency\", they get a short list of named products - not ten blue links. If your product is on that list, you win a customer you never paid to acquire. If it isn't, you were never in the running. Generative engine optimization (GEO) is the practice of understanding and improving whether AI answer engines name your brand in moments like that.",
      },
      { type: "h2", text: "Why this is different from SEO" },
      {
        type: "p",
        text: "Search engines rank pages; answer engines synthesize an answer and cite a handful of sources. A page ranking third on Google still gets clicks. A brand mentioned nowhere in an AI answer gets nothing - there is no page two. That makes AI visibility closer to a binary outcome than a gradient, and it makes knowing where you stand the first job.",
      },
      {
        type: "p",
        text: "The second difference is that answers are non-deterministic. Ask the same question twice and the list can change. Any serious measurement has to sample repeatedly and report a rate - \"you appear in 6 of 10 runs\" - rather than pretend there is a fixed rank.",
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
      { type: "h2", text: "The practical GEO loop" },
      {
        type: "p",
        text: "GEO in practice is a measurement loop, not a bag of tricks. Write down the questions your buyers actually ask. Sample multiple AI providers with those exact questions, repeatedly. Record who gets named, in what position, with what framing, and which sources the answers cite. Then work on the gap: earn presence on the sources being cited, fix the pages that misdescribe you, and re-measure.",
      },
      {
        type: "p",
        text: "The cited sources are the actionable part. If Perplexity keeps citing a comparison article that omits you, that article is your roadmap. If answers cite your own docs but describe you incorrectly, your docs are the roadmap.",
      },
      { type: "h2", text: "What GEO is not" },
      {
        type: "p",
        text: "It is not prompt injection, not keyword-stuffing pages with \"best X\" lists about yourself, and not a guarantee. AI answers move as models and their retrieval change. The durable strategy is the boring one: be genuinely well-documented, well-reviewed, and clearly described across the web - and measure often enough to notice when things shift.",
      },
    ],
  },
  {
    slug: "how-to-get-chatgpt-to-recommend-your-brand",
    title: "How to get ChatGPT to recommend your brand",
    description:
      "A practical, no-hype guide to improving the odds that ChatGPT and other AI assistants name your product when buyers ask for recommendations.",
    published: "2026-08-14",
    updated: "2026-08-14",
    readingMinutes: 7,
    blocks: [
      {
        type: "p",
        text: "First, the honest caveat: nobody can guarantee ChatGPT will recommend you. Answers vary between runs, models update, and the ranking logic is not public. What you can do is stack the observable odds in your favour. Everything below is based on how these systems visibly behave, not on secret tricks.",
      },
      { type: "h2", text: "1. Find out where you stand today" },
      {
        type: "p",
        text: "Before changing anything, measure. Take the ten questions a real buyer would ask - \"best [category] for [audience]\", \"alternatives to [competitor]\", \"[your brand] vs [competitor]\" - and run them through the providers' APIs multiple times. Record your mention rate, your position when mentioned, and every source the answers cite. This baseline is what makes every later change testable instead of vibes.",
      },
      { type: "h2", text: "2. Win the sources the answers already cite" },
      {
        type: "p",
        text: "When ChatGPT searches the web before answering, it leans on a small set of pages per question: comparison posts, review aggregators, community threads, industry lists. Those citations are a literal to-do list. Get reviewed on the aggregators that keep appearing. Pitch the authors of the comparison posts that omit you. Answer the recurring questions in the communities that get cited. This is classic digital PR, aimed with unusual precision.",
      },
      { type: "h2", text: "3. Make your own site quotable" },
      {
        type: "list",
        items: [
          "State plainly what you are, who you're for, and what you cost. Models synthesize; give them clean sentences to synthesize from.",
          "Publish an honest comparison page. If you don't describe how you differ from competitors, a third party will do it for you, less favourably.",
          "Keep pricing public and current. \"Contact us\" pages give an assistant nothing to say when someone asks about cost.",
          "Use structured data (Organization, Product, FAQ schema) so crawlers parse your facts unambiguously.",
        ],
      },
      { type: "h2", text: "4. Don't block the crawlers" },
      {
        type: "p",
        text: "Check your robots.txt. GPTBot and OAI-SearchBot (OpenAI), ClaudeBot (Anthropic), PerplexityBot, and Google-Extended all identify themselves. Blocking them while wanting AI visibility is asking to be recommended by systems you've locked out. Also make sure your key pages render without JavaScript - many AI crawlers read plain HTML.",
      },
      { type: "h2", text: "5. Feed the durable record" },
      {
        type: "p",
        text: "Search grounding decides today's answers; training data decides the model's baseline instincts. Wikipedia (where you legitimately qualify), Wikidata, GitHub, established review platforms, and long-lived industry publications all persist into future training runs. Mentions there compound in a way your own blog cannot.",
      },
      { type: "h2", text: "6. Re-measure on a schedule" },
      {
        type: "p",
        text: "Run the same question set weekly or monthly with the same method. A single scan tells you where you stand; a series tells you whether anything you did worked, and alerts you when a model update quietly drops you from answers you used to win. Treat it like uptime monitoring for your brand's presence in AI.",
      },
    ],
  },
  {
    slug: "geo-vs-seo",
    title: "GEO vs SEO: what actually changes, what doesn't",
    description:
      "Generative engine optimization builds on SEO but breaks its core assumptions - rankings, clicks, and determinism. A clear-eyed comparison.",
    published: "2026-08-14",
    updated: "2026-08-14",
    readingMinutes: 5,
    blocks: [
      {
        type: "p",
        text: "The tempting frame is \"GEO is the new SEO\". It's half right. Most SEO fundamentals still matter, because AI answer engines read the same web Google does. But three assumptions at the heart of SEO break, and they change how you should spend effort.",
      },
      { type: "h2", text: "Broken assumption 1: there is a ranking" },
      {
        type: "p",
        text: "SEO optimizes a position in an ordered list, where position three still earns real traffic. An AI answer typically names two to five options, and everything else earns nothing. The practical consequence: in AI channels, the difference between third and absent is small, and the difference between mentioned and absent is everything. Mention rate, not rank, is the metric.",
      },
      { type: "h2", text: "Broken assumption 2: results are stable" },
      {
        type: "p",
        text: "The same Google query returns near-identical results for weeks. The same ChatGPT question can name different brands across two consecutive runs. One-off checks are therefore nearly meaningless - you have to sample repeatedly and track rates over time, the way pollsters do, and any tool that shows you a single answer as \"your result\" is misleading you.",
      },
      { type: "h2", text: "Broken assumption 3: the click is the prize" },
      {
        type: "p",
        text: "SEO ends with a visit to your page. An AI answer often ends the journey right there: the user asks, reads the recommendation, and acts. Your brand needs to survive being paraphrased. If your positioning only works when someone reads your homepage hero, it doesn't work in this channel at all.",
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
    ],
  },
  {
    slug: "how-to-measure-ai-visibility",
    title: "How to measure AI visibility without fooling yourself",
    description:
      "AI answers are non-deterministic, so most casual checks mislead. What a defensible AI visibility measurement needs: sampling, provider labels, position, and citations.",
    published: "2026-08-14",
    updated: "2026-08-14",
    readingMinutes: 6,
    blocks: [
      {
        type: "p",
        text: "The most common way teams check their AI visibility is also the worst: type a question into ChatGPT, screenshot the answer, and draw a conclusion. Run the same question five more times and you'll often get a different list. Measuring a non-deterministic system takes the same discipline as polling - and skipping that discipline produces confident, wrong conclusions.",
      },
      { type: "h2", text: "Sample, don't spot-check" },
      {
        type: "p",
        text: "A single answer is an anecdote. Ask the same question many times and the noise averages into a signal: appearing in 8 of 10 runs versus 1 of 10 is a real, stable difference even though any individual run varies. Every credible number downstream - trends, competitor gaps, the effect of your changes - depends on this.",
      },
      { type: "h2", text: "Hold the method constant" },
      {
        type: "list",
        items: [
          "Label the provider and model. \"AI visibility\" isn't one number - GPT-5 with web search, Gemini, and Perplexity behave differently and should be reported separately.",
          "Keep prompts unbiased. Asking \"is Acme good?\" tells the model the answer you want. Ask what a buyer would ask, with no brand in the prompt.",
          "Version the methodology. When you change prompts, models, or sample size, mark the break - otherwise you'll read a method change as a market change.",
          "Timestamp everything. Answers drift when models update; a number without a date is unusable.",
        ],
      },
      { type: "h2", text: "Measure more than mentions" },
      {
        type: "p",
        text: "Whether you're named is the headline, but two other dimensions decide what a mention is worth. Position: first-named products get chosen; fifth-named rarely do. Citations: which sources the answer drew on - because that list is where your visibility actually comes from, and it's the only part you can directly act on.",
      },
      { type: "h2", text: "Track competitors in the same runs" },
      {
        type: "p",
        text: "Your mention rate alone has no scale. Appearing in 40% of answers is excellent if your nearest competitor appears in 10%, and alarming if they appear in 90%. Because competitors get measured in the very same sampled answers, the comparison is apples to apples by construction.",
      },
      { type: "h2", text: "What a good report looks like" },
      {
        type: "p",
        text: "Provider-labelled mention rates with sample sizes, position when mentioned, the cited sources ranked by frequency, competitor rates from the same runs, and a methodology version plus timestamp on all of it. This is the shape we built RankedByAI's reports around - but the principles hold whether you use a tool or a spreadsheet and an API key.",
      },
    ],
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}
