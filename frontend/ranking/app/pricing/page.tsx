import { Fragment } from "react";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { MarketingShell } from "@/components/site/marketing-shell";
import { Button } from "@/components/ui/button";
import { PLAN_CONFIG, type PlanId } from "@/lib/billing/entitlements";
import { getSessionUser } from "@/lib/auth/session";
import { routes } from "@/lib/routes";

export const metadata = {
  title: "Pricing",
  description:
    "Free, Pro, Pro+ and Agency plans for AI visibility monitoring.",
};

function formatChecks(count: number): string {
  return count >= 1000
    ? `${(count / 1000).toFixed(count % 1000 ? 1 : 0)}k`
    : String(count);
}

const CONTACT_HREF =
  "mailto:kenesislabs@gmail.com?subject=RankedByAI%20Agency%20plan";

/**
 * The short sell per card. Every line here corresponds to something the app
 * actually does — the full grid below is the exhaustive version.
 */
const CARD_FEATURES: Record<PlanId, string[]> = {
  free: [
    "1 website, 1 free audit every 30 days",
    "5 real buyer questions",
    "OpenAI with live web search",
    "Visibility score with full breakdown",
    "Your top competitor, with evidence",
    "One prioritized website fix",
  ],
  founder: [
    "20 buyer questions per audit",
    "4 AI providers compared side by side",
    "Full answers, sources & verified mentions",
    "Citation gaps — where rivals are cited, you aren't",
    "Complete action plan + copy-paste AI prompt",
    "Weekly monitoring, score alerts, history",
    "Private or public report link",
  ],
  growth: [
    "Everything in Pro",
    "5 websites, 100 questions each",
    "Daily monitoring",
    "CSV exports + PDF reports",
    "Content briefs on recommendations",
    "Impact tracking on completed fixes",
  ],
  agency: [
    "Everything in Pro+",
    "20 websites, 500 questions",
    "10k provider checks a month",
    "Priority support",
    "White-label & team seats — talk to us",
  ],
};

type Cell = string | boolean;

/** The exhaustive comparison. One row per real capability. */
const COMPARISON: Array<{
  section: string;
  rows: Array<{ label: string; cells: [Cell, Cell, Cell, Cell] }>;
}> = [
  {
    section: "Audit",
    rows: [
      { label: "Websites", cells: ["1", "1", "5", "20"] },
      { label: "Buyer questions per audit", cells: ["5", "20", "100", "500"] },
      {
        label: "AI providers compared",
        cells: ["1", "4", "5", "5"],
      },
      {
        label: "Provider checks per month",
        cells: [
          formatChecks(PLAN_CONFIG.free.features.providerChecksPerMonth),
          formatChecks(PLAN_CONFIG.founder.features.providerChecksPerMonth),
          formatChecks(PLAN_CONFIG.growth.features.providerChecksPerMonth),
          formatChecks(PLAN_CONFIG.agency.features.providerChecksPerMonth),
        ],
      },
      {
        label: "Competitors tracked per website",
        cells: ["1", "5", "10", "20"],
      },
    ],
  },
  {
    section: "Evidence",
    rows: [
      { label: "Visibility score & breakdown", cells: [true, true, true, true] },
      { label: "Full AI answers", cells: [false, true, true, true] },
      {
        label: "Sources & verified web mentions",
        cells: [false, true, true, true],
      },
      { label: "Citation gaps", cells: [false, true, true, true] },
      { label: "Score history", cells: [false, true, true, true] },
    ],
  },
  {
    section: "Action",
    rows: [
      {
        label: "Website improvement plan",
        cells: ["First fix only", "Full plan", "Full plan", "Full plan"],
      },
      {
        label: "Copy-paste prompt for your AI coding tool",
        cells: [true, true, true, true],
      },
      { label: "Content briefs", cells: [false, false, true, true] },
      {
        label: "Impact tracking on completed fixes",
        cells: [false, false, true, true],
      },
    ],
  },
  {
    section: "Monitoring",
    rows: [
      {
        label: "Scheduled re-scans",
        cells: [false, "Weekly", "Daily", "Daily"],
      },
      { label: "Score alerts by email", cells: [false, true, true, true] },
    ],
  },
  {
    section: "Sharing",
    rows: [
      { label: "Shareable report link", cells: [true, true, true, true] },
      { label: "Private reports", cells: [false, true, true, true] },
      { label: "CSV export", cells: [false, false, true, true] },
      { label: "PDF report", cells: [false, false, true, true] },
    ],
  },
];

