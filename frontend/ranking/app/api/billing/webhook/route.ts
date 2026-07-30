import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import {
  recordWebhookEvent,
  upsertSubscription,
} from "@/lib/db/repository";
import { resolvePlanFromProductId } from "@/lib/billing/entitlements";

function verifySignature(rawBody: string, signature: string | null): boolean {
  const key = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
  if (!key) {
    // Allow local fixture processing without webhook key.
    return process.env.NODE_ENV !== "production";
  }
  if (!signature) return false;
  const digest = createHmac("sha256", key).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return digest === signature;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature =
    request.headers.get("webhook-signature") ||
    request.headers.get("x-dodo-signature");

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as {
    id?: string;
    event_id?: string;
    type?: string;
    data?: {
      subscription_id?: string;
      customer_id?: string;
      product_id?: string;
      status?: string;
      metadata?: { user_id?: string; plan?: string };
      current_period_start?: string;
      current_period_end?: string;
      cancel_at_period_end?: boolean;
    };
  };

  const eventId = payload.event_id || payload.id || createFallbackId(rawBody);
  const eventType = payload.type || "unknown";

  const recorded = await recordWebhookEvent({
    provider: "dodo",
    event_id: eventId,
    event_type: eventType,
    payload,
  });

  if (!recorded.inserted) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const data = payload.data;
  const userId = data?.metadata?.user_id;
  if (
    userId &&
    data?.subscription_id &&
    (eventType.includes("subscription") || eventType.includes("payment"))
  ) {
    const plan =
      (data.metadata?.plan as "founder" | "growth" | "agency" | undefined) ||
      resolvePlanFromProductId(data.product_id);

    if (plan !== "free") {
      let status:
        | "active"
        | "trialing"
        | "canceled"
        | "past_due"
        | "inactive"
        | "paused" = "active";
      if (eventType.includes("cancel")) status = "canceled";
      if (eventType.includes("failed") || eventType.includes("on_hold")) {
        status = "past_due";
      }
      if (eventType.includes("trial")) status = "trialing";

      await upsertSubscription({
        user_id: userId,
        provider: "dodo",
        provider_customer_id: data.customer_id ?? null,
        provider_subscription_id: data.subscription_id,
        plan,
        status,
        current_period_start: data.current_period_start ?? null,
        current_period_end: data.current_period_end ?? null,
        cancel_at_period_end: Boolean(data.cancel_at_period_end),
      });
    }
  }

  return NextResponse.json({ ok: true });
}

function createFallbackId(raw: string): string {
  return createHmac("sha256", "rankedbyai").update(raw).digest("hex").slice(0, 32);
}
