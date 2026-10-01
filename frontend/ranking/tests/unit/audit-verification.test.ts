import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/billing/enforce", () => ({ authorizeAudit: vi.fn() }));
vi.mock("@/lib/db/repository", () => ({}));
vi.mock("@/lib/scans/queue", () => ({ enqueueScan: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ limitAuditStart: vi.fn() }));
import { getSessionUser } from "@/lib/auth/session";
import { authorizeAudit } from "@/lib/billing/enforce";
import { enqueueScan } from "@/lib/scans/queue";
import { POST } from "@/app/api/audit-run/start/route";

beforeEach(() => vi.clearAllMocks());
describe("audit verification gate", () => {
  it("rejects an unauthenticated or unverified session before any paid work", async () => {
    // getSessionUser only returns confirmed-email users, so pending email
    // accounts reach this route as unauthenticated.
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const response = await POST(new NextRequest("http://localhost/api/audit-run/start", {
      method: "POST", body: JSON.stringify({ domain: "example.com" }),
    }));
    expect(response.status).toBe(401);
    expect(authorizeAudit).not.toHaveBeenCalled();
    expect(enqueueScan).not.toHaveBeenCalled();
  });
});