const FAQS = [
  {
    q: "What counts as a provider check?",
    a: "One question asked to one AI provider. A 20-question Pro audit across 4 providers uses 80 checks. Monthly limits reset on the 1st.",
  },
  {
    q: "What does the free audit include?",
    a: "A real audit, not a teaser: your visibility score, five buyer questions with mention status, your top competitor with evidence, and your first prioritized fix. One per website every 30 days.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Manage or cancel from the billing portal in one click. Your data stays exportable while your account exists.",
  },
  {
    q: "How does the 7-day Pro trial work?",
    a: "Full Pro features with the same usage limits as the paid plan. No charge until the trial ends; cancel before then and you pay nothing.",
  },
  {
    q: "Do you guarantee better AI rankings?",
    a: "No — and you should distrust anyone who does. We measure honestly and recommend changes backed by evidence from real AI answers and competitor pages.",
  },
];

function CellValue({ value }: { value: Cell }) {
  if (value === true) {
    return <Check className="mx-auto size-4 text-[color:var(--rb-green)]" aria-label="Included" />;
  }
  if (value === false) {
    return <Minus className="mx-auto size-4 text-border" aria-label="Not included" />;
  }
  return <span className="text-sm">{value}</span>;
}

export default async function PricingPage() {
  const user = await getSessionUser();
  const planIds: PlanId[] = ["free", "founder", "growth", "agency"];

  const ctaFor = (planId: PlanId) => {
    if (planId === "free") {
      return user ? routes.newScan() : routes.publicScanAnchor;
    }
    return user
      ? routes.billing({ plan: planId })
      : routes.login({ returnTo: routes.billing({ plan: planId }) });
  };

  return (
    <MarketingShell className="py-10 md:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="rb-eyebrow">Pricing</p>
        <h1 className="font-heading mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
          Start free. Scale when it matters.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          The free audit is the trial. Paid plans add more providers, ongoing
          monitoring, and the full evidence behind every answer.
        </p>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {planIds.map((planId) => {
          const plan = PLAN_CONFIG[planId];
          const popular = planId === "founder";
          return (
            <div
              key={planId}
              className={`relative flex flex-col rounded-xl border bg-card p-6 ${
                popular ? "border-foreground" : "border-border"
              }`}
            >
              {popular ? (
                <span className="absolute -top-2.5 left-5 rounded-full bg-foreground px-2.5 py-0.5 text-[11px] font-medium text-background">
                  Most popular
                </span>
              ) : null}
              <h2 className="text-sm font-medium">{plan.name}</h2>
              <p className="font-heading mt-3 text-4xl font-semibold tracking-tight">
                ${plan.monthlyPriceUsd}
                {plan.monthlyPriceUsd > 0 ? (
                  <span className="text-sm font-normal text-muted-foreground">
                    /mo
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {plan.yearlyPriceUsd > 0
                  ? `$${plan.yearlyPriceUsd}/year — 2 months free`
                  : "No card required"}
                {plan.trialDays > 0 ? ` · ${plan.trialDays}-day trial` : ""}
              </p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {CARD_FEATURES[planId].map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-[color:var(--rb-green)]" />
                    <span className="text-foreground/80">{feature}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                variant={popular ? "default" : "outline"}
                className="mt-6"
              >
                {planId === "agency" ? (
                  <a href={CONTACT_HREF}>Contact us</a>
                ) : (
                  <Link href={ctaFor(planId)}>
                    {planId === "free" ? "Run free audit" : "Get started"}
                  </Link>
                )}
              </Button>
            </div>
          );
        })}
      </div>

      {/* Full comparison */}
      <div className="mt-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            Everything, compared
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Every capability in the product, and the plan it comes with.
          </p>
        </div>
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="w-[36%] py-3 pr-4 text-sm font-medium text-muted-foreground">
                  Feature
                </th>
                {planIds.map((planId) => (
                  <th
                    key={planId}
                    className="px-3 py-3 text-center text-sm font-semibold"
                  >
                    {PLAN_CONFIG[planId].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((group) => (
                <Fragment key={group.section}>
                  <tr className="border-b border-border bg-muted/40">
                    <td
                      colSpan={5}
                      className="rb-eyebrow py-2.5 pr-4 pl-1"
                    >
                      {group.section}
                    </td>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.label} className="border-b border-border/70">
                      <td className="py-3 pr-4 pl-1 text-sm">{row.label}</td>
                      {row.cells.map((cell, index) => (
                        <td
                          key={`${row.label}-${planIds[index]}`}
                          className="px-3 py-3 text-center text-muted-foreground"
                        >
                          <CellValue value={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* FAQ */}
      <div className="mx-auto mt-20 max-w-3xl">
        <h2 className="font-heading text-center text-2xl font-semibold tracking-tight md:text-3xl">
          Questions, answered
        </h2>
        <div className="mt-8 divide-y divide-border">
          {FAQS.map((faq) => (
            <div key={faq.q} className="py-5">
              <h3 className="text-sm font-medium">{faq.q}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {faq.a}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-10 text-center text-sm text-muted-foreground">
          Every score decomposes into mention, position, and sentiment — read
          the{" "}
          <Link
            href={routes.methodology}
            className="text-foreground underline underline-offset-4"
          >
            methodology
          </Link>
          .
        </p>
      </div>
    </MarketingShell>
  );
}
