"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { FeatureCheck } from "@/components/site/feature-check";
import { Button } from "@/components/ui/button";
import { ProviderStack } from "@/components/providers/provider-logo";
import {
  PLAN_CONFIG,
  PLUS_CHECKS_SUMMARY,
  PROVIDER_CHECK_DEFINITION,
  plusModelNames,
  type PlanId,
} from "@/lib/billing/entitlements";
import {
  formatChecks,
  headlinePriceUsd,
  isSalesLockedPlan,
  PRO_CONTACT_HREF,
  publicSubscribeHref,
  SOLD_PLAN_IDS,
  yearlySavingsUsd,
  trialCommitment,
  type BillingInterval,
} from "@/lib/billing/pricing";
import { routes } from "@/lib/routes";
import { PricingIntervalToggle } from "@/components/site/pricing-interval-toggle";

type CardFeature = { text: string; providers?: readonly string[] };

const PLUS_MODELS = plusModelNames();

function checksFeature(planId: PlanId): CardFeature {
  if (planId === "founder") {
    return { text: PLUS_CHECKS_SUMMARY };
  }
  const count = PLAN_CONFIG[planId].features.providerChecksPerMonth;
  return {
    text: `${formatChecks(count)} provider checks a month — one buyer question asked to one AI`,
  };
}

const CARD_FEATURES: Partial<Record<PlanId, CardFeature[]>> = {
  founder: [
    checksFeature("founder"),
    {
      text: `${PLAN_CONFIG.founder.features.activePrompts} questions × ${PLAN_CONFIG.founder.features.providersPerScan} AIs × 1 answer = ${PLAN_CONFIG.founder.features.activePrompts * PLAN_CONFIG.founder.features.providersPerScan} checks per audit`,
    },
    {
      text: `${PLUS_MODELS}, compared on every audit`,
      providers: PLAN_CONFIG.founder.features.providers,
    },
    { text: "Full answers, sources & verified mentions" },
    { text: "Citation gaps - where rivals are cited, you aren't" },
    { text: "Action centre - your prioritized fix list + copy-paste AI prompt" },
    { text: "Weekly monitoring, score alerts, history" },
    { text: "Complete saved audit history" },
  ],
  agency: [
    { text: "Everything in Plus" },
    checksFeature("agency"),
    {
      text: `${PLAN_CONFIG.agency.features.providers.length} AI providers - run any ${PLAN_CONFIG.agency.features.providersPerScan} per audit`,
      providers: PLAN_CONFIG.agency.features.providers,
    },
    {
      text: `${PLAN_CONFIG.agency.features.brands} websites, ${PLAN_CONFIG.agency.features.activePrompts} tracked questions`,
    },
    { text: "Daily monitoring that rotates through your questions" },
    { text: "CSV exports" },
    { text: "Impact tracking on completed fixes" },
    { text: "Priority support - talk to us before you buy" },
  ],
};

function planCta(
  planId: PlanId,
  interval: BillingInterval,
  signedIn: boolean,
): { href: string; label: string; external?: boolean } {
  if (isSalesLockedPlan(planId)) {
    return { href: PRO_CONTACT_HREF, label: "Contact us" };
  }
  if (planId === "free") {
    const href = signedIn ? routes.newScan() : routes.freeAuditSignup;
    return { href, label: "Run free audit" };
  }
  return {
    href: publicSubscribeHref(planId, interval, signedIn),
    label: `Start ${PLAN_CONFIG[planId].trialDays}-day trial`,
  };
}

function PlanPrice({
  planId,
  interval,
  size,
}: {
  planId: PlanId;
  interval: BillingInterval;
  size: "full" | "teaser";
}) {
  const plan = PLAN_CONFIG[planId];
  const headline = headlinePriceUsd(plan, interval);
  const saved = yearlySavingsUsd(plan);
  const headingClass =
    size === "full"
      ? "font-heading mt-3 text-4xl font-semibold tracking-tight"
      : "arc-tabular mt-3 font-heading text-3xl font-semibold tracking-tight";

  if (isSalesLockedPlan(planId)) {
    return (
      <>
        <p className={headingClass}>From ${plan.monthlyPriceUsd}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
        <p className="mt-1 text-xs text-muted-foreground">Starting package below · ${plan.yearlyPriceUsd}/year available</p>
        <p className="mt-2 text-sm text-muted-foreground">
          For agencies and teams managing multiple websites.
        </p>
      </>
    );
  }

  if (headline === 0) {
    return (
      <>
        <p className={headingClass}>$0</p>
        <p className="mt-1 text-xs text-muted-foreground">No card required</p>
      </>
    );
  }

  return (
    <>
      <p className={headingClass}>
        ${headline}
        <span className="text-sm font-normal text-muted-foreground">/mo</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {interval === "yearly" ? "Billed " : "Or "}${plan.yearlyPriceUsd}/year
        {saved > 0 ? (
          <span className="text-[color:var(--arc-green)]">
            {" "}· save ${saved}/year
          </span>
        ) : null}
        {plan.trialDays > 0 ? ` · ${plan.trialDays}-day trial` : ""}
      </p>
      {planId === "founder" ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {PROVIDER_CHECK_DEFINITION}
        </p>
      ) : null}
    </>
  );
}

