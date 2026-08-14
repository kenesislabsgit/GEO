import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { getSessionUser } from "@/lib/auth/session";
import { dodoApiBase } from "@/lib/billing/dodo";
import { exec, q, withTransaction } from "@/lib/db/pg";
import { log } from "@/lib/log";
import { cancelActiveScansForUser } from "@/lib/scans/queue";

export const runtime = "nodejs";

/**
 * Account deletion. Explicit confirmation required in the body; running
 * audits are cancelled first; every account-owned record goes in one
 * transaction; Better Auth sessions are revoked through Better Auth and the
 * session cookie is cleared. Repeating the request is safe - a deleted
 * account simply has nothing left to delete.
 *
 * Retained for legal/billing accuracy, anonymized: usage_ledger rows (user
 * FK nulls on delete) and billing webhook events (payload bodies age out via
 * the retention sweep). Documented in the privacy policy.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    confirm?: unknown;
  };
  if (body.confirm !== "DELETE") {
    return NextResponse.json(
      { error: 'Confirm deletion by sending { "confirm": "DELETE" }.' },
      { status: 400 },
    );
  }

  // Stop the money first: running audits and the live subscription.
  await cancelActiveScansForUser(user.id).catch(() => {});
  await cancelDodoSubscriptions(user.id);

  await withTransaction(async () => {
    // Brands cascade to prompts, competitors, monitoring, scans, answers,
    // scores, recommendations and scan events via the schema.
    await exec(`delete from brands where owner_id = $1`, [user.id]);
    await exec(`delete from subscriptions where user_id = $1`, [user.id]);
    await exec(`delete from alerts where user_id = $1`, [user.id]);
    await exec(`delete from domain_verifications where user_id = $1`, [user.id]);
    await exec(`delete from app_settings where key = $1`, [
      `user_onboarding:${user.id}`,
    ]);
    // Outstanding verification/reset tokens for this account's email.
    await exec(
      `delete from verification where identifier in (
         select email from "user" where id = $1
       )`,
      [user.id],
    );
    await exec(`delete from session where "userId" = $1`, [user.id]);
    await exec(`delete from account where "userId" = $1`, [user.id]);
    await exec(`delete from "user" where id = $1`, [user.id]);
  });

  // Revoke through Better Auth so its cookie handling clears the browser's
  // session cookie properly (name, prefix and attributes included).
  await auth.api
    .signOut({ headers: request.headers })
    .catch(() => {
      // The user row is already gone; a signOut failure leaves only a
      // dangling cookie that no longer matches any session.
    });

  log.info("account_deleted", { userId: user.id });
  return NextResponse.json({ ok: true });
}

/** Cancel live Dodo subscriptions so billing stops with the account. */
async function cancelDodoSubscriptions(userId: string): Promise<void> {
  const key = process.env.DODO_PAYMENTS_API_KEY;
  if (!key) return;
  const rows = await q<{ provider_subscription_id: string }>(
    `select provider_subscription_id from subscriptions
     where user_id = $1 and provider = 'dodo'
       and provider_subscription_id is not null
       and status in ('active', 'trialing', 'past_due', 'paused')`,
    [userId],
  );
  for (const row of rows) {
    try {
      const response = await fetch(
        `${dodoApiBase()}/subscriptions/${encodeURIComponent(row.provider_subscription_id)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "cancelled" }),
        },
      );
      if (!response.ok) {
        log.warn("dodo_cancel_failed", {
          subscriptionId: row.provider_subscription_id,
          status: response.status,
        });
      }
    } catch (error) {
      log.warn("dodo_cancel_failed", {
        subscriptionId: row.provider_subscription_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
