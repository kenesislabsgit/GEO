import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createCheckoutSession } from "@/lib/billing/create-checkout";
import type { PlanId } from "@/lib/billing/entitlements";
import type { BillingInterval } from "@/lib/billing/pricing";

const schema = z.object({
  plan: z.enum(["founder", "growth", "agency"]),
  interval: z.enum(["monthly", "yearly"]),
  returnTo: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = schema.parse(await request.json());
  const result = await createCheckoutSession({
    user,
    plan: body.plan as PlanId,
    interval: body.interval as BillingInterval,
    returnTo: body.returnTo,
    origin: new URL(request.url).origin,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ url: result.url });
}
