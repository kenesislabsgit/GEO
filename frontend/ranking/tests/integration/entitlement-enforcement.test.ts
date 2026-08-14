import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestDb, resetTestDb } from "./pg-test-db";

/**
 * Server-side entitlement enforcement, against the real database. Crafted
 * requests get clamped or refused — the UI never was the security boundary.
 */

async function makeUser(id: string, withPlan?: "founder" | "growth") {
  const { exec } = await import("@/lib/db/pg");
  await exec(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $1, $2, true, now(), now()) on conflict (id) do nothing`,
    [id, `${id}@example.com`],
  );
  if (withPlan) {
    await exec(
      `insert into subscriptions
         (user_id, provider, provider_subscription_id, plan, status)
       values ($1, 'dodo', $2, $3, 'active')`,
      [id, `sub_${id}`, withPlan],
    );
  }
  return id;
}

describe("audit authorization", () => {
  beforeAll(async () => {
    await resetTestDb();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("refuses a Pro audit for a free account", async () => {
    const { authorizeAudit } = await import("@/lib/billing/enforce");
    const user = await makeUser("ent-free");
    const result = await authorizeAudit(user, {
      mode: "pro",
      assistants: ["openai_search"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(402);
  });

  it("drops providers outside the plan and refuses when none remain", async () => {
    const { authorizeAudit } = await import("@/lib/billing/enforce");
    const user = await makeUser("ent-founder", "founder");
    // gemini and nova are not in the founder plan; claude search is.
    const clamped = await authorizeAudit(user, {
      mode: "pro",
      assistants: ["gemini", "bedrock_nova", "openai_search"],
    });
    expect(clamped.ok).toBe(true);
    if (clamped.ok) expect(clamped.assistants).toEqual(["openai_search"]);

    const refused = await authorizeAudit(user, {
      mode: "pro",
      assistants: ["gemini", "bedrock_nova"],
    });
    expect(refused.ok).toBe(false);
  });

  it("clamps question counts to the plan ceiling", async () => {
    const { authorizeAudit } = await import("@/lib/billing/enforce");
    const user = await makeUser("ent-questions", "growth");
    const result = await authorizeAudit(user, {
      mode: "pro",
      assistants: ["openai_search"],
      limitPerAssistant: 500,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.limitPerAssistant).toBeLessThanOrEqual(20);
  });

  it("refuses an audit that would create a brand over the plan limit", async () => {
    const { authorizeAudit } = await import("@/lib/billing/enforce");
    const { upsertBrand } = await import("@/lib/db/repository");
    const user = await makeUser("ent-brands", "founder"); // 1 brand allowed
    await upsertBrand({
      owner_id: user,
      name: "first.example",
      canonical_domain: "first.example",
      slug: "ent-first",
      logo_url: null,
      description: null,
      category: null,
      target_audience: null,
      aliases: [],
      default_country: "US",
      default_language: "en",
      visibility: "public",
      claimed_at: null,
      metadata_confidence: null,
    });
    const result = await authorizeAudit(user, {
      mode: "pro",
      assistants: ["openai_search"],
      creatingBrand: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("geo market search is a Pro+ capability, not a request parameter", async () => {
    const { authorizeAudit } = await import("@/lib/billing/enforce");
    const founder = await makeUser("ent-geo-founder", "founder");
    const growth = await makeUser("ent-geo-growth", "growth");
    const founderResult = await authorizeAudit(founder, {
      mode: "pro",
      assistants: ["openai_search"],
    });
    const growthResult = await authorizeAudit(growth, {
      mode: "pro",
      assistants: ["openai_search"],
    });
    expect(founderResult.ok && !founderResult.geoMarket).toBe(true);
    expect(growthResult.ok && growthResult.geoMarket).toBe(true);
  });
});
