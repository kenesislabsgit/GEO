"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Clock, Loader2, Lock, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuditProgress } from "@/components/scan/audit-progress";
import { useDetachedAudit } from "@/components/scan/use-detached-audit";
import { routes } from "@/lib/routes";
import {
  DEFAULT_SCAN_PROVIDERS,
  FREE_AUDIT_PROVIDER,
  FREE_AUDIT_QUESTION_COUNT,
  PRO_AUDIT_QUESTION_COUNT,
  providerDisplayName,
} from "@/lib/constants";
import { PLAN_CONFIG, type PlanId } from "@/lib/billing/entitlements";
import { ProviderLogo } from "@/components/providers/provider-logo";
import { cn, formatDate } from "@/lib/utils";
import type { ProviderId } from "@/types/database";

export type ScanBrandOption = {
  id: string;
  name: string;
  domain: string;
  category: string | null;
  slug: string;
  prompts: Array<{
    id: string;
    prompt: string;
    type: string;
    country: string;
    language: string;
  }>;
  lastScanAt: string | null;
  recentlyScanned: boolean;
  lastCompletedScanAt: string | null;
};

type PlanInfo = {
  id: string;
  name: string;
  isPaid: boolean;
  allowedProviders: ProviderId[];
  providersPerScan: number;
  countries: number;
  languages: number;
  checksLimit: number;
  checksUsed: number;
};

/** Providers that at least one plan actually offers, in display order.
 * Every id here is wired into the audit engine - nothing aspirational. */
const OFFERED_PROVIDERS: ProviderId[] = [
  "openai_search",
  "bedrock_claude",
  "gemini",
  "perplexity",
  "grok",
  "deepseek",
  "bedrock_llama",
  "bedrock_mistral",
  "kimi",
  "bedrock_nova",
  "groq",
  "minimax",
  "sarvam",
  "qwen",
];

/** The cheapest plan whose provider list includes this provider. */
function planThatUnlocks(provider: ProviderId): PlanId | null {
  for (const planId of ["founder", "growth", "agency"] as const) {
    if (PLAN_CONFIG[planId].features.providers.includes(provider)) {
      return planId;
    }
  }
  return null;
}

/** Markets the engine can pin web search to (names it recognises). */
const GEO_MARKETS = [
  "India",
  "United States",
  "United Kingdom",
  "Germany",
  "France",
  "Spain",
  "Netherlands",
  "Canada",
  "Australia",
  "Singapore",
  "United Arab Emirates",
  "Japan",
  "Brazil",
  "Indonesia",
] as const;

