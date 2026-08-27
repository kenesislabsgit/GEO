import type { ProviderId } from "@/types/database";

export const APP_NAME = "Arcanoris";
export const APP_TAGLINE = "Does AI recommend your company?";
// The one inbox that actually gets read. Override with
// NEXT_PUBLIC_SUPPORT_EMAIL if a dedicated support address goes live.
export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "admin@kenesis.ai";
// Must track GEO/geo_audit/aggregation.py - the engine stamps every scan
// with its own version; this constant is only the import fallback and the
// version shown on marketing pages.
export const METHODOLOGY_VERSION = "v1.2.0";

/** Customer-facing model names. Which endpoint served a model is an
 * infrastructure detail; the stored `model` field keeps the exact route. */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: "ChatGPT",
  // Web search is how ChatGPT answers buyer questions, not a separate
  // product buyers know - so it reads plain "ChatGPT" everywhere.
  openai_search: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
  bedrock_claude: "Claude",
  bedrock_nova: "Nova",
  bedrock_llama: "Llama",
  bedrock_mistral: "Mistral",
  grok: "Grok",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  groq: "Groq",
  minimax: "MiniMax",
  sarvam: "Sarvam",
  qwen: "Qwen",
};

export function providerDisplayName(id: string): string {
  return PROVIDER_DISPLAY_NAMES[id] ?? id;
}

/** Complete customer-selectable provider catalog, in display order. */
export const ALL_PROVIDERS = [
  "openai_search",
  "bedrock_claude",
  "gemini",
  "perplexity",
  "grok",
  "deepseek",
  "bedrock_mistral",
  "kimi",
  "bedrock_nova",
  "groq",
  "minimax",
  "sarvam",
  "qwen",
] as const satisfies readonly ProviderId[];

/**
 * The eight most-used consumer AIs, in display order. Growth checks all of
 * these on every audit. Pro still offers the full catalog below.
 */
export const MOST_USED_PROVIDERS = [
  ...ALL_PROVIDERS.slice(0, 8),
] as const satisfies readonly ProviderId[];

/**
 * The ten providers pre-selected for a Pro audit, in display order.
 * Every id here is genuinely integrated in the audit engine
 * (GEO/geo_audit/llm.py - the OpenAI-compatible registry covers Perplexity,
 * Grok, DeepSeek, Kimi, Groq, MiniMax, Sarvam and Qwen). Plans offer more than an
 * audit runs at once; users swap picks in the provider picker. This list is
 * also what the landing and pricing pages show.
 */
export const DEFAULT_SCAN_PROVIDERS = [
  ...ALL_PROVIDERS.slice(0, 10),
] as const satisfies readonly ProviderId[];

export const SUPPORTED_COUNTRIES = [
  { code: "us", label: "United States" },
  { code: "gb", label: "United Kingdom" },
  { code: "de", label: "Germany" },
  { code: "fr", label: "France" },
  { code: "in", label: "India" },
  { code: "au", label: "Australia" },
  { code: "ca", label: "Canada" },
  { code: "br", label: "Brazil" },
  { code: "jp", label: "Japan" },
  { code: "es", label: "Spain" },
] as const;

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanese" },
] as const;

export const FREE_SCAN_CACHE_DAYS = Number(
  process.env.FREE_SCAN_CACHE_DAYS ?? "30",
);
// Template questions generated for a brand before an audit narrows them down.
// This is a generation pool size, not the free audit's question count - that
// is FREE_AUDIT_QUESTION_COUNT below.
export const FREE_PROMPT_COUNT = 10;

/**
 * The free audit, defined in one place so it cannot drift between the homepage,
 * the dashboard and the plan config. ChatGPT (OpenAI) with web search is what makes the
 * free report show real, checked sources.
 */
export const FREE_AUDIT_PROVIDER = "openai_search" as const;
export const FREE_AUDIT_QUESTION_COUNT = 5;
/** Answer-cited competitor pages checked to ground one action. */
export const FREE_AUDIT_COMPETITORS_CRAWLED = 1;
export const FREE_AUDIT_COMPETITOR_PAGES = 3;
/** One checked action is the entire free improvement preview. */
export const FREE_AUDIT_ACTION_COUNT = 1;
/** Caps how much searching each free question does, so runs stay predictable. */
export const FREE_AUDIT_SEARCH_CONTEXT = "low" as const;
export const PRO_AUDIT_SEARCH_CONTEXT = "medium" as const;
/**
 * What Pro actually buys. Five questions is too small a sample to measure
 * anything: on a live run the free audit put Kenesis at an average rank of 3.5
 * because it happened to catch its two worst placements, where twenty
 * questions showed 1.83 and first place in half of them. Every Pro caller was
 * still asking for five, so the deep scan was the shallow one.
 */
export const PRO_AUDIT_QUESTION_COUNT = 20;
/** 1 question per call, so all five run at the same time. */
export const AUDIT_SEARCH_BATCH_SIZE = 1;
/**
 * How many provider calls are in flight at once. A Pro run creates one task
 * per question for the searching provider plus one batched task per hosted
 * model - 23 in total at twenty questions - so anything below that leaves
 * questions queueing for no reason.
 */
export const AUDIT_PROVIDER_CONCURRENCY = Number(
  process.env.AUDIT_PROVIDER_CONCURRENCY ?? "20",
);
export const MAX_PROVIDER_ANSWER_CHARS = Number(
  process.env.MAX_PROVIDER_ANSWER_CHARS ?? "20000",
);
export const SCAN_COST_CEILING_USD = Number(
  process.env.SCAN_COST_CEILING_USD ?? "2.50",
);
export const PROVIDER_CONCURRENCY = Number(
  process.env.PROVIDER_CONCURRENCY ?? "3",
);

/**
 * Mirror of SCORE_WEIGHTS in GEO/geo_audit/scoring.py - the engine is the
 * one source of truth and stores its full breakdown with every snapshot;
 * these numbers exist only so marketing pages can describe the formula.
 */
export const SCORE_WEIGHTS = {
  mention: 0.65,
  position: 0.3,
  citation: 0,
  dataConfidence: 0.05,
} as const;

export const POSITION_SCORES: Record<number, number> = {
  1: 100,
  2: 80,
  3: 60,
  4: 40,
  5: 20,
};

export const SENTIMENT_SCORES = {
  positive: 100,
  neutral: 60,
  mixed: 40,
  negative: 10,
} as const;
