import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckoutSession } from "@/lib/billing/create-checkout";

const user = { id: "user_1", email: "founder@example.com" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("createCheckoutSession", () => {
  it("refuses Growth and Pro", async () => {
    const growth = await createCheckoutSession({
      user,
      plan: "growth",
      interval: "monthly",
      origin: "http://localhost:3000",
    });
    expect(growth).toMatchObject({ ok: false, status: 403 });

    const pro = await createCheckoutSession({
      user,
      plan: "agency",
      interval: "monthly",
      origin: "http://localhost:3000",
    });
    expect(pro).toMatchObject({ ok: false, status: 403 });
  });

  it("fails closed when Dodo is not configured", async () => {
    vi.stubEnv("DODO_PAYMENTS_API_KEY", "");
    vi.stubEnv("DODO_FOUNDER_MONTHLY_PRODUCT_ID", "");
    const result = await createCheckoutSession({
      user,
      plan: "founder",
      interval: "monthly",
      origin: "http://localhost:3000",
    });
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  it("returns the Dodo checkout URL for Plus", async () => {
    vi.stubEnv("DODO_PAYMENTS_API_KEY", "rk_test");
    vi.stubEnv("DODO_FOUNDER_MONTHLY_PRODUCT_ID", "prod_plus_monthly");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://arcanoris.in");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ checkout_url: "https://checkout.dodopayments.com/sess_1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCheckoutSession({
      user,
      plan: "founder",
      interval: "monthly",
      origin: "http://localhost:3000",
    });

    expect(result).toEqual({
      ok: true,
      url: "https://checkout.dodopayments.com/sess_1",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.customer).toEqual({ email: user.email });
    expect(body.product_cart[0].product_id).toBe("prod_plus_monthly");
    expect(body.return_url).toBe("https://arcanoris.in/dashboard/billing/success");
  });
});
