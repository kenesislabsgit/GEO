import { NextResponse } from "next/server";
import { getAuditEvents } from "@/lib/audit/progress-events";
import { getBrandById, getScanRun } from "@/lib/db/repository";
import {
  assertScanProgressAccess,
  ScanAccessError,
} from "@/lib/scans/access";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const scan = await getScanRun(id);
  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  try {
    await assertScanProgressAccess(scan);
  } catch (error) {
    if (error instanceof ScanAccessError) {
      const status = error.message === "Unauthorized" ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }

  const brand = await getBrandById(scan.brand_id);
  // Live per-answer events, held in memory by the process running the audit.
  // `after` is the last seq the client has, so polls return only what's new.
  const afterSeq = Number(new URL(request.url).searchParams.get("after") ?? 0);
  const events = getAuditEvents(id, Number.isFinite(afterSeq) ? afterSeq : 0);
  return NextResponse.json({
    events,
    id: scan.id,
    status: scan.status,
    // The runner's own step name and 0-100, written as the audit goes. The
    // query-count fallback only matters for rows from before these existed.
    step: scan.step ?? null,
    totalQueries: scan.total_queries,
    completedQueries: scan.completed_queries,
    errorSummary: scan.error_summary,
    demoMode: scan.demo_mode,
    brandId: scan.brand_id,
    slug: brand?.slug ?? null,
    progress:
      (scan.progress ?? 0) > 0
        ? scan.progress
        : scan.total_queries > 0
          ? Math.round((scan.completed_queries / scan.total_queries) * 100)
          : 0,
  });
}
