import { describe, expect, it } from "vitest";
import {
  assertCanCreateBrand,
  canRunProviderCheck,
  EntitlementError,
  PLAN_CONFIG,
} from "@/lib/billing/entitlements";

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
});
