import {
  getProductIdForPlan,
  type PlanId,
} from "@/lib/billing/entitlements";
import { dodoApiBase } from "@/lib/billing/dodo";
import { isSelfServePlan, type BillingInterval } from "@/lib/billing/pricing";
import { log } from "@/lib/log";
import { routes } from "@/lib/routes";

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

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Base URL Dodo sends the buyer back to after checkout. Production must use
 * NEXT_PUBLIC_APP_URL (https://app.arcanoris.in). Request origin is only a
 * localhost fallback in development — Next behind a proxy reports
 * 127.0.0.1:3000, which must never reach Dodo in production.
 */
function resolveCheckoutAppUrl(
  requestOrigin: string,
): { ok: true; appUrl: string } | { ok: false; error: string } {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "";
  const production = process.env.NODE_ENV === "production";

  if (production) {
    if (!fromEnv) {
      return {
        ok: false,
        error:
          "NEXT_PUBLIC_APP_URL must be set to a public URL in production (for example https://app.arcanoris.in).",
      };
    }
    const parsed = parseHttpUrl(fromEnv);
    if (!parsed || isLoopbackHostname(parsed.hostname)) {
      return {
        ok: false,
        error:
          "NEXT_PUBLIC_APP_URL cannot be localhost or 127.0.0.1 in production. Use https://app.arcanoris.in.",
      };
    }
    return { ok: true, appUrl: stripTrailingSlash(fromEnv) };
  }

  const candidate = fromEnv || requestOrigin.trim();
  const parsed = parseHttpUrl(candidate);
  if (!parsed) {
    return {
      ok: false,
      error: "Checkout cannot start because the application URL is missing.",
    };
  }
  return { ok: true, appUrl: stripTrailingSlash(candidate) };
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

  const resolved = resolveCheckoutAppUrl(input.origin);
  if (!resolved.ok) {
    log.error("dodo_checkout_invalid_app_url", {
      nodeEnv: process.env.NODE_ENV,
      hasAppUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL?.trim()),
    });
    return { ok: false, status: 503, error: resolved.error };
  }

  // Dodo appends subscription_id, status, and email onto this URL. Keep the
  // path query-free so those parameters reach /dashboard/billing/success.
  const returnUrl = `${resolved.appUrl}${routes.billingSuccess()}`;

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
