import { getSessionUser } from "@/lib/auth/session";
import { getBrandById, getScanRun } from "@/lib/db/repository";
import type { ScanRun } from "@/types/database";

export class ScanAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanAccessError";
  }
}

/** Public free scans are readable without auth; dashboard scans require ownership. */
export async function assertScanProgressAccess(
  scan: ScanRun,
): Promise<void> {
  if (scan.scan_type === "free" && !scan.initiated_by) {
    return;
  }

  const user = await getSessionUser();
  if (!user) {
    throw new ScanAccessError("Unauthorized");
  }

  const brand = await getBrandById(scan.brand_id);
  if (!brand || brand.owner_id !== user.id) {
    throw new ScanAccessError("Forbidden");
  }
}
