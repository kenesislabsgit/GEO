import { NextRequest, NextResponse } from "next/server";
import { importAuditExport, type AuditExport } from "@/lib/audit/import-export";

export async function POST(request: NextRequest) {
  const configuredToken = process.env.AUDIT_IMPORT_TOKEN;
  if (configuredToken) {
    const providedToken = request.headers.get("x-audit-import-token");
    if (providedToken !== configuredToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Set AUDIT_IMPORT_TOKEN before enabling imports in production." },
      { status: 403 },
    );
  }

  try {
    const result = await importAuditExport((await request.json()) as AuditExport);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit import failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
