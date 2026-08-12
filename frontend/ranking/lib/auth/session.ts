import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { createClient } from "@/lib/db/supabase/server";
import { usingLocalDb } from "@/lib/db/repository";

export type SessionUser = {
  id: string;
  email: string;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  // Asked first, and on every path. Someone who signed in with Google is
  // signed in whether or not a database is configured, and the two older
  // routes below stay in place so nobody is logged out by this change.
  const session = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);
  if (session?.user?.email) {
    return { id: session.user.id, email: session.user.email };
  }

  if (usingLocalDb()) {
    // Local demo auth via cookie set by /api/auth/local
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const raw = jar.get("rbai_local_user")?.value;
    if (!raw) return null;
    try {
      return JSON.parse(decodeURIComponent(raw)) as SessionUser;
    } catch {
      return null;
    }
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

export function isAdminEmail(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
