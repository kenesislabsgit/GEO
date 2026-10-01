import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/db/repository", () => ({ upsertSubscription: vi.fn() }));
vi.mock("@/lib/billing/dodo", async (original) => ({
  ...await original<typeof import("@/lib/billing/dodo")>(),
  fetchDodoCheckout: vi.fn(), fetchDodoPayment: vi.fn(),
  fetchDodoSubscription: vi.fn(), latestDodoPayment: vi.fn(),
}));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn() } }));

import { POST } from "@/app/api/billing/confirm/route";
import { getSessionUser } from "@/lib/auth/session";
import { upsertSubscription } from "@/lib/db/repository";
import { fetchDodoCheckout, fetchDodoPayment, fetchDodoSubscription, latestDodoPayment } from "@/lib/billing/dodo";
import { paymentConfirmationState } from "@/lib/billing/payment-status";

const request = (body: unknown) => new Request("http://localhost/api/billing/confirm", {
  method: "POST", body: JSON.stringify(body),
});
const metadata = { user_id: "user-1", plan: "founder" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "user-1" } as Awaited<ReturnType<typeof getSessionUser>>);
  vi.mocked(fetchDodoSubscription).mockResolvedValue({ subscription_id: "sub-1", status: "active", metadata });
  vi.mocked(fetchDodoPayment).mockResolvedValue({ payment_id: "pay-1", subscription_id: "sub-1", status: "succeeded", metadata });
  vi.mocked(latestDodoPayment).mockResolvedValue({ payment_id: "pay-1", subscription_id: "sub-1", status: "succeeded", metadata });
});
afterEach(() => vi.unstubAllEnvs());

describe("checkout-specific payment confirmation", () => {
  it("requires authentication", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    expect((await POST(request({ paymentId: "pay-1" }))).status).toBe(401);
    expect(fetchDodoPayment).not.toHaveBeenCalled();
  });
  it("does not infer success from an unrelated existing paid plan", async () => {
    const response = await POST(request({}));
    expect((await response.json()).paymentStatus).toBe("unknown");
    expect(fetchDodoSubscription).not.toHaveBeenCalled();
    expect(upsertSubscription).not.toHaveBeenCalled();
  });
  it("returns the real decline reason instead of confirming an active account", async () => {
    vi.mocked(fetchDodoPayment).mockResolvedValue({ payment_id: "pay-1", subscription_id: "sub-1", status: "failed", error_code: "insufficient_funds", error_message: "Insufficient funds", metadata });
    const data = await (await POST(request({ paymentId: "pay-1" }))).json();
    expect(data.paymentStatus).toBe("failed");
    expect(data.paymentError).toBe("Insufficient funds");
    expect(paymentConfirmationState(data)).toBe("failed");
  });
  it.each(["failed", "cancelled", "processing", "requires_payment_method"])("returns the provider's %s payment state", async (status) => {
    vi.mocked(latestDodoPayment).mockResolvedValue({ payment_id: "pay-1", subscription_id: "sub-1", status, metadata });
    const data = await (await POST(request({ subscriptionId: "sub-1" }))).json();
    expect(data.paymentStatus).toBe(status);
    expect(paymentConfirmationState(data)).not.toBe("confirmed");
  });
  it("confirms only a succeeded payment with an active paid subscription", async () => {
    const data = await (await POST(request({ paymentId: "pay-1" }))).json();
    expect(paymentConfirmationState(data)).toBe("confirmed");
    expect(upsertSubscription).toHaveBeenCalledOnce();
  });
  it("keeps a pending mandate unconfirmed even if the payment succeeded", async () => {
    vi.mocked(fetchDodoSubscription).mockResolvedValue({ subscription_id: "sub-1", status: "pending", metadata });
    const data = await (await POST(request({ paymentId: "pay-1" }))).json();
    expect(paymentConfirmationState(data)).toBe("pending");
    expect(upsertSubscription).not.toHaveBeenCalled();
  });
  it("does not expose another user's payment", async () => {
    vi.mocked(fetchDodoPayment).mockResolvedValue({ payment_id: "pay-1", metadata: { user_id: "other" }, status: "succeeded" });
    const response = await POST(request({ paymentId: "pay-1" }));
    expect(response.status).toBe(404);
    expect(fetchDodoSubscription).not.toHaveBeenCalled();
  });
  it("rejects another user's subscription without falling back to an old success", async () => {
    vi.mocked(fetchDodoSubscription).mockResolvedValue({ subscription_id: "sub-1", status: "active", metadata: { user_id: "other" } });
    expect((await POST(request({ subscriptionId: "sub-1" }))).status).toBe(404);
    expect(latestDodoPayment).not.toHaveBeenCalled();
  });
  it("rejects mismatched redirect references", async () => {
    expect((await POST(request({ paymentId: "pay-1", subscriptionId: "sub-other" }))).status).toBe(400);
  });
  it("verifies a checkout session through its owned payment", async () => {
    vi.mocked(fetchDodoCheckout).mockResolvedValue({ payment_id: "pay-1" });
    const data = await (await POST(request({ sessionId: "cks-1" }))).json();
    expect(fetchDodoPayment).toHaveBeenCalledWith("pay-1");
    expect(paymentConfirmationState(data)).toBe("confirmed");
  });
  it("does not claim success or decline when Dodo is unavailable", async () => {
    vi.mocked(fetchDodoPayment).mockRejectedValue(new Error("offline"));
    const response = await POST(request({ paymentId: "pay-1" }));
    expect(response.status).toBe(503);
    expect((await response.json()).paymentStatus).toBe("unknown");
    expect(upsertSubscription).not.toHaveBeenCalled();
  });
});
