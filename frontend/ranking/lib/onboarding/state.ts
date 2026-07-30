import type { Brand } from "@/types/database";
import type { OnboardingState } from "@/types/onboarding";
import { PLAN_CONFIG, type PlanId } from "@/lib/billing/entitlements";

export function createInitialOnboardingState(input: {
  brand: Brand;
  plan: PlanId;
  competitors: Array<{ name: string; domain: string | null }>;
  promptIds: string[];
}): OnboardingState {
  const features = PLAN_CONFIG[input.plan].features;
  return {
    completed: false,
    currentStep: 1,
    brandId: input.brand.id,
    company: {
      name: input.brand.name,
      category: input.brand.category ?? "",
      description: input.brand.description ?? "",
      domain: input.brand.canonical_domain,
    },
    competitors: input.competitors.map((c) => ({
      name: c.name,
      domain: c.domain,
    })),
    activePromptIds: input.promptIds,
    providers: [...features.providers],
    country: input.brand.default_country.toLowerCase(),
    language: input.brand.default_language.toLowerCase(),
    monitoringFrequency: features.dailyMonitoring ? "daily" : "weekly",
    alerts: {
      scoreDrop: true,
      competitor: true,
      citation: false,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function isOnboardingComplete(state: OnboardingState | null): boolean {
  return Boolean(state?.completed);
}
