import { randomBytes } from "node:crypto";
import dns from "node:dns/promises";
import { one, withTransaction } from "@/lib/db/pg";
import { getAccountEntitlements } from "@/lib/billing/account";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { safeFetchText, SafeFetchError } from "@/lib/security/safe-fetch";
import type { Brand } from "@/types/database";

/**
 * Domain-ownership verification. Nobody claims a company report by knowing
 * its URL any more: they prove control of the domain with a DNS TXT record
 * or a well-known file, and only a verified proof transfers ownership.
 */

export const TXT_PREFIX = "arcanoris-verify=";
export const WELL_KNOWN_PATH = "/.well-known/arcanoris-verify.txt";
const EXPIRY_HOURS = 48;
const MAX_ATTEMPTS = 20;

export type DomainVerification = {
  id: string;
  user_id: string;
  domain: string;
  brand_id: string | null;
  method: "dns_txt" | "well_known";
  token: string;
  status: "pending" | "verified" | "failed" | "expired";
  attempts: number;
  last_checked_at: string | null;
  verified_at: string | null;
  expires_at: string;
  created_at: string;
};

export async function startVerification(
  userId: string,
  domain: string,
  brandId: string | null,
): Promise<DomainVerification> {
  const existing = await one<DomainVerification>(
    `select * from domain_verifications
     where user_id = $1 and domain = $2 and status = 'pending'
       and expires_at > timezone('utc', now())`,
    [userId, domain],
  );
  if (existing) return existing;

  // Expire any stale pending row so the partial unique index accepts a new one.
  await one(
    `update domain_verifications set status = 'expired'
     where user_id = $1 and domain = $2 and status = 'pending'
     returning id`,
    [userId, domain],
  );

  const token = randomBytes(16).toString("hex");
  const created = await one<DomainVerification>(
    `insert into domain_verifications
       (user_id, domain, brand_id, method, token, status, expires_at)
     values ($1, $2, $3, 'dns_txt', $4, 'pending',
             timezone('utc', now()) + make_interval(hours => $5))
     returning *`,
    [userId, domain, brandId, token, EXPIRY_HOURS],
  );
  if (!created) throw new Error("Could not create verification.");
  return created;
}

async function tokenVisibleInDns(domain: string, token: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(domain);
    return records.some((chunks) => chunks.join("") === `${TXT_PREFIX}${token}`);
  } catch {
    return false;
  }
}

async function tokenVisibleInWellKnown(
  domain: string,
  token: string,
): Promise<boolean> {
  try {
    const body = await safeFetchText(`https://${domain}${WELL_KNOWN_PATH}`);
    return body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .includes(token);
  } catch (error) {
    if (error instanceof SafeFetchError) return false;
    return false;
  }
}

export type CheckResult =
  | { ok: true; brand: Brand }
  | { ok: false; status: number; error: string };

/**
 * Check the proof and, on success, transfer or create the brand - all
 * inside one transaction so two verified claims cannot both win.
 */
export async function checkVerification(
  userId: string,
  verificationId: string,
): Promise<CheckResult> {
  const verification = await one<DomainVerification>(
    `update domain_verifications set
       attempts = attempts + 1,
       last_checked_at = timezone('utc', now())
     where id = $1 and user_id = $2
     returning *`,
    [verificationId, userId],
  );
  if (!verification) {
    return { ok: false, status: 404, error: "Verification not found." };
  }
  if (verification.status === "verified") {
    return { ok: false, status: 409, error: "Already verified." };
  }
  if (new Date(verification.expires_at).getTime() < Date.now()) {
    await one(
      `update domain_verifications set status = 'expired' where id = $1 returning id`,
      [verification.id],
    );
    return {
      ok: false,
      status: 410,
      error: "This verification expired. Start a new one.",
    };
  }
  if (verification.attempts > MAX_ATTEMPTS) {
    await one(
      `update domain_verifications set status = 'failed' where id = $1 returning id`,
      [verification.id],
    );
    return {
      ok: false,
      status: 429,
      error: "Too many checks. Start a new verification.",
    };
  }

  const viaDns = await tokenVisibleInDns(verification.domain, verification.token);
  const viaFile = viaDns
    ? false
    : await tokenVisibleInWellKnown(verification.domain, verification.token);
  if (!viaDns && !viaFile) {
    return {
      ok: false,
      status: 422,
      error:
        "The verification token was not found yet. DNS changes can take a few minutes to spread.",
    };
  }

  // Ownership transfer is entitlement-checked and atomic.
  const entitlements = await getAccountEntitlements(userId);
  const plan = PLAN_CONFIG[entitlements.plan];

  return withTransaction(async (): Promise<CheckResult> => {
    const claimed = await one<Brand>(
      `select * from brands where owner_id = $1 and canonical_domain = $2`,
      [userId, verification.domain],
    );
    if (!claimed && entitlements.brandCount >= plan.features.brands) {
      return {
        ok: false,
        status: 403,
        error: `Your ${plan.name} plan tracks up to ${plan.features.brands} website(s). Upgrade to claim this one.`,
      };
    }

    let brand = claimed;
    if (!brand) {
      // Take over the unowned public report atomically; if someone else owns
      // one for this domain, create this account's own brand row instead.
      brand = await one<Brand>(
        `update brands set owner_id = $1, claimed_at = timezone('utc', now())
         where canonical_domain = $2 and owner_id is null
         returning *`,
        [userId, verification.domain],
      );
    }
    if (!brand) {
      brand = await one<Brand>(
        `insert into brands
           (owner_id, name, canonical_domain, slug, aliases, default_country,
            default_language, visibility, claimed_at)
         values ($1, $2, $2, $3 || '-' || substring(md5(random()::text), 1, 6),
                 to_jsonb(array[$2]), 'US', 'en', 'public', timezone('utc', now()))
         returning *`,
        [
          userId,
          verification.domain,
          verification.domain.replace(/[^a-z0-9]+/g, "-"),
        ],
      );
    }
    if (!brand) {
      return { ok: false, status: 500, error: "Could not attach the website." };
    }

    await one(
      `update domain_verifications set
         status = 'verified',
         method = $2,
         verified_at = timezone('utc', now()),
         brand_id = $3
       where id = $1 returning id`,
      [verification.id, viaDns ? "dns_txt" : "well_known", brand.id],
    );
    return { ok: true, brand };
  });
}
