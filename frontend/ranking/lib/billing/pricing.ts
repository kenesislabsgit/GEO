import { PLAN_CONFIG, type PlanConfig, type PlanId } from "@/lib/billing/entitlements";
import { routes } from "@/lib/routes";

export type BillingInterval = "monthly" | "yearly";

export const SOLD_PLAN_IDS: PlanId[] = ["free", "founder", "agency"];

export const PRO_CONTACT_HREF = `${routes.contact}?intent=pro`;

/** Pro is listed everywhere but is not self-serve. */
export function isSalesLockedPlan(planId: PlanId): boolean {
  return planId === "agency";
}

export function yearlySavingsUsd(plan: PlanConfig): number {
  if (plan.monthlyPriceUsd <= 0 || plan.yearlyPriceUsd <= 0) return 0;
  return plan.monthlyPriceUsd * 12 - plan.yearlyPriceUsd;
}

export function equivalentMonthlyUsd(plan: PlanConfig): number {
  if (plan.yearlyPriceUsd <= 0) return plan.monthlyPriceUsd;
  return Math.round(plan.yearlyPriceUsd / 12);
}

export function yearlySavingsPercent(plan: PlanConfig): number {
  const fullYear = plan.monthlyPriceUsd * 12;
  if (fullYear <= 0) return 0;
  return Math.round((yearlySavingsUsd(plan) / fullYear) * 100);
}

/** Same discount on every paid plan we sell; Plus is the reference. */
export function advertisedYearlySavingsPercent(): number {
  return yearlySavingsPercent(PLAN_CONFIG.founder);
}

export function headlinePriceUsd(
  plan: PlanConfig,
  interval: BillingInterval,
): number {
  if (plan.monthlyPriceUsd <= 0) return 0;
  return interval === "yearly"
    ? equivalentMonthlyUsd(plan)
    : plan.monthlyPriceUsd;
}
