import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { EntitlementError } from "@/lib/billing/entitlements";
import {
  assertBrandOwnership,
  assertCanActivateAnotherPrompt,
  BrandAccessError,
} from "@/lib/prompts/access";
import { findDuplicatePrompt } from "@/lib/prompts/normalize";
import {
  deleteTrackedPrompt,
  getTrackedPromptById,
  listAllPrompts,
  updateTrackedPrompt,
} from "@/lib/db/repository";

const patchSchema = z.object({
  prompt: z.string().min(8).max(500).optional(),
  active: z.boolean().optional(),
  country: z.string().length(2).optional(),
  language: z.string().length(2).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());
    const existing = await getTrackedPromptById(id);
    if (!existing) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    await assertBrandOwnership(existing.brand_id, user.id);

    if (body.prompt !== undefined) {
      const siblings = await listAllPrompts(existing.brand_id);
      const duplicate = findDuplicatePrompt(body.prompt, siblings, id);
      if (duplicate) {
        return NextResponse.json(
          {
            error: "A similar prompt already exists for this brand.",
            code: "duplicate_prompt",
          },
          { status: 409 },
        );
      }
    }

    if (body.active === true && !existing.active) {
      await assertCanActivateAnotherPrompt(user.id);
    }

    const updated = await updateTrackedPrompt(id, {
      ...(body.prompt !== undefined ? { prompt: body.prompt.trim() } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.country !== undefined
        ? { country: body.country.toUpperCase() }
        : {}),
      ...(body.language !== undefined
        ? { language: body.language.toLowerCase() }
        : {}),
    });

    return NextResponse.json({ prompt: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid prompt update." }, { status: 400 });
    }
    if (error instanceof BrandAccessError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof EntitlementError) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    const message = error instanceof Error ? error.message : "Failed to update prompt";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const existing = await getTrackedPromptById(id);
    if (!existing) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    await assertBrandOwnership(existing.brand_id, user.id);
    await deleteTrackedPrompt(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BrandAccessError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Failed to delete prompt";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
