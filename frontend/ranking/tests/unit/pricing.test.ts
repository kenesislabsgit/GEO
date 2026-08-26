import { describe, expect, it } from "vitest";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import {
  advertisedYearlySavingsPercent,
  equivalentMonthlyUsd,
  formatChecks,
  headlinePriceUsd,
  isSalesLockedPlan,
  isSelfServePlan,
  publicSubscribeHref,
  SOLD_PLAN_IDS,
  yearlySavingsUsd,
} from "@/lib/billing/pricing";
import { routes } from "@/lib/routes";

describe("pricing helpers", () => {
  it("sells Plus and custom Pro — Growth is waitlist-only", () => {
    expect(SOLD_PLAN_IDS).toEqual(["founder", "agency"]);
    expect(isSelfServePlan("founder")).toBe(true);
    expect(isSelfServePlan("growth")).toBe(false);
    expect(isSelfServePlan("agency")).toBe(false);
    expect(isSalesLockedPlan("agency")).toBe(true);
    expect(isSalesLockedPlan("founder")).toBe(false);
    expect(isSalesLockedPlan("growth")).toBe(false);
    expect(isSalesLockedPlan("free")).toBe(false);
  });

  it("formats monthly check counts for marketing", () => {
    expect(formatChecks(0)).toBe("0");
    expect(formatChecks(5)).toBe("5");
    expect(formatChecks(400)).toBe("400");
    expect(formatChecks(1000)).toBe("1k");
    expect(formatChecks(2500)).toBe("2.5k");
    expect(formatChecks(10000)).toBe("10k");
    expect(() => formatChecks(-1)).toThrow(/non-negative/);
  });

  it("computes yearly savings from the list prices", () => {
    expect(yearlySavingsUsd(PLAN_CONFIG.founder)).toBe(158);
    expect(equivalentMonthlyUsd(PLAN_CONFIG.founder)).toBe(66);
    expect(advertisedYearlySavingsPercent()).toBe(17);
    expect(headlinePriceUsd(PLAN_CONFIG.founder, "monthly")).toBe(79);
    expect(headlinePriceUsd(PLAN_CONFIG.founder, "yearly")).toBe(66);
    expect(headlinePriceUsd(PLAN_CONFIG.growth, "monthly")).toBe(199);
    expect(headlinePriceUsd(PLAN_CONFIG.growth, "yearly")).toBe(166);
    expect(yearlySavingsUsd(PLAN_CONFIG.growth)).toBe(398);
    expect(PLAN_CONFIG.growth.name).toBe("Growth");
    expect(PLAN_CONFIG.founder.features.providerChecksPerMonth).toBe(700);
    expect(headlinePriceUsd(PLAN_CONFIG.free, "yearly")).toBe(0);
  });

  it("sends Plus from public pricing into checkout after login", () => {
    const start = routes.checkoutStart({
      plan: "founder",
      interval: "monthly",
    });
    expect(start).toBe(
      "/dashboard/billing/start?plan=founder&interval=monthly",
    );
    expect(publicSubscribeHref("founder", "monthly", true)).toBe(start);
    expect(publicSubscribeHref("founder", "yearly", false)).toBe(
      routes.login({
        returnTo: routes.checkoutStart({ plan: "founder", interval: "yearly" }),
      }),
    );
  });
});
