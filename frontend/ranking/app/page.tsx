import Link from "next/link";
import { ArrowRight, ArrowUpRight, Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { ProviderLogo } from "@/components/providers/provider-logo";
import { Button } from "@/components/ui/button";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { routes } from "@/lib/routes";

const faqs = [
  {
    q: "Is this the same as ChatGPT or Perplexity.com?",
    a: "No. We query provider APIs and label the exact provider used. The free audit uses OpenAI with web search; paid audits compare the same questions across multiple providers.",
  },
  {
    q: "Can results change between runs?",
    a: "Yes. AI answers are non-deterministic. Every report stores methodology version, timestamp, models, and sample size so results stay comparable in context.",
  },
  {
    q: "Do free scans require an account?",
    a: "Yes — a free account, no card. Sign up, run your free audit, and your report is saved to your dashboard so you can come back to it any time.",
  },
  {
    q: "Do you guarantee ranking improvements?",
    a: "No — and you should distrust anyone who does. The action centre gives evidence-based, directional recommendations tied to exact prompts and sources.",
  },
];

/* ---------------------------------------------------------------- hero -- */

function ProductStage() {
  return (
    <div className="relative mx-auto w-full max-w-4xl">
      <div
        aria-hidden
        className="rb-glow absolute -inset-x-16 -top-10 bottom-0"
      />
      <div className="relative overflow-hidden rounded-xl border border-black/10 bg-[color:var(--rb-ink)] shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_32px_80px_-24px_rgba(0,0,0,0.5)] dark:border-white/10">
        <div aria-hidden className="rb-noise pointer-events-none absolute inset-0 opacity-[0.15]" />
        <div className="relative flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="ml-2 truncate font-mono text-[11px] text-white/35">
            rankedbyai.com/report/acme-analytics
          </span>
        </div>
        <div className="relative p-6 md:p-10">
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
              <p className="rb-tabular font-heading text-5xl font-semibold tracking-tight text-white md:text-6xl">
                62<span className="text-white/35">.4</span>
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
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] md:px-4 md:py-4"
              >
                <p className="text-[10px] tracking-wide text-white/40 uppercase md:text-[11px]">
                  {label}
                </p>
                <p className="rb-tabular mt-1 font-heading text-xl font-semibold text-white md:text-2xl">
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
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
              >
                <span className="truncate text-sm text-white/75">{prompt}</span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    mentioned
                      ? "bg-emerald-400/15 text-emerald-300"
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

/* ------------------------------------------------------ blueprint marks -- */

function Cross({ className }: { className: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute z-10 ${className}`}>
      <span className="absolute -left-2 top-0 h-px w-4 bg-foreground/30" />
      <span className="absolute -top-2 left-0 h-4 w-px bg-foreground/30" />
    </span>
  );
}

/* ---------------------------------------------------- bento mini-visuals -- */

const PROVIDER_PILLS = [
  { name: "OpenAI", color: "#10a37f", className: "top-[6%] left-[10%] opacity-50" },
  { name: "Claude", color: "#d97757", className: "top-[16%] right-[12%]" },
  { name: "Gemini", color: "#4285f4", className: "top-[36%] left-[22%]" },
  { name: "Perplexity", color: "#20b8cd", className: "top-[58%] left-[6%] opacity-50" },
  { name: "Llama", color: "#0668e1", className: "top-[52%] right-[14%]" },
  { name: "Mistral", color: "#f54e42", className: "top-[76%] left-[30%]" },
  { name: "Nova", color: "#8b5cf6", className: "top-[88%] right-[8%] opacity-50" },
] as const;

const SOURCE_DOTS = [
  { className: "top-[22%] left-[26%] bg-[#52a8ff] shadow-[0_0_22px_6px_rgba(82,168,255,0.45)]" },
  { className: "top-[44%] left-[60%] bg-[#ff6ea9] shadow-[0_0_22px_6px_rgba(255,110,169,0.4)]" },
  { className: "top-[66%] left-[38%] bg-[#8b8bff] shadow-[0_0_22px_6px_rgba(139,139,255,0.45)]" },
  { className: "top-[30%] left-[80%] bg-[#3ecf7a] shadow-[0_0_22px_6px_rgba(62,207,122,0.4)]" },
] as const;

/* ----------------------------------------------------------------- page -- */

export default function HomePage() {
  return (
    <>
      <SiteHeader />

      <main>
        {/* Hero — editorial blueprint */}
        <section className="relative bg-background">
          <div aria-hidden className="rb-hatch h-8 border-b border-border" />
          <div className="mx-auto max-w-6xl">
            <div className="relative border-x border-border px-5 py-16 sm:px-8 md:px-12 md:py-24">
              <Cross className="top-0 left-0" />
              <Cross className="top-0 right-0" />
              <Cross className="bottom-0 left-0" />
              <Cross className="bottom-0 right-0" />

              <div
                aria-hidden
                className="rb-halftone absolute inset-y-6 right-0 hidden w-[55%] text-foreground/25 [mask-image:radial-gradient(ellipse_75%_85%_at_100%_35%,black,transparent_72%)] md:block"
              />

              <div className="relative max-w-2xl">
                <p className="rb-fade-up inline-flex items-center gap-2 border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                  <span aria-hidden className="size-1.5 rounded-full bg-[color:var(--rb-green)]" />
                  Measured from real provider APIs — never simulated
                </p>

                <h1 className="rb-fade-up rb-fade-up-delay-1 font-heading mt-6 text-[2.75rem] leading-[1.04] font-semibold tracking-[-0.035em] text-balance sm:text-6xl md:text-[4.25rem]">
                  See what AI tells your buyers before your competitors do.
                </h1>

                <p className="rb-fade-up rb-fade-up-delay-2 mt-5 max-w-xl text-base text-pretty text-muted-foreground md:text-lg">
                  Buyers ask ChatGPT before they ask Google. See what it answers,
                  which competitors it names instead of you, and exactly what to
                  change.
                </p>

                <div className="rb-fade-up rb-fade-up-delay-3 mt-8 flex flex-wrap items-center gap-3">
                  <Button asChild size="lg" className="h-11 rounded-none px-6">
                    <Link href={routes.publicScanAnchor}>
                      Run your free audit
                      <ArrowRight data-icon="inline-end" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    variant="outline"
                    className="h-11 rounded-none border-foreground/25 bg-transparent px-6"
                  >
                    <Link href={routes.methodology}>How it&rsquo;s measured</Link>
                  </Button>
                </div>
                <p className="rb-fade-up rb-fade-up-delay-3 mt-3 text-xs text-muted-foreground">
                  Free account · no card · report in ~2 minutes
                </p>
              </div>
            </div>
          </div>
          <div aria-hidden className="rb-hatch h-8 border-y border-border" />
        </section>

        {/* Product stage on a soft color field */}
        <section className="relative overflow-hidden border-b border-border">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-80 dark:opacity-30"
            style={{
              background:
                "radial-gradient(ellipse 40% 50% at 18% 10%, rgba(127,178,255,0.35), transparent 70%), radial-gradient(ellipse 35% 45% at 85% 25%, rgba(255,173,198,0.3), transparent 70%), radial-gradient(ellipse 40% 50% at 50% 95%, rgba(255,217,138,0.3), transparent 70%)",
            }}
          />

          <div className="relative px-3 pt-14 pb-4 md:px-6 md:pt-20">
            <div className="[mask-image:linear-gradient(to_bottom,black_78%,transparent)]">
              <ProductStage />
            </div>
          </div>

          {/* Provider strip */}
          <div className="relative mx-auto max-w-6xl px-4 pb-14 md:px-6">
            <p className="text-center text-xs text-muted-foreground">
              Answers measured across
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 font-mono text-sm tracking-wide text-muted-foreground/70">
              {["OpenAI", "Claude", "Llama", "Mistral", "Nova"].map((name) => (
                <span key={name} className="inline-flex items-center gap-2">
                  <ProviderLogo provider={name.toLowerCase()} />
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>
        {/* Bento — dark evidence grid */}
        <section className="relative overflow-hidden bg-[color:var(--rb-ink)] text-white">
          <div aria-hidden className="rb-noise pointer-events-none absolute inset-0 opacity-[0.08]" />
          <div className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] tracking-[0.14em] text-white/40 uppercase">
                The report
              </p>
              <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Evidence, not vibes
              </h2>
              <p className="mt-3 text-white/50">
                Everything below ships in every paid report — and the free audit
                is a real slice of it.
              </p>
            </div>

            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {/* Visibility score — stat + bars */}
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8 lg:col-span-2">
                <p className="font-mono text-[11px] tracking-[0.14em] text-white/35 uppercase">
                  Visibility score
                </p>
                <h3 className="font-heading mt-2 text-xl font-semibold tracking-tight">
                  A score that moves when you do
                </h3>
                <p className="mt-1.5 max-w-md text-sm leading-relaxed text-white/50">
                  Mentions, position and sentiment compiled into one number —
                  comparable scan after scan, never a black box.
                </p>
                <div className="mt-8 flex items-end justify-between gap-4">
                  <p className="rb-tabular font-heading text-5xl font-semibold tracking-tight">
                    62<span className="text-white/35">.4</span>
                  </p>
                  <p className="text-sm font-medium text-[#3ecf7a]">+6.2 this month</p>
                </div>
                <div className="mt-4 flex h-20 items-stretch gap-1 md:gap-1.5">
                  {Array.from({ length: 40 }, (_, i) => (
                    <span
                      key={i}
                      className={`flex-1 rounded-full ${i < 25 ? "bg-[#52a8ff]" : "bg-[#52a8ff]/15"}`}
                    />
                  ))}
                </div>
              </div>

              {/* Citations — glowing source map */}
              <div className="relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] lg:row-span-2">
                <div className="relative min-h-56 flex-1">
                  <div
                    aria-hidden
                    className="rb-grid-dark absolute inset-0 [mask-image:radial-gradient(ellipse_95%_95%_at_55%_40%,black,transparent_78%)]"
                  />
                  {SOURCE_DOTS.map((dot, i) => (
                    <span
                      key={i}
                      aria-hidden
                      className={`absolute size-1.5 rounded-full ${dot.className}`}
                    />
                  ))}
                </div>
                <div className="p-6 md:p-8">
                  <p className="font-mono text-[11px] tracking-[0.14em] text-white/35 uppercase">
                    Citations
                  </p>
                  <h3 className="font-heading mt-2 text-xl font-semibold tracking-tight">
                    Trace every citation
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/50">
                    The exact pages that taught each model who to recommend —
                    mapped across the open web, including where you&rsquo;re missing.
                  </p>
                </div>
              </div>

              {/* Providers — floating pills */}
              <div className="relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] lg:row-span-2">
                <div className="relative min-h-72 flex-1">
                  {PROVIDER_PILLS.map((pill) => (
                    <span
                      key={pill.name}
                      className={`absolute inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-sm text-white/70 ${pill.className}`}
                    >
                      <ProviderLogo
                        provider={pill.name.toLowerCase()}
                        className="size-3.5"
                        style={{ color: pill.color }}
                      />
                      {pill.name}
                    </span>
                  ))}
                </div>
                <div className="p-6 md:p-8">
                  <p className="font-mono text-[11px] tracking-[0.14em] text-white/35 uppercase">
                    Providers
                  </p>
                  <h3 className="font-heading mt-2 text-xl font-semibold tracking-tight">
                    One method, every model
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/50">
                    The same buyer questions asked across OpenAI, Claude, Gemini
                    and more — answers compared side by side.
                  </p>
                </div>
              </div>

              {/* Big stat card */}
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_130%_100%_at_50%_-20%,#173a5e,#0a1626_65%)] p-6 text-center md:p-8">
                <div aria-hidden className="rb-noise pointer-events-none absolute inset-0 opacity-[0.1]" />
                <p className="rb-tabular font-heading relative bg-gradient-to-b from-white via-white/75 to-white/15 bg-clip-text text-6xl font-semibold tracking-tight text-transparent">
                  120+
                </p>
                <p className="relative mt-1 text-white/70">
                  real buyer questions per audit
                </p>
                <div className="relative mt-6 flex flex-wrap items-center justify-center gap-2">
                  {["5 providers", "Cited sources", "Share of voice"].map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white/60"
                    >
                      {chip}
                    </span>
                  ))}
                  <span aria-hidden className="h-7 w-16 rounded-full bg-white/[0.05]" />
                  <span aria-hidden className="h-7 w-12 rounded-full bg-white/[0.05]" />
                </div>
              </div>

              {/* Monitoring — trend chart */}
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] lg:col-span-2">
                <div className="relative px-2 pt-14">
                  <span className="absolute top-4 left-[31%] inline-flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-white/10 bg-[#161616] px-2.5 py-1 text-xs font-medium whitespace-nowrap text-white/80">
                    <span aria-hidden className="size-1.5 rounded-full bg-[#52a8ff]" />
                    Avg 62.4
                  </span>
                  <span className="absolute top-4 left-[69%] inline-flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-white/10 bg-[#161616] px-2.5 py-1 text-xs font-medium whitespace-nowrap text-white/80">
                    <span aria-hidden className="size-1.5 rounded-full bg-[#ff6166]" />
                    Low 41.2
                  </span>
                  <svg
                    viewBox="0 0 600 140"
                    className="h-36 w-full"
                    preserveAspectRatio="none"
                    aria-hidden
                  >
                    <defs>
                      <linearGradient id="rb-trend-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#52a8ff" stopOpacity="0.28" />
                        <stop offset="100%" stopColor="#52a8ff" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <line x1="186" y1="0" x2="186" y2="140" stroke="rgba(255,255,255,0.25)" strokeDasharray="2 4" />
                    <line x1="414" y1="0" x2="414" y2="140" stroke="rgba(255,255,255,0.25)" strokeDasharray="2 4" />
                    <path
                      d="M0,84 L20,80 40,86 60,78 80,82 100,74 120,78 140,70 160,74 186,62 210,66 230,54 250,60 270,48 290,56 310,50 330,62 350,58 370,72 390,80 414,96 435,90 455,98 475,88 495,92 515,82 535,86 555,76 575,80 600,68 L600,140 0,140 Z"
                      fill="url(#rb-trend-fill)"
                    />
                    <path
                      d="M0,84 L20,80 40,86 60,78 80,82 100,74 120,78 140,70 160,74 186,62 210,66 230,54 250,60 270,48 290,56 310,50 330,62 350,58 370,72 390,80 414,96 435,90 455,98 475,88 495,92 515,82 535,86 555,76 575,80 600,68"
                      fill="none"
                      stroke="#52a8ff"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div className="p-6 pt-4 md:p-8 md:pt-4">
                  <p className="font-mono text-[11px] tracking-[0.14em] text-white/35 uppercase">
                    Monitoring
                  </p>
                  <h3 className="font-heading mt-2 text-xl font-semibold tracking-tight">
                    Catch the moves that matter
                  </h3>
                  <p className="mt-1.5 max-w-md text-sm leading-relaxed text-white/50">
                    Scheduled re-scans chart your visibility across providers and
                    email you when it shifts.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="bg-background">
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="rb-eyebrow">How it works</p>
                <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Measurement you can defend
                </h2>
                <p className="mt-3 text-muted-foreground">
                  No black boxes. Every score decomposes across prompts and
                  providers, and every claim links to its evidence.
                </p>
              </div>
              <ol className="relative space-y-8 border-l border-border pl-8">
                {[
                  {
                    title: "We read your website",
                    body: "Category, audience and claims extracted from your public pages — you correct anything before the scan.",
                  },
                  {
                    title: "AI gets asked real buyer questions",
                    body: "Generated without your company name, so the measurement is never primed in your favour.",
                  },
                  {
                    title: "Every answer becomes evidence",
                    body: "Mentions, positions, citations and competitor patterns — scored into one number and a prioritized fix list.",
                  },
                ].map((step, index) => (
                  <li key={step.title} className="relative">
                    <span className="absolute top-0.5 -left-[41px] flex size-5 items-center justify-center rounded-full border border-border bg-card text-[10px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                      {index + 1}
                    </span>
                    <h3 className="text-base font-medium tracking-tight">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {step.body}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="plans" className="scroll-mt-20 border-y border-border bg-card">
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <div className="mx-auto max-w-2xl text-center">
              <p className="rb-eyebrow">Pricing</p>
              <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Start free. Scale when it matters.
              </h2>
              <p className="mt-3 text-muted-foreground">
                The free audit is the trial. Upgrade for more providers,
                monitoring, and the full evidence.
              </p>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {Object.values(PLAN_CONFIG).map((plan) => {
                const popular = plan.id === "founder";
                return (
                  <div
                    key={plan.id}
                    className={`rb-card-hover relative flex flex-col rounded-xl border bg-background p-6 ${
                      popular
                        ? "border-[color:var(--rb-accent)]/50 shadow-[0_0_0_1px_color-mix(in_srgb,var(--rb-accent)_35%,transparent),0_16px_48px_-24px_color-mix(in_srgb,var(--rb-accent)_45%,transparent)]"
                        : "border-border"
                    }`}
                  >
                    {popular ? (
                      <span className="absolute -top-2.5 left-5 rounded-full bg-[color:var(--rb-accent)] px-2.5 py-0.5 text-[11px] font-medium text-white">
                        Most popular
                      </span>
                    ) : null}
                    <p className="text-sm font-medium">{plan.name}</p>
                    <p className="rb-tabular mt-3 font-heading text-3xl font-semibold tracking-tight">
                      {plan.monthlyPriceUsd === 0 ? "$0" : `$${plan.monthlyPriceUsd}`}
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
                      className="mt-5"
                    >
                      {plan.id === "agency" ? (
                        <a href="mailto:kenesislabs@gmail.com?subject=RankedByAI%20Agency%20plan">
                          Contact us
                        </a>
                      ) : (
                        <Link
                          href={
                            plan.id === "free"
                              ? routes.login({ mode: "signup", returnTo: routes.newScan() })
                              : routes.billing({ plan: plan.id })
                          }
                        >
                          {plan.id === "free" ? "Run free audit" : "Get started"}
                        </Link>
                      )}
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
        <section className="bg-background">
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <div className="grid gap-12 lg:grid-cols-[0.9fr_1.3fr]">
              <div>
                <p className="rb-eyebrow">FAQ</p>
                <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Honest answers
                </h2>
                <p className="mt-3 text-muted-foreground">
                  What AI visibility measurement can — and cannot — tell you.
                </p>
              </div>
              <div className="divide-y divide-border">
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
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_120%,color-mix(in_srgb,var(--rb-accent)_35%,transparent),transparent_60%)]"
          />
          <div aria-hidden className="rb-noise pointer-events-none absolute inset-0 opacity-[0.12]" />
          <div className="relative mx-auto max-w-6xl px-4 py-24 text-center md:px-6 md:py-32">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/70">
              <Sparkles className="size-3" aria-hidden />
              Two minutes to your first report
            </p>
            <h2 className="font-heading mx-auto mt-6 max-w-2xl text-3xl font-semibold tracking-tight text-balance text-white md:text-5xl">
              Find out before your competitors do.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-white/55">
              Run a free AI visibility audit. No card needed — a shareable
              report in minutes.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="h-10 bg-white px-5 text-black shadow-none hover:bg-white/90"
              >
                <Link href={routes.publicScanAnchor}>
                  Start free audit
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-10 border-white/20 bg-transparent px-5 text-white hover:bg-white/10 hover:text-white"
              >
                <Link href={routes.methodology}>
                  Methodology
                  <ArrowUpRight data-icon="inline-end" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
