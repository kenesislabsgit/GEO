import {
  fetchDodoSubscription,
  mapDodoSubscriptionStatus,
} from "@/lib/billing/dodo";
import { exec, q } from "@/lib/db/pg";
import { log } from "@/lib/log";

/**
 * Daily subscription reconciliation against Dodo. Webhooks are the fast
 * path; this sweep is the safety net for the webhook that never arrived - 
 * a cancellation or failure at the provider must not keep granting a plan
 * here forever.
 */
export async function reconcileSubscriptions(): Promise<void> {
  if (!process.env.DODO_PAYMENTS_API_KEY) return;

  const rows = await q<{
    id: string;
    provider_subscription_id: string;
    status: string;
  }>(
    `select id, provider_subscription_id, status
     from subscriptions
     where provider = 'dodo'
       and provider_subscription_id is not null
       and status in ('active', 'trialing', 'past_due', 'paused')`,
  );

  for (const row of rows) {
    try {
      const remote = await fetchDodoSubscription(row.provider_subscription_id);
      if (!remote) continue;
      const mapped = mapDodoSubscriptionStatus(remote.status);
      if (mapped !== row.status) {
        await exec(
          `update subscriptions set
             status = $2,
             current_period_start = coalesce($3, current_period_start),
             current_period_end = coalesce($4, current_period_end),
             cancel_at_period_end = coalesce($5, cancel_at_period_end)
           where id = $1`,
          [
            row.id,
            mapped,
            remote.previous_billing_date ?? null,
            remote.next_billing_date ?? null,
            remote.cancel_at_next_billing_date ?? null,
          ],
        );
        log.info("subscription_reconciled", {
          subscriptionId: row.id,
          from: row.status,
          to: mapped,
        });
      }
    } catch (error) {
      log.warn("subscription_reconcile_failed", {
        subscriptionId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
