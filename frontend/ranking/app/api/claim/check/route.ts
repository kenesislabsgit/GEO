import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { checkVerification } from "@/lib/claims/verification";
import { limitAction } from "@/lib/rate-limit";
import { routes } from "@/lib/routes";

const schema = z.object({ verificationId: z.string().uuid() });

/** Check the published token; on success, ownership transfers atomically. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const rate = await limitAction("claim-check", user.id, 30, 3600);
  if (!rate.success) {
    return NextResponse.json(
      { error: "Too many checks. Try again in a while." },
      { status: 429 },
    );
  }
  const body = schema.parse(await request.json());
  const result = await checkVerification(user.id, body.verificationId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({
    ok: true,
    brandId: result.brand.id,
    redirect: routes.brand(result.brand.id),
  });
}
