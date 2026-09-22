import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckoutSession } from "@/lib/billing/create-checkout";

const user = { id: "user_1", email: "founder@example.com" };
const advertisedPrice = { type: "recurring_price", currency: "USD", price: 7900, payment_frequency_count: 1, payment_frequency_interval: "Month", trial_period_days: 7, trial_payment_method_optional: false };

function checkoutFetch() {
  return vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ price: advertisedPrice }) })
    .mockResolvedValue({ ok: true, json: async () => ({ checkout_url: "https://checkout.dodopayments.com/sess_1" }) });
}

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
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.arcanoris.in");

    const fetchMock = checkoutFetch();
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.customer).toEqual({ email: user.email });
    expect(body.product_cart[0].product_id).toBe("prod_plus_monthly");
    expect(body.return_url).toBe(
      "https://app.arcanoris.in/dashboard/billing/success",
    );
    expect(new URL(body.return_url).search).toBe("");
  });

  it("ignores a loopback request origin in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DODO_PAYMENTS_API_KEY", "rk_test");
    vi.stubEnv("DODO_FOUNDER_MONTHLY_PRODUCT_ID", "prod_plus_monthly");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.arcanoris.in/");

    const fetchMock = checkoutFetch();
    vi.stubGlobal("fetch", fetchMock);

    await createCheckoutSession({
      user,
      plan: "founder",
      interval: "monthly",
      origin: "http://127.0.0.1:3000",
    });

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.return_url).toBe(
      "https://app.arcanoris.in/dashboard/billing/success",
    );
  });

  it("fails clearly in production when NEXT_PUBLIC_APP_URL is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DODO_PAYMENTS_API_KEY", "rk_test");
    vi.stubEnv("DODO_FOUNDER_MONTHLY_PRODUCT_ID", "prod_plus_monthly");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCheckoutSession({
      user,
      plan: "founder",
      interval: "monthly",
      origin: "http://127.0.0.1:3000",
    });

    expect(result).toMatchObject({ ok: false, status: 503 });
    if (!result.ok) {
      expect(result.error).toContain("NEXT_PUBLIC_APP_URL");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails clearly in production when NEXT_PUBLIC_APP_URL is localhost", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DODO_PAYMENTS_API_KEY", "rk_test");
    vi.stubEnv("DODO_FOUNDER_MONTHLY_PRODUCT_ID", "prod_plus_monthly");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCheckoutSession({
      user,
      plan: "founder",
      interval: "monthly",
      origin: "https://app.arcanoris.in",
    });

    expect(result).toMatchObject({ ok: false, status: 503 });
    if (!result.ok) {
      expect(result.error).toMatch(/localhost|127\.0\.0\.1/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the request origin on localhost when the env URL is unset", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DODO_PAYMENTS_API_KEY", "rk_test");
    vi.stubEnv("DODO_FOUNDER_MONTHLY_PRODUCT_ID", "prod_plus_monthly");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    const fetchMock = checkoutFetch();
    vi.stubGlobal("fetch", fetchMock);

    await createCheckoutSession({
      user,
      plan: "founder",
      interval: "monthly",
      origin: "http://localhost:3000",
    });

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.return_url).toBe(
      "http://localhost:3000/dashboard/billing/success",
    );
  });

  it.each([{ price: 2900 }, { trial_period_days: 0 }, { trial_amount: 100 }, { trial_payment_method_optional: true }, { payment_frequency_interval: "Year" }])("blocks checkout when configured terms differ: %j", async (mismatch) => {
    vi.stubEnv("DODO_PAYMENTS_API_KEY", "rk_test");
    vi.stubEnv("DODO_FOUNDER_MONTHLY_PRODUCT_ID", "prod_plus_monthly");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.arcanoris.in");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ price: { ...advertisedPrice, ...mismatch } }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createCheckoutSession({ user, plan: "founder", interval: "monthly", origin: "http://localhost:3000" });
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });
});
