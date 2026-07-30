import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import {
  EntitlementError,
  PLAN_CONFIG,
} from "@/lib/billing/entitlements";
import { providerKeyMissing } from "@/lib/ai/providers/demo";
import { METHODOLOGY_VERSION } from "@/lib/constants";
import { withIdempotency } from "@/lib/rate-limit";
import {
  createScanRun,
  getBrandById,
  getPrompts,
  getScanRun,
  getUserOnboarding,
  listAllPrompts,
  replaceCompetitors,
  updateBrand,
  updateTrackedPrompt,
  upsertBrandMonitoringSettings,
  upsertUserOnboarding,
} from "@/lib/db/repository";
import { enqueueScan } from "@/lib/jobs/inngest";
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
    const providers = state.providers.filter((p) =>
      plan.features.providers.includes(p),
    ) as ProviderId[];
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

    const estimatedChecks = activePrompts.length * providers.length;
    const remaining =
      plan.features.providerChecksPerMonth - entitlements.providerChecksUsed;
    if (estimatedChecks > remaining) {
      return NextResponse.json(
        {
          error: `This scan needs ${estimatedChecks} AI checks but only ${Math.max(remaining, 0)} remain this month.`,
          code: "usage_exceeded",
        },
        { status: 402 },
      );
    }

    const idempotent = await withIdempotency(
      `onboarding-scan:${user.id}:${brand.id}`,
      120,
    );
    if (!idempotent) {
      return NextResponse.json(
        { error: "A scan is already starting for this brand.", code: "in_progress" },
        { status: 409 },
      );
    }

    const scan = await createScanRun({
      brand_id: brand.id,
      initiated_by: user.id,
      scan_type: "manual",
      status: "queued",
      provider_ids: providers,
      total_queries: estimatedChecks,
      completed_queries: 0,
      started_at: null,
      completed_at: null,
      error_summary: null,
      methodology_version: METHODOLOGY_VERSION,
      demo_mode: providers.some((p) => providerKeyMissing(p)),
      cancelled_at: null,
      country: state.country.toUpperCase(),
      language: state.language.toLowerCase(),
    });

    await enqueueScan(scan.id);

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

    const created = await getScanRun(scan.id);
    return NextResponse.json({
      scanRunId: created?.id ?? scan.id,
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
