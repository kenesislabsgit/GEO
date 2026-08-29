import { Fragment } from "react";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { MarketingShell } from "@/components/site/marketing-shell";
import { ProviderStack } from "@/components/providers/provider-logo";
import { JsonLd } from "@/components/site/json-ld";
import { PricingPlans } from "@/components/site/pricing-plans";
import { HorizontalScrollHint } from "@/components/site/scroll-hint";
import { PLAN_CONFIG, PLUS_CHECKS_INCLUDED, PLUS_EARLY_BIRD_BONUS_CHECKS, type PlanId } from "@/lib/billing/entitlements";
import { formatChecks, isSalesLockedPlan, SOLD_PLAN_IDS } from "@/lib/billing/pricing";
import { getSessionUser } from "@/lib/auth/session";
import { ALL_PROVIDERS, APP_NAME } from "@/lib/constants";
import { routes } from "@/lib/routes";
import { SITE_URL } from "@/lib/site";

const PLAN_IDS: PlanId[] = SOLD_PLAN_IDS;

export const metadata = {
  title: "Pricing",
  description: "Plus and Pro plans for AI visibility monitoring.",
  alternates: { canonical: "/pricing" },
};

type Cell =
  | string
  | boolean
  | { label: string; providers: readonly string[] };

/** The exhaustive comparison. One row per real capability, one column per
 * PLAN_IDS entry (founder/Plus, agency/Pro - in that order). */
const COMPARISON: Array<{
  section: string;
  rows: Array<{ label: string; cells: [Cell, Cell] }>;
}> = [
  {
    section: "Audit",
    rows: [
      {
        label: "Websites",
        cells: [
          String(PLAN_CONFIG.founder.features.brands),
          String(PLAN_CONFIG.agency.features.brands),
        ],
      },
      {
        label: "Tracked buyer questions per website",
        cells: [
          String(PLAN_CONFIG.founder.features.activePrompts),
          String(PLAN_CONFIG.agency.features.activePrompts),
        ],
      },
      {
        label: "Questions asked per audit run",
        cells: ["20", "20"],
      },
      {
        label: "AI providers compared",
        cells: [
          {
            label: String(PLAN_CONFIG.founder.features.providers.length),
            providers: PLAN_CONFIG.founder.features.providers,
          },
          {
            label: `any ${PLAN_CONFIG.agency.features.providersPerScan} of ${PLAN_CONFIG.agency.features.providers.length}`,
            providers: PLAN_CONFIG.agency.features.providers,
          },
        ],
      },
      {
        label: "Provider checks per month",
        cells: [
          `${PLUS_CHECKS_INCLUDED} + ${PLUS_EARLY_BIRD_BONUS_CHECKS}`,
          formatChecks(PLAN_CONFIG.agency.features.providerChecksPerMonth),
        ],
      },
      {
        label: "Competitors tracked per website",
        cells: [
          String(PLAN_CONFIG.founder.features.competitorsPerBrand),
          String(PLAN_CONFIG.agency.features.competitorsPerBrand),
        ],
      },
    ],
  },
  {
    section: "Evidence",
    rows: [
      { label: "Visibility score & breakdown", cells: [true, true] },
      { label: "Full AI answers", cells: [true, true] },
      {
        label: "Sources & verified web mentions",
        cells: [true, true],
      },
      { label: "Citation gaps", cells: [true, true] },
      { label: "Score history", cells: [true, true] },
    ],
  },
  {
    section: "Action",
    rows: [
      {
        label: "Website improvement plan",
        cells: ["Full plan", "Full plan"],
      },
      {
        label: "Copy-paste prompt for your AI coding tool",
        cells: [true, true],
      },
      {
        label: "Impact tracking on completed fixes",
        cells: [false, true],
      },
    ],
  },
  {
    section: "Monitoring",
    rows: [
      {
        label: "Scheduled re-scans",
        cells: ["Weekly", "Daily"],
      },
      { label: "Score alerts by email", cells: [true, true] },
    ],
  },
  {
    section: "Sharing",
    rows: [
      { label: "Shareable report link", cells: [true, true] },
      { label: "Private reports", cells: [true, true] },
      { label: "CSV export", cells: [false, true] },
      { label: "PDF report", cells: [false, true] },
    ],
  },
];

