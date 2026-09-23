import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", () => ({ getOnboardingUser: vi.fn() }));
vi.mock("@/lib/billing/enforce", () => ({ authorizeAudit: vi.fn() }));
vi.mock("@/lib/db/repository", () => ({}));
vi.mock("@/lib/scans/queue", () => ({ enqueueScan: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ limitAuditStart: vi.fn() }));
import { getOnboardingUser } from "@/lib/auth/session";
import { authorizeAudit } from "@/lib/billing/enforce";
import { enqueueScan } from "@/lib/scans/queue";
import { POST } from "@/app/api/audit-run/start/route";

beforeEach(() => vi.clearAllMocks());
describe("audit verification gate", () => {
  it.each([false, true])("rejects the request before any paid work (session present: %s)", async (signedIn) => {
    vi.mocked(getOnboardingUser).mockResolvedValue(signedIn ? { id: "pending", email: "pending@example.com", emailVerified: false } : null);
    const response = await POST(new NextRequest("http://localhost/api/audit-run/start", {
      method: "POST", body: JSON.stringify({ domain: "example.com" }),
    }));
    expect(response.status).toBe(signedIn ? 403 : 401);
    if (signedIn) expect(await response.json()).toMatchObject({ code: "email_unverified" });
    expect(authorizeAudit).not.toHaveBeenCalled();
    expect(enqueueScan).not.toHaveBeenCalled();
  });
});
