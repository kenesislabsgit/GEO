import { describe, expect, it } from "vitest";
import { resolveReturnTo, routes } from "@/lib/routes";

describe("resolveReturnTo", () => {
  it("preserves an explicit pricing checkout destination", () => {
    const checkout = routes.checkoutStart({
      plan: "founder",
      interval: "monthly",
    });

    expect(resolveReturnTo({ returnTo: checkout, mode: "signup" })).toBe(
      checkout,
    );
  });

  it("lets a new signup use the new-account audit destination", () => {
    expect(resolveReturnTo({ mode: "signup" })).toBeNull();
  });

  it("keeps the existing sign-in default when no destination is present", () => {
    expect(resolveReturnTo({ mode: "signin" })).toBeNull();
  });

  it("rejects external return destinations", () => {
    expect(
      resolveReturnTo({
        returnTo: "https://attacker.example/checkout",
        mode: "signup",
      }),
    ).toBeNull();
  });
});
