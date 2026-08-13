import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getLatestSubscription } from "@/lib/db/repository";
import { dodoApiBase } from "@/lib/billing/dodo";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Latest subscription whatever its status: a person whose payment failed
  // needs the portal precisely to fix it.
  const subscription = await getLatestSubscription(user.id);
  if (!subscription?.provider_customer_id) {
    return NextResponse.json(
      { error: "No billing customer found." },
      { status: 404 },
    );
  }

  if (!process.env.DODO_PAYMENTS_API_KEY) {
    return NextResponse.json({
      url: "/dashboard/billing",
      simulated: true,
    });
  }

  const response = await fetch(
    `${dodoApiBase()}/customers/${encodeURIComponent(
      subscription.provider_customer_id,
    )}/customer-portal/session`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.DODO_PAYMENTS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    },
  );

  if (!response.ok) {
    return NextResponse.json(
      { error: "Unable to open customer portal." },
      { status: 400 },
    );
  }

  const data = (await response.json()) as { link?: string; url?: string };
  return NextResponse.json({ url: data.link || data.url });
}
