import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getSubscription } from "@/lib/db/repository";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subscription = await getSubscription(user.id);
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
    "https://api.dodopayments.com/customers/portal",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.DODO_PAYMENTS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer_id: subscription.provider_customer_id,
      }),
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
