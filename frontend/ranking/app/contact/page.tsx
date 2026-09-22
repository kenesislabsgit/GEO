import { MarketingShell } from "@/components/site/marketing-shell";
import { ContactForm } from "@/components/site/contact-form";
import { getSessionUser } from "@/lib/auth/session";
import { isContactIntent } from "@/lib/contact/schema";
import { SUPPORT_EMAIL } from "@/lib/constants";
import { publicPageMetadata } from "@/lib/public-metadata";

export const metadata = publicPageMetadata(
  "Contact support and sales",
  "Contact Arcanoris for account or billing support, plan questions, or a Pro inquiry. Our team replies by email, usually within one business day.",
  "/contact",
);

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const [user, params] = await Promise.all([getSessionUser(), searchParams]);
  const defaultInterest = isContactIntent(params.intent)
    ? params.intent
    : "pro";
  return (
    <MarketingShell>
      <div className="grid items-start gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <p className="arc-eyebrow">Support and sales</p>
          <h1 className="font-heading mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            Talk to the Arcanoris team
          </h1>
          <p className="mt-4 max-w-md text-lg text-muted-foreground">
            Choose the reason for your message. We reply by email, usually
            within one business day.
          </p>
          <dl className="mt-8 space-y-6 text-sm leading-relaxed">
            <div>
              <dt className="font-semibold">Account or billing support</dt>
              <dd className="mt-2 text-muted-foreground">
                Your account email and a description of the issue are enough to
                start. No company size, phone number, or website required.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Plans and Pro inquiries</dt>
              <dd className="mt-2 text-muted-foreground">
                Tell us about your websites and requirements so we can suggest a
                package and explain the next step.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Corrections and other questions</dt>
              <dd className="mt-2 text-muted-foreground">
                Include the relevant page URL and the details we should review.
              </dd>
            </div>
          </dl>
          <p className="mt-8 text-sm text-muted-foreground">
            Prefer email?{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="underline underline-offset-4"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
        <ContactForm
          defaultEmail={user?.email ?? ""}
          defaultInterest={defaultInterest}
        />
      </div>
    </MarketingShell>
  );
}
