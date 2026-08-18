import { DEFAULT_SCAN_PROVIDERS, FREE_AUDIT_PROVIDER } from "@/lib/constants";
import type { ProviderId } from "@/types/database";

export type PlanId = "free" | "founder" | "growth" | "agency";

export type PlanFeatures = {
  brands: number;
  activePrompts: number;
  /** Every provider the plan may pick from. Can exceed providersPerScan. */
  providers: ProviderId[];
  /** How many providers one audit can run at once. */
  providersPerScan: number;
  competitorsPerBrand: number;
  countries: number;
  languages: number;
  providerChecksPerMonth: number;
  weeklyMonitoring: boolean;
  dailyMonitoring: boolean;
  /** Pro only: a slice of audit questions asked as a buyer in the
   * company's home market would, with web search pinned to that country. */
  geoMarketSearch: boolean;
  fullAnswers: boolean;
  fullCitations: boolean;
  history: boolean;
  citationGaps: boolean;
  shareOfVoice: boolean;
  actionCentre: boolean;
  emailAlerts: boolean;
  publicPrivateReports: boolean;
  contentBriefs: boolean;
  impactTracking: boolean;
  pdfCsvExport: boolean;
  // Team seats, white-label reports, client dashboards, custom branding,
  // bulk import, webhooks and priority scanning were flags with no
  // implementation behind them. They were removed from the plans and the
  // marketing pages rather than sold; add a flag back the day its feature
  // actually exists.
};

export type PlanConfig = {
  id: PlanId;
  name: string;
  description: string;
  monthlyPriceUsd: number;
  yearlyPriceUsd: number;
  trialDays: number;
  features: PlanFeatures;
  monthlyProductEnv: string | null;
  yearlyProductEnv: string | null;
};

