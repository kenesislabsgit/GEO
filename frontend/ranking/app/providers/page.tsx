import Link from "next/link";
import { MarketingShell } from "@/components/site/marketing-shell";
import { ProductCrossNav } from "@/components/site/product-cross-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import {
  ALL_PROVIDERS,
  METHODOLOGY_VERSION,
  MOST_USED_PROVIDERS,
  providerDisplayName,
} from "@/lib/constants";
import { routes } from "@/lib/routes";
import type { ProviderId } from "@/types/database";

export const metadata = {
  title: "Provider coverage",
  description:
    "Every AI provider Arcanoris can query, how each call is made, and which Free, Plus, and Pro plans include it.",
  alternates: { canonical: routes.providers },
};

type ProviderNote = {
  query: string;
  search: string;
};

const NOTES: Partial<Record<ProviderId, ProviderNote>> = {
  openai_search: {
    query: "OpenAI Responses API",
    search: "Web search tool on",
  },
  bedrock_claude: {
    query: "Claude via Amazon Bedrock API",
    search: "API only — citations labelled as model-suggested unless independently grounded",
  },
  gemini: {
    query: "Gemini generateContent API",
    search: "Official API; grounding URLs stored when returned",
  },
  perplexity: {
    query: "Perplexity API",
    search: "Provider-grounded answers",
  },
  grok: {
    query: "xAI API",
    search: "API only",
  },
  deepseek: {
    query: "DeepSeek API",
    search: "API only",
  },
  bedrock_mistral: {
    query: "Mistral via Amazon Bedrock API",
    search: "API only",
  },
  kimi: {
    query: "Kimi API",
    search: "API only",
  },
  bedrock_nova: {
    query: "Amazon Nova via Bedrock API",
    search: "API only",
  },
  groq: {
    query: "Groq API",
    search: "API only",
  },
  minimax: {
    query: "MiniMax API",
    search: "API only",
  },
  sarvam: {
    query: "Sarvam API",
    search: "API only",
  },
  qwen: {
    query: "Qwen API",
    search: "API only",
  },
};

function planMarks(id: ProviderId): { free: boolean; plus: boolean; pro: boolean } {
  return {
    free: PLAN_CONFIG.free.features.providers.includes(id),
    plus: PLAN_CONFIG.founder.features.providers.includes(id),
    pro: PLAN_CONFIG.agency.features.providers.includes(id),
  };
}

export default function ProvidersPage() {
  return (
    <MarketingShell narrow>
      <section className="border-b border-border pb-14 md:pb-20">
        <Badge variant="secondary" className="rounded-full font-mono text-[11px]">
          {METHODOLOGY_VERSION}
        </Badge>
        <h1 className="font-heading mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
          Provider coverage
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          {ALL_PROVIDERS.length} providers, queried through their APIs — never
          by scraping a consumer chat window. API samples can differ from
          what one person sees in the consumer app. Every stored answer
          keeps the exact model id.
        </p>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          How plans pick providers
        </h2>
        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
          <li className="flex gap-3">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
            Free always runs ChatGPT with web search. One provider,{" "}
            {PLAN_CONFIG.free.features.activePrompts} questions.
          </li>
          <li className="flex gap-3">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
            Plus runs all {PLAN_CONFIG.founder.features.providers.length} of
            its catalog on every audit: ChatGPT, Claude, Gemini, Perplexity,
            and Mistral.
          </li>
          <li className="flex gap-3">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
            Pro can pick any {PLAN_CONFIG.agency.features.providersPerScan} of{" "}
            {PLAN_CONFIG.agency.features.providers.length} for one audit.
            Swap in the picker. A missing API key on our side marks that
            provider partial instead of dropping it quietly.
          </li>
          <li className="flex gap-3">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
            Growth (waitlist) would run the {MOST_USED_PROVIDERS.length}{" "}
            most-used consumer AIs. It is not on sale.
          </li>
        </ul>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Coverage matrix
        </h2>
        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 font-medium">
              <tr>
                <th className="px-3 py-3">Provider</th>
                <th className="px-3 py-3">How we query</th>
                <th className="px-3 py-3">Search / grounding</th>
                <th className="px-3 py-3">Free</th>
                <th className="px-3 py-3">Plus</th>
                <th className="px-3 py-3">Pro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ALL_PROVIDERS.map((id) => {
                const note = NOTES[id];
                const plans = planMarks(id);
                return (
                  <tr key={id}>
                    <td className="px-3 py-3 font-medium">
                      {providerDisplayName(id)}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {note?.query ?? "Official API"}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {note?.search ?? "API only"}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {plans.free ? "Yes" : "—"}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {plans.plus ? "Yes" : "—"}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {plans.pro ? "Yes" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Buyers see ChatGPT once. The free and paid audits use the
          ChatGPT route that has web search on.
        </p>
      </section>

      <section className="py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Update log
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          This matrix matches the catalog shipped with methodology{" "}
          {METHODOLOGY_VERSION}. We do not have public dates for when each
          provider was first added. When a provider is added or a plan
          mapping changes, this page and the methodology page update
          together.
        </p>
        <ul className="mt-6 space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li className="flex gap-3">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
            Current catalog: {ALL_PROVIDERS.map((id) => providerDisplayName(id)).join(", ")}.
          </li>
          <li className="flex gap-3">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
            Scoring, prompt rules, and limitations stay on{" "}
            <Link href={routes.methodology} className="underline underline-offset-4">
              Methodology
            </Link>
            .
          </li>
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="sm">
            <Link href={routes.pricing}>See plan picker limits</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={routes.methodology}>Methodology</Link>
          </Button>
        </div>
        <div className="mt-14">
          <ProductCrossNav current={routes.providers} />
        </div>
      </section>
    </MarketingShell>
  );
}
