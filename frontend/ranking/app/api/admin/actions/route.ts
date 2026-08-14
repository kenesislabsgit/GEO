import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAdminAction, requireAdmin } from "@/lib/admin/guard";
import { exec, one } from "@/lib/db/pg";
import { requestScanCancel, retryScan } from "@/lib/scans/queue";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("retry_scan"),
    scanId: z.string().uuid(),
    confirm: z.literal(true),
  }),
  z.object({
    action: z.literal("cancel_scan"),
    scanId: z.string().uuid(),
    confirm: z.literal(true),
  }),
  z.object({
    action: z.literal("set_maintenance"),
    enabled: z.boolean(),
    confirm: z.literal(true),
  }),
  z.object({
    action: z.literal("set_disabled_providers"),
    providers: z.array(z.string().min(1).max(40)).max(20),
    confirm: z.literal(true),
  }),
]);

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  const body = schema.parse(await request.json());

  switch (body.action) {
    case "retry_scan": {
      const result = await retryScan(body.scanId, `admin:${admin.email}`);
      await recordAdminAction(admin.email, "retry_scan", body.scanId, {
        ok: result.ok,
      });
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status },
        );
      }
      return NextResponse.json({ ok: true });
    }
    case "cancel_scan": {
      const status = await requestScanCancel(body.scanId);
      await recordAdminAction(admin.email, "cancel_scan", body.scanId, {
        status,
      });
      return NextResponse.json({ ok: true, status });
    }
    case "set_maintenance": {
      await exec(
        `insert into app_settings (key, value) values ('maintenance_mode', $1)
         on conflict (key) do update set value = $1, updated_at = timezone('utc', now())`,
        [JSON.stringify(body.enabled)],
      );
      await recordAdminAction(admin.email, "set_maintenance", null, {
        enabled: body.enabled,
      });
      return NextResponse.json({ ok: true, enabled: body.enabled });
    }
    case "set_disabled_providers": {
      await exec(
        `insert into app_settings (key, value) values ('providers_disabled', $1)
         on conflict (key) do update set value = $1, updated_at = timezone('utc', now())`,
        [JSON.stringify(body.providers)],
      );
      await recordAdminAction(admin.email, "set_disabled_providers", null, {
        providers: body.providers,
      });
      return NextResponse.json({ ok: true, providers: body.providers });
    }
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  const maintenance = await one<{ value: unknown }>(
    `select value from app_settings where key = 'maintenance_mode'`,
  );
  const disabled = await one<{ value: unknown }>(
    `select value from app_settings where key = 'providers_disabled'`,
  );
  return NextResponse.json({
    maintenance: maintenance?.value === true,
    disabledProviders: Array.isArray(disabled?.value) ? disabled.value : [],
  });
}
