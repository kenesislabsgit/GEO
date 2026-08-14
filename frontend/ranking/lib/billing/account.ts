import {
  PLAN_CONFIG,
  type EntitlementContext,
  type PlanId,
} from "@/lib/billing/entitlements";
import { one } from "@/lib/db/pg";
import { getSubscription } from "@/lib/db/repository";

export async function getAccountEntitlements(
  userId: string,
): Promise<EntitlementContext & { planName: string }> {
  const sub = await getSubscription(userId);
  const plan: PlanId = sub?.plan ?? "free";
  const period = new Date().toISOString().slice(0, 7);

  // One round trip for everything the checks need. This used to load every
  // brand and then query prompts per brand - an N+1 on the hottest path in
  // the app.
  const totals = await one<{
    brand_count: number;
    active_prompt_count: number;
    checks_used: number;
  }>(
    `select
       (select count(*)::int from brands where owner_id = $1) as brand_count,
       (select count(*)::int from tracked_prompts p
          join brands b on b.id = p.brand_id
          where b.owner_id = $1 and p.active = true) as active_prompt_count,
       (select coalesce(sum(units), 0)::int from usage_ledger
          where user_id = $1 and billing_period = $2) as checks_used`,
    [userId, period],
  );

  return {
    plan: sub ? plan : "free",
    status: sub?.status ?? "inactive",
    providerChecksUsed: totals?.checks_used ?? 0,
    brandCount: totals?.brand_count ?? 0,
    activePromptCount: totals?.active_prompt_count ?? 0,
    planName: PLAN_CONFIG[sub ? plan : "free"].name,
  };
}
