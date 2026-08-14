import { getSessionUser, isAdminEmail } from "@/lib/auth/session";
import { insertRow } from "@/lib/db/pg";

/**
 * Admin authorization: a signed-in session whose email is on ADMIN_EMAILS.
 * No list means no admins - in every environment. The old rule let any
 * signed-in dev user into /admin when the variable was unset.
 */
export async function requireAdmin(): Promise<
  { ok: true; email: string } | { ok: false; status: number; error: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };
  if (!process.env.ADMIN_EMAILS || !isAdminEmail(user.email)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, email: user.email };
}

/** Every sensitive admin action leaves a row. */
export async function recordAdminAction(
  adminEmail: string,
  action: string,
  target: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await insertRow("admin_audit_log", {
    admin_email: adminEmail,
    action,
    target,
    details,
  });
}
