import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import {
  countUnreadAlerts,
  markAlertRead,
  markAllAlertsRead,
} from "@/lib/db/repository";

const patchSchema = z.union([
  z.object({ alertId: z.string().uuid() }),
  z.object({ all: z.literal(true) }),
]);

/** Unread count, for the sidebar badge. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ unread: await countUnreadAlerts(user.id) });
}

/** Mark one alert read, or all of them. Ownership enforced in the query. */
export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if ("all" in parsed.data) {
    const marked = await markAllAlertsRead(user.id);
    return NextResponse.json({ ok: true, marked });
  }
  const marked = await markAlertRead(user.id, parsed.data.alertId);
  return NextResponse.json({ ok: true, marked: marked ? 1 : 0 });
}
