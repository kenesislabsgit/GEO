import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { upsertSubscription } from "@/lib/db/repository";
import { resolvePlanFromProductId } from "@/lib/billing/entitlements";
import {
  fetchDodoCheckout, fetchDodoPayment, fetchDodoSubscription,
  latestDodoPayment, mapDodoSubscriptionStatus, type DodoPayment,
} from "@/lib/billing/dodo";
import { log } from "@/lib/log";

const id = z.string().min(1).max(200).optional().nullable();
const schema = z.object({ subscriptionId: id, paymentId: id, sessionId: id });
const unknown = { paymentStatus: "unknown", status: "inactive", plan: "free", currentPeriodEnd: null };

/** Verify this checkout attempt, not an unrelated existing subscription. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    let payment: DodoPayment | null = null;
    let paymentId = body.data.paymentId;
    if (!paymentId && body.data.sessionId) {
      paymentId = (await fetchDodoCheckout(body.data.sessionId)).payment_id;
    }
    if (paymentId) {
      payment = await fetchDodoPayment(paymentId);
      if (payment.metadata?.user_id !== user.id) {
        return NextResponse.json({ error: "Checkout not found" }, { status: 404 });
      }
    }
    const subscriptionId = payment?.subscription_id ?? body.data.subscriptionId;
    if (!subscriptionId) return NextResponse.json(unknown);
    if (payment && body.data.subscriptionId && subscriptionId !== body.data.subscriptionId) {
      return NextResponse.json({ error: "Checkout references do not match" }, { status: 400 });
    }
    const subscription = await fetchDodoSubscription(subscriptionId);
    if (!subscription) return NextResponse.json(unknown, { status: 503 });
    if (subscription.metadata?.user_id !== user.id) {
      return NextResponse.json({ error: "Checkout not found" }, { status: 404 });
    }
    if (!payment) {
      payment = await latestDodoPayment(subscriptionId);
      if (payment && payment.metadata?.user_id !== user.id) {
        return NextResponse.json({ error: "Checkout not found" }, { status: 404 });
      }
    }
    const metadataPlan = subscription.metadata?.plan;
    const plan = metadataPlan === "founder" || metadataPlan === "growth" || metadataPlan === "agency"
      ? metadataPlan : resolvePlanFromProductId(subscription.product_id);
    const status = mapDodoSubscriptionStatus(subscription.status);
    if (plan !== "free" && subscription.status !== "pending") {
      await upsertSubscription({
        user_id: user.id, provider: "dodo",
        provider_customer_id: subscription.customer?.customer_id ?? null,
        provider_subscription_id: subscription.subscription_id,
        plan, status,
        current_period_start: subscription.previous_billing_date ?? null,
        current_period_end: subscription.next_billing_date ?? null,
        cancel_at_period_end: Boolean(subscription.cancel_at_next_billing_date),
      });
    }
    const paymentStatus = payment?.status ??
      (subscription.status === "failed" ? "failed" :
        subscription.status === "cancelled" ? "cancelled" : "unknown");
    return NextResponse.json({
      plan, status, paymentStatus,
      providerSubscriptionStatus: subscription.status,
      paymentId: payment?.payment_id ?? null,
      paymentError: paymentStatus === "failed"
        ? payment?.error_message?.slice(0, 300) ?? null : null,
      paymentErrorCode: paymentStatus === "failed" ? payment?.error_code ?? null : null,
      currentPeriodEnd: subscription.next_billing_date ?? null,
    });
  } catch (error) {
    log.error("dodo_confirmation_failed", {
      error: error instanceof Error ? error.message : "Provider lookup failed",
    });
    return NextResponse.json(unknown, { status: 503 });
  }
}
