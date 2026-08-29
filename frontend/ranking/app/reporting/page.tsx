import Link from "next/link";
import { MarketingShell } from "@/components/site/marketing-shell";
import { ProductCrossNav } from "@/components/site/product-cross-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export const metadata = {
  title: "Reporting & alerts",
  description:
    "How Arcanoris schedules re-scans, emails visibility alerts, shares reports, and exports CSV or PDF on Pro.",
  alternates: { canonical: routes.reporting },
};

const frequencies = [
  {
    plan: "Free",
    cadence: "Manual only",
    detail:
      "One audit per website every 30 days. There is no scheduled re-scan and no email alert. The report stays on the site until the next run.",
  },
  {
    plan: "Plus",
    cadence: "Weekly",
    detail:
      "Turn monitoring on for the website, pick a weekday, local hour, and timezone. The worker enqueues one audit for that period. If a weekly plan is somehow set to daily, it still runs weekly.",
  },
  {
    plan: "Pro",
    cadence: "Daily or weekly",
    detail:
      "Same controls as Plus, plus a daily option. Each website has its own schedule, providers, market, and question set. A month of scheduled runs is sized so it fits inside the monthly provider-check allowance.",
  },
];

const alerts = [
  {
    name: "Score shift",
    defaultOn: "On",
    body: "Email when the visibility score moves at least 5 points in the same direction across two comparable audits. One noisy sample does not page you.",
  },
  {
    name: "Competitor appeared or dropped",
    defaultOn: "On",
    body: "Email when a brand name shows up in — or disappears from — two consecutive comparable runs.",
  },
  {
    name: "New or lost citation domains",
    defaultOn: "Off",
    body: "Optional. Email when a domain starts or stops appearing in answer citations across two comparable runs.",
  },
  {
    name: "Failed scheduled audit",
    defaultOn: "Always",
    body: "If a scheduled run fails or times out, you get an email. The scan can be retried from the dashboard.",
  },
];

const csvExports = [
  {
    type: "questions",
    columns: "prompt, type, buyer_stage, country, language, active, custom",
  },
  {
    type: "citations",
    columns: "url, title, domain, provider, supports_brand",
  },
  {
    type: "competitors",
    columns: "name, domain",
  },
  {
    type: "scores",
    columns:
      "date, overall_score, mention_rate, average_position, share_of_voice, citation_score",
  },
  {
    type: "actions",
    columns: "title, status, priority, action_type, explanation",
  },
];

export default function ReportingPage() {
  return (
    <MarketingShell narrow>
      <section className="border-b border-border pb-14 md:pb-20">
        <Badge variant="secondary" className="rounded-full font-mono text-[11px]">
          Product
        </Badge>
        <h1 className="font-heading mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
          Reporting &amp; alerts
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Scheduled re-scans, email alerts, shareable reports, and Pro
          exports. This page is the workflow — not a feature list on the
          homepage.
        </p>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Scheduled scan frequencies
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Monitoring lives on each website&apos;s settings page. Changes
          apply from the next due run, not mid-run. One website can have
          only one audit in flight at a time — a scheduled tick joins that
          run instead of stacking a second one.
        </p>
        <div className="arc-list mt-6 divide-y divide-border">
          {frequencies.map((row) => (
            <div key={row.plan} className="bg-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{row.plan}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {row.cadence}
                </p>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {row.detail}
              </p>
            </div>
          ))}
        </div>
        <ol className="mt-8 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>Open the website in the dashboard, then Settings.</li>
          <li>Turn monitoring on. Pick weekly or daily (daily needs Pro).</li>
          <li>Set weekday (weekly), hour, and timezone.</li>
          <li>
            Choose which providers and which saved question set the scheduled
            run asks. Empty providers means the plan default.
          </li>
          <li>Save. The next due period enqueues one audit.</li>
        </ol>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          What a scheduled report contains
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          A scheduled audit is the same engine as a manual one: same
          methodology version, same scoring, same stored answers. The
          dashboard history lists each run with its timestamp. A comparable
          alert only fires when two later runs asked the same questions to
          the same providers in the same market.
        </p>
        <ul className="mt-6 space-y-2 text-sm leading-relaxed text-muted-foreground">
          {[
            "Overall score, mention rate, and average position",
            "Per-provider answers with the exact model recorded",
            "Cited sources, when the provider returned them",
            "Competitor names that appeared in those answers",
            "The Action centre list written from that run",
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
          Report formats
        </h2>
        <div className="mt-6 space-y-6">
          <div>
            <p className="font-medium">Shareable link (Plus and Pro)</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Paid plans can flip a report between public (anyone with the
              link) and private (only the owner). Free audits stay public by
              design.
            </p>
          </div>
          <div>
            <p className="font-medium">PDF (Pro)</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Open the report and use Save as PDF. That prints the live
              report page with navigation and signup buttons hidden.
            </p>
          </div>
          <div>
            <p className="font-medium">CSV (Pro)</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Download one file per type from the website export. Columns
              below are what the file actually contains today.
            </p>
            <div className="mt-4 divide-y divide-border overflow-x-auto rounded-lg border border-border">
              {csvExports.map((row) => (
                <div
                  key={row.type}
                  className="grid gap-1 px-4 py-3 sm:grid-cols-[7rem_1fr]"
                >
                  <p className="font-mono text-xs text-muted-foreground">
                    {row.type}.csv
                  </p>
                  <p className="font-mono text-xs leading-relaxed text-foreground">
                    {row.columns}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Email alerts
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Alerts are per website, next to the schedule. The mail goes to
          the account email.
        </p>
        <div className="arc-list mt-6 divide-y divide-border">
          {alerts.map((row) => (
            <div key={row.name} className="bg-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{row.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {row.defaultOn}
                </p>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {row.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Export workflow on Pro
        </h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>Finish at least one audit on the website.</li>
          <li>
            Open the report. Use Save as PDF if you need a single document
            for a meeting.
          </li>
          <li>
            For spreadsheets, request the CSV type you need: questions,
            citations, competitors, scores, or actions.
          </li>
          <li>
            Plus can share the live link instead. CSV and PDF return an
            upgrade error on Plus.
          </li>
        </ol>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="sm">
            <Link href={routes.freeAuditSignup}>Run a free audit</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={routes.pricing}>See plan limits</Link>
          </Button>
        </div>
        <div className="mt-14">
          <ProductCrossNav current={routes.reporting} />
        </div>
      </section>
    </MarketingShell>
  );
}
