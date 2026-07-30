import Link from "next/link";
import { Check } from "lucide-react";
import { MarketingShell } from "@/components/site/marketing-shell";
import { Button } from "@/components/ui/button";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { providerDisplayName } from "@/lib/constants";
import { getSessionUser } from "@/lib/auth/session";
import { routes } from "@/lib/routes";

export const metadata = {
  title: "Pricing",
  description:
    "Free, Founder, Growth, and Agency plans for AI visibility monitoring.",
};

function formatChecks(count: number): string {
  return count >= 1000
    ? `${(count / 1000).toFixed(count % 1000 ? 1 : 0)}k`
    : String(count);
}

export default async function PricingPage() {
  const user = await getSessionUser();
  return (
    <MarketingShell className="py-10 md:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Pricing
        </p>
        <h1 className="font-heading mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
          Start free. Scale when it matters.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          The free audit is the trial. Upgrade for multi-provider monitoring,
          history, and the action centre.
        </p>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {(["free", "founder", "growth"] as const).map((planId) => {
          const plan = PLAN_CONFIG[planId];
          const popular = plan.id === "founder";
          const featureList = [
            plan.id === "free"
              ? "1 public website"
              : `${plan.features.brands} website${plan.features.brands > 1 ? "s" : ""} managed`,
            `${plan.features.activePrompts} tracked prompts`,
            plan.features.providers.map(providerDisplayName).join(" + "),
            `${formatChecks(plan.features.providerChecksPerMonth)} provider checks / month`,
            plan.features.dailyMonitoring
              ? "Daily monitoring"
              : plan.features.weeklyMonitoring
                ? "Weekly monitoring"
                : "Five questions, one public audit / 30 days",
            ...(plan.features.actionCentre ? ["Action centre"] : []),
            ...(plan.features.emailAlerts
              ? ["Score & competitor alerts"]
              : []),
            ...(plan.features.pdfCsvExport ? ["PDF & CSV export"] : []),
            ...(plan.features.whiteLabel ? ["White-label reports"] : []),
            ...(plan.features.webhooks ? ["Webhooks"] : []),
            ...(plan.trialDays > 0
              ? [`${plan.trialDays}-day trial with usage caps`]
              : []),
          ];

          return (
            <div
              key={plan.id}
              className={`rb-card-hover relative flex flex-col rounded-2xl border bg-white p-6 ${
                popular
                  ? "border-[color:var(--rb-ink)] shadow-[0_16px_40px_rgba(12,15,20,0.1)]"
                  : "border-border"
              }`}
            >
              {popular ? (
                <span className="absolute -top-2.5 left-5 rounded-full bg-[color:var(--rb-ink)] px-2.5 py-0.5 text-[11px] font-medium text-white">
                  Most popular
                </span>
              ) : null}
              <h2 className="text-sm font-medium">{plan.name}</h2>
              <p className="mt-3 font-heading text-4xl font-semibold tracking-tight">
                ${plan.monthlyPriceUsd}
                {plan.monthlyPriceUsd > 0 ? (
                  <span className="text-sm font-normal text-muted-foreground">
                    /mo
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {plan.yearlyPriceUsd > 0
                  ? `or $${plan.yearlyPriceUsd}/year`
                  : "Forever free"}
              </p>
              <p className="mt-4 text-sm text-muted-foreground">
                {plan.description}
              </p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {featureList.map((feature) => (
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
                <Link
                  href={
                    plan.id === "free"
                      ? user
                        ? routes.newScan()
                        : routes.publicScanAnchor
                      : user
                        ? routes.billing({ plan: plan.id })
                        : routes.login({
                            returnTo: routes.billing({ plan: plan.id }),
                          })
                  }
                >
                  {plan.id === "free" ? "Run free audit" : "Get started"}
                </Link>
              </Button>
            </div>
          );
        })}
      </div>

      <div className="rb-panel-soft mt-16 grid gap-8 p-8 md:grid-cols-3">
        <div>
          <h3 className="font-medium tracking-tight">Cancel anytime</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage or cancel from the billing portal. Your data stays
            exportable on every plan.
          </p>
        </div>
        <div>
          <h3 className="font-medium tracking-tight">Usage-capped trials</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Trials enforce the same provider-check limits as paid plans.
          </p>
        </div>
        <div>
          <h3 className="font-medium tracking-tight">Transparent scoring</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Every score decomposes into mention, position, citation, and
            sentiment — see the{" "}
            <Link
              href={routes.methodology}
              className="text-foreground underline underline-offset-4"
            >
              methodology
            </Link>
            .
          </p>
        </div>
      </div>
    </MarketingShell>
  );
}
