import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { createInitialOnboardingState } from "@/lib/onboarding/state";
import {
  getBrandById,
  getCompetitors,
  getUserOnboarding,
  listAllPrompts,
  listBrandsForOwner,
  upsertUserOnboarding,
} from "@/lib/db/repository";
import type { OnboardingState } from "@/types/onboarding";
import type { ProviderId } from "@/types/database";

// Every ProviderId (types/database.ts) - keep in sync, or a provider a plan
// legitimately offers gets rejected here as "Invalid onboarding update".
// Which providers a given plan may save is checked separately below.
const providerSchema = z.enum([
  "openai",
  "openai_search",
  "claude",
  "gemini",
  "perplexity",
  "bedrock_claude",
  "bedrock_nova",
  "bedrock_llama",
  "bedrock_mistral",
  "grok",
  "deepseek",
  "kimi",
  "groq",
  "minimax",
  "sarvam",
] as const satisfies readonly ProviderId[]);

const patchSchema = z.object({
  currentStep: z.number().int().min(1).max(8).optional(),
  brandId: z.string().min(8).optional(),
  company: z
    .object({
      name: z.string().min(1),
      category: z.string(),
      description: z.string(),
      domain: z.string().min(1),
    })
    .optional(),
  competitors: z
    .array(
      z.object({
        name: z.string().min(1),
        domain: z.string().nullable(),
      }),
    )
    .optional(),
  activePromptIds: z.array(z.string()).optional(),
  providers: z
    .array(providerSchema)
    .min(1)
    .optional(),
  country: z.string().length(2).optional(),
  language: z.string().length(2).optional(),
  monitoringFrequency: z.enum(["weekly", "daily"]).optional(),
  alerts: z
    .object({
      scoreDrop: z.boolean(),
      competitor: z.boolean(),
      citation: z.boolean(),
    })
    .optional(),
});

async function loadOrInitOnboarding(
  userId: string,
): Promise<OnboardingState | null> {
  const entitlements = await getAccountEntitlements(userId);
  if (!isPaidSubscription(entitlements)) return null;
  const competitorLimit =
    PLAN_CONFIG[entitlements.plan].features.competitorsPerBrand;

  const existing = await getUserOnboarding(userId);
  if (existing) {
    // An audit can seed more competitors than the plan tracks (the report
    // lists everyone AI named). Saved state over the limit made every later
    // save fail its plan check - clamp on read so the wizard always starts
    // from a state it is allowed to save back.
    if (existing.competitors.length > competitorLimit) {
      existing.competitors = existing.competitors.slice(0, competitorLimit);
    }
    return existing;
  }

  const brands = await listBrandsForOwner(userId);
  const brand = brands[0];
  if (!brand) return null;

  const [competitors, prompts] = await Promise.all([
    getCompetitors(brand.id),
    listAllPrompts(brand.id),
  ]);

  const initial = createInitialOnboardingState({
    brand,
    plan: entitlements.plan,
    competitors: competitors.slice(0, competitorLimit).map((c) => ({
      name: c.name,
      domain: c.domain,
    })),
    promptIds: prompts.filter((p) => p.active).map((p) => p.id),
  });
  return upsertUserOnboarding(userId, initial);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entitlements = await getAccountEntitlements(user.id);
  if (!isPaidSubscription(entitlements)) {
    return NextResponse.json({ error: "Paid plan required" }, { status: 403 });
  }

  const state = await loadOrInitOnboarding(user.id);
  if (!state) {
    return NextResponse.json(
      { error: "Add a brand before starting onboarding." },
      { status: 400 },
    );
  }

  const plan = PLAN_CONFIG[entitlements.plan];
  return NextResponse.json({
    state,
    plan: {
      id: entitlements.plan,
      name: entitlements.planName,
      providers: plan.features.providers,
      providersPerScan: plan.features.providersPerScan,
      competitorsPerBrand: plan.features.competitorsPerBrand,
      countries: plan.features.countries,
      languages: plan.features.languages,
      weeklyMonitoring: plan.features.weeklyMonitoring,
      dailyMonitoring: plan.features.dailyMonitoring,
      emailAlerts: plan.features.emailAlerts,
    },
  });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const entitlements = await getAccountEntitlements(user.id);
    if (!isPaidSubscription(entitlements)) {
      return NextResponse.json({ error: "Paid plan required" }, { status: 403 });
    }

    const body = patchSchema.parse(await request.json());
    const current = await loadOrInitOnboarding(user.id);
    if (!current) {
      return NextResponse.json(
        { error: "Add a brand before starting onboarding." },
        { status: 400 },
      );
    }

    const plan = PLAN_CONFIG[entitlements.plan];
    const nextBrandId = body.brandId ?? current.brandId;
    if (nextBrandId) {
      const brand = await getBrandById(nextBrandId);
      if (!brand || brand.owner_id !== user.id) {
        return NextResponse.json({ error: "Brand not found" }, { status: 404 });
      }
    }

    // Keep the top of the list rather than refusing the save: the wizard UI
    // already enforces the limit for hand-added rows, and audit-seeded lists
    // legitimately run longer than the plan tracks.
    if (body.competitors && body.competitors.length > plan.features.competitorsPerBrand) {
      body.competitors = body.competitors.slice(
        0,
        plan.features.competitorsPerBrand,
      );
    }

    if (body.providers) {
      const invalid = body.providers.filter(
        (p) => !plan.features.providers.includes(p),
      );
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `${invalid.join(", ")} is not available on your plan.` },
          { status: 402 },
        );
      }
    }

    if (
      body.monitoringFrequency === "daily" &&
      !plan.features.dailyMonitoring
    ) {
      return NextResponse.json(
        { error: "Daily monitoring is not available on your plan." },
        { status: 402 },
      );
    }

    const merged: OnboardingState = {
      ...current,
      ...(body.currentStep !== undefined ? { currentStep: body.currentStep } : {}),
      ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
      ...(body.company !== undefined ? { company: body.company } : {}),
      ...(body.competitors !== undefined ? { competitors: body.competitors } : {}),
      ...(body.activePromptIds !== undefined
        ? { activePromptIds: body.activePromptIds }
        : {}),
      ...(body.providers !== undefined
        ? { providers: body.providers as ProviderId[] }
        : {}),
      ...(body.country !== undefined
        ? { country: body.country.toLowerCase() }
        : {}),
      ...(body.language !== undefined
        ? { language: body.language.toLowerCase() }
        : {}),
      ...(body.monitoringFrequency !== undefined
        ? { monitoringFrequency: body.monitoringFrequency }
        : {}),
      ...(body.alerts !== undefined ? { alerts: body.alerts } : {}),
      updatedAt: new Date().toISOString(),
    };

    const saved = await upsertUserOnboarding(user.id, merged);
    return NextResponse.json({ state: saved });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const field = error.issues[0]?.path.join(".") || "request";
      return NextResponse.json(
        { error: `Invalid onboarding update (${field}).` },
        { status: 400 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to save onboarding";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
