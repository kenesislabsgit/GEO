import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { exec } from "@/lib/db/pg";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Deleting the brands cascades to their prompts, competitors, scans,
  // answers, scores and recommendations — the schema does that work.
  await exec(`delete from brands where owner_id = $1`, [user.id]);
  await exec(`delete from subscriptions where user_id = $1`, [user.id]);
  await exec(`delete from alerts where user_id = $1`, [user.id]);
  await exec(`delete from app_settings where key = $1`, [
    `user_onboarding:${user.id}`,
  ]);

  // Better Auth's rows last, sessions before the user they belong to.
  await exec(`delete from session where "userId" = $1`, [user.id]);
  await exec(`delete from account where "userId" = $1`, [user.id]);
  await exec(`delete from "user" where id = $1`, [user.id]);

  const response = NextResponse.json({ ok: true });
  response.cookies.set("rbai_local_user", "", { path: "/", maxAge: 0 });
  return response;
}
