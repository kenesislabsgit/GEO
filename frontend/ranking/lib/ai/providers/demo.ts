import type { ProviderId } from "@/types/database";
import type { ProviderQueryInput, ProviderQueryResult } from "./types";

const DEMO_ANSWERS = [
  {
    answer:
      "For teams evaluating options in this category, commonly recommended products include Acme Analytics, Northstar Suite, and Beacon Ops. Acme Analytics is frequently cited for mid-market teams that need faster onboarding, while Northstar Suite tends to appear for enterprise buyers. Sources often reference comparison pages and recent review roundups.",
    citations: [
      {
        url: "https://www.g2.com/categories/example",
        title: "Category reviews",
        domain: "g2.com",
      },
      {
        url: "https://www.example.com/blog/buyers-guide",
        title: "Buyer guide",
        domain: "example.com",
      },
    ],
  },
  {
    answer:
      "Budget-conscious buyers often shortlist Lite tools and open alternatives before considering premium suites. Recommendation order varies by use case, integrations, and regional support coverage.",
    citations: [
      {
        url: "https://www.capterra.com/example-software/",
        title: "Software directory",
        domain: "capterra.com",
      },
    ],
  },
];

export function isDemoModeForced(): boolean {
  return process.env.FORCE_DEMO_MODE === "true";
}

export function providerKeyMissing(provider: ProviderId): boolean {
  if (isDemoModeForced()) return true;
  switch (provider) {
    case "openai":
      return !process.env.OPENAI_API_KEY;
    case "gemini":
      return !process.env.GEMINI_API_KEY;
    case "perplexity":
      return !process.env.PERPLEXITY_API_KEY;
    default:
      return true;
  }
}

export function createDemoResult(
  provider: ProviderId,
  model: string,
  input: ProviderQueryInput,
): ProviderQueryResult {
  const pick = DEMO_ANSWERS[Math.abs(hash(input.query)) % DEMO_ANSWERS.length]!;
  const started = Date.now();
  return {
    provider,
    model,
    query: input.query,
    rawAnswer: `[DEMO MODE] ${pick.answer}`,
    citations: pick.citations,
    sources: pick.citations,
    latencyMs: Date.now() - started + 120,
    usage: {
      inputTokens: 400,
      outputTokens: 220,
      totalTokens: 620,
      searchCalls: 1,
      raw: { demo: true },
    },
    error: null,
    timestamp: new Date().toISOString(),
    isDemo: true,
  };
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return h;
}
