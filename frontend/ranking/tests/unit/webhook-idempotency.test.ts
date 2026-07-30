import { describe, expect, it } from "vitest";
import { localRecordWebhook } from "@/lib/db/local-store";
import { randomUUID } from "crypto";

describe("webhook idempotency", () => {
  it("inserts once for the same event id", async () => {
    const eventId = `evt_${randomUUID()}`;
    const first = await localRecordWebhook({
      provider: "dodo",
      event_id: eventId,
      event_type: "subscription.active",
      payload: { ok: true },
    });
    const second = await localRecordWebhook({
      provider: "dodo",
      event_id: eventId,
      event_type: "subscription.active",
      payload: { ok: true },
    });
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
  });
});
