import { describe, expect, it } from "vitest";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import {
  advertisedYearlySavingsPercent,
  equivalentMonthlyUsd,
  headlinePriceUsd,
  isSalesLockedPlan,
  yearlySavingsUsd,
} from "@/lib/billing/pricing";

describe("pricing helpers", () => {
  it("treats Pro as sales-locked and Plus as self-serve", () => {
    expect(isSalesLockedPlan("agency")).toBe(true);
    expect(isSalesLockedPlan("founder")).toBe(false);
    expect(isSalesLockedPlan("free")).toBe(false);
  });

  it("computes yearly savings from the list prices", () => {
    expect(yearlySavingsUsd(PLAN_CONFIG.founder)).toBe(98);
    expect(equivalentMonthlyUsd(PLAN_CONFIG.founder)).toBe(41);
    expect(advertisedYearlySavingsPercent()).toBe(17);
    expect(headlinePriceUsd(PLAN_CONFIG.founder, "monthly")).toBe(49);
    expect(headlinePriceUsd(PLAN_CONFIG.founder, "yearly")).toBe(41);
    expect(headlinePriceUsd(PLAN_CONFIG.free, "yearly")).toBe(0);
  });
});
