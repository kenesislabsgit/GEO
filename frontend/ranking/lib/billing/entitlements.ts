import { FREE_AUDIT_PROVIDER } from "@/lib/constants";
import type { ProviderId } from "@/types/database";

export type PlanId = "free" | "founder" | "growth" | "agency";

export type PlanFeatures = {
  brands: number;
  activePrompts: number;
  providers: ProviderId[];
  competitorsPerBrand: number;
  countries: number;
  languages: number;
  providerChecksPerMonth: number;
  teamSeats: number;
  weeklyMonitoring: boolean;
  dailyMonitoring: boolean;
  fullAnswers: boolean;
  fullCitations: boolean;
  history: boolean;
  citationGaps: boolean;
  shareOfVoice: boolean;
  actionCentre: boolean;
  brandAccuracy: boolean;
  emailAlerts: boolean;
  publicPrivateReports: boolean;
  contentBriefs: boolean;
  impactTracking: boolean;
  pdfCsvExport: boolean;
  whiteLabel: boolean;
  clientDashboards: boolean;
  customBranding: boolean;
  bulkImport: boolean;
  webhooks: boolean;
  priorityScanning: boolean;
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
      competitorsPerBrand: 1,
      countries: 1,
      languages: 1,
      providerChecksPerMonth: 5,
      teamSeats: 1,
      weeklyMonitoring: false,
      dailyMonitoring: false,
      fullAnswers: false,
      fullCitations: false,
      history: false,
      citationGaps: false,
      shareOfVoice: false,
      actionCentre: false,
      brandAccuracy: false,
      emailAlerts: false,
      publicPrivateReports: false,
      contentBriefs: false,
      impactTracking: false,
      pdfCsvExport: false,
      whiteLabel: false,
      clientDashboards: false,
      customBranding: false,
      bulkImport: false,
      webhooks: false,
      priorityScanning: false,
    },
  },
  founder: {
    id: "founder",
    name: "Pro",
    description: "One website, multi-provider monitoring, and full evidence.",
    monthlyPriceUsd: 29,
    yearlyPriceUsd: 290,
    trialDays: 7,
    monthlyProductEnv: "DODO_FOUNDER_MONTHLY_PRODUCT_ID",
    yearlyProductEnv: "DODO_FOUNDER_YEARLY_PRODUCT_ID",
    features: {
      brands: 1,
      activePrompts: 20,
      providers: ["openai_search", "bedrock_claude", "bedrock_llama", "bedrock_mistral"],
      competitorsPerBrand: 5,
      countries: 1,
      languages: 1,
      providerChecksPerMonth: 400,
      teamSeats: 1,
      weeklyMonitoring: true,
      dailyMonitoring: false,
      fullAnswers: true,
      fullCitations: true,
      history: true,
      citationGaps: true,
      shareOfVoice: true,
      actionCentre: true,
      brandAccuracy: true,
      emailAlerts: true,
      publicPrivateReports: true,
      contentBriefs: false,
      impactTracking: false,
      pdfCsvExport: false,
      whiteLabel: false,
      clientDashboards: false,
      customBranding: false,
      bulkImport: false,
      webhooks: false,
      priorityScanning: false,
    },
  },
  growth: {
    id: "growth",
    name: "Pro+",
    description: "Multi-website tracking, exports, and team seats.",
    monthlyPriceUsd: 79,
    yearlyPriceUsd: 790,
    trialDays: 0,
    monthlyProductEnv: "DODO_GROWTH_MONTHLY_PRODUCT_ID",
    yearlyProductEnv: "DODO_GROWTH_YEARLY_PRODUCT_ID",
    features: {
      brands: 5,
      activePrompts: 100,
      providers: ["openai_search", "bedrock_claude", "bedrock_llama", "bedrock_mistral", "bedrock_nova"],
      competitorsPerBrand: 10,
      countries: 5,
      languages: 5,
      providerChecksPerMonth: 2500,
      teamSeats: 3,
      weeklyMonitoring: true,
      dailyMonitoring: true,
      fullAnswers: true,
      fullCitations: true,
      history: true,
      citationGaps: true,
      shareOfVoice: true,
      actionCentre: true,
      brandAccuracy: true,
      emailAlerts: true,
      publicPrivateReports: true,
      contentBriefs: true,
      impactTracking: true,
      pdfCsvExport: true,
      whiteLabel: false,
      clientDashboards: false,
      customBranding: false,
      bulkImport: false,
      webhooks: false,
      priorityScanning: false,
    },
  },
  agency: {
    id: "agency",
    name: "Agency",
    description: "White-label reports, bulk import, and webhooks.",
    monthlyPriceUsd: 199,
    yearlyPriceUsd: 1990,
    trialDays: 0,
    monthlyProductEnv: "DODO_AGENCY_MONTHLY_PRODUCT_ID",
    yearlyProductEnv: "DODO_AGENCY_YEARLY_PRODUCT_ID",
    features: {
      brands: 20,
      activePrompts: 500,
      providers: ["openai_search", "bedrock_claude", "bedrock_llama", "bedrock_mistral", "bedrock_nova"],
      competitorsPerBrand: 20,
      countries: 20,
      languages: 20,
      providerChecksPerMonth: 10000,
      teamSeats: 10,
      weeklyMonitoring: true,
      dailyMonitoring: true,
      fullAnswers: true,
      fullCitations: true,
      history: true,
      citationGaps: true,
      shareOfVoice: true,
      actionCentre: true,
      brandAccuracy: true,
      emailAlerts: true,
      publicPrivateReports: true,
      contentBriefs: true,
      impactTracking: true,
      pdfCsvExport: true,
      whiteLabel: true,
      clientDashboards: true,
      customBranding: true,
      bulkImport: true,
      webhooks: true,
      priorityScanning: true,
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
      "CSV and PDF exports require the Pro+ or Agency plan.",
    );
  }
}
