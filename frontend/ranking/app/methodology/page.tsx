import { MarketingShell } from "@/components/site/marketing-shell";
import { Badge } from "@/components/ui/badge";
import { METHODOLOGY_VERSION, SCORE_WEIGHTS } from "@/lib/constants";

export const metadata = {
  title: "Methodology",
  description:
    "How RankedByAI measures AI visibility: provider sampling, unbiased prompts, scoring weights, and known limitations.",
  alternates: { canonical: "/methodology" },
};

const weights = [
  {
    name: "Mention",
    weight: SCORE_WEIGHTS.mention,
    body: "Whether your brand appears in the answer at all, matched against your name, aliases, and domain.",
  },
  {
    name: "Position",
    weight: SCORE_WEIGHTS.position,
    body: "Where you appear in the ranked recommendations - first mentions earn full credit, later positions decay.",
  },
  {
    name: "Citation",
    weight: SCORE_WEIGHTS.citation,
    body: "A diagnostic showing whether a search-grounded answer returned verifiable annotations. It does not affect the core visibility score; independently discovered mentions are reported separately.",
  },
  {
    name: "Data confidence",
    weight: SCORE_WEIGHTS.dataConfidence,
    body: "How complete the evidence behind this scan is: whether providers returned usable answers and whether competitor websites could be read. A thin scan scores lower because less was verified.",
  },
];

const providers = [
  {
    name: "ChatGPT Search",
    detail:
      "Responses API with the web_search tool. Answers reflect API sampling, not consumer ChatGPT.",
  },
  {
    name: "Claude",
    detail:
      "Claude model responses via API. Source URLs are labelled as model-suggested unless independently grounded.",
  },
  {
    name: "Gemini, Perplexity, Grok",
    detail:
      "Each queried via its official API and labelled with the exact model that answered.",
  },
  {
    name: "Llama, Mistral, Nova, DeepSeek, Kimi, Groq, MiniMax, Sarvam",
    detail:
      "Additional model perspectives via their APIs. The exact model is stored with every answer; a provider that cannot answer marks the scan partial rather than vanishing.",
  },
];

export default function MethodologyPage() {
  return (
    <MarketingShell narrow>
      <section className="border-b border-border pb-14 md:pb-20">
        <Badge variant="secondary" className="rounded-full font-mono text-[11px]">
          {METHODOLOGY_VERSION}
        </Badge>
        <h1 className="font-heading mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
          Methodology
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          RankedByAI measures whether AI answer engines recommend a brand
          when buyers ask commercial questions. Every report embeds the
          methodology version, timestamp, models, and sample size used.
        </p>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Provider sampling
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          We query official provider APIs only - never scraped consumer
          interfaces. API samples are not guaranteed to match what an
          individual user sees in a consumer chat interface, and we
          label every result accordingly.
        </p>
        <div className="rb-list mt-6 divide-y divide-border">
          {providers.map((provider) => (
            <div key={provider.name} className="bg-card p-5">
              <p className="font-medium">{provider.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {provider.detail}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Unbiased prompts
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Buyer-intent questions are generated from your category and
          audience - never from your brand name. Mentioning the brand in
          the question would prime the model and invalidate the
          measurement. Prompts span discovery, comparison, alternative,
          and purchase-intent phrasing.
        </p>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Scoring weights
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          The AI Visibility Score is a 0–100 weighted composite. Each
          query&apos;s sub-scores are averaged per provider, then
          aggregated across providers.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {weights.map((w) => (
            <div
              key={w.name}
              className="rb-panel p-5"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{w.name}</p>
                <span className="font-mono text-sm text-muted-foreground">
                  {Math.round(w.weight * 100)}%
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground"
                  style={{ width: `${w.weight * 100}%` }}
                />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {w.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Limitations
        </h2>
        <ul className="mt-4 space-y-3">
          {[
            "AI answers are non-deterministic; scores can vary between runs even with identical inputs.",
            "We never fabricate provider results. If a provider API fails after retries, the scan completes as partial and the failure is disclosed on the report.",
            "Recommendations are directional guidance tied to observed answers, website evidence, grounded citations when available, and separately verified web mentions. They are not ranking guarantees.",
            "Provider APIs may use different model snapshots than consumer products; each report records the exact models sampled.",
          ].map((item) => (
            <li
              key={item}
              className="flex gap-3 text-sm leading-relaxed text-muted-foreground"
            >
              <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </MarketingShell>
  );
}