export function NewScanForm({
  brands,
  preselectedBrandId,
  plan,
}: {
  brands: ScanBrandOption[];
  preselectedBrandId: string | null;
  plan: PlanInfo;
}) {
  const router = useRouter();
  const initialBrand =
    brands.find((b) => b.id === preselectedBrandId) ?? brands[0]!;
  const [brandId, setBrandId] = useState(initialBrand.id);
  // Pre-select the default slice, not the whole catalog - plans can offer
  // more providers than one audit may run.
  const [providers, setProviders] = useState<string[]>(
    plan.isPaid
      ? DEFAULT_SCAN_PROVIDERS.filter((id) =>
          plan.allowedProviders.includes(id),
        ).slice(0, plan.providersPerScan)
      : [FREE_AUDIT_PROVIDER],
  );
  const [market, setMarket] = useState<string>("auto");
  const [recentBlock, setRecentBlock] = useState<{
    reportSlug: string;
    lastScanAt: string | null;
  } | null>(null);
  const {
    loading,
    error,
    progress: scanProgress,
    step: scanStep,
    events: scanEvents,
    start,
  } = useDetachedAudit({
    storageKey: "rbai_audit_new_scan",
    onDone: (doneBrandId) => router.push(`${routes.brand(doneBrandId)}?completed=1`),
  });

  const brand = brands.find((b) => b.id === brandId) ?? initialBrand;
  // What this plan can actually use, and what a higher plan would add.
  const availableProviders = plan.isPaid
    ? OFFERED_PROVIDERS.filter((id) => plan.allowedProviders.includes(id))
    : [FREE_AUDIT_PROVIDER];
  const lockedProviders = OFFERED_PROVIDERS.filter(
    (id) => !availableProviders.includes(id),
  ).map((id) => ({ id, unlockPlan: planThatUnlocks(id) }));
  // One CTA, pointing at the cheapest plan that unlocks anything above.
  const unlockCtaPlan =
    lockedProviders.find((item) => item.unlockPlan)?.unlockPlan ?? null;
  const geoEnabled = Boolean(
    PLAN_CONFIG[plan.id as PlanId]?.features.geoMarketSearch,
  );
  // This form always starts a Pro run, so the estimate has to be the Pro
  // question count. It used to cap at five - the old Pro size - which made a
  // twenty-question run look like a five-question one and under-counted the
  // monthly allowance by four times.
  const questionsPerProvider = PRO_AUDIT_QUESTION_COUNT;
  const estimatedChecks = questionsPerProvider * providers.length;
  const remaining = Math.max(plan.checksLimit - plan.checksUsed, 0);
  const overAllowance = estimatedChecks > remaining;

  function toggleProvider(id: string) {
    if (!plan.isPaid) return;
    setProviders((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((p) => p !== id);
      }
      if (prev.length >= plan.providersPerScan) return prev;
      return [...prev, id];
    });
  }

  function startScan() {
    setRecentBlock(null);
    // A free account gets the free audit it is entitled to - requesting Pro
    // here used to hand free users a payment error instead of their audit.
    void start({
      brandId,
      domain: brand.domain,
      assistants: providers,
      limitPerAssistant: plan.isPaid
        ? PRO_AUDIT_QUESTION_COUNT
        : FREE_AUDIT_QUESTION_COUNT,
      mode: plan.isPaid ? "pro" : "free",
      ...(plan.isPaid && geoEnabled && market !== "auto" ? { market } : {}),
    });
  }

  // While the audit runs, the form gives way to a full-width progress view - 
  // the reasoning timeline was unreadable squeezed into the summary sidebar.
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <section className="rb-panel p-6">
          <AuditProgress
            progress={scanProgress}
            step={scanStep}
            plan="pro"
            providers={providers}
            questionCount={questionsPerProvider}
            events={scanEvents}
            className=""
          />
        </section>
        {error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>Audit could not start</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <p className="mt-4 text-center text-xs text-muted-foreground">
          You can leave this page - the audit keeps running and the report
          opens when it finishes.
        </p>
      </div>
    );
  }

  return (
    // minmax(0,1fr): a long question or provider name must truncate inside
    // its card, never widen the track and push the sidebar off-screen.
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        {/* Brand selection */}
        <section className="rb-panel">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">1. Select website</h2>
          </div>
          <div className="divide-y divide-border">
            {brands.map((option) => {
              const selected = option.id === brandId;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setBrandId(option.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left transition-colors",
                    selected ? "bg-muted/60" : "hover:bg-muted/40",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {option.name}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {option.domain}
                      {option.category ? ` · ${option.category}` : ""}
                    </p>
                    {option.lastScanAt ? (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        Last scan{" "}
                        {formatDate(option.lastScanAt)}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border",
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-border",
                    )}
                  >
                    {selected ? <Check className="size-3" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Questions */}
        <section className="rb-panel">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">
              2. Questions from your last audit
            </h2>
            <Badge variant="secondary" className="rounded-full text-[11px]">
              {brand.prompts.length} questions
            </Badge>
          </div>
          {/* These are history, not a selection. Every run reads the website
              again and writes fresh questions from what it finds, then
              replaces the list below. Labelling this a "library" made it look
              like the questions you see are the ones about to be asked. */}
          <p className="px-5 pt-4 text-xs leading-relaxed text-muted-foreground">
            This audit will write {questionsPerProvider} new buyer questions from a
            fresh read of the website. The questions below are what the last audit
            asked, and they will be replaced.
          </p>
          {brand.prompts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No questions yet - this is the first audit for this website.
            </p>
          ) : (
            <div className="max-h-72 divide-y divide-border overflow-y-auto">
              {brand.prompts.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-4 px-5 py-2.5"
                >
                  <p className="min-w-0 truncate text-sm">{p.prompt}</p>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground capitalize">
                    {p.type.replaceAll("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Providers + locale */}
        <section className="rb-panel">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">3. Audit settings</h2>
          </div>
          <div className="space-y-5 px-5 py-4">
            <div>
              <p className="text-sm font-medium">AI providers</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {availableProviders.length > plan.providersPerScan
                  ? `Your ${plan.name} plan offers ${availableProviders.length} providers - run up to ${plan.providersPerScan} per audit (${providers.length} selected). Deselect one to swap in another.`
                  : `Included in your ${plan.name} plan. Every selected provider answers the same questions.`}
              </p>
              {/* What the plan includes - selectable, with the provider's own
                  mark. Locked providers live below, not greyed out in here. */}
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {availableProviders.map((id) => {
                  const active = providers.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={!plan.isPaid}
                      onClick={() => toggleProvider(id)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors",
                        active
                          ? "border-foreground/40 bg-muted/60 font-medium"
                          : "border-border text-muted-foreground hover:text-foreground",
                        !plan.isPaid && "cursor-default",
                      )}
                    >
                      <ProviderLogo provider={id} className="size-4" />
                      <span className="min-w-0 truncate">
                        {providerDisplayName(id)}
                      </span>
                      <span
                        className={cn(
                          "ml-auto flex size-4.5 shrink-0 items-center justify-center rounded-full border",
                          active
                            ? "border-foreground bg-foreground text-background"
                            : "border-border",
                        )}
                      >
                        {active ? <Check className="size-3" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>

              {lockedProviders.length > 0 ? (
                <div className="mt-4 overflow-hidden rounded-lg border border-dashed border-border">
                  <p className="flex items-center gap-1.5 border-b border-dashed border-border px-3.5 py-2 text-xs font-medium text-muted-foreground">
                    <Lock className="size-3" aria-hidden />
                    Not in the {plan.name} plan
                  </p>
                  <div className="divide-y divide-border/60">
                    {lockedProviders.map(({ id, unlockPlan }) => (
                      <div
                        key={id}
                        className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-muted-foreground/80"
                      >
                        <ProviderLogo provider={id} className="size-4 opacity-60" />
                        {providerDisplayName(id)}
                        {unlockPlan ? (
                          <span className="rb-chip ml-auto">
                            {PLAN_CONFIG[unlockPlan].name}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {unlockCtaPlan ? (
                    <Link
                      href={routes.billing({
                        plan: unlockCtaPlan,
                        returnTo: routes.newScan(brandId),
                      })}
                      className="block border-t border-dashed border-border px-3.5 py-2.5 text-xs font-medium text-[color:var(--rb-accent)] transition-colors hover:bg-muted/40"
                    >
                      Unlock with {PLAN_CONFIG[unlockCtaPlan].name} →
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
            {geoEnabled ? (
              <div>
                <p className="text-sm font-medium">Geographic market</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  A slice of the questions is asked the way a buyer in this
                  market would (&ldquo;best X in India&rdquo;), with web search
                  located there. Auto reads the market from your website.
                </p>
                <select
                  value={market}
                  onChange={(event) => setMarket(event.target.value)}
                  className="mt-2.5 h-9 w-full max-w-xs rounded-lg border border-border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="auto">Auto - detect from website</option>
                  {GEO_MARKETS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            ) : plan.isPaid ? (
              <p className="text-xs text-muted-foreground">
                <Lock className="mr-1 inline size-3" aria-hidden />
                Geographic market simulation - asking as a buyer in your home
                market - is available on{" "}
                <Link
                  href={routes.billing({ plan: "growth", returnTo: routes.newScan(brandId) })}
                  className="text-[color:var(--rb-accent)] hover:underline"
                >
                  Pro+
                </Link>
                .
              </p>
            ) : null}
            {/* Country and language pickers used to sit here. Nothing sent
                them to the audit runner and the runner has no flag for them,
                so every run was US/English whatever was chosen. Put them back
                when geo_audit can actually ask in another country or
                language. */}
          </div>
        </section>

        {recentBlock ? (
          <Alert>
            <AlertTitle>This website was scanned recently</AlertTitle>
            <AlertDescription>
              <p>
                You can view the existing report or upgrade for ongoing
                monitoring.
                {recentBlock.lastScanAt
                  ? ` Last scanned ${formatDate(recentBlock.lastScanAt)}.`
                  : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href={routes.brand(brandId)}>
                    View report
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={routes.billing({
                      plan: "founder",
                      returnTo: routes.newScan(brandId),
                    })}
                  >
                    Upgrade
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRecentBlock(null)}
                >
                  Cancel
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Audit could not start</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      {/* Summary sidebar */}
      <aside className="h-fit space-y-4 lg:sticky lg:top-20">
        <div className="rb-panel p-5">
          <h2 className="text-sm font-semibold">Audit summary</h2>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Website</dt>
              <dd className="truncate font-medium">{brand.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Questions</dt>
              <dd className="font-medium">{questionsPerProvider}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Providers</dt>
              <dd className="flex flex-wrap justify-end gap-1.5">
                {providers.map((id) => (
                  <span key={id} title={providerDisplayName(id)}>
                    <ProviderLogo provider={id} className="size-4" />
                  </span>
                ))}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-2.5">
              <dt className="text-muted-foreground">Estimated AI checks</dt>
              <dd className="font-semibold">{estimatedChecks}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Remaining this month</dt>
              <dd
                className={cn(
                  "font-medium",
                  overAllowance && "text-destructive",
                )}
              >
                {remaining} / {plan.checksLimit}
              </dd>
            </div>
          </dl>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                overAllowance ? "bg-destructive" : "bg-foreground",
              )}
              style={{
                width: `${Math.min((plan.checksUsed / Math.max(plan.checksLimit, 1)) * 100, 100)}%`,
              }}
            />
          </div>
          {/* An empty question list is no longer a reason to block: the run
              writes its own questions. Blocking on it meant a website whose
              first audit died could never be audited again from this page. */}
          <Button
            className="mt-5 w-full"
            disabled={loading || overAllowance}
            onClick={startScan}
          >
            {loading ? (
              <>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                Starting…
              </>
            ) : (
              <>
                <Play data-icon="inline-start" />
                Start audit
              </>
            )}
          </Button>
          {overAllowance ? (
            <p className="mt-2 text-xs text-destructive">
              This scan exceeds your remaining monthly allowance.{" "}
              <Link
                href={routes.billing({ returnTo: routes.newScan(brandId) })}
                className="underline underline-offset-4"
              >
                Upgrade to continue
              </Link>
              .
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            Plan: {plan.name}. One provider answering one question equals one
            AI check.
          </p>
        </div>
        {!plan.isPaid && brand.recentlyScanned ? (
          <div className="rb-warn rounded-2xl p-4 text-sm">
            <p className="font-medium">Recently audited</p>
            <p className="mt-1 text-muted-foreground">
              This website was last audited{" "}
              {brand.lastCompletedScanAt
                ? formatDate(brand.lastCompletedScanAt)
                : "recently"}
              . You can run it again - a recent read of the website is reused, and
              each run uses your monthly AI checks.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={routes.brand(brand.id)}>View report</Link>
              </Button>
              <Button asChild size="sm">
                <Link href={routes.billing({ plan: "founder" })}>Upgrade</Link>
              </Button>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
