import type { SubscriptionStatus } from "@/types/database";

/**
 * Shared plumbing for talking to Dodo Payments from the server. Checkout,
 * webhook, confirm and portal all need the same base URL, the same status
 * translation, and the same subscription shape — defining them once keeps
 * the four routes from drifting apart.
 */

export function dodoApiBase(): string {
  // Test keys only work against Dodo's test server, live keys against the
  // live one. Live is the default so a production box with no setting cannot
  // accidentally sell test products.
  return process.env.DODO_PAYMENTS_ENVIRONMENT === "test_mode"
    ? "https://test.dodopayments.com"
    : "https://live.dodopayments.com";
}

export type DodoSubscription = {
  subscription_id: string;
  status: string;
  product_id?: string | null;
  customer?: { customer_id?: string; email?: string } | null;
  metadata?: Record<string, string> | null;
  previous_billing_date?: string | null;
  next_billing_date?: string | null;
  cancel_at_next_billing_date?: boolean | null;
  created_at?: string | null;
};

/**
 * Dodo's subscription statuses are pending, active, on_hold, cancelled,
 * failed and expired. Ours differ; translate rather than store theirs.
 * "pending" maps to inactive — a mandate that has not gone through yet
 * grants nothing.
 */
export function mapDodoSubscriptionStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "on_hold":
      return "past_due";
    case "cancelled":
      return "canceled";
    default:
      return "inactive";
  }
}

export async function fetchDodoSubscription(
  subscriptionId: string,
): Promise<DodoSubscription | null> {
  const key = process.env.DODO_PAYMENTS_API_KEY;
  if (!key) return null;
  const response = await fetch(
    `${dodoApiBase()}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    },
  );
  if (!response.ok) return null;
  return (await response.json()) as DodoSubscription;
}

/**
 * Newest subscriptions first, straight from Dodo. Used as a fallback when
 * the redirect back from checkout did not carry a subscription id.
 */
export async function listDodoSubscriptions(): Promise<DodoSubscription[]> {
  const key = process.env.DODO_PAYMENTS_API_KEY;
  if (!key) return [];
  const response = await fetch(
    `${dodoApiBase()}/subscriptions?page_size=100`,
    {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    },
  );
  if (!response.ok) return [];
  const data = (await response.json()) as { items?: DodoSubscription[] };
  return data.items ?? [];
}
