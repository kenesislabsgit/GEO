import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Several people must be able to audit the same website. Only the read of the
 * website is shared; questions, competitors and reports stay per person.
 */

let store: typeof import("@/lib/db/local-store");
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "rbai-store-"));
  process.env.LOCAL_STORE_PATH = path.join(tempDir, "local-store.json");
  store = await import("@/lib/db/local-store");
});

afterAll(async () => {
  delete process.env.LOCAL_STORE_PATH;
  await rm(tempDir, { recursive: true, force: true });
});

function brandInput(domain: string, ownerId: string | null) {
  return {
    owner_id: ownerId,
    name: "Example",
    canonical_domain: domain,
    slug: domain.replace(/\./g, "-"),
    logo_url: null,
    description: null,
    category: null,
    target_audience: null,
    aliases: [],
    default_country: "us",
    default_language: "en",
    visibility: "public" as const,
    claimed_at: null,
    metadata_confidence: null,
  };
}

describe("one website, many people", () => {
  const domain = "example.com";
  const alice = "11111111-1111-1111-1111-111111111111";
  const bob = "22222222-2222-2222-2222-222222222222";

  it("gives each account its own record for the same website", async () => {
    const aliceBrand = await store.localUpsertBrand(brandInput(domain, alice));
    const bobBrand = await store.localUpsertBrand(brandInput(domain, bob));

    expect(aliceBrand.id).not.toBe(bobBrand.id);
    expect(aliceBrand.slug).not.toBe(bobBrand.slug);
    expect(bobBrand.canonical_domain).toBe(domain);
  });

  it("reuses the same record when one person audits again", async () => {
    const first = await store.localGetBrandByDomainForOwner(domain, alice);
    const again = await store.localUpsertBrand(brandInput(domain, alice));
    expect(again.id).toBe(first?.id);
    expect(again.slug).toBe(first?.slug);
  });

  it("keeps anonymous audits of the same website apart", async () => {
    const one = await store.localUpsertBrand(brandInput(domain, null));
    const two = await store.localUpsertBrand(brandInput(domain, null));
    expect(one.id).not.toBe(two.id);
    expect(one.slug).not.toBe(two.slug);
  });

  it("copies a website record instead of refusing a second owner", async () => {
    const aliceBrand = await store.localGetBrandByDomainForOwner(domain, alice);
    const carol = "33333333-3333-3333-3333-333333333333";
    const copy = await store.localCopyBrandForOwner(aliceBrand!.id, carol);

    expect(copy?.owner_id).toBe(carol);
    expect(copy?.id).not.toBe(aliceBrand!.id);
    expect(copy?.canonical_domain).toBe(domain);
  });

  it("finds the latest audit per record, not per website", async () => {
    const aliceBrand = await store.localGetBrandByDomainForOwner(domain, alice);
    const bobBrand = await store.localGetBrandByDomainForOwner(domain, bob);

    await store.localCreateScanRun({
      brand_id: aliceBrand!.id,
      initiated_by: alice,
      scan_type: "free",
      status: "completed",
      provider_ids: ["openai"],
      total_queries: 1,
      completed_queries: 1,
      started_at: null,
      completed_at: null,
      error_summary: null,
      methodology_version: "test",
      demo_mode: false,
      cancelled_at: null,
      country: null,
      language: null,
    });

    const aliceLatest = await store.localLatestCompletedScanForBrand(
      aliceBrand!.id,
      null,
    );
    const bobLatest = await store.localLatestCompletedScanForBrand(
      bobBrand!.id,
      null,
    );

    expect(aliceLatest?.scan.brand_id).toBe(aliceBrand!.id);
    // Bob has no audit of his own yet, and must not inherit Alice's.
    expect(bobLatest).toBeNull();
  });
});
