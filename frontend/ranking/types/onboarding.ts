import type { ProviderId } from "@/types/database";

export type MonitoringFrequency = "weekly" | "daily";

export type OnboardingAlertPreferences = {
  scoreDrop: boolean;
  competitor: boolean;
  citation: boolean;
};

export type OnboardingCompetitor = {
  name: string;
  domain: string | null;
};

export type OnboardingState = {
  completed: boolean;
  currentStep: number;
  brandId: string | null;
  company: {
    name: string;
    category: string;
    description: string;
    domain: string;
  };
  competitors: OnboardingCompetitor[];
  activePromptIds: string[];
  providers: ProviderId[];
  country: string;
  language: string;
  monitoringFrequency: MonitoringFrequency;
  alerts: OnboardingAlertPreferences;
  updatedAt: string;
};

export const ONBOARDING_STEPS = [
  "Company",
  "Competitors",
  "Questions",
  "Providers",
  "Region",
  "Monitoring",
  "Alerts",
  "First scan",
] as const;

export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length;

/** Applied to a brand when onboarding completes (monitoring + alerts). */
export type BrandMonitoringSettings = {
  monitoringFrequency: MonitoringFrequency;
  alerts: OnboardingAlertPreferences;
  providers: ProviderId[];
  country: string;
  language: string;
  updatedAt: string;
};
