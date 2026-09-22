import { PLAN_CONFIG, type PlanConfig, type PlanId } from "@/lib/billing/entitlements";
import { routes } from "@/lib/routes";

export type BillingInterval = "monthly" | "yearly";

export const SOLD_PLAN_IDS: PlanId[] = ["founder", "agency"];

export const PRO_CONTACT_HREF = `${routes.contact}?intent=pro`;
export const GROWTH_WAITLIST_HREF = `${routes.contact}?intent=growth`;

/** Pro is listed everywhere but is not self-serve. */
export function isSalesLockedPlan(planId: PlanId): boolean {
  return planId === "agency";
}

export function isSelfServePlan(planId: PlanId): boolean {
  return SOLD_PLAN_IDS.includes(planId) && !isSalesLockedPlan(planId);
}

/** New visitors create an account with their selection preserved. */
export function publicSubscribeHref(
  planId: PlanId,
  interval: BillingInterval,
  signedIn: boolean,
): string {
  const start = routes.checkoutStart({ plan: planId, interval });
  return signedIn ? start : routes.login({ returnTo: start, mode: "signup" });
}

export function selectedTrial(returnTo: string | null) {
  if (!returnTo?.startsWith("/dashboard/billing/start?")) return null;
  const params = new URLSearchParams(returnTo.split("?")[1]);
  if (params.get("plan") !== "founder") return null;
  const interval = params.get("interval");
  return interval === "monthly" || interval === "yearly" ? { plan: PLAN_CONFIG.founder, interval } as const : null;
}

export function trialCommitment(interval: BillingInterval): string {
  const plan = PLAN_CONFIG.founder;
  const price = interval === "yearly" ? plan.yearlyPriceUsd : plan.monthlyPriceUsd;
  const period = interval === "yearly" ? "year" : "month";
  return `Payment method required. $0 for ${plan.trialDays} days, then $${price}/${period} plus applicable tax, billed automatically every ${period}. Cancel in Billing before your ${plan.trialDays}-day trial ends to avoid the first charge.`;
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

/** Compact monthly check counts for marketing: 5, 700, 10k. */
export function formatChecks(count: number): string {
  if (count < 0) {
    throw new Error("formatChecks requires a non-negative count");
  }
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
}
