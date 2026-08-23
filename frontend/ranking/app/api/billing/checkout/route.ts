import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import {
  getProductIdForPlan,
  type PlanId,
} from "@/lib/billing/entitlements";
import { dodoApiBase } from "@/lib/billing/dodo";
import { log } from "@/lib/log";
import { routes, safeReturnTo } from "@/lib/routes";

const schema = z.object({
  plan: z.enum(["founder", "growth", "agency"]),
  interval: z.enum(["monthly", "yearly"]),
  returnTo: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = schema.parse(await request.json());
  if (body.plan === "agency") {
    return NextResponse.json(
      {
        error:
          "The Pro plan is set up with our team. Contact us to get started.",
      },
      { status: 403 },
    );
  }
  const productId = getProductIdForPlan(body.plan as PlanId, body.interval);

  // No payment processor, no plan - in every environment. The simulation
  // that used to live here activated real subscription rows whenever an env
  // var was missing, which is a free-paid-plan bug wearing a dev hat.
  if (!process.env.DODO_PAYMENTS_API_KEY || !productId) {
    return NextResponse.json(
      { error: "Checkout is not available right now. Contact support." },
      { status: 503 },
    );
  }

  // Checkout always comes back to the confirmation page, which verifies with
  // Dodo rather than believing the redirect. The original destination rides
  // along and is re-validated there. Fall back to the request's own origin
  // so a missing env var cannot produce an "undefined/..." return URL.
  const requestedReturn = safeReturnTo(body.returnTo);
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
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
      // The account's email, never one the request body chose.
      customer: { email: user.email },
      return_url: returnUrl,
      metadata: { user_id: user.id, plan: body.plan, interval: body.interval },
    }),
  });

  if (!response.ok) {
    log.error("dodo_checkout_failed", {
      status: response.status,
      body: (await response.text()).slice(0, 500),
    });
    return NextResponse.json(
      { error: "Checkout could not be started. Try again shortly." },
      { status: 502 },
    );
  }

  const data = (await response.json()) as { checkout_url?: string; url?: string };
  return NextResponse.json({ url: data.checkout_url || data.url });
}
