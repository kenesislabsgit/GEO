import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";

export type SessionUser = {
  id: string;
  email: string;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  // Better Auth is the only session that counts. The old fake login's cookie
  // is deliberately not honoured - it was plain JSON the browser could write
  // itself - and the Supabase session went with the Supabase login.
  const session = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);
  if (session?.user?.email) {
    return { id: session.user.id, email: session.user.email };
  }
  return null;
}

export function isAdminEmail(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
