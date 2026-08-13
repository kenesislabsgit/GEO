import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Copy,
  Sparkles,
} from "lucide-react";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
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

/* ---------------------------------------------------- bento mini-visuals -- */

function MiniScore() {
  const parts = [
    { label: "Mentions", pct: 72 },
    { label: "Position", pct: 55 },
    { label: "Sentiment", pct: 84 },
  ];
  return (
    <div className="mt-5 space-y-2.5">
      <p className="rb-tabular font-heading text-4xl font-semibold tracking-tight">
        62<span className="text-muted-foreground">.4</span>
      </p>
      {parts.map((part) => (
        <div key={part.label} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-[11px] text-muted-foreground">
            {part.label}
          </span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-[color:var(--rb-blue)]"
              style={{ width: `${part.pct}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

function MiniShareOfVoice() {
  const rows = [
    { name: "Northstar", pct: 86, you: false },
    { name: "You", pct: 41, you: true },
    { name: "Metricly", pct: 33, you: false },
  ];
  return (
    <div className="mt-5 space-y-2.5">
      {rows.map((row) => (
        <div key={row.name} className="flex items-center gap-3">
          <span
            className={`w-20 shrink-0 truncate text-[11px] ${row.you ? "font-semibold text-foreground" : "text-muted-foreground"}`}
          >
            {row.name}
          </span>
          <span className="h-4 flex-1 overflow-hidden rounded-sm bg-muted">
            <span
              className={`block h-full rounded-sm ${row.you ? "bg-[color:var(--rb-blue)]" : "bg-[color:var(--rb-slate)]/40"}`}
              style={{ width: `${row.pct}%` }}
            />
          </span>
          <span className="rb-tabular w-8 text-right text-[11px] text-muted-foreground">
            {row.pct}%
          </span>
        </div>
      ))}
    </div>
  );
}

function MiniCitations() {
  const rows = [
    { domain: "g2.com", count: 7, you: false },
    { domain: "reddit.com", count: 5, you: false },
    { domain: "yourdocs.com", count: 2, you: true },
  ];
  return (
    <div className="mt-5 divide-y divide-border border-y border-border">
      {rows.map((row) => (
        <div key={row.domain} className="flex items-center justify-between py-2">
          <span className="font-mono text-xs">{row.domain}</span>
          <span className="text-[11px] text-muted-foreground">
            cited {row.count}×{row.you ? " · you" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function MiniPrompt() {
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-border bg-[color:var(--rb-mist)]">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-[10px] text-muted-foreground">
          master-prompt.md
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium">
          <Copy className="size-2.5" aria-hidden /> Copy
        </span>
      </div>
      <div className="space-y-1.5 px-3 py-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        <p>## Fix 1: Add a comparison page</p>
        <p>Buyer questions currently lost:</p>
        <p className="text-foreground">
          &ldquo;Best analytics platforms…&rdquo; — lost to Northstar
        </p>
        <p>Paste into Cursor / Claude Code ↵</p>
      </div>
    </div>
  );
}

function MiniAlert() {
  return (
    <div className="mt-5 space-y-2">
      <svg viewBox="0 0 200 44" className="h-11 w-full" aria-hidden>
        <polyline
          points="0,34 28,30 56,32 84,24 112,26 140,16 168,18 200,8"
          fill="none"
          stroke="var(--rb-blue)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <Bell className="size-3.5 text-[color:var(--rb-blue)]" aria-hidden />
        <span className="text-xs">
          Visibility up{" "}
          <span className="font-semibold text-[color:var(--rb-green)]">+6.2</span>{" "}
          after Tuesday&rsquo;s scan
        </span>
      </div>
    </div>
  );
}

const BENTO = [
  {
    title: "Every answer, on the record",
    body: "Real buyer questions asked through provider APIs — each answer stored with who was recommended and why.",
    visual: (
      <div className="mt-5 space-y-2">
        {[
          ["Best analytics platforms for startups?", "Mentioned #2", true],
          ["Alternatives to the category leader?", "Absent", false],
        ].map(([q, status, ok]) => (
          <div
            key={String(q)}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <span className="truncate text-xs">{q}</span>
            <span
              className={`shrink-0 text-[11px] font-medium ${ok ? "text-[color:var(--rb-green)]" : "text-muted-foreground"}`}
            >
              {status}
            </span>
          </div>
        ))}
      </div>
    ),
    wide: true,
  },
  {
    title: "A score you can defend",
    body: "Mentions, position and sentiment — decomposed, never a black box.",
    visual: <MiniScore />,
    wide: false,
  },
  {
    title: "Share of voice",
    body: "Who owns the answers in your category, measured — including you.",
    visual: <MiniShareOfVoice />,
    wide: false,
  },
  {
    title: "Citation intelligence",
    body: "The exact pages that taught AI who to recommend — and where you're missing.",
    visual: <MiniCitations />,
    wide: false,
  },
  {
    title: "An action plan your AI tool can run",
    body: "Every fix with its evidence, compiled into one prompt you paste into Cursor or Claude Code.",
    visual: <MiniPrompt />,
    wide: false,
  },
  {
    title: "Monitoring that emails you",
    body: "Scheduled re-scans track the trend; alerts fire when your visibility moves.",
    visual: <MiniAlert />,
    wide: true,
  },
] as const;

/* ----------------------------------------------------------------- page -- */

export default function HomePage() {
  return (
    <>
      <div className="rb-atmosphere relative overflow-hidden">
        <div
          aria-hidden
          className="rb-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_70%_50%_at_50%_0%,black,transparent)]"
        />
        <SiteHeader />

        <main className="relative">
          {/* Hero */}
          <section className="relative">
            <div className="mx-auto max-w-6xl px-4 pt-16 pb-8 md:px-6 md:pt-24 md:pb-10">
              <div className="mx-auto max-w-3xl text-center">
                <p className="rb-fade-up inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                  <span aria-hidden className="size-1.5 rounded-full bg-[color:var(--rb-green)]" />
                  Measured from real provider APIs — never simulated
                </p>

                <h1 className="rb-fade-up rb-fade-up-delay-1 rb-gradient-text font-heading mt-7 text-[2.6rem] leading-[1.02] font-semibold tracking-[-0.03em] text-balance sm:text-6xl md:text-[4.25rem]">
                  Does AI recommend your company?
                </h1>

                <p className="rb-fade-up rb-fade-up-delay-2 mx-auto mt-5 max-w-xl text-base text-pretty text-muted-foreground md:text-lg">
                  Buyers ask ChatGPT before they ask Google. See what it answers,
                  which competitors it names instead of you, and exactly what to
                  change.
                </p>

                <div className="rb-fade-up rb-fade-up-delay-3 mt-8 flex flex-wrap items-center justify-center gap-3">
                  <Button asChild size="lg" className="h-10 px-5">
                    <Link href={routes.publicScanAnchor}>
                      Run your free audit
                      <ArrowRight data-icon="inline-end" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="h-10 px-5">
                    <Link href={routes.methodology}>How it&rsquo;s measured</Link>
                  </Button>
                </div>
                <p className="rb-fade-up rb-fade-up-delay-3 mt-3 text-xs text-muted-foreground">
                  Free account · no card · report in ~2 minutes
                </p>
              </div>
            </div>

            <div className="relative px-3 pb-10 md:px-6 md:pb-14">
              <div className="[mask-image:linear-gradient(to_bottom,black_78%,transparent)]">
                <ProductStage />
              </div>
            </div>

            {/* Provider strip */}
            <div className="mx-auto max-w-6xl px-4 pb-16 md:px-6">
              <p className="text-center text-xs text-muted-foreground">
                Answers measured across
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 font-mono text-sm tracking-wide text-muted-foreground/70">
                <span>OpenAI</span>
                <span>Claude</span>
                <span>Llama</span>
                <span>Mistral</span>
                <span>Nova</span>
              </div>
            </div>
          </section>
        </main>
      </div>

      <main>
        {/* Bento */}
        <section className="border-y border-border bg-card">
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <div className="max-w-2xl">
              <p className="rb-eyebrow">The report</p>
              <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Evidence, not vibes
              </h2>
              <p className="mt-3 text-muted-foreground">
                Everything below ships in every paid report — and the free audit
                is a real slice of it.
              </p>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {BENTO.map((item) => (
                <div
                  key={item.title}
                  className={`rb-panel rb-card-hover flex flex-col p-5 ${item.wide ? "lg:col-span-2" : ""}`}
                >
                  <h3 className="text-sm font-semibold tracking-tight">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                  <div className="mt-auto">{item.visual}</div>
                </div>
              ))}
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
                        ? "border-[color:var(--rb-blue)]/50 shadow-[0_0_0_1px_color-mix(in_srgb,var(--rb-blue)_35%,transparent),0_16px_48px_-24px_color-mix(in_srgb,var(--rb-blue)_45%,transparent)]"
                        : "border-border"
                    }`}
                  >
                    {popular ? (
                      <span className="absolute -top-2.5 left-5 rounded-full bg-[color:var(--rb-blue)] px-2.5 py-0.5 text-[11px] font-medium text-white">
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
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_120%,color-mix(in_srgb,var(--rb-blue)_35%,transparent),transparent_60%)]"
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
