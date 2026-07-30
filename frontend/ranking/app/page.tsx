import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileSearch,
  Radar,
  Sparkles,
} from "lucide-react";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { Button } from "@/components/ui/button";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { APP_NAME } from "@/lib/constants";
import { routes } from "@/lib/routes";

const planChoices = [
  {
    name: "Free",
    price: "$0",
    detail: "5 questions · 1 provider",
    href: routes.login({ mode: "signup", returnTo: routes.newScan() }),
  },
  {
    name: "Pro",
    price: `$${PLAN_CONFIG.founder.monthlyPriceUsd}/mo`,
    detail: "Multi-provider report",
    href: routes.login({
      mode: "signup",
      returnTo: routes.billing({
        plan: "founder",
        returnTo: routes.newScan(),
      }),
    }),
  },
  {
    name: "Pro+",
    price: `$${PLAN_CONFIG.growth.monthlyPriceUsd}/mo`,
    detail: "More websites and usage",
    href: routes.login({
      mode: "signup",
      returnTo: routes.billing({
        plan: "growth",
        returnTo: routes.newScan(),
      }),
    }),
  },
] as const;

const steps = [
  {
    n: "01",
    title: "Understand the company",
    body: "We read your public site, extract category and audience, then let you correct anything before scanning.",
  },
  {
    n: "02",
    title: "Ask unbiased buyer questions",
    body: "Five real discovery prompts — generated without your company name so the measurement is never primed.",
  },
  {
    n: "03",
    title: "Score what AI actually says",
    body: "Mentions, position, citations, and sentiment across providers — into one explainable visibility score.",
  },
];

const faqs = [
  {
    q: "Is this the same as ChatGPT or Perplexity.com?",
    a: "No. We query provider APIs and label the exact provider used. The free audit currently uses Bedrock Llama; paid audits compare the same questions across multiple providers.",
  },
  {
    q: "Can results change between runs?",
    a: "Yes. AI answers are non-deterministic. Every report stores methodology version, timestamp, models, and sample size so results stay comparable in context.",
  },
  {
    q: "Do free scans require an account?",
    a: "No. Enter a domain and get a shareable public report. One free scan per domain every 30 days — claim the brand later to unlock monitoring.",
  },
  {
    q: "Do you guarantee ranking improvements?",
    a: "No — and you should distrust anyone who does. The action centre gives evidence-based, directional recommendations tied to exact prompts and sources.",
  },
];

