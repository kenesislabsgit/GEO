import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import {
  assertCanEditAuditSetup,
  EntitlementError,
  PLAN_CONFIG,
} from "@/lib/billing/entitlements";
import {
  getBrandById,
  getBrandMonitoringSettings,
  listQuestionSetsForBrands,
  updateBrand,
  upsertBrandMonitoringSettings,
} from "@/lib/db/repository";
import { SUPPORTED_COUNTRIES, SUPPORTED_LANGUAGES } from "@/lib/constants";
import type { ProviderId } from "@/types/database";

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const putSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["daily", "weekly"]),
  dayOfWeek: z.number().int().min(0).max(6),
  hourLocal: z.number().int().min(0).max(23),
  timezone: z.string().min(1).max(64).refine(validTimezone, {
    message: "Choose a valid timezone.",
  }),
  providers: z.array(z.string()).max(16),
  country: z.string().length(2),
  language: z.string().length(2),
  alerts: z.object({
    scoreDrop: z.boolean(),
    competitor: z.boolean(),
    citation: z.boolean(),
  }),
  monitoringQuestions: z
    .array(z.string().trim().min(5).max(500))
    .max(5)
    .refine(
      (items) =>
        new Set(items.map((item) => item.toLowerCase())).size === items.length,
      {
        message: "Monitoring questions must be different.",
      },
    ),
});

async function authorize(id: string) {
  const user = await getSessionUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const brand = await getBrandById(id);
  if (!brand || brand.owner_id !== user.id) {
    return { error: "Not found", status: 404 as const };
  }
  return { user, brand };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await authorize(id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const settings = await getBrandMonitoringSettings(id);
  const entitlements = await getAccountEntitlements(auth.user.id);
  const features = PLAN_CONFIG[entitlements.plan].features;
  const questionSets = await listQuestionSetsForBrands([id]);
  return NextResponse.json({
    settings,
    brand: {
      country: auth.brand.default_country,
      language: auth.brand.default_language,
      visibility: auth.brand.visibility,
    },
    plan: {
      id: entitlements.plan,
      dailyMonitoring: features.dailyMonitoring,
      weeklyMonitoring: features.weeklyMonitoring,
      providers: features.providers,
      providersPerScan: features.providersPerScan,
    },
    questionSets,
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await authorize(id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const body = putSchema.parse(await request.json());
    const entitlements = await getAccountEntitlements(auth.user.id);
    const features = PLAN_CONFIG[entitlements.plan].features;

    // Turning monitoring off must always remain possible. Other changes are
    // paused once the monthly allowance has been consumed.
    if (body.enabled) assertCanEditAuditSetup(entitlements);

    if (body.enabled && body.monitoringQuestions.length !== 5) {
      return NextResponse.json(
        { error: "Choose exactly five monitoring questions." },
        { status: 400 },
      );
    }

    // Server-side plan rules, whatever the page sent.
    const frequency =
      body.frequency === "daily" && !features.dailyMonitoring
        ? "weekly"
        : body.frequency;
    const allowed = new Set<string>(features.providers);
    const providers = body.providers
      .filter((p): p is ProviderId => allowed.has(p))
      .slice(0, features.providersPerScan);
    const country = SUPPORTED_COUNTRIES.some(
      (c) => c.code === body.country.toLowerCase(),
    )
      ? body.country.toLowerCase()
      : auth.brand.default_country.toLowerCase();
    const language = SUPPORTED_LANGUAGES.some(
      (l) => l.code === body.language.toLowerCase(),
    )
      ? body.language.toLowerCase()
      : auth.brand.default_language.toLowerCase();

    const stored = await upsertBrandMonitoringSettings(id, {
      enabled: body.enabled,
      monitoringFrequency: frequency,
      dayOfWeek: body.dayOfWeek,
      hourLocal: body.hourLocal,
      timezone: body.timezone,
      providers,
      monitoringQuestions: body.monitoringQuestions,
      country: country.toUpperCase(),
      language,
      alerts: body.alerts,
      updatedAt: new Date().toISOString(),
    });

    // Locale lives on the brand too, so manual audits pick it up.
    await updateBrand(id, {
      default_country: country.toUpperCase(),
      default_language: language,
    });

    return NextResponse.json({ settings: stored });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid monitoring settings." },
        { status: 400 },
      );
    }
    if (error instanceof EntitlementError) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    throw error;
  }
}
