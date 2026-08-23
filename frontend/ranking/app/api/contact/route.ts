import { NextResponse } from "next/server";
import { contactInquirySchema, labelForCompanySize, labelForInterest } from "@/lib/contact/schema";
import { sendContactEmail } from "@/lib/email/smtp";
import { SUPPORT_EMAIL } from "@/lib/constants";
import { limitAction } from "@/lib/rate-limit";
import { normalizeDomain, UrlValidationError } from "@/lib/security/url";
import { log } from "@/lib/log";

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const ipLimit = await limitAction("contact", ip, 5, 3600);
  if (!ipLimit.success) {
    return NextResponse.json(
      { error: "Too many messages from this network. Try again in an hour." },
      { status: 429 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const parsed = contactInquirySchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Check the form and try again.";
    return NextResponse.json({ error: first }, { status: 400 });
  }

  const inquiry = parsed.data;
  if (inquiry.hp) {
    return NextResponse.json({ ok: true });
  }

  const emailLimit = await limitAction(
    "contact-email",
    inquiry.workEmail.toLowerCase(),
    3,
    3600,
  );
  if (!emailLimit.success) {
    return NextResponse.json(
      { error: "This email already sent a few messages. Try again later." },
      { status: 429 },
    );
  }

  let website: string;
  try {
    website = normalizeDomain(inquiry.website);
  } catch (error) {
    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const body = [
    `Company: ${inquiry.companyName}`,
    `Size: ${labelForCompanySize(inquiry.companySize)}`,
    `Name: ${inquiry.firstName} ${inquiry.lastName}`,
    `Email: ${inquiry.workEmail}`,
    `Phone: ${inquiry.phone || "-"}`,
    `Website: ${website}`,
    `Interest: ${labelForInterest(inquiry.interest)}`,
    "",
    inquiry.needs || "(no extra notes)",
  ].join("\n");

  const sent = await sendContactEmail({
    to: SUPPORT_EMAIL,
    replyTo: inquiry.workEmail,
    subject: `${labelForInterest(inquiry.interest)}: ${inquiry.companyName}`,
    body,
  });

  if (!sent.ok) {
    log.error("contact_email_failed", { error: sent.error ?? "unknown" });
    return NextResponse.json(
      { error: "We could not send that just now. Email us directly and we will reply." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
