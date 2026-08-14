import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { q, one } from "@/lib/db/pg";
import { limitAction } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Complete account export: everything the account owns, as one JSON
 * document with a stable structure. Excluded on purpose: password hashes,
 * session tokens, other users' data, and internal service credentials.
 *
 * Big accounts stream section by section from the database but are still
 * one response; per-table row caps below keep a pathological account from
 * tying up a connection, and the caps are declared in the payload rather
 * than silently applied.
 */

const ROW_CAP = 20_000;

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rate = await limitAction("account-export", user.id, 5, 3600);
  if (!rate.success) {
    return NextResponse.json(
      { error: "Too many exports. Try again later." },
      { status: 429 },
    );
  }

  const profile = await one(
    `select id, name, email, "emailVerified", "createdAt", "updatedAt"
     from "user" where id = $1`,
    [user.id],
  );
  const authAccounts = await q(
    `select "providerId", "createdAt" from account where "userId" = $1`,
    [user.id],
  );
  const brands = await q(
    `select id, name, canonical_domain, slug, description, category,
            target_audience, aliases, default_country, default_language,
            visibility, claimed_at, created_at, updated_at
     from brands where owner_id = $1`,
    [user.id],
  );
  const monitoring = await q(
    `select bm.* from brand_monitoring bm
     join brands b on b.id = bm.brand_id where b.owner_id = $1`,
    [user.id],
  );
  const prompts = await q(
    `select p.* from tracked_prompts p
     join brands b on b.id = p.brand_id where b.owner_id = $1 limit ${ROW_CAP}`,
    [user.id],
  );
  const competitors = await q(
    `select c.* from competitors c
     join brands b on b.id = c.brand_id where b.owner_id = $1 limit ${ROW_CAP}`,
    [user.id],
  );
  const scans = await q(
    `select s.id, s.brand_id, s.scan_type, s.status, s.provider_ids,
            s.total_queries, s.completed_queries, s.started_at, s.completed_at,
            s.error_summary, s.methodology_version, s.country, s.language,
            s.summary, s.trigger_source, s.input_snapshot, s.estimated_cost_usd,
            s.created_at
     from scan_runs s
     join brands b on b.id = s.brand_id where b.owner_id = $1
     order by s.created_at limit ${ROW_CAP}`,
    [user.id],
  );
  const answers = await q(
    `select r.id, r.scan_run_id, r.tracked_prompt_id, r.provider, r.model,
            r.raw_answer, r.answer_summary, r.brand_mentioned, r.brand_position,
            r.confidence, r.recommended_brands, r.citations, r.sources,
            r.estimated_cost, r.error, r.created_at
     from query_results r
     join scan_runs s on s.id = r.scan_run_id
     join brands b on b.id = s.brand_id where b.owner_id = $1
     order by r.created_at limit ${ROW_CAP}`,
    [user.id],
  );
  const scores = await q(
    `select sc.* from score_snapshots sc
     join brands b on b.id = sc.brand_id where b.owner_id = $1
     order by sc.created_at limit ${ROW_CAP}`,
    [user.id],
  );
  const actions = await q(
    `select r.* from recommendations r
     join brands b on b.id = r.brand_id where b.owner_id = $1
     order by r.created_at limit ${ROW_CAP}`,
    [user.id],
  );
  const alerts = await q(
    `select id, brand_id, scan_run_id, type, title, body, metadata,
            read_at, emailed_at, created_at
     from alerts where user_id = $1 order by created_at limit ${ROW_CAP}`,
    [user.id],
  );
  const subscriptions = await q(
    `select plan, status, current_period_start, current_period_end,
            cancel_at_period_end, created_at, updated_at
     from subscriptions where user_id = $1`,
    [user.id],
  );
  const usage = await q(
    `select brand_id, scan_run_id, provider, operation, units,
            estimated_cost, billing_period, created_at
     from usage_ledger where user_id = $1 order by created_at limit ${ROW_CAP}`,
    [user.id],
  );
  const verifications = await q(
    `select domain, brand_id, method, status, verified_at, expires_at, created_at
     from domain_verifications where user_id = $1`,
    [user.id],
  );
  const onboarding = await one(
    `select value from app_settings where key = $1`,
    [`user_onboarding:${user.id}`],
  );

  const payload = {
    schema: "rankedbyai.account_export.v2",
    exportedAt: new Date().toISOString(),
    rowCapPerSection: ROW_CAP,
    user: profile,
    authProviders: authAccounts,
    onboarding: onboarding?.value ?? null,
    brands,
    brandMonitoring: monitoring,
    trackedPrompts: prompts,
    competitors,
    scans,
    providerAnswers: answers,
    scoreSnapshots: scores,
    actions,
    alerts,
    subscriptions,
    usageLedger: usage,
    domainVerifications: verifications,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="rankedbyai-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