export const PLAN_CONFIG: Record<PlanId, PlanConfig> = {
  free: {
    id: "free",
    name: "Free",
    description: "One public website, five questions, one audit every 30 days.",
    monthlyPriceUsd: 0,
    yearlyPriceUsd: 0,
    trialDays: 0,
    monthlyProductEnv: null,
    yearlyProductEnv: null,
    features: {
      brands: 1,
      activePrompts: 5,
      providers: [FREE_AUDIT_PROVIDER],
      providersPerScan: 1,
      competitorsPerBrand: 1,
      countries: 1,
      languages: 1,
      providerChecksPerMonth: 5,
      weeklyMonitoring: false,
      dailyMonitoring: false,
      geoMarketSearch: false,
      fullAnswers: false,
      fullCitations: false,
      history: false,
      citationGaps: false,
      shareOfVoice: false,
      actionCentre: false,
      emailAlerts: false,
      publicPrivateReports: false,
      contentBriefs: false,
      impactTracking: false,
      pdfCsvExport: false,
    },
  },
  founder: {
    id: "founder",
    name: "Plus",
    description: "One website, multi-provider monitoring, and full evidence.",
    monthlyPriceUsd: 49,
    yearlyPriceUsd: 490,
    trialDays: 7,
    monthlyProductEnv: "DODO_FOUNDER_MONTHLY_PRODUCT_ID",
    yearlyProductEnv: "DODO_FOUNDER_YEARLY_PRODUCT_ID",
    features: {
      brands: 1,
      activePrompts: 20,
      providers: ["openai_search", "bedrock_claude", "gemini", "bedrock_mistral"],
      providersPerScan: 4,
      competitorsPerBrand: 5,
      countries: 1,
      languages: 1,
      providerChecksPerMonth: 400,
      weeklyMonitoring: true,
      dailyMonitoring: false,
      geoMarketSearch: false,
      fullAnswers: true,
      fullCitations: true,
      history: true,
      citationGaps: true,
      shareOfVoice: true,
      actionCentre: true,
      emailAlerts: true,
      publicPrivateReports: true,
      contentBriefs: false,
      impactTracking: false,
      pdfCsvExport: false,
    },
  },
  // Grandfathered: no longer sold. The pricing page and every "upgrade to"
  // CTA skip this id now - it stays here only so the one existing "growth"
  // subscriber's entitlements keep resolving instead of crashing on a
  // missing plan lookup. Do not remove until that subscriber is migrated.
  growth: {
    id: "growth",
    name: "Pro+",
    description: "Multi-website tracking, daily monitoring, and exports.",
    monthlyPriceUsd: 79,
    yearlyPriceUsd: 790,
    trialDays: 0,
    monthlyProductEnv: "DODO_GROWTH_MONTHLY_PRODUCT_ID",
    yearlyProductEnv: "DODO_GROWTH_YEARLY_PRODUCT_ID",
    features: {
      brands: 5,
      activePrompts: 100,
      // Every provider here is genuinely wired into the audit engine - 
      // see OPENAI_COMPAT_PROVIDERS in GEO/geo_audit/llm.py for the eight
      // OpenAI-compatible ones. Providers without configured API keys show
      // up as partial in scan results rather than silently vanishing.
      providers: [
        "openai_search",
        "bedrock_claude",
        // Gemini is out until it has a paid quota. On a free key it answered
        // seven of ten questions and returned redirect addresses that identify
        // nobody, so it cost a tenth of the run's answers and contributed no
        // usable citations.
        "perplexity",
        "grok",
        "deepseek",
        "bedrock_llama",
        "bedrock_mistral",
        "kimi",
        "bedrock_nova",
        "groq",
        "minimax",
        "sarvam",
        "qwen",
      ],
      providersPerScan: 10,
      competitorsPerBrand: 10,
      countries: 5,
      languages: 5,
      providerChecksPerMonth: 2500,
      weeklyMonitoring: true,
      dailyMonitoring: true,
      geoMarketSearch: true,
      fullAnswers: true,
      fullCitations: true,
      history: true,
      citationGaps: true,
      shareOfVoice: true,
      actionCentre: true,
      emailAlerts: true,
      publicPrivateReports: true,
      contentBriefs: true,
      impactTracking: true,
      pdfCsvExport: true,
    },
  },
  agency: {
    id: "agency",
    name: "Pro",
    description: "Everything in Plus, at higher limits: 20 websites and a 10k check allowance.",
    monthlyPriceUsd: 199,
    yearlyPriceUsd: 1990,
    trialDays: 0,
    monthlyProductEnv: "DODO_AGENCY_MONTHLY_PRODUCT_ID",
    yearlyProductEnv: "DODO_AGENCY_YEARLY_PRODUCT_ID",
    features: {
      brands: 20,
      activePrompts: 500,
      // Every provider here is genuinely wired into the audit engine - 
      // see OPENAI_COMPAT_PROVIDERS in GEO/geo_audit/llm.py for the eight
      // OpenAI-compatible ones. Providers without configured API keys show
      // up as partial in scan results rather than silently vanishing.
      providers: [
        "openai_search",
        "bedrock_claude",
        // Gemini is out until it has a paid quota. On a free key it answered
        // seven of ten questions and returned redirect addresses that identify
        // nobody, so it cost a tenth of the run's answers and contributed no
        // usable citations.
        "perplexity",
        "grok",
        "deepseek",
        "bedrock_llama",
        "bedrock_mistral",
        "kimi",
        "bedrock_nova",
        "groq",
        "minimax",
        "sarvam",
        "qwen",
      ],
      providersPerScan: 10,
      competitorsPerBrand: 20,
      countries: 20,
      languages: 20,
      providerChecksPerMonth: 10000,
      weeklyMonitoring: true,
      dailyMonitoring: true,
      geoMarketSearch: true,
      fullAnswers: true,
      fullCitations: true,
      history: true,
      citationGaps: true,
      shareOfVoice: true,
      actionCentre: true,
      emailAlerts: true,
      publicPrivateReports: true,
      contentBriefs: true,
      impactTracking: true,
      pdfCsvExport: true,
    },
  },
};

export function getProductIdForPlan(
  plan: PlanId,
  interval: "monthly" | "yearly",
): string | null {
  if (plan === "free") return null;
  const config = PLAN_CONFIG[plan];
  const envKey =
    interval === "monthly" ? config.monthlyProductEnv : config.yearlyProductEnv;
  if (!envKey) return null;
  return process.env[envKey] ?? null;
}

export function resolvePlanFromProductId(productId: string | null | undefined): PlanId {
  if (!productId) return "free";
  const entries = Object.values(PLAN_CONFIG);
  for (const plan of entries) {
    if (!plan.monthlyProductEnv || !plan.yearlyProductEnv) continue;
    const monthly = process.env[plan.monthlyProductEnv];
    const yearly = process.env[plan.yearlyProductEnv];
    if (productId === monthly || productId === yearly) {
      return plan.id;
    }
  }
  return "free";
}