export function PricingPlans({
  variant,
  signedIn = false,
}: {
  variant: "full" | "teaser";
  signedIn?: boolean;
}) {
  const [interval, setInterval] = useState<BillingInterval>("monthly");

  return (
    <div>
      <div className="flex justify-center">
        <PricingIntervalToggle value={interval} onChange={setInterval} />
      </div>
      <div className="mt-8 mx-auto grid max-w-3xl gap-4 md:grid-cols-2">
        {SOLD_PLAN_IDS.map((planId) => {
          const plan = PLAN_CONFIG[planId];
          const popular = planId === "founder";
          const locked = isSalesLockedPlan(planId);
          const cta = planCta(planId, interval, signedIn);
          return (
            <div
              key={planId}
              className={`relative flex flex-col rounded-xl border p-6 ${
                variant === "teaser" ? "bg-background" : "bg-card"
              } ${
                popular
                  ? variant === "teaser"
                    ? "border-[color:var(--arc-accent)]/50 shadow-[0_0_0_1px_color-mix(in_srgb,var(--arc-accent)_35%,transparent),0_16px_48px_-24px_color-mix(in_srgb,var(--arc-accent)_45%,transparent)]"
                    : "border-foreground"
                  : "border-border"
              }`}
            >
              {popular ? (
                <span
                  className={`absolute -top-2.5 left-5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    variant === "teaser"
                      ? "bg-[color:var(--arc-accent)] text-white"
                      : "bg-foreground text-background"
                  }`}
                >
                  Early bird
                </span>
              ) : null}
              {locked ? (
                <span className="absolute -top-2.5 right-5 inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <Lock className="size-2.5" aria-hidden />
                  By request
                </span>
              ) : null}
              <h2 className="text-sm font-medium">{plan.name}</h2>
              <PlanPrice
                planId={planId}
                interval={interval}
                size={variant === "full" ? "full" : "teaser"}
              />
              {variant === "teaser" ? (
                <p className="mt-3 flex-1 text-sm text-muted-foreground">
                  {plan.description}
                  {planId === "founder" ? (
                    <span className="mt-2 block">
                      {PLUS_MODELS}, compared on every audit.
                    </span>
                  ) : null}
                </p>
              ) : (
                <ul className="mt-5 flex-1 space-y-2.5">
                  {(CARD_FEATURES[planId] ?? []).map((feature) => (
                    <li
                      key={feature.text}
                      className="flex items-start gap-2 text-sm"
                    >
                      <FeatureCheck className="mt-0.5" />
                      <span className="text-foreground/80">
                        {feature.text}
                        {feature.providers ? (
                          <ProviderStack
                            providers={feature.providers}
                            className="mt-1.5 flex"
                          />
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                asChild
                variant={popular ? "default" : "outline"}
                size={variant === "teaser" ? "sm" : "default"}
                className={variant === "teaser" ? "mt-5" : "mt-6"}
              >
                {cta.external ? (
                  <a href={cta.href}>{cta.label}</a>
                ) : (
                  <Link href={cta.href}>{cta.label}</Link>
                )}
              </Button>
              {planId === "founder" ? <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{trialCommitment(interval)}</p> : <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Starting package includes the allowances above. Contact us to confirm your package before purchase.</p>}
            </div>
          );
        })}
      </div>
      <div className="mt-6 text-center">
        <Button asChild variant="outline">
          <Link href={signedIn ? routes.newScan() : routes.freeAuditSignup}>
            Run free audit
          </Link>
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">No card required. Audit results are saved to your dashboard.</p>
        <p className="mt-2 text-xs text-muted-foreground">Each audit samples one answer per question per AI: a snapshot, not proof of a stable trend.</p>
      </div>
    </div>
  );
}
