import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import {
  recordWebhookEvent,
  setWebhookEventStatus,
  upsertSubscription,
} from "@/lib/db/repository";
import { log } from "@/lib/log";
import { resolvePlanFromProductId } from "@/lib/billing/entitlements";
import type { SubscriptionStatus } from "@/types/database";

// Five minutes of clock drift, matching the Standard Webhooks recommendation.
const TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * Dodo signs webhooks per the Standard Webhooks spec: the secret is
 * "whsec_" + base64 key material, the signed content is
 * "{webhook-id}.{webhook-timestamp}.{raw body}", and the webhook-signature
 * header carries one or more space-separated "v1,{base64 hmac}" entries.
 * Anything else - including the hex-of-body-only scheme this file used to
 * implement - never matches a real Dodo signature.
 */
function verifySignature(
  rawBody: string,
  headers: Headers,
): boolean {
  const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
  if (!secret) {
    // Allow local fixture processing without webhook key.
    return process.env.NODE_ENV !== "production";
  }

  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const drift = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (drift > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const keyMaterial = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret, "base64");
  const expected = createHmac("sha256", keyMaterial)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  for (const candidate of signatureHeader.split(" ")) {
    const [version, value] = candidate.split(",", 2);
    if (version !== "v1" || !value) continue;
    const provided = Buffer.from(value, "base64");
    if (
      provided.length === expected.length &&
      timingSafeEqual(provided, expected)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Only event types with a known meaning may change a subscription's status.
 * The old behaviour - default any subscription/payment event to "active" - 
 * meant subscription.expired and subscription.on_hold quietly kept the plan
 * alive forever.
 */
const EVENT_STATUS: Record<string, SubscriptionStatus> = {
  "subscription.active": "active",
  "subscription.renewed": "active",
  "subscription.plan_changed": "active",
  "subscription.on_hold": "past_due",
  "subscription.failed": "inactive",
  "subscription.expired": "inactive",
  "subscription.cancelled": "canceled",
  "payment.succeeded": "active",
  "payment.failed": "past_due",
};

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as {
    id?: string;
    event_id?: string;
    type?: string;
    data?: {
      subscription_id?: string;
      customer_id?: string;
      customer?: { customer_id?: string };
      product_id?: string;
      status?: string;
      metadata?: { user_id?: string; plan?: string };
      previous_billing_date?: string;
      next_billing_date?: string;
      cancel_at_next_billing_date?: boolean;
      current_period_start?: string;
      current_period_end?: string;
      cancel_at_period_end?: boolean;
    };
  };

  const eventId =
    request.headers.get("webhook-id") ||
    payload.event_id ||
    payload.id ||
    createFallbackId(rawBody);
  const eventType = payload.type || "unknown";

  const recorded = await recordWebhookEvent({
    provider: "dodo",
    event_id: eventId,
    event_type: eventType,
    payload,
  });

  // Seen before and handled: the retry is a duplicate. Seen before and
  // FAILED: process it again - that retry is exactly why Dodo resent it.
  if (!recorded.inserted && recorded.existingStatus !== "failed") {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    const data = payload.data;
    const userId = data?.metadata?.user_id;
    const status = EVENT_STATUS[eventType];

    if (userId && data?.subscription_id && status) {
      const plan =
        (data.metadata?.plan as "founder" | "growth" | "agency" | undefined) ||
        resolvePlanFromProductId(data.product_id);

      if (plan !== "free") {
        await upsertSubscription({
          user_id: userId,
          provider: "dodo",
          provider_customer_id:
            data.customer_id ?? data.customer?.customer_id ?? null,
          provider_subscription_id: data.subscription_id,
          plan,
          status,
          current_period_start:
            data.previous_billing_date ?? data.current_period_start ?? null,
          current_period_end:
            data.next_billing_date ?? data.current_period_end ?? null,
          cancel_at_period_end: Boolean(
            data.cancel_at_next_billing_date ?? data.cancel_at_period_end,
          ),
        });
      }
    }
  } catch (error) {
    // The event stays recorded with status 'failed'; Dodo's retry finds the
    // failed row and reprocesses it instead of being dismissed as a
    // duplicate. Admin sees the failure with its reason.
    await setWebhookEventStatus(
      "dodo",
      eventId,
      "failed",
      error instanceof Error ? error.message : String(error),
    ).catch(() => {});
    log.error("dodo_webhook_failed", {
      eventId,
      eventType,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  await setWebhookEventStatus("dodo", eventId, "processed", null).catch(() => {});
  return NextResponse.json({ ok: true });
}

function createFallbackId(raw: string): string {
  return createHmac("sha256", "rankedbyai").update(raw).digest("hex").slice(0, 32);
}
