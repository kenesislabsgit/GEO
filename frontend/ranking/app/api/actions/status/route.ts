import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import {
  assertBrandOwnership,
  BrandAccessError,
} from "@/lib/prompts/access";
import {
  getRecommendationById,
  updateRecommendationStatus,
} from "@/lib/db/repository";

const schema = z.object({
  actionId: z.string(),
  status: z.enum(["open", "in_progress", "completed", "dismissed"]),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = schema.parse(await request.json());
    const recommendation = await getRecommendationById(body.actionId);
    if (!recommendation) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }
    await assertBrandOwnership(recommendation.brand_id, user.id);
    await updateRecommendationStatus(
      body.actionId,
      body.status,
      body.status === "completed" ? new Date().toISOString() : null,
    );
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
