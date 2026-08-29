import Link from "next/link";
import { MarketingShell } from "@/components/site/marketing-shell";
import { ProductCrossNav } from "@/components/site/product-cross-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import {
  AUDIT_PROVIDER_CONCURRENCY,
  PRO_AUDIT_QUESTION_COUNT,
} from "@/lib/constants";
import { routes } from "@/lib/routes";

/** Default from the audit queue. Shown here so this page does not import
 * the worker module. */
const SCAN_HEARTBEAT_TIMEOUT_SECONDS = 180;

export const metadata = {
  title: "Scale & reliability",
  description:
    "How Arcanoris queues high-volume AI visibility checks, retries provider failures, and enforces monthly plan limits.",
  alternates: { canonical: routes.scale },
};

const capacities = [
  {
    plan: "Plus",
    sites: PLAN_CONFIG.founder.features.brands,
    checks: PLAN_CONFIG.founder.features.providerChecksPerMonth,
    cadence: "Weekly monitoring",
  },
  {
    plan: "Pro",
    sites: PLAN_CONFIG.agency.features.brands,
    checks: PLAN_CONFIG.agency.features.providerChecksPerMonth,
    cadence: "Daily or weekly monitoring",
  },
];

export default function ScalePage() {
  const proPerRun =
    PRO_AUDIT_QUESTION_COUNT * PLAN_CONFIG.agency.features.providersPerScan;

  return (
    <MarketingShell narrow>
      <section className="border-b border-border pb-14 md:pb-20">
        <Badge variant="secondary" className="rounded-full font-mono text-[11px]">
          Product
        </Badge>
        <h1 className="font-heading mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
          Scale &amp; reliability
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          How checks are queued, retried, and stopped when the monthly
          allowance is gone.
        </p>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Capacity by plan
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          A provider check is one question asked to one AI. Monthly counts
          reset on the 1st. When the allowance is used up, new audits are
          refused. Existing reports stay readable and exportable.
        </p>
        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 font-medium">
              <tr>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Websites</th>
                <th className="px-4 py-3">Checks / month</th>
                <th className="px-4 py-3">Schedule</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {capacities.map((row) => (
                <tr key={row.plan}>
                  <td className="px-4 py-3">{row.plan}</td>
                  <td className="px-4 py-3 font-mono">{row.sites}</td>
                  <td className="px-4 py-3 font-mono">
                    {row.checks.toLocaleString("en-US")}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.cadence}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          A full Pro audit is {PRO_AUDIT_QUESTION_COUNT} questions ×{" "}
          {PLAN_CONFIG.agency.features.providersPerScan} selected providers ={" "}
          {proPerRun} checks. Twenty websites at that depth every day would
          exceed the {PLAN_CONFIG.agency.features.providerChecksPerMonth.toLocaleString("en-US")}{" "}
          monthly cap. Scheduled monitoring rotates questions so a month of
          runs fits the allowance. The dashboard shows which questions the
          latest run actually asked.
        </p>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          How a high-volume run is scheduled
        </h2>
        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
          {[
            "Audits sit in a database queue. Any worker can claim the next queued row.",
            "One website, one active audit. A second click or a scheduled tick joins the run that is already queued or running.",
            `Provider calls inside a run fan out with a concurrency of ${AUDIT_PROVIDER_CONCURRENCY}.`,
            `A running worker must heartbeat. Silence longer than ${SCAN_HEARTBEAT_TIMEOUT_SECONDS} seconds is treated as a dead job.`,
            "A queued job nobody claims for 15 minutes is cancelled so it cannot block the next start.",
            "Maintenance mode refuses new manual and scheduled audits until it is switched off.",
          ].map((item) => (
            <li key={item} className="flex gap-3">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Retries and rate limits
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          A single provider call is tried up to three times. Only temporary
          failures retry: HTTP 408, 409, 425, 429, 500, 502, 503, 504, and
          common timeout or throttle text. Permanent errors fail that
          provider and the scan can finish as partial instead of inventing
          an answer.
        </p>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Backoff is 1.5 × 2^attempt seconds, or the provider&apos;s
          Retry-After header when it sends one, capped at 60 seconds, plus a
          short jitter. Failed, timed-out, cancelled, or partial audits can
          be retried from the dashboard. A retry replays the stored input —
          it does not silently pick up settings you changed later.
        </p>
      </section>

      <section className="py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Enterprise onboarding
        </h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>
            Contact us for Pro. Confirm website count, markets, languages,
            and monthly check volume.
          </li>
          <li>
            We turn the plan on. You add websites in the dashboard — still
            the browser app, no agent.
          </li>
          <li>
            Pick providers per audit (up to{" "}
            {PLAN_CONFIG.agency.features.providersPerScan} of{" "}
            {PLAN_CONFIG.agency.features.providers.length}).
          </li>
          <li>
            Set daily or weekly monitoring, timezone, and alert toggles per
            website.
          </li>
          <li>
            Run the first manual audit, then let the scheduler take the next
            period. Watch the monthly check counter so volume stays inside
            the cap.
          </li>
        </ol>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="sm">
            <Link href={`${routes.contact}?intent=pro`}>Talk to us about Pro</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={routes.pricing}>Pricing</Link>
          </Button>
        </div>
        <div className="mt-14">
          <ProductCrossNav current={routes.scale} />
        </div>
      </section>
    </MarketingShell>
  );
}
