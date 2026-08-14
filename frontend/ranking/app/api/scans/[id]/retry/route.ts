import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getBrandById, getScanRun } from "@/lib/db/repository";
import { limitAction } from "@/lib/rate-limit";
import { retryScan } from "@/lib/scans/queue";

/**
 * Retry a failed, timed-out, cancelled, or partial audit. The retry replays
 * the scan's stored input snapshot on the same engine - it never picks up
 * settings edited since the original request. Starting fresh with new
 * settings is what the normal audit button is for.
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
  const rate = await limitAction("scan-retry", user.id, 10, 3600);
  if (!rate.success) {
    return NextResponse.json(
      { error: "Too many retries. Try again later." },
      { status: 429 },
    );
  }
  const result = await retryScan(id, user.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({
    ok: true,
    scanRunId: result.scan.id,
    brandId: scan.brand_id,
  });
}
