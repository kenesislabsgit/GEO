"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProviderStack } from "@/components/providers/provider-logo";
import {
  PLAN_CONFIG,
  PLUS_CHECKS_INCLUDED,
  PLUS_EARLY_BIRD_BONUS_CHECKS,
  type PlanId,
} from "@/lib/billing/entitlements";
import {
  formatChecks,
  headlinePriceUsd,
  GROWTH_WAITLIST_HREF,
  isSalesLockedPlan,
  PRO_CONTACT_HREF,
  publicSubscribeHref,
  SOLD_PLAN_IDS,
  yearlySavingsUsd,
  type BillingInterval,
} from "@/lib/billing/pricing";
import { routes } from "@/lib/routes";
import { PricingIntervalToggle } from "@/components/site/pricing-interval-toggle";

type CardFeature = { text: string; providers?: readonly string[] };

function checksFeature(planId: PlanId): CardFeature {
  if (planId === "founder") {
    return {
      text: `${PLUS_CHECKS_INCLUDED} + ${PLUS_EARLY_BIRD_BONUS_CHECKS} early-bird checks per month`,
    };
  }
  const count = PLAN_CONFIG[planId].features.providerChecksPerMonth;
  return {
    text: `${formatChecks(count)} provider checks per month`,
  };
}

const CARD_FEATURES: Partial<Record<PlanId, CardFeature[]>> = {
  founder: [
    checksFeature("founder"),
    { text: "20 buyer questions per audit" },
    {
      text: `${PLAN_CONFIG.founder.features.providers.length} AI providers compared side by side`,
      providers: PLAN_CONFIG.founder.features.providers,
    },
    { text: "Full answers, sources & verified mentions" },
    { text: "Citation gaps - where rivals are cited, you aren't" },
    { text: "Complete action plan + copy-paste AI prompt" },
    { text: "Weekly monitoring, score alerts, history" },
    { text: "Private or public report link" },
  ],
  growth: [
    { text: "Everything in Plus" },
    checksFeature("growth"),
    {
      text: `The ${PLAN_CONFIG.growth.features.providersPerScan} most-used AIs, checked on every audit`,
      providers: PLAN_CONFIG.growth.features.providers,
    },
    {
      text: `${PLAN_CONFIG.growth.features.brands} websites, ${PLAN_CONFIG.growth.features.activePrompts} tracked questions`,
    },
    { text: "Daily monitoring that rotates through your questions" },
    { text: "CSV exports + PDF reports" },
    { text: "Impact tracking on completed fixes" },
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
    { text: "CSV exports + PDF reports" },
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
    label: "Get started",
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
        <p className={headingClass}>Custom</p>
        <p className="mt-1 text-xs text-muted-foreground">Pricing by request</p>
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
        {interval === "yearly" ? (
          <>
            billed ${plan.yearlyPriceUsd}/year
            {saved > 0 ? (
              <span className="text-[color:var(--arc-green)]">
                {" "}
                · save ${saved}
              </span>
            ) : null}
          </>
        ) : (
          <>
            ${plan.yearlyPriceUsd}/year
            {plan.trialDays > 0 ? ` · ${plan.trialDays}-day trial` : ""}
          </>
        )}
      </p>
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
                  Most popular
                </span>
              ) : null}
              {planId === "founder" ? (
                <span className="absolute -top-2.5 right-5 rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Early bird
                </span>
              ) : locked ? (
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
                </p>
              ) : (
                <ul className="mt-5 flex-1 space-y-2.5">
                  {(CARD_FEATURES[planId] ?? []).map((feature) => (
                    <li
                      key={feature.text}
                      className="flex items-start gap-2 text-sm"
                    >
                      <Check className="mt-0.5 size-3.5 shrink-0 text-[color:var(--arc-green)]" />
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
            </div>
          );
        })}
      </div>
      <p className="mt-8 text-center text-sm leading-relaxed text-muted-foreground">
        Need more websites and daily scans? Growth is next —{" "}
        {PLAN_CONFIG.growth.features.brands} sites, the{" "}
        {PLAN_CONFIG.growth.features.providersPerScan} most-used AIs, opening
        in waves.{" "}
        <Link
          href={GROWTH_WAITLIST_HREF}
          className="text-foreground underline underline-offset-4"
        >
          Join the list
        </Link>
        .
      </p>
    </div>
  );
}