function ProductStage() {
  return (
    <div className="rb-float relative mx-auto w-full max-w-5xl">
      <div
        aria-hidden
        className="absolute -inset-x-8 -bottom-10 top-1/3 rounded-[40%] bg-[radial-gradient(ellipse_at_center,rgba(11,132,255,0.18),transparent_70%)] blur-2xl"
      />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[color:var(--rb-ink)] shadow-[0_40px_100px_rgba(12,15,20,0.35)]">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="ml-2 truncate font-mono text-[11px] text-white/35">
            rankedbyai.com/report/acme-analytics
          </span>
        </div>
        <div className="rb-grid-dark rb-scanline relative p-6 md:p-10">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="font-mono text-[11px] tracking-[0.18em] text-white/40 uppercase">
                AI visibility report
              </p>
              <p className="mt-2 font-heading text-3xl font-semibold tracking-tight text-white md:text-4xl">
                Acme Analytics
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[11px] tracking-wide text-white/40 uppercase">
                Score
              </p>
              <p className="font-heading text-5xl font-semibold tracking-tight text-white md:text-6xl">
                62
                <span className="text-white/35">.4</span>
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-3 gap-3 md:gap-4">
            {[
              ["Mention rate", "40%"],
              ["Avg position", "2.5"],
              ["Top rival", "Northstar"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 md:px-4 md:py-4"
              >
                <p className="text-[10px] tracking-wide text-white/40 uppercase md:text-[11px]">
                  {label}
                </p>
                <p className="mt-1 font-heading text-xl font-semibold text-white md:text-2xl">
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-2">
            {[
              ["Best analytics platforms for startups?", true],
              ["Affordable product analytics options?", true],
              ["Alternatives to the category leader?", false],
            ].map(([prompt, mentioned]) => (
              <div
                key={String(prompt)}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5"
              >
                <span className="truncate text-sm text-white/75">
                  {prompt}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    mentioned
                      ? "bg-[color:var(--rb-green)]/15 text-[#34d399]"
                      : "bg-white/10 text-white/45"
                  }`}
                >
                  {mentioned ? "Mentioned" : "Absent"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <div className="rb-atmosphere relative min-h-screen overflow-hidden">
        <div aria-hidden className="rb-mesh pointer-events-none absolute inset-0" />
        <div
          aria-hidden
          className="rb-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
        />

        <SiteHeader />

        <main className="relative flex-1">
          {/* Hero — one composition: brand, headline, line, CTA, product plane */}
          <section className="relative">
            <div className="mx-auto max-w-6xl px-4 pt-10 pb-5 md:px-6 md:pt-14 md:pb-6">
              <div className="mx-auto max-w-3xl text-center">
                <p className="rb-fade-up inline-flex items-center gap-3 font-heading text-xl font-semibold tracking-tight md:text-2xl">
                  <span
                    aria-hidden
                    className="flex size-8 items-center justify-center rounded-lg bg-[color:var(--rb-ink)] text-xs font-bold text-white md:size-9 md:text-sm"
                  >
                    R
                  </span>
                  {APP_NAME}
                </p>

                <h1 className="rb-fade-up rb-fade-up-delay-1 font-heading mt-5 text-[2.15rem] leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl md:text-[3.75rem]">
                  Does AI recommend
                  <br className="hidden sm:block" /> your company?
                </h1>

                <p className="rb-fade-up rb-fade-up-delay-2 mx-auto mt-4 max-w-xl text-base text-pretty text-muted-foreground md:text-lg">
                  See whether AI recommends your website, which competitors
                  appear instead, and what evidence could improve the result.
                </p>

                <div id="plans" className="rb-fade-up rb-fade-up-delay-3 mx-auto mt-7 grid max-w-2xl scroll-mt-24 gap-3 sm:grid-cols-3">
                  {planChoices.map((plan) => (
                    <Link
                      key={plan.name}
                      href={plan.href}
                      className="rb-card-hover rounded-xl border border-white/70 bg-white/85 p-4 text-left shadow-sm backdrop-blur-xl"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{plan.name}</span>
                        <ArrowRight className="size-4 text-muted-foreground" />
                      </div>
                      <p className="mt-3 font-heading text-2xl font-semibold">{plan.price}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{plan.detail}</p>
                    </Link>
                  ))}
                </div>
                <p className="rb-fade-up rb-fade-up-delay-3 mt-3 text-xs text-muted-foreground">
                  Choose a plan, then sign in or create an account to begin.
                </p>
              </div>
            </div>

            <div className="relative px-3 pb-16 md:px-6 md:pb-24">
              <div className="[mask-image:linear-gradient(to_bottom,black_72%,transparent)]">
                <ProductStage />
              </div>
            </div>
          </section>
        </main>
      </div>

      <main>
        {/* How it works — one job */}
        <section className="border-y border-border bg-white">
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                How it works
              </p>
              <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Measurement you can defend
              </h2>
              <p className="mt-3 text-muted-foreground">
                No black boxes. Every score decomposes across prompts and
                providers.
              </p>
            </div>

            <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
              {steps.map((step) => (
                <div key={step.n} className="relative">
                  <p className="font-heading text-5xl font-semibold tracking-tight text-[color:var(--rb-blue)]/15">
                    {step.n}
                  </p>
                  <h3 className="mt-2 text-lg font-medium tracking-tight">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Proof strip */}
        <section className="bg-[color:var(--rb-mist)]">
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-24">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                  What you get
                </p>
                <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  A report worth sharing with your team
                </h2>
                <p className="mt-4 text-muted-foreground">
                  Prompt-level evidence, grounded sources, competitor share
                  of voice — sampled from real provider APIs.
                </p>
                <ul className="mt-8 space-y-3">
                  {[
                    "Unbiased buyer-question matrix",
                    "Mentioned / not mentioned status",
                    "Grounded citations and verified web mentions",
                    "One clear action to start with",
                  ].map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2.5 text-sm text-foreground"
                    >
                      <Check className="mt-0.5 size-4 shrink-0 text-[color:var(--rb-green)]" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-8 rounded-full" size="lg">
                  <Link href={routes.methodology}>
                    Read the methodology
                    <ArrowUpRight data-icon="inline-end" />
                  </Link>
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    icon: Radar,
                    title: "Multi-provider",
                    body: "The same buyer questions compared across supported AI providers.",
                  },
                  {
                    icon: FileSearch,
                    title: "Citation intel",
                    body: "See which pages shape AI answers in your category.",
                  },
                  {
                    icon: Sparkles,
                    title: "Action centre",
                    body: "Evidence-backed pages and fixes to pursue next.",
                  },
                  {
                    icon: ArrowRight,
                    title: "Ongoing monitoring",
                    body: "Weekly scans and alerts when visibility moves.",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-border bg-white p-5"
                  >
                    <item.icon className="size-5 text-[color:var(--rb-blue)]" />
                    <p className="mt-4 font-medium tracking-tight">
                      {item.title}
                    </p>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="border-y border-border bg-white">
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <div className="mx-auto max-w-2xl text-center">
              <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                Pricing
              </p>
              <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Start free. Scale when it matters.
              </h2>
              <p className="mt-3 text-muted-foreground">
                The free audit is the trial. Upgrade for monitoring, history, and
                the full action centre.
              </p>
            </div>

            <div className="mt-14 grid gap-4 md:grid-cols-4">
              {Object.values(PLAN_CONFIG).map((plan) => {
                const popular = plan.id === "founder";
                return (
                  <div
                    key={plan.id}
                    className={`rb-card-hover relative flex flex-col rounded-2xl border bg-white p-6 ${
                      popular
                        ? "border-[color:var(--rb-ink)] shadow-[0_16px_40px_rgba(12,15,20,0.08)]"
                        : "border-border"
                    }`}
                  >
                    {popular ? (
                      <span className="absolute -top-2.5 left-5 rounded-full bg-[color:var(--rb-ink)] px-2.5 py-0.5 text-[11px] font-medium text-white">
                        Most popular
                      </span>
                    ) : null}
                    <p className="text-sm font-medium">{plan.name}</p>
                    <p className="mt-3 font-heading text-3xl font-semibold tracking-tight">
                      {plan.monthlyPriceUsd === 0
                        ? "$0"
                        : `$${plan.monthlyPriceUsd}`}
                      {plan.monthlyPriceUsd > 0 ? (
                        <span className="text-sm font-normal text-muted-foreground">
                          /mo
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-3 flex-1 text-sm text-muted-foreground">
                      {plan.description}
                    </p>
                    <Button
                      asChild
                      variant={popular ? "default" : "outline"}
                      size="sm"
                      className="mt-5 rounded-full"
                    >
                      <Link
                        href={
                          plan.id === "free"
                            ? routes.publicScanAnchor
                            : routes.billing({ plan: plan.id })
                        }
                      >
                        {plan.id === "free" ? "Run free audit" : "Get started"}
                      </Link>
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 text-center">
              <Link
                href={routes.pricing}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Compare all plan features
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="bg-[color:var(--rb-mist)]">
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <div className="grid gap-12 lg:grid-cols-[0.9fr_1.3fr]">
              <div>
                <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                  FAQ
                </p>
                <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Honest answers
                </h2>
                <p className="mt-3 text-muted-foreground">
                  What AI visibility measurement can — and cannot — tell you.
                </p>
              </div>
              <div className="divide-y divide-border/80">
                {faqs.map((faq) => (
                  <div key={faq.q} className="py-6 first:pt-0 last:pb-0">
                    <h3 className="font-medium tracking-tight">{faq.q}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {faq.a}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden bg-[color:var(--rb-ink)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_120%,rgba(11,132,255,0.35),transparent_60%)]"
          />
          <div
            aria-hidden
            className="rb-grid-dark pointer-events-none absolute inset-0 opacity-50"
          />
          <div className="relative mx-auto max-w-6xl px-4 py-24 text-center md:px-6 md:py-32">
            <h2 className="font-heading mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-balance text-white md:text-5xl">
              Find out before your competitors do.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-white/55">
              Run a free AI visibility scan. No account, no card — a shareable
              report in minutes.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="rounded-full bg-white text-[color:var(--rb-ink)] hover:bg-white/90"
              >
                <Link href={routes.publicScanAnchor}>
                  Start free scan
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
              >
                <Link href={routes.methodology}>Methodology</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
