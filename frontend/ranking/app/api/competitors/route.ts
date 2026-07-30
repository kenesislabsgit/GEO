import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import {
  assertCanAddCompetitor,
  EntitlementError,
} from "@/lib/billing/entitlements";
import {
  assertBrandOwnership,
  BrandAccessError,
} from "@/lib/prompts/access";
import {
  addCompetitor,
  getCompetitors,
  removeCompetitor,
} from "@/lib/db/repository";

const createSchema = z.object({
  brandId: z.string().min(8),
  name: z.string().min(2).max(120),
  domain: z.string().max(253).optional().nullable(),
});

const deleteSchema = z.object({
  brandId: z.string().min(8),
  competitorId: z.string().min(8),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = createSchema.parse(await request.json());
    await assertBrandOwnership(body.brandId, user.id);
    const entitlements = await getAccountEntitlements(user.id);
    const existing = await getCompetitors(body.brandId);
    assertCanAddCompetitor(entitlements, existing.length);

    const domain = body.domain?.trim().toLowerCase() || null;
    const created = await addCompetitor(body.brandId, {
      name: body.name.trim(),
      domain,
    });
    return NextResponse.json({ competitor: created }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid competitor" }, { status: 400 });
    }
    if (error instanceof BrandAccessError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof EntitlementError) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to add competitor";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = deleteSchema.parse(await request.json());
    await assertBrandOwnership(body.brandId, user.id);
    const removed = await removeCompetitor(body.brandId, body.competitorId);
    if (!removed) {
      return NextResponse.json({ error: "Competitor not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (error instanceof BrandAccessError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
