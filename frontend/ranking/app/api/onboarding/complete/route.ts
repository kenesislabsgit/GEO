import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import {
  EntitlementError,
  PLAN_CONFIG,
} from "@/lib/billing/entitlements";
import { PRO_AUDIT_QUESTION_COUNT } from "@/lib/constants";
import { enqueueScan } from "@/lib/scans/queue";
import {
  getBrandById,
  getPrompts,
  getUserOnboarding,
  listAllPrompts,
  replaceCompetitors,
  updateBrand,
  updateTrackedPrompt,
  upsertBrandMonitoringSettings,
  upsertUserOnboarding,
} from "@/lib/db/repository";
import type { ProviderId } from "@/types/database";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const entitlements = await getAccountEntitlements(user.id);
    if (!isPaidSubscription(entitlements)) {
      return NextResponse.json({ error: "Paid plan required" }, { status: 403 });
    }

    const state = await getUserOnboarding(user.id);
    if (!state || !state.brandId) {
      return NextResponse.json(
        { error: "Onboarding has not been started." },
        { status: 400 },
      );
    }

    const brand = await getBrandById(state.brandId);
    if (!brand || brand.owner_id !== user.id) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    const plan = PLAN_CONFIG[entitlements.plan];
    const providers = (
      state.providers.filter((p) =>
        plan.features.providers.includes(p),
      ) as ProviderId[]
    ).slice(0, plan.features.providersPerScan);
    if (providers.length === 0) {
      return NextResponse.json(
        { error: "Select at least one provider." },
        { status: 400 },
      );
    }

    await updateBrand(brand.id, {
      name: state.company.name.trim(),
      category: state.company.category.trim() || null,
      description: state.company.description.trim() || null,
      canonical_domain: brand.canonical_domain,
      default_country: state.country.toUpperCase(),
      default_language: state.language.toLowerCase(),
    });

    await replaceCompetitors(
      brand.id,
      state.competitors.slice(0, plan.features.competitorsPerBrand).map((c) => ({
        name: c.name.trim(),
        domain: c.domain?.trim() || null,
        aliases: [c.name.trim()],
      })),
    );

    const allPrompts = await listAllPrompts(brand.id);
    const activeIds = new Set(state.activePromptIds);
    for (const prompt of allPrompts) {
      const shouldBeActive = activeIds.has(prompt.id);
      if (prompt.active !== shouldBeActive) {
        await updateTrackedPrompt(prompt.id, { active: shouldBeActive });
      }
    }

    const refreshedEntitlements = await getAccountEntitlements(user.id);
    if (refreshedEntitlements.activePromptCount > plan.features.activePrompts) {
      throw new EntitlementError(
        `Your plan allows ${plan.features.activePrompts} active prompts.`,
      );
    }

    const activePrompts = await getPrompts(brand.id);
    if (activePrompts.length === 0) {
      return NextResponse.json(
        { error: "Select at least one buyer question to track." },
        { status: 400 },
      );
    }

    // The wizard's exact curated questions, asked verbatim by the engine.
    const promptSlice = activePrompts
      .slice(0, PRO_AUDIT_QUESTION_COUNT)
      .map((p) => ({ id: p.id, prompt: p.prompt }));

    // One queue, one engine: the same enqueue path a manual audit uses, with
    // everything the wizard collected frozen into the input snapshot.
    const result = await enqueueScan({
      brand,
      initiatedBy: user.id,
      scanType: "manual",
      snapshot: {
        domain: brand.canonical_domain,
        mode: "pro",
        assistants: providers,
        limit_per_assistant: promptSlice.length,
        prompts: promptSlice,
        country: state.country.toLowerCase(),
        language: state.language.toLowerCase(),
        geo_market: plan.features.geoMarketSearch,
        geo_market_name: null,
        ip_hash: null,
        plan: plan.id,
        question_count: promptSlice.length,
        methodology_version_requested: null,
        trigger_source: "onboarding",
        cost_ceiling_usd: Number(process.env.SCAN_COST_CEILING_USD ?? "2.50"),
        resume: false,
      },
      idempotencyKey: `onboarding:${user.id}:${brand.id}`,
      checksLimit: plan.features.providerChecksPerMonth,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: "usage_exceeded" },
        { status: result.status },
      );
    }

    await upsertBrandMonitoringSettings(brand.id, {
      monitoringFrequency: state.monitoringFrequency,
      alerts: state.alerts,
      providers,
      country: state.country.toUpperCase(),
      language: state.language.toLowerCase(),
      updatedAt: new Date().toISOString(),
    });

    await upsertUserOnboarding(user.id, {
      ...state,
      completed: true,
      currentStep: 8,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      scanRunId: result.scan.id,
      brandId: brand.id,
      completed: true,
    });
  } catch (error) {
    if (error instanceof EntitlementError) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to complete onboarding";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
