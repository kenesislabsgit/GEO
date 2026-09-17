import { describe, expect, it } from "vitest";
import {
  mapDodoEventStatus,
  mapDodoSubscriptionStatus,
} from "@/lib/billing/dodo";

describe("Dodo subscription status mapping", () => {
  it.each([
    ["active", "active"],
    ["on_hold", "past_due"],
    ["past_due", "past_due"],
    ["paused", "paused"],
    ["cancelled", "canceled"],
    ["failed", "inactive"],
    ["expired", "inactive"],
  ])("maps provider status %s to %s", (input, expected) => {
    expect(mapDodoSubscriptionStatus(input)).toBe(expected);
  });

  it.each([
    ["subscription.active", null, "active"],
    ["subscription.renewed", null, "active"],
    ["subscription.past_due", null, "past_due"],
    ["subscription.paused", null, "paused"],
    ["subscription.unpaused", null, "active"],
    ["subscription.cancelled", null, "canceled"],
    ["payment.failed", null, "past_due"],
    ["subscription.updated", "paused", "paused"],
  ])("maps event %s with provider status %s", (event, status, expected) => {
    expect(mapDodoEventStatus(event, status)).toBe(expected);
  });

  it("ignores events that do not express a subscription status", () => {
    expect(mapDodoEventStatus("payment.processing")).toBeNull();
    expect(mapDodoEventStatus("subscription.updated")).toBeNull();
  });
});
