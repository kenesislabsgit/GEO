import { MarketingShell } from "@/components/site/marketing-shell";

export const metadata = { title: "Refund policy" };

export default function RefundPage() {
  return (
    <MarketingShell narrow>
      <h1 className="font-heading text-4xl font-semibold tracking-tight">
        Refund policy
      </h1>
      <div className="mt-8 space-y-6 text-muted-foreground leading-relaxed">
        <p>
          RankedByAI subscriptions renew automatically each billing period.
          You may cancel at any time from Billing; access continues until the
          end of the paid period.
        </p>
        <p>
          If you believe you were charged in error, contact support within 14
          days of the charge. We review refund requests case by case for
          duplicate charges, failed service delivery, or billing mistakes.
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
