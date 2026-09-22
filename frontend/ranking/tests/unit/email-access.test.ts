import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, listBrands } = vi.hoisted(() => ({
  getSession: vi.fn(),
  listBrands: vi.fn().mockResolvedValue([]),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/db/repository", () => ({ listBrandsForOwner: listBrands }));

import { getOnboardingUser, getSessionUser } from "@/lib/auth/session";
import { GET, POST } from "@/app/api/auth/complete/route";

describe("email confirmation access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: "pending", email: "pending@example.com", emailVerified: false } });
  });

  it("keeps pending sessions for confirmation without authorizing app access", async () => {
    expect(await getSessionUser()).toBeNull();
    expect(await getOnboardingUser()).toMatchObject({ id: "pending", emailVerified: false });
    expect(getSession).toHaveBeenCalledWith(expect.objectContaining({ query: { disableCookieCache: true } }));
  });

  it("recognizes confirmation on the same existing session", async () => {
    expect(await getSessionUser()).toBeNull();
    getSession.mockResolvedValue({ user: { id: "pending", email: "pending@example.com", emailVerified: true } });
    expect(await getSessionUser()).toEqual({ id: "pending", email: "pending@example.com" });
  });

  it("denies an expired session", async () => {
    getSession.mockResolvedValue(null);
    expect(await getSessionUser()).toBeNull();
  });

  it("sends password sign-in back to confirmation and preserves checkout", async () => {
    const destination = "/dashboard/billing/start?plan=founder&interval=monthly";
    const response = await POST(new Request("http://localhost:3000/api/auth/complete", {
      method: "POST", body: JSON.stringify({ returnTo: destination }),
    }));
    expect(await response.json()).toEqual({ redirect: `/verify-email?returnTo=${encodeURIComponent(destination)}` });
    expect(listBrands).not.toHaveBeenCalled();
  });

  it("guards callback visits too and rejects external destinations", async () => {
    const response = await GET(new Request("http://localhost:3000/api/auth/complete?returnTo=https://example.com"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/verify-email?returnTo=%2Fdashboard%2Fscans%2Fnew");
  });

  it("preserves a pending report claim", async () => {
    const response = await POST(new Request("http://localhost:3000/api/auth/complete", {
      method: "POST", body: JSON.stringify({ claim: "test-report" }),
    }));
    expect(await response.json()).toEqual({ redirect: "/verify-email?returnTo=%2Fclaim%2Ftest-report" });
  });

  it("lets confirmed users including verified Google users continue", async () => {
    getSession.mockResolvedValue({ user: { id: "verified", email: "verified@example.com", emailVerified: true } });
    const response = await POST(new Request("http://localhost:3000/api/auth/complete", { method: "POST", body: "{}" }));
    expect((await response.json()).redirect).toMatch(/\/dashboard\/scans\/new$/);
    expect(listBrands).toHaveBeenCalledWith("verified");
  });
});
