import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ScanRun } from "@/types/database";

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/db/repository", () => ({
  getBrandById: vi.fn(),
}));

import { getSessionUser } from "@/lib/auth/session";
import { getBrandById } from "@/lib/db/repository";
import {
  assertScanProgressAccess,
  ScanAccessError,
} from "@/lib/scans/access";

const baseScan: ScanRun = {
  id: "scan-1",
  brand_id: "brand-1",
  initiated_by: null,
  scan_type: "free",
  status: "running",
  provider_ids: ["openai"],
  total_queries: 10,
  completed_queries: 2,
  started_at: null,
  completed_at: null,
  error_summary: null,
  methodology_version: "1",
  demo_mode: false,
  cancelled_at: null,
  country: null,
  language: null,
  created_at: new Date().toISOString(),
};

describe("assertScanProgressAccess", () => {
  beforeEach(() => {
    vi.mocked(getSessionUser).mockReset();
    vi.mocked(getBrandById).mockReset();
  });

  it("allows anonymous access to public free scans", async () => {
    await expect(assertScanProgressAccess(baseScan)).resolves.toBeUndefined();
  });

  it("requires auth for dashboard scans", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const scan = { ...baseScan, scan_type: "manual" as const, initiated_by: "user-1" };
    await expect(assertScanProgressAccess(scan)).rejects.toThrow(ScanAccessError);
  });

  it("allows brand owner for dashboard scans", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: "user-1", email: "a@b.com" });
    vi.mocked(getBrandById).mockResolvedValue({
      id: "brand-1",
      owner_id: "user-1",
    } as Awaited<ReturnType<typeof getBrandById>>);
    const scan = { ...baseScan, scan_type: "manual" as const, initiated_by: "user-1" };
    await expect(assertScanProgressAccess(scan)).resolves.toBeUndefined();
  });
});
