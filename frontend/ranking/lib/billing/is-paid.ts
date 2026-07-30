import type { PlanId } from "@/lib/billing/entitlements";

export function isPaidSubscription(input: {
  plan: PlanId;
  status: string;
}): boolean {
  return (
    input.plan !== "free" &&
    (input.status === "active" || input.status === "trialing")
  );
}
