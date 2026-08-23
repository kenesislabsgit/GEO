"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PLAN_CONFIG, type PlanId } from "@/lib/billing/entitlements";
import {
  PRO_CONTACT_HREF,
  yearlySavingsUsd,
  type BillingInterval,
} from "@/lib/billing/pricing";

export function BillingActions({
  highlightedPlan,
  highlightedInterval,
  hasSubscription,
  returnTo = null,
}: {
  highlightedPlan?: string;
  highlightedInterval?: BillingInterval;
  hasSubscription: boolean;
  returnTo?: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  async function checkout(plan: PlanId, interval: "monthly" | "yearly") {
    setLoading(`${plan}-${interval}`);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, interval, returnTo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      window.location.assign("/dashboard/billing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setLoading(null);
    }
  }

  async function openPortal() {
    setLoading("portal");
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Portal failed");
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      setLoading(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Portal failed");
      setLoading(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          {hasSubscription ? "Change plan" : "Upgrade"}
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {(["founder"] as PlanId[]).map((planId) => {
            const plan = PLAN_CONFIG[planId];
            const highlight = highlightedPlan === planId;
            return (
              <div
                key={planId}
                className={`relative flex flex-col rounded-xl border bg-card p-5 ${
                  highlight
                    ? "border-foreground shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
                    : "border-border"
                }`}
              >
                {highlight ? (
                  <Badge className="absolute -top-2.5 left-4 rounded-full px-2.5 text-[11px]">
                    Selected
                  </Badge>
                ) : null}
                <p className="text-sm font-medium">{plan.name}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">
                  ${plan.monthlyPriceUsd}
                  <span className="text-sm font-normal text-muted-foreground">
                    /mo
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  or ${plan.yearlyPriceUsd}/year
                  {yearlySavingsUsd(plan) > 0
                    ? ` · save $${yearlySavingsUsd(plan)}`
                    : ""}
                  {plan.trialDays > 0 ? ` · ${plan.trialDays}-day trial` : ""}
                </p>
                <p className="mt-3 flex-1 text-sm text-muted-foreground">
                  {plan.description}
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <Button
                    size="sm"
                    variant={highlightedInterval === "yearly" ? "outline" : "default"}
                    disabled={loading !== null}
                    onClick={() => checkout(planId, "monthly")}
                  >
                    {loading === `${planId}-monthly` ? (
                      <>
                        <Loader2
                          data-icon="inline-start"
                          className="animate-spin"
                        />
                        Redirecting…
                      </>
                    ) : (
                      "Subscribe monthly"
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant={highlightedInterval === "yearly" ? "default" : "outline"}
                    disabled={loading !== null}
                    onClick={() => checkout(planId, "yearly")}
                  >
                    {loading === `${planId}-yearly` ? (
                      <>
                        <Loader2
                          data-icon="inline-start"
                          className="animate-spin"
                        />
                        Redirecting…
                      </>
                    ) : (
                      `Subscribe yearly · save $${yearlySavingsUsd(plan)}`
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
          <div className="relative flex flex-col rounded-xl border border-border bg-card p-5">
            <span className="absolute -top-2.5 right-4 rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              By request
            </span>
            <p className="text-sm font-medium">{PLAN_CONFIG.agency.name}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">
              ${PLAN_CONFIG.agency.monthlyPriceUsd}
              <span className="text-sm font-normal text-muted-foreground">/mo</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              or ${PLAN_CONFIG.agency.yearlyPriceUsd}/year
              {yearlySavingsUsd(PLAN_CONFIG.agency) > 0
                ? ` · save $${yearlySavingsUsd(PLAN_CONFIG.agency)}`
                : ""}
            </p>
            <p className="mt-3 flex-1 text-sm text-muted-foreground">
              {PLAN_CONFIG.agency.description} Set up with our team.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={PRO_CONTACT_HREF}>Contact us</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {hasSubscription ? (
        <Button
          variant="outline"
          size="sm"
          onClick={openPortal}
          disabled={loading !== null}
        >
          {loading === "portal" ? (
            <>
              <Loader2 data-icon="inline-start" className="animate-spin" />
              Opening…
            </>
          ) : (
            <>
              Manage subscription
              <ExternalLink data-icon="inline-end" />
            </>
          )}
        </Button>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Billing error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Payments are processed by Dodo Payments (test mode supported). When API
        keys are missing, checkout simulates an active subscription locally for
        development.
      </p>
    </div>
  );
}
