import { getAccountEntitlements } from "@/lib/billing/account";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import {
  FREE_AUDIT_QUESTION_COUNT,
  PRO_AUDIT_QUESTION_COUNT,
} from "@/lib/constants";
import type { ProviderId } from "@/types/database";

/**
 * The door check. The pages already show each plan only what it may use, but
 * a page is a suggestion - this is the rule. Every audit start passes through
 * here, so a hand-crafted request gets exactly what the account's plan
 * allows and nothing more.
 */

export type AuditAuthorization =
  | {
      ok: true;
      mode: "free" | "pro";
      assistants: ProviderId[];
      limitPerAssistant: number;
      /** Pro only: localize a slice of questions to the company's home
       * market and pin their web search there. */
      geoMarket: boolean;
      /** The plan the checks ran against, for the scan's input snapshot. */
      plan: string;
      /** Monthly provider-check allowance; the enqueue re-checks it atomically. */
      checksLimit: number;
    }
  | { ok: false; status: number; error: string };

export async function authorizeAudit(
  userId: string,
  requested: {
    mode: "free" | "pro";
    assistants: ProviderId[];
    limitPerAssistant?: number;
    /** True when this audit would create a new brand for the account. */
    creatingBrand?: boolean;
  },
): Promise<AuditAuthorization> {
  const account = await getAccountEntitlements(userId);
  const paid =
    account.plan !== "free" &&
    (account.status === "active" || account.status === "trialing");
  const plan = PLAN_CONFIG[paid ? account.plan : "free"];

  // Starting an audit on a new website is also creating a brand, and the
  // brand limit applies here exactly as it does on the brands page.
  if (requested.creatingBrand && account.brandCount >= plan.features.brands) {
    return {
      ok: false,
      status: 403,
      error: `Your ${plan.name} plan tracks up to ${plan.features.brands} website(s). Upgrade to add more.`,
    };
  }

  // A Pro run without a paid plan is refused outright rather than silently
  // downgraded: silently running a free audit when Pro was asked for would
  // look like a broken product instead of a missing subscription.
  const mode = requested.mode;
  if (mode === "pro" && !paid) {
    return {
      ok: false,
      status: 402,
      error: "The Pro audit needs an active subscription. Upgrade to run it.",
    };
  }

  // Providers the plan does not include are dropped, not fatal - the page
  // never offers them, so their presence means a hand-edited request.
  const allowed = new Set<string>(plan.features.providers);
  const assistants = requested.assistants.filter((a) => allowed.has(a));
  if (assistants.length === 0) {
    return {
      ok: false,
      status: 403,
      error: "None of the requested AI providers are in your plan.",
    };
  }
  // The picker caps the selection, so an over-cap request is hand-edited.
  if (assistants.length > plan.features.providersPerScan) {
    return {
      ok: false,
      status: 403,
      error: `Your plan runs up to ${plan.features.providersPerScan} providers per audit.`,
    };
  }

  const maxQuestions =
    mode === "pro" ? PRO_AUDIT_QUESTION_COUNT : FREE_AUDIT_QUESTION_COUNT;
  const limitPerAssistant = Math.min(
    requested.limitPerAssistant ?? maxQuestions,
    maxQuestions,
  );

  // The monthly allowance. One check = one question asked to one provider.
  const estimated = assistants.length * limitPerAssistant;
  const remaining = Math.max(
    plan.features.providerChecksPerMonth - account.providerChecksUsed,
    0,
  );
  if (estimated > remaining) {
    return {
      ok: false,
      status: 402,
      error:
        account.plan === "free"
          ? "Your free audit for this month is used. Upgrade to run more."
          : `This audit needs ${estimated} provider checks but only ${remaining} are left this month.`,
    };
  }

  return {
    ok: true,
    mode,
    assistants,
    limitPerAssistant,
    geoMarket: mode === "pro" && plan.features.geoMarketSearch,
    plan: plan.id,
    checksLimit: plan.features.providerChecksPerMonth,
  };
}
