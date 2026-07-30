import {
  PLAN_CONFIG,
  type EntitlementContext,
  type PlanId,
} from "@/lib/billing/entitlements";
import {
  getSubscription,
  listBrandsForOwner,
  getPrompts,
  sumUsage,
} from "@/lib/db/repository";

export async function getAccountEntitlements(
  userId: string,
): Promise<EntitlementContext & { planName: string }> {
  const sub = await getSubscription(userId);
  const plan: PlanId = sub?.plan ?? "free";
  const brands = await listBrandsForOwner(userId);
  let activePromptCount = 0;
  for (const brand of brands) {
    const prompts = await getPrompts(brand.id);
    activePromptCount += prompts.length;
  }
  const period = new Date().toISOString().slice(0, 7);
  const providerChecksUsed = await sumUsage(userId, period);

  return {
    plan: sub ? plan : "free",
    status: sub?.status ?? "inactive",
    providerChecksUsed,
    brandCount: brands.length,
    activePromptCount,
    planName: PLAN_CONFIG[sub ? plan : "free"].name,
  };
}
