/**
 * What the customer is told while an audit runs.
 *
 * The runner names its own steps for its own logs - "web_presence",
 * "extract_user_evidence" - and those names describe how the product is built
 * rather than what the customer is getting. They used to reach the screen
 * verbatim. This file is the one place the wording is decided, so a tagline can
 * be changed without touching the runner or the components.
 *
 * A stage may cover several runner steps. The free audit genuinely does less
 * work than Pro, and its stage list is shorter to match: showing the same nine
 * lines for both would claim a thoroughness the free run does not have.
 */

export type AuditPlan = "free" | "pro";

export type AuditStage = {
  /** Stable key. Used for React keys and future per-stage animation. */
  id: string;
  /** Runner step names that light this stage up. */
  steps: readonly string[];
  /** Shown to the customer. Safe to reword freely. */
  label: string | ((providers: readonly string[]) => string);
  /** Fallback position, used only when the runner sends a step we do not know. */
  at: number;
};

/**
 * Assistant names as customers know them ("ChatGPT"), which can differ from
 * the report's model names ("OpenAI Search").
 */
const ASSISTANT_NAMES: Record<string, string> = {
  openai: "ChatGPT",
  openai_search: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
  bedrock_claude: "Claude",
  bedrock_nova: "Nova",
  bedrock_llama: "Llama",
  bedrock_mistral: "Mistral",
};

/** Distinct customer-facing names, in the order the providers were given. */
export function assistantNames(providers: readonly string[]): string[] {
  const names: string[] = [];
  for (const provider of providers) {
    const name = ASSISTANT_NAMES[provider];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Only ever names an assistant this run actually asked. Saying "ChatGPT,
 * Claude and others" on a run that asked one of them would be a claim about
 * the customer's own results, and a wrong one.
 */
export function describeAssistants(providers: readonly string[]): string {
  const names = assistantNames(providers);
  if (names.length === 0) return "AI assistants";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and others`;
}

const READING_STEPS = [
  "starting",
  "resume_free_audit",
  "crawl_user_site",
  "extract_user_evidence",
] as const;

const FREE_STAGES: readonly AuditStage[] = [
  { id: "read", steps: READING_STEPS, label: "Reading your website", at: 1 },
  {
    id: "understand",
    steps: ["company_profile"],
    label: "Understanding your business",
    at: 25,
  },
  {
    id: "questions",
    steps: ["buyer_prompts"],
    label: "Thinking like your customers",
    at: 40,
  },
  {
    id: "asking",
    steps: ["provider_questions"],
    label: (providers) => `Asking ${describeAssistants(providers)} what it recommends`,
    at: 45,
  },
  // Free reads one competitor and writes one action, so the last four runner
  // steps are one line here. Pro earns four.
  {
    id: "finish",
    steps: [
      "pattern_analysis",
      // Free is run with web presence switched off, so this step should never
      // arrive. It is claimed anyway: an unclaimed step falls back to matching
      // on the percentage, which is the guessing this file replaced.
      "web_presence",
      "competitor_evidence",
      "comparison",
      "improvement_recommendations",
      "final_report",
      "frontend_export",
      "frontend_import",
    ],
    label: "Checking who's beating you, and what to fix first",
    at: 72,
  },
];

const PRO_STAGES: readonly AuditStage[] = [
  { id: "read", steps: READING_STEPS, label: "Reading your website", at: 1 },
  {
    id: "understand",
    steps: ["company_profile"],
    label: "Understanding your business",
    at: 25,
  },
  {
    id: "questions",
    steps: ["buyer_prompts"],
    label: "Thinking like your customers",
    at: 40,
  },
  {
    id: "asking",
    steps: ["provider_questions"],
    label: (providers) => `Asking ${describeAssistants(providers)} what they recommend`,
    at: 45,
  },
  {
    id: "counting",
    steps: ["pattern_analysis"],
    label: "Counting who gets named",
    at: 72,
  },
  // Deliberately not "searching the web". What matters to the customer is not
  // that we ran searches, it is that the pages we find are what taught the
  // assistants who to recommend. Same framing as the Sources page.
  {
    id: "knowledge",
    steps: ["web_presence"],
    label: "Finding what the internet has taught AI about you",
    at: 76,
  },
  {
    id: "rivals",
    steps: ["competitor_evidence"],
    label: "Studying the companies beating you",
    at: 82,
  },
  { id: "gaps", steps: ["comparison"], label: "Finding your gaps", at: 88 },
  {
    id: "actions",
    steps: [
      "improvement_recommendations",
      "final_report",
      "frontend_export",
      "frontend_import",
    ],
    label: "Writing your action plan",
    at: 91,
  },
];

export function auditStages(plan: AuditPlan): readonly AuditStage[] {
  return plan === "pro" ? PRO_STAGES : FREE_STAGES;
}

export function stageLabel(
  stage: AuditStage,
  providers: readonly string[],
): string {
  return typeof stage.label === "function" ? stage.label(providers) : stage.label;
}

/**
 * Which stage is running now.
 *
 * The step name is the truth: it says what the runner is actually doing. The
 * percentage is only a fallback for a step this file has not been taught yet,
 * so a new runner step shows a roughly right stage instead of snapping back to
 * the first one.
 */
export function activeStageIndex(
  stages: readonly AuditStage[],
  step: string | null,
  progress: number,
): number {
  if (step) {
    const matched = stages.findIndex((stage) => stage.steps.includes(step));
    if (matched >= 0) return matched;
  }
  const byProgress = stages.findLastIndex((stage) => progress >= stage.at);
  return Math.max(0, byProgress);
}
