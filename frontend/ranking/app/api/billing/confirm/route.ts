import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import {
  getLatestSubscription,
  upsertSubscription,
} from "@/lib/db/repository";
import { resolvePlanFromProductId } from "@/lib/billing/entitlements";
import {
  fetchDodoSubscription,
  listDodoSubscriptions,
  mapDodoSubscriptionStatus,
  type DodoSubscription,
} from "@/lib/billing/dodo";

const schema = z.object({
  subscriptionId: z.string().max(200).optional().nullable(),
});

/**
 * Reconcile the signed-in user's subscription with Dodo directly, instead of
 * waiting for a webhook that may be delayed - or, on localhost, can never
 * arrive at all. Nothing from the browser is believed: the subscription id
 * from the redirect is only a hint, and the subscription counts only if
 * Dodo's own record carries this user's id in its metadata (written by our
 * checkout, never by the client).
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = schema.safeParse(await request.json().catch(() => ({})));
  const hintedId = body.success ? body.data.subscriptionId ?? null : null;

  if (process.env.DODO_PAYMENTS_API_KEY) {
    let dodoSub: DodoSubscription | null = null;

    if (hintedId) {
      const fetched = await fetchDodoSubscription(hintedId);
      if (fetched?.metadata?.user_id === user.id) {
        dodoSub = fetched;
      }
    }

    if (!dodoSub) {
      // No usable hint - find this user's newest subscription at Dodo.
      const candidates = (await listDodoSubscriptions()).filter(
        (sub) => sub.metadata?.user_id === user.id,
      );
      candidates.sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
      );
      dodoSub = candidates[0] ?? null;
    }

    // "pending" means the mandate has not gone through yet; write nothing
    // and let the success page keep polling.
    if (dodoSub && dodoSub.status !== "pending") {
      const plan =
        (dodoSub.metadata?.plan as "founder" | "growth" | "agency" | undefined) ||
        resolvePlanFromProductId(dodoSub.product_id);

      if (plan !== "free") {
        await upsertSubscription({
          user_id: user.id,
          provider: "dodo",
          provider_customer_id: dodoSub.customer?.customer_id ?? null,
          provider_subscription_id: dodoSub.subscription_id,
          plan,
          status: mapDodoSubscriptionStatus(dodoSub.status),
          current_period_start: dodoSub.previous_billing_date ?? null,
          current_period_end: dodoSub.next_billing_date ?? null,
          cancel_at_period_end: Boolean(dodoSub.cancel_at_next_billing_date),
        });
      }
    }
  }

  // Answer in the same shape as /api/billing/status so the success page can
  // treat this as its first poll.
  const subscription = await getLatestSubscription(user.id);
  return NextResponse.json({
    plan: subscription?.plan ?? "free",
    status: subscription?.status ?? "inactive",
    currentPeriodEnd: subscription?.current_period_end ?? null,
  });
}
