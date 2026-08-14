import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestDb, resetTestDb } from "./pg-test-db";

/**
 * Several accounts may audit the same website; whoever got there first must
 * not own it for everyone else. Each owner gets their own brand row for the
 * domain (unique per owner), and their audits never collide with each
 * other's active-scan guard.
 */
describe("two accounts auditing the same website", () => {
  beforeAll(async () => {
    await resetTestDb();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("gives each owner an independent brand for the same domain", async () => {
    const { exec } = await import("@/lib/db/pg");
    const { upsertBrand, getBrandByDomainForOwner } = await import(
      "@/lib/db/repository"
    );
    for (const id of ["owner-a", "owner-b"]) {
      await exec(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, $1, $2, true, now(), now()) on conflict (id) do nothing`,
        [id, `${id}@example.com`],
      );
    }
    const base = {
      name: "shared.example",
      canonical_domain: "shared.example",
      logo_url: null,
      description: null,
      category: null,
      target_audience: null,
      aliases: ["shared.example"],
      default_country: "US",
      default_language: "en",
      visibility: "public" as const,
      claimed_at: null,
      metadata_confidence: null,
    };
    const a = await upsertBrand({ ...base, owner_id: "owner-a", slug: "shared-a" });
    const b = await upsertBrand({ ...base, owner_id: "owner-b", slug: "shared-b" });
    expect(a.id).not.toBe(b.id);

    const aAgain = await getBrandByDomainForOwner("shared.example", "owner-a");
    const bAgain = await getBrandByDomainForOwner("shared.example", "owner-b");
    expect(aAgain?.id).toBe(a.id);
    expect(bAgain?.id).toBe(b.id);
  });

  it("keeps the one-active-scan guard per brand, not per domain", async () => {
    const { enqueueScan } = await import("@/lib/scans/queue");
    const { getBrandByDomainForOwner } = await import("@/lib/db/repository");
    const a = await getBrandByDomainForOwner("shared.example", "owner-a");
    const b = await getBrandByDomainForOwner("shared.example", "owner-b");
    const snapshot = {
      domain: "shared.example",
      mode: "free" as const,
      assistants: ["openai_search" as const],
      limit_per_assistant: 5,
      prompts: [],
      country: "us",
      language: "en",
      geo_market: false,
      geo_market_name: null,
      ip_hash: null,
      plan: "free",
      question_count: 5,
      methodology_version_requested: null,
      trigger_source: "free",
      cost_ceiling_usd: 2.5,
      resume: false,
    };
    const first = await enqueueScan({
      brand: a!,
      initiatedBy: "owner-a",
      scanType: "free",
      snapshot,
      checksLimit: 5,
    });
    const second = await enqueueScan({
      brand: b!,
      initiatedBy: "owner-b",
      scanType: "free",
      snapshot,
      checksLimit: 5,
    });
    // Different owners, same website — both scans queue independently.
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.alreadyRunning).toBe(false);
      expect(second.alreadyRunning).toBe(false);
      expect(first.scan.id).not.toBe(second.scan.id);
    }
  });
});
