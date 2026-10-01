import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestDb, resetTestDb } from "./pg-test-db";
import { exec, q } from "@/lib/db/pg";
import { upsertSubscription } from "@/lib/db/repository";

const subscription = (id: string, status: "active" | "inactive" = "active", user = "billing-user") => ({
  user_id: user, provider: "dodo", provider_customer_id: "customer-1",
  provider_subscription_id: id, plan: "founder" as const, status,
  current_period_start: null, current_period_end: null, cancel_at_period_end: false,
});
describe("subscription reconciliation races", () => {
  beforeAll(async () => {
    await resetTestDb();
    await exec(`insert into "user" (id, name, email) values
      ('billing-user', 'Billing user', 'billing@example.com'),
      ('other-user', 'Other user', 'other@example.com')`);
  });
  afterAll(closeTestDb);
  it("atomically reconciles simultaneous webhook, worker and confirmation writes", async () => {
    const rows = await Promise.all(Array.from({ length: 20 }, () => upsertSubscription(subscription("sub-race"))));
    expect(new Set(rows.map((row) => row.id)).size).toBe(1);
    expect(await q("select * from subscriptions where provider_subscription_id = 'sub-race'")).toHaveLength(1);
  });
  it("does not overwrite an existing paid subscription with a failed new attempt", async () => {
    await upsertSubscription(subscription("sub-declined", "inactive"));
    const rows = await q<{ status: string }>("select status from subscriptions where provider_subscription_id = 'sub-race'");
    expect(rows[0].status).toBe("active");
  });
  it("does not reassign a provider subscription to another user", async () => {
    await expect(upsertSubscription(subscription("sub-race", "active", "other-user"))).rejects.toThrow("owner mismatch");
  });
});
