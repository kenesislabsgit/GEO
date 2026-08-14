import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { importAuditExport, type AuditExport } from "@/lib/audit/import-export";

/**
 * Internal ingest for audit exports produced outside the queue (operator
 * tooling). Fail-closed in every environment: no token configured means the
 * route does not exist, dev included - an open write-anything endpoint on a
 * dev box is still an open write-anything endpoint.
 */
export async function POST(request: NextRequest) {
  const configuredToken = process.env.AUDIT_IMPORT_TOKEN;
  if (!configuredToken) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const providedToken = request.headers.get("x-audit-import-token") ?? "";
  const expected = Buffer.from(configuredToken);
  const provided = Buffer.from(providedToken);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await importAuditExport((await request.json()) as AuditExport);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit import failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
