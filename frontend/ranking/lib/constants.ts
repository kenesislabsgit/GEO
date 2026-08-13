export const APP_NAME = "RankedByAI";
export const APP_TAGLINE = "Does AI recommend your company?";
export const METHODOLOGY_VERSION = "v1.1.0";

export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: "OpenAI",
  openai_search: "OpenAI Search",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
  bedrock_claude: "Bedrock Claude Haiku",
  bedrock_nova: "Bedrock Nova",
  bedrock_llama: "Bedrock Llama",
  bedrock_mistral: "Bedrock Mistral",
};

export function providerDisplayName(id: string): string {
  return PROVIDER_DISPLAY_NAMES[id] ?? id;
}

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
// This is a generation pool size, not the free audit's question count — that
// is FREE_AUDIT_QUESTION_COUNT below.
export const FREE_PROMPT_COUNT = 10;

/**
 * The free audit, defined in one place so it cannot drift between the homepage,
 * the dashboard and the plan config. OpenAI with web search is what makes the
 * free report show real, checked sources.
 */
export const FREE_AUDIT_PROVIDER = "openai_search" as const;
export const FREE_AUDIT_QUESTION_COUNT = 5;
/** Websites read for the most-recommended competitor, to ground one action. */
export const FREE_AUDIT_COMPETITORS_CRAWLED = 1;
export const FREE_AUDIT_COMPETITOR_PAGES = 3;
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
 * per question for the searching provider plus one batched task per Bedrock
 * model — 23 in total at twenty questions — so anything below that leaves
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

export const SCORE_WEIGHTS = {
  mention: 0.65,
  position: 0.3,
  citation: 0,
  sentiment: 0.05,
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
