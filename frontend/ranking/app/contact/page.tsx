import Link from "next/link";
import { MarketingShell } from "@/components/site/marketing-shell";
import { SUPPORT_EMAIL } from "@/lib/constants";
import { routes } from "@/lib/routes";

export const metadata = {
  title: "Contact & support",
  description:
    "Reach Arcanoris support for questions about scans, billing, brand claims, or methodology - typical response within one business day.",
  alternates: { canonical: routes.contact },
};

export default function ContactPage() {
  return (
    <MarketingShell narrow>
      <h1 className="font-heading text-4xl font-semibold tracking-tight">
        Contact & support
      </h1>
      <div className="mt-8 space-y-6 text-muted-foreground leading-relaxed">
        <p>
          Questions about scans, billing, brand claims, or methodology? Email{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
          . We typically respond within one business day.
        </p>
        <p>
          For account security issues, include the email on your account and
          the brand domain affected. Do not send passwords or payment card
          numbers by email.
        </p>
        <p>
          See also our{" "}
          <Link href={routes.methodology} className="text-foreground hover:underline">
            methodology
          </Link>
          ,{" "}
          <Link href={routes.dataHandling} className="text-foreground hover:underline">
            data handling
          </Link>
          , and{" "}
          <Link href={routes.refund} className="text-foreground hover:underline">
            refund policy
          </Link>
          .
        </p>
      </div>
    </MarketingShell>
  );
}
