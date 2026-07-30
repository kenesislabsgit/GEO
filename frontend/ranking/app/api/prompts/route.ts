import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { assertCanAddPrompt, EntitlementError } from "@/lib/billing/entitlements";
import {
  assertBrandOwnership,
  BrandAccessError,
} from "@/lib/prompts/access";
import { findDuplicatePrompt } from "@/lib/prompts/normalize";
import {
  createTrackedPrompt,
  listAllPrompts,
} from "@/lib/db/repository";

const createSchema = z.object({
  brandId: z.string().min(8),
  prompt: z.string().min(8).max(500),
  country: z.string().length(2),
  language: z.string().length(2),
});

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const brandId = new URL(request.url).searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "brandId is required" }, { status: 400 });
  }

  try {
    await assertBrandOwnership(brandId, user.id);
    const prompts = await listAllPrompts(brandId);
    return NextResponse.json({ prompts });
  } catch (error) {
    if (error instanceof BrandAccessError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = createSchema.parse(await request.json());
    const brand = await assertBrandOwnership(body.brandId, user.id);
    const existing = await listAllPrompts(brand.id);
    const duplicate = findDuplicatePrompt(body.prompt, existing);
    if (duplicate) {
      return NextResponse.json(
        {
          error: "A similar prompt already exists for this brand.",
          code: "duplicate_prompt",
        },
        { status: 409 },
      );
    }

    const entitlements = await getAccountEntitlements(user.id);
    assertCanAddPrompt(entitlements);

    const created = await createTrackedPrompt({
      brand_id: brand.id,
      prompt: body.prompt.trim(),
      prompt_type: "custom",
      buyer_stage: "custom",
      country: body.country.toUpperCase(),
      language: body.language.toLowerCase(),
      active: true,
      is_custom: true,
      rationale: "User-defined buyer question.",
    });

    return NextResponse.json({ prompt: created }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid prompt request." }, { status: 400 });
    }
    if (error instanceof BrandAccessError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof EntitlementError) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    const message = error instanceof Error ? error.message : "Failed to create prompt";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
