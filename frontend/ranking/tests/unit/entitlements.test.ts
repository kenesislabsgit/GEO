import { describe, expect, it } from "vitest";
import {
  assertCanCreateBrand,
  canRunProviderCheck,
  defaultScanProviders,
  EntitlementError,
  PLAN_CONFIG,
} from "@/lib/billing/entitlements";
import { ALL_PROVIDERS, MOST_USED_PROVIDERS } from "@/lib/constants";

describe("entitlements", () => {
  it("allows free plan one brand, then blocks the second", () => {
    expect(() =>
      assertCanCreateBrand({
        plan: "free",
        status: "inactive",
        providerChecksUsed: 0,
        brandCount: 0,
        activePromptCount: 0,
      }),
    ).not.toThrow();
    expect(() =>
      assertCanCreateBrand({
        plan: "free",
        status: "inactive",
        providerChecksUsed: 0,
        brandCount: 1,
        activePromptCount: 0,
      }),
    ).toThrow(EntitlementError);
  });

  it("enforces founder usage ceiling during trial-like active status", () => {
    const ok = canRunProviderCheck({
      plan: "founder",
      status: "trialing",
      providerChecksUsed: PLAN_CONFIG.founder.features.providerChecksPerMonth - 1,
      brandCount: 1,
      activePromptCount: 10,
    });
    const blocked = canRunProviderCheck({
      plan: "founder",
      status: "trialing",
      providerChecksUsed: PLAN_CONFIG.founder.features.providerChecksPerMonth,
      brandCount: 1,
      activePromptCount: 10,
    });
    expect(ok).toBe(true);
    expect(blocked).toBe(false);
  });

  it("includes Perplexity in every Plus audit", () => {
    expect(PLAN_CONFIG.founder.features.providers).toContain("perplexity");
    expect(defaultScanProviders("founder")).toContain("perplexity");
    expect(defaultScanProviders("founder")).toHaveLength(
      PLAN_CONFIG.founder.features.providersPerScan,
    );
  });

  it("checks the 8 most-used AIs on every Growth audit", () => {
    expect(PLAN_CONFIG.growth.features.providers).toEqual([...MOST_USED_PROVIDERS]);
    expect(PLAN_CONFIG.growth.features.providersPerScan).toBe(8);
    expect(defaultScanProviders("growth")).toHaveLength(8);
    expect(defaultScanProviders("growth")).toEqual([...MOST_USED_PROVIDERS]);
  });

  it("offers all 14 providers on Pro and selects 10 per audit", () => {
    expect(PLAN_CONFIG.agency.features.providers).toEqual([...ALL_PROVIDERS]);
    expect(PLAN_CONFIG.agency.features.providersPerScan).toBe(10);
    expect(defaultScanProviders("agency")).toHaveLength(10);
  });
});