const FAQS = [
  {
    q: "What counts as a provider check?",
    a: `One question asked to one AI provider. A 20-question Plus audit across ${PLAN_CONFIG.founder.features.providers.length} providers uses ${20 * PLAN_CONFIG.founder.features.providers.length} checks. Monthly limits reset on the 1st.`,
  },
  {
    q: "How do 500 tracked questions fit into audits of 20?",
    a: "On Pro, you curate up to 500 tracked questions per website. Each audit run asks 20 of them; scheduled monitoring rotates deterministically through the rest, sized so a month of runs fits inside your provider-check allowance. Your dashboard shows which questions the latest run checked.",
  },
  {
    q: "How do the AI providers work on each plan?",
    a: `Plus checks ChatGPT (with live web search), Claude, Gemini, Perplexity, and Mistral on every audit. Pro unlocks all ${ALL_PROVIDERS.length} providers and runs any ${PLAN_CONFIG.agency.features.providersPerScan} per audit, swappable in the picker. Every selected provider answers the same buyer questions so results are directly comparable.`,
  },
  {
    q: "What about Growth?",
    a: `Growth adds more websites, daily scans, and the ${PLAN_CONFIG.growth.features.providersPerScan} most-used AIs. We're letting people in in waves — join the list on this page and we'll email you when a spot opens.`,
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
    q: "How does the 7-day Plus trial work?",
    a: "Full Plus features with the same usage limits as the paid plan. No charge until the trial ends; cancel before then and you pay nothing.",
  },
  {
    q: "Do you guarantee better AI rankings?",
    a: "No - and you should distrust anyone who does. We measure honestly and recommend changes backed by evidence from real AI answers and competitor pages.",
  },
];

function CellValue({ value }: { value: Cell }) {
  if (value === true) {
    return <Check className="mx-auto size-4 text-[color:var(--arc-green)]" aria-label="Included" />;
  }
  if (value === false) {
    return <Minus className="mx-auto size-4 text-border" aria-label="Not included" />;
  }
  if (typeof value === "object") {
    return (
      <span className="inline-flex flex-col items-center gap-1.5">
        <span className="text-sm">{value.label}</span>
        <ProviderStack providers={value.providers} max={8} />
      </span>
    );
  }
  return <span className="text-sm">{value}</span>;
}

export default async function PricingPage() {
  const user = await getSessionUser();
  const planIds = PLAN_IDS;

  return (
    <MarketingShell className="py-10 md:py-16">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: `${APP_NAME} AI visibility monitoring`,
          description:
            "AI visibility monitoring: measures whether AI answer engines like ChatGPT, Claude, and Gemini mention and recommend your brand.",
          brand: { "@type": "Organization", name: APP_NAME, url: SITE_URL },
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "USD",
            lowPrice: String(PLAN_CONFIG.founder.monthlyPriceUsd),
            highPrice: String(PLAN_CONFIG.founder.monthlyPriceUsd),
            offerCount: PLAN_IDS.length,
            offers: PLAN_IDS.map((planId) => {
              const plan = PLAN_CONFIG[planId];
              const custom = isSalesLockedPlan(planId);
              return {
                "@type": "Offer",
                name: `${plan.name} plan`,
                description: plan.description,
                url: `${SITE_URL}${routes.pricing}`,
                ...(custom
                  ? {}
                  : {
                      price: String(plan.monthlyPriceUsd),
                      priceCurrency: "USD",
                      priceSpecification: {
                        "@type": "UnitPriceSpecification",
                        price: String(plan.monthlyPriceUsd),
                        priceCurrency: "USD",
                        billingDuration: "P1M",
                      },
                    }),
              };
            }),
          },
        }}
      />
      <div className="mx-auto max-w-2xl text-center">
        <p className="arc-eyebrow">Pricing</p>
        <h1 className="font-heading mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
          Start free. Scale when it matters.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          The free audit is the trial. Paid plans add more providers, ongoing
          monitoring, and the full evidence behind every answer.
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          <Link href={routes.providers} className="underline underline-offset-4 hover:text-foreground">
            Provider coverage
          </Link>
          {" · "}
          <Link href={routes.scale} className="underline underline-offset-4 hover:text-foreground">
            Scale &amp; reliability
          </Link>
          {" · "}
          <Link href={routes.reporting} className="underline underline-offset-4 hover:text-foreground">
            Reporting
          </Link>
        </p>
      </div>

      <div className="mt-14">
        <PricingPlans variant="full" signedIn={Boolean(user)} />
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
        <div className="mt-8">
          <HorizontalScrollHint label="Swipe to compare plans">
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
                      colSpan={1 + planIds.length}
                      className="arc-eyebrow py-2.5 pr-4 pl-1"
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
          </HorizontalScrollHint>
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
          Every score decomposes into mention, position, and evidence
          quality - read the{" "}
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
