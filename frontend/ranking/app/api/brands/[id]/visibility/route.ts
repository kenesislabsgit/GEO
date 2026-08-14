import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { hasFeature } from "@/lib/billing/entitlements";
import { getBrandById, updateBrand } from "@/lib/db/repository";

const schema = z.object({
  visibility: z.enum(["public", "private"]),
});

/**
 * Flip a brand's report between public and private. The report page already
 * enforces the column on read; this is the switch that was missing - every
 * brand was hardcoded public with no way to change it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand || brand.owner_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = schema.parse(await request.json());

  const entitlements = await getAccountEntitlements(user.id);
  if (
    body.visibility === "private" &&
    !hasFeature(entitlements.plan, "publicPrivateReports")
  ) {
    return NextResponse.json(
      { error: "Private reports require a paid plan." },
      { status: 402 },
    );
  }

  await updateBrand(id, { visibility: body.visibility });
  return NextResponse.json({ ok: true, visibility: body.visibility });
}
