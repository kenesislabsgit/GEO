// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
import { ConfirmSubscription } from "@/app/dashboard/billing/success/confirm-subscription";

const response = (paymentStatus: string, status = "active") => ({
  ok: true,
  json: async () => ({ plan: "founder", status, paymentStatus, currentPeriodEnd: null }),
});
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("payment confirmation screen", () => {
  it.each([
    ["failed", "Payment failed"],
    ["cancelled", "Payment cancelled"],
    ["requires_payment_method", "Payment not completed"],
    ["succeeded", "Payment successful"],
  ])("shows the verified %s outcome", async (status, heading) => {
    const fetch = vi.fn().mockResolvedValue(response(status));
    vi.stubGlobal("fetch", fetch);
    await act(async () => { render(createElement(ConfirmSubscription, { returnTo: null, subscriptionId: "sub-1" })); });
    expect(screen.getByRole("heading").textContent).toBe(heading);
    expect(router.refresh).toHaveBeenCalledTimes(status === "succeeded" ? 1 : 0);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("keeps rechecking Dodo for a pending payment and then shows the decline", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response("processing", "inactive")).mockResolvedValue(response("failed", "inactive"));
    vi.stubGlobal("fetch", fetch);
    await act(async () => { render(createElement(ConfirmSubscription, { returnTo: null, subscriptionId: "sub-1" })); });
    expect(screen.getByRole("heading").textContent).toBe("Checking payment status");
    expect(screen.getByRole("status").textContent).not.toContain("payment went through");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole("heading").textContent).toBe("Payment failed");
    expect(fetch.mock.calls.every(([url]) => url === "/api/billing/confirm")).toBe(true);
  });
  it("does not promise payment success when verification stays unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await act(async () => { render(createElement(ConfirmSubscription, { returnTo: null, subscriptionId: "sub-1" })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(screen.getByRole("heading").textContent).toBe("Payment status unavailable");
    expect(screen.getByRole("status").textContent).not.toContain("Your payment is not lost");
  });
});
