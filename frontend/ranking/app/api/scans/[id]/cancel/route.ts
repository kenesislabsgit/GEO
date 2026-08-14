import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getBrandById, getScanRun } from "@/lib/db/repository";
import { requestScanCancel } from "@/lib/scans/queue";

/**
 * Cancel a queued or running audit. Queued scans stop instantly; running
 * ones flip to cancel_requested and the worker kills the engine at its next
 * heartbeat - no further provider calls are made after that.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scan = await getScanRun(id);
  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }
  const brand = await getBrandById(scan.brand_id);
  if (!brand || brand.owner_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (
    !["queued", "running", "cancel_requested"].includes(scan.status)
  ) {
    return NextResponse.json(
      { error: "This scan is not running.", status: scan.status },
      { status: 409 },
    );
  }
  const status = await requestScanCancel(id);
  return NextResponse.json({ ok: true, status });
}
