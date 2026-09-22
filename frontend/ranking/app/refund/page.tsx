import { publicPageMetadata } from "@/lib/public-metadata";
import { MarketingShell } from "@/components/site/marketing-shell";
import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/constants";
import { PolicyMeta } from "@/components/site/policy-meta";

export const metadata = publicPageMetadata(
  "Refund policy",
  "How cancellations, refunds, and downgrades work on Arcanoris subscriptions - what's refundable, what isn't, and how to request one.",
  "/refund",
);

export default function RefundPage() {
  return (
    <MarketingShell narrow>
      <h1 className="font-heading text-4xl font-semibold tracking-tight">
        Refund policy
      </h1>
      <PolicyMeta />
      <div className="mt-8 space-y-6 text-muted-foreground leading-relaxed">
        <p>
          Arcanoris subscriptions renew automatically each billing period. You
          may cancel at any time from Billing; access continues until the end of
          the paid period.
        </p>
        <p>
          If you believe you were charged in error, contact support within 14
          days of the charge using{" "}
          <Link
            href="/contact?intent=support"
            className="underline underline-offset-4"
          >
            account and billing support
          </Link>{" "}
          or email{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=Refund%20request`}
            className="underline underline-offset-4"
          >
            {SUPPORT_EMAIL}
          </a>
          . We review refund requests case by case for duplicate charges, failed
          service delivery, or billing mistakes.
        </p>
        <h2 className="font-heading text-xl font-semibold text-foreground">
          What to include
        </h2>
        <p>
          Send the email used at checkout, your payment or invoice ID, the
          charge date, amount and currency, and a short explanation of the
          issue. If you cannot find the ID, include the other details so we can
          locate the payment. Do not send your password or full card number.
        </p>
        <h2 className="font-heading text-xl font-semibold text-foreground">
          What happens next
        </h2>
        <p>
          The Arcanoris support team replies by email, usually within one
          business day, to acknowledge the request or ask for missing details.
          Acknowledgement is not approval. We will tell you the decision and, if
          approved, the refund amount and processing status.
        </p>
        <p>
          Approved refunds are issued through Dodo Payments to the original
          payment method. Dodo may hold a refund for review, and the time until
          funds appear depends on the payment provider and bank. See{" "}
          <a
            href="https://docs.dodopayments.com/features/transactions/refunds"
            className="underline underline-offset-4"
          >
            Dodo&apos;s refund process
          </a>
          . Contact us with your refund ID if the confirmed processing estimate
          has passed.
        </p>
        <p>
          Usage-based AI checks consumed during a billing period are not
          refundable. Downgrading takes effect at the next renewal and does not
          retroactively refund unused time on a higher tier.
        </p>
      </div>
    </MarketingShell>
  );
}
