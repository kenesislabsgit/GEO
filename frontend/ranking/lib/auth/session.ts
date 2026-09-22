import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";

export type SessionUser = {
  id: string;
  email: string;
};

/** Only onboarding may use a session whose email is still unconfirmed. */
export async function getOnboardingUser(
  requestHeaders?: Headers,
): Promise<(SessionUser & { emailVerified: boolean }) | null> {
  // Better Auth is the only session that counts. The old fake login's cookie
  // is deliberately not honoured - it was plain JSON the browser could write
  // itself - and the Supabase session went with the Supabase login.
  const session = await auth.api
    .getSession({
      headers: requestHeaders ?? await headers(),
      query: { disableCookieCache: true },
    })
    .catch(() => null);
  if (session?.user?.email) {
    return {
      id: session.user.id,
      email: session.user.email,
      emailVerified: session.user.emailVerified === true,
    };
  }
  return null;
}

/** Shared by protected pages, API routes, and public signed-in controls. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const user = await getOnboardingUser();
  return user?.emailVerified ? { id: user.id, email: user.email } : null;
}

export function isAdminEmail(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
