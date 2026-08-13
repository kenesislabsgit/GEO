import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import {
  getProductIdForPlan,
  type PlanId,
} from "@/lib/billing/entitlements";
import { upsertSubscription } from "@/lib/db/repository";
import { dodoApiBase } from "@/lib/billing/dodo";
import { routes, safeReturnTo } from "@/lib/routes";

const schema = z.object({
  plan: z.enum(["founder", "growth", "agency"]),
  interval: z.enum(["monthly", "yearly"]),
  email: z.string().email(),
  returnTo: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = schema.parse(await request.json());
  const productId = getProductIdForPlan(body.plan as PlanId, body.interval);

  // With a real API key but no product id for this plan, refuse. The old
  // behaviour fell through to the simulation and handed out the plan for
  // free in production.
  if (process.env.DODO_PAYMENTS_API_KEY && !productId) {
    return NextResponse.json(
      { error: "This plan is not available for checkout yet." },
      { status: 503 },
    );
  }

  if (!process.env.DODO_PAYMENTS_API_KEY) {
    // Local/test simulation with usage-limited Founder trial semantics.
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + (body.plan === "founder" ? 7 : 30));
    await upsertSubscription({
      user_id: user.id,
      provider: "dodo",
      provider_customer_id: `demo_${user.id}`,
      provider_subscription_id: `demo_sub_${user.id}_${body.plan}`,
      plan: body.plan,
      status: body.plan === "founder" ? "trialing" : "active",
      current_period_start: new Date().toISOString(),
      current_period_end: periodEnd.toISOString(),
      cancel_at_period_end: false,
    });

    const requestedReturn = safeReturnTo(body.returnTo);
    const redirectPath = requestedReturn ?? routes.newScan();

    return NextResponse.json({
      simulated: true,
      url: redirectPath,
      message:
        "Dodo product/API keys missing. Activated a local simulated subscription with usage limits enforced.",
    });
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
      customer: { email: body.email },
      return_url: returnUrl,
      metadata: { user_id: user.id, plan: body.plan, interval: body.interval },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json(
      { error: `Dodo checkout failed: ${text}` },
      { status: 400 },
    );
  }

  const data = (await response.json()) as { checkout_url?: string; url?: string };
  return NextResponse.json({ url: data.checkout_url || data.url });
}
