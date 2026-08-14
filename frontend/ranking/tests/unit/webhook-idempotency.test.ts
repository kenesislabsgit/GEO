import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestDb, resetTestDb } from "../integration/pg-test-db";

/**
 * Webhook idempotency against the real store: the unique (provider,
 * event_id) constraint makes a retried event a no-op, and a FAILED event's
 * retry is offered for reprocessing.
 */
describe("webhook event idempotency", () => {
  beforeAll(async () => {
    await resetTestDb();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("records an event once and flags the duplicate", async () => {
    const { recordWebhookEvent } = await import("@/lib/db/repository");
    const first = await recordWebhookEvent({
      provider: "dodo",
      event_id: "evt_1",
      event_type: "subscription.active",
      payload: { ok: true },
    });
    const second = await recordWebhookEvent({
      provider: "dodo",
      event_id: "evt_1",
      event_type: "subscription.active",
      payload: { ok: true },
    });
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.existingStatus).toBe("processed");
  });

  it("offers a failed event for reprocessing", async () => {
    const { recordWebhookEvent, setWebhookEventStatus } = await import(
      "@/lib/db/repository"
    );
    await recordWebhookEvent({
      provider: "dodo",
      event_id: "evt_2",
      event_type: "payment.succeeded",
      payload: {},
    });
    await setWebhookEventStatus("dodo", "evt_2", "failed", "db down");
    const retry = await recordWebhookEvent({
      provider: "dodo",
      event_id: "evt_2",
      event_type: "payment.succeeded",
      payload: {},
    });
    expect(retry.inserted).toBe(false);
    expect(retry.existingStatus).toBe("failed");
  });
});
