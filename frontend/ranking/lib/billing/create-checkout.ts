import {
  getProductIdForPlan,
  type PlanId,
} from "@/lib/billing/entitlements";
import { dodoApiBase } from "@/lib/billing/dodo";
import { isSelfServePlan, type BillingInterval } from "@/lib/billing/pricing";
import { log } from "@/lib/log";
import { routes, safeReturnTo } from "@/lib/routes";

export type CheckoutUser = {
  id: string;
  email: string;
};

export type CreateCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; status: 403 | 502 | 503; error: string };

function notSelfServeError(plan: PlanId): string {
  return plan === "agency"
    ? "The Pro plan is set up with our team. Contact us to get started."
    : "Growth isn't open for self-serve yet. Join the waitlist from pricing.";
}

export async function createCheckoutSession(input: {
  user: CheckoutUser;
  plan: PlanId;
  interval: BillingInterval;
  returnTo?: string | null;
  origin: string;
}): Promise<CreateCheckoutResult> {
  if (!isSelfServePlan(input.plan)) {
    return { ok: false, status: 403, error: notSelfServeError(input.plan) };
  }

  const productId = getProductIdForPlan(input.plan, input.interval);
  if (!process.env.DODO_PAYMENTS_API_KEY || !productId) {
    return {
      ok: false,
      status: 503,
      error: "Checkout is not available right now. Contact support.",
    };
  }

  const requestedReturn = safeReturnTo(input.returnTo);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || input.origin;
  const returnUrl = `${appUrl}${routes.billingSuccess(
    requestedReturn ? { returnTo: requestedReturn } : undefined,
  )}`;

  const response = await fetch(`${dodoApiBase()}/checkouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DODO_PAYMENTS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { email: input.user.email },
      return_url: returnUrl,
      metadata: {
        user_id: input.user.id,
        plan: input.plan,
        interval: input.interval,
      },
    }),
  });

  if (!response.ok) {
    log.error("dodo_checkout_failed", {
      status: response.status,
      body: (await response.text()).slice(0, 500),
    });
    return {
      ok: false,
      status: 502,
      error: "Checkout could not be started. Try again shortly.",
    };
  }

  const data = (await response.json()) as { checkout_url?: string; url?: string };
  const url = data.checkout_url || data.url;
  if (!url) {
    log.error("dodo_checkout_missing_url", { plan: input.plan });
    return {
      ok: false,
      status: 502,
      error: "Checkout could not be started. Try again shortly.",
    };
  }

  return { ok: true, url };
}
