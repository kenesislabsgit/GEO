import { describe, expect, it } from "vitest";
import {
  assertCanEditAuditSetup,
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
      providerChecksUsed:
        PLAN_CONFIG.founder.features.providerChecksPerMonth - 1,
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

  it("allows Plus one website and 700 monthly checks", () => {
    expect(PLAN_CONFIG.founder.features.brands).toBe(1);
    expect(PLAN_CONFIG.founder.features.providerChecksPerMonth).toBe(700);
    expect(() =>
      assertCanCreateBrand({
        plan: "founder",
        status: "active",
        providerChecksUsed: 0,
        brandCount: 0,
        activePromptCount: 20,
      }),
    ).not.toThrow();
    expect(() =>
      assertCanCreateBrand({
        plan: "founder",
        status: "active",
        providerChecksUsed: 0,
        brandCount: 1,
        activePromptCount: 20,
      }),
    ).toThrow(EntitlementError);
  });

  it("blocks audit-setting edits after monthly checks are used", () => {
    expect(() =>
      assertCanEditAuditSetup({
        plan: "founder",
        status: "active",
        providerChecksUsed: PLAN_CONFIG.founder.features.providerChecksPerMonth,
        brandCount: 1,
        activePromptCount: 5,
      }),
    ).toThrow(EntitlementError);
  });

  it("includes Perplexity in every Plus audit", () => {
    expect(PLAN_CONFIG.founder.features.providers).toContain("perplexity");
    expect(defaultScanProviders("founder")).toContain("perplexity");
    expect(defaultScanProviders("founder")).toHaveLength(
      PLAN_CONFIG.founder.features.providersPerScan,
    );
  });

  it("does not offer Llama on any selectable plan", () => {
    expect(ALL_PROVIDERS).not.toContain("bedrock_llama");
    for (const plan of Object.values(PLAN_CONFIG)) {
      expect(plan.features.providers).not.toContain("bedrock_llama");
      expect(defaultScanProviders(plan.id)).not.toContain("bedrock_llama");
    }
  });

  it("checks the 8 most-used AIs on every Growth audit", () => {
    expect(PLAN_CONFIG.growth.features.providers).toEqual([...MOST_USED_PROVIDERS]);
    expect(PLAN_CONFIG.growth.features.providersPerScan).toBe(8);
    expect(defaultScanProviders("growth")).toHaveLength(8);
    expect(defaultScanProviders("growth")).toEqual([...MOST_USED_PROVIDERS]);
  });

  it("offers the complete provider catalog on Pro and selects 10 per audit", () => {
    expect(PLAN_CONFIG.agency.features.providers).toEqual([...ALL_PROVIDERS]);
    expect(PLAN_CONFIG.agency.features.providersPerScan).toBe(10);
    expect(defaultScanProviders("agency")).toHaveLength(10);
  });
});
