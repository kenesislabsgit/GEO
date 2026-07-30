import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  listAlerts,
  listBrandsForOwner,
  getSubscription,
} from "@/lib/db/repository";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [brands, alerts, subscription] = await Promise.all([
    listBrandsForOwner(user.id),
    listAlerts(user.id),
    getSubscription(user.id),
  ]);
  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    user,
    brands,
    alerts,
    subscription,
  });
}