export type EntitlementContext = {
  plan: PlanId;
  status: "active" | "trialing" | "canceled" | "past_due" | "inactive" | "paused";
  providerChecksUsed: number;
  brandCount: number;
  activePromptCount: number;
};

export function getFeaturesForPlan(plan: PlanId): PlanFeatures {
  return PLAN_CONFIG[plan].features;
}

/**
 * The providers a scan runs when the user hasn't picked any: the default
 * ten (in display order), topped up from the plan's catalog if needed, and
 * always capped at what one audit may run. Every code path that starts a
 * scan without an explicit selection must use this, not features.providers - 
 * the catalog can be larger than a single audit.
 */
export function defaultScanProviders(plan: PlanId): ProviderId[] {
  const { providers, providersPerScan } = PLAN_CONFIG[plan].features;
  const preferred = DEFAULT_SCAN_PROVIDERS.filter((p) =>
    providers.includes(p),
  );
  const rest = providers.filter(
    (p) => !(DEFAULT_SCAN_PROVIDERS as readonly string[]).includes(p),
  );
  return [...preferred, ...rest].slice(0, providersPerScan);
}

export function hasFeature(
  plan: PlanId,
  feature: keyof PlanFeatures,
): boolean {
  const value = PLAN_CONFIG[plan].features[feature];
  return typeof value === "boolean" ? value : Boolean(value);
}

export function assertWithinLimit(
  used: number,
  limit: number,
  message: string,
): void {
  if (used >= limit) {
    throw new EntitlementError(message);
  }
}

export class EntitlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntitlementError";
  }
}

export function canRunProviderCheck(ctx: EntitlementContext): boolean {
  if (ctx.status !== "active" && ctx.status !== "trialing" && ctx.plan !== "free") {
    return false;
  }
  const limit = PLAN_CONFIG[ctx.plan].features.providerChecksPerMonth;
  return ctx.providerChecksUsed < limit;
}

export function assertCanCreateBrand(ctx: EntitlementContext): void {
  // Free accounts may own one public brand (claim or dashboard free scan).
  // Paid plans require an active or trialing subscription.
  if (ctx.plan !== "free") {
    if (ctx.status !== "active" && ctx.status !== "trialing") {
      throw new EntitlementError("Your subscription is not active.");
    }
  }
  assertWithinLimit(
    ctx.brandCount,
    PLAN_CONFIG[ctx.plan].features.brands,
    `Your ${PLAN_CONFIG[ctx.plan].name} plan allows ${PLAN_CONFIG[ctx.plan].features.brands} brand(s). Upgrade to add more.`,
  );
}

export function assertCanAddPrompt(ctx: EntitlementContext): void {
  if (ctx.plan === "free") {
    throw new EntitlementError("Upgrade to manage custom prompts.");
  }
  assertWithinLimit(
    ctx.activePromptCount,
    PLAN_CONFIG[ctx.plan].features.activePrompts,
    `Prompt limit reached for the ${PLAN_CONFIG[ctx.plan].name} plan.`,
  );
}

export function assertCanUseProvider(
  plan: PlanId,
  provider: "openai" | "gemini" | "perplexity",
): void {
  if (!PLAN_CONFIG[plan].features.providers.includes(provider)) {
    throw new EntitlementError(
      `${provider} is not available on the ${PLAN_CONFIG[plan].name} plan.`,
    );
  }
}

export function assertCanAddCompetitor(
  ctx: EntitlementContext,
  currentCount: number,
): void {
  if (ctx.plan === "free") {
    throw new EntitlementError("Upgrade to manage competitors.");
  }
  assertWithinLimit(
    currentCount,
    PLAN_CONFIG[ctx.plan].features.competitorsPerBrand,
    `Competitor limit reached for the ${PLAN_CONFIG[ctx.plan].name} plan.`,
  );
}

export function assertCanExport(ctx: EntitlementContext): void {
  if (!PLAN_CONFIG[ctx.plan].features.pdfCsvExport) {
    throw new EntitlementError(
      "CSV and PDF exports require the Pro plan.",
    );
  }
}
