import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Check, Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { JsonLd } from "@/components/site/json-ld";
import { Reveal } from "@/components/site/reveal";
import { ProviderLogo } from "@/components/providers/provider-logo";
import { Button } from "@/components/ui/button";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import {
  APP_NAME,
  APP_TAGLINE,
  DEFAULT_SCAN_PROVIDERS,
  providerDisplayName,
} from "@/lib/constants";
import { routes } from "@/lib/routes";

export const metadata = {
  alternates: { canonical: "/" },
};

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const faqs = [
  {
    q: "Is this the same as ChatGPT or Perplexity.com?",
    a: "No. We query provider APIs and label the exact provider used. The free audit uses ChatGPT with web search; paid audits compare the same questions across multiple providers.",
  },
  {
    q: "Can results change between runs?",
    a: "Yes. AI answers are non-deterministic. Every report stores methodology version, timestamp, models, and sample size so results stay comparable in context.",
  },
  {
    q: "Do free scans require an account?",
    a: "Yes - a free account, no card. Sign up, run your free audit, and your report is saved to your dashboard so you can come back to it any time.",
  },
  {
    q: "Do you guarantee ranking improvements?",
    a: "No - and you should distrust anyone who does. The action centre gives evidence-based, directional recommendations tied to exact prompts and sources.",
  },
];

/** Inline stagger for children inside a <Reveal>. */
function delayStyle(ms: number): CSSProperties {
  return { "--rb-delay": `${ms}ms` } as CSSProperties;
}

/* ------------------------------------------------ the shift: AI answer -- */

/**
 * A stylized AI answer: the buyer's question, the two or three products the
 * model names, and the row that hurts - your brand, absent. Illustrative,
 * clearly labelled as an example.
 */
function AnswerCard() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div aria-hidden className="rb-glow absolute -inset-x-12 inset-y-0" />
      <div className="relative overflow-hidden rounded-xl border border-border bg-background shadow-[0_24px_64px_-32px_rgba(0,0,0,0.35)]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <ProviderLogo provider="openai" className="size-4" />
            ChatGPT
          </span>
          <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
            Example answer
          </span>
        </div>
        <div className="space-y-4 p-4 md:p-5">
          <div
            className="rb-rise ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm bg-card px-3.5 py-2.5 text-sm"
            style={delayStyle(150)}
          >
            What&rsquo;s the best analytics tool for an early-stage startup?
          </div>
          <div className="space-y-2">
            {[
              { name: "Northstar", note: "recommended first" },
              { name: "Beacon", note: "runner up" },
              { name: "Metricly", note: "budget pick" },
            ].map((item, index) => (
              <div
                key={item.name}
                className="rb-rise flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5"
                style={delayStyle(300 + index * 90)}
              >
                <span className="rb-tabular flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-semibold">
                  {index + 1}
                </span>
                <span className="text-sm font-medium">{item.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {item.note}
                </span>
              </div>
            ))}
            <div
              className="rb-rise flex items-center gap-3 rounded-lg border border-dashed border-foreground/25 px-3.5 py-2.5"
              style={delayStyle(620)}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-foreground/25 text-[10px] font-semibold text-muted-foreground">
                ?
              </span>
              <span className="text-sm font-medium text-muted-foreground">
                Your brand
              </span>
              <span className="rb-pulse-soft ml-auto rounded-full bg-[#ff6166]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#d6453f]">
                Not mentioned
              </span>
            </div>
          </div>
          <div
            className="rb-rise flex flex-wrap items-center gap-2 border-t border-border pt-3"
            style={delayStyle(760)}
          >
            <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
              Cited
            </span>
            {["northstar.com", "g2.com", "reddit.com"].map((source) => (
              <span
                key={source}
                className="rounded-full border border-border bg-card px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                {source}
              </span>
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
    <span
      aria-hidden
      className={`pointer-events-none absolute z-10 text-foreground/30 ${className}`}
    >
      <span className="absolute -left-2 top-0 h-px w-4 bg-current" />
      <span className="absolute -top-2 left-0 h-4 w-px bg-current" />
    </span>
  );
}

/**
 * The hero's technical frame, as a non-interactive overlay: the max-w-6xl
 * guide rails plus corner registration marks, laid over a section without
 * touching its layout. `tone="dark"` is for ink sections.
 */
function SectionFrame({ tone = "light" }: { tone?: "light" | "dark" }) {
  const rail = tone === "dark" ? "border-white/10" : "border-border";
  const mark = tone === "dark" ? "text-white/25" : "";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      <div
        className={`absolute inset-y-0 left-1/2 w-full max-w-6xl -translate-x-1/2 border-x ${rail}`}
      >
        <Cross className={`top-0 left-0 ${mark}`} />
        <Cross className={`top-0 right-0 ${mark}`} />
        <Cross className={`bottom-0 left-0 ${mark}`} />
        <Cross className={`bottom-0 right-0 ${mark}`} />
      </div>
    </div>
  );
}

/* -------------------------------------------------- feature mini-visuals -- */

/** Green check bullet for feature lists. */
function CheckItem({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
}) {
  return (
    <li className="rb-rise flex items-start gap-3" style={delayStyle(delay)}>
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#3ecf7a]">
        <Check className="size-3 text-white" strokeWidth={3} aria-hidden />
      </span>
      <span className="text-sm md:text-[15px]">{children}</span>
    </li>
  );
}

/** Tall azure panel the feature mockups float on. */
function VisualTile({ children }: { children: ReactNode }) {
  return (
    <div className="rb-feature-tile relative flex items-center justify-center overflow-hidden rounded-3xl border border-black/[0.04] px-5 py-12 sm:px-10 md:min-h-[540px] md:py-16 dark:border-white/10">
      <div className="relative w-full max-w-md">{children}</div>
    </div>
  );
}

/** Small pill floating over a feature mockup, TxtCart-style. */
function FloatChip({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return (
    <span
      className={`rb-float absolute z-10 inline-flex items-center gap-1.5 rounded-full border border-black/[0.05] bg-card px-3 py-1.5 text-xs font-medium shadow-[0_12px_32px_-12px_rgba(23,58,110,0.45)] dark:border-white/10 ${className}`}
    >
      {children}
    </span>
  );
}

/** Share of voice: who wins the answers in your category. */
function ShareOfVoicePanel() {
  const rows = [
    { name: "Northstar", value: 46, tone: "bg-[#52a8ff]" },
    { name: "You", value: 34, tone: "bg-[color:var(--rb-accent)]", you: true },
    { name: "Beacon", value: 12, tone: "bg-[#ff6ea9]" },
    { name: "Everyone else", value: 8, tone: "bg-foreground/20" },
  ];
  return (
    <div className="relative">
      <FloatChip className="-top-4 -right-2 sm:-right-6">
        <span aria-hidden className="size-1.5 rounded-full bg-[#3ecf7a]" />
        You, up 6 pts
      </FloatChip>
      <div className="rounded-2xl border border-black/[0.04] bg-card p-6 shadow-[0_32px_64px_-28px_rgba(23,58,110,0.4)] md:p-7 dark:border-white/10">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          Share of voice
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          20 questions · 10 AIs
        </p>
      </div>
      <div className="mt-5 space-y-4">
        {rows.map((row, index) => (
          <div key={row.name} className="rb-rise" style={delayStyle(index * 90)}>
            <div className="flex items-baseline justify-between text-sm">
              <span className={row.you ? "font-semibold" : "text-muted-foreground"}>
                {row.name}
              </span>
              <span className="rb-tabular font-medium">{row.value}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
              <div
                className={`rb-grow-x h-full rounded-full ${row.tone}`}
                style={{
                  width: `${row.value}%`,
                  ...delayStyle(200 + index * 120),
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs text-muted-foreground">
        Broken down per question, per provider, per market.
      </p>
      </div>
    </div>
  );
}

/** Action centre: the prioritized fix list a report turns into. */
function ActionListPanel() {
  const actions = [
    {
      title: "Publish a comparison page vs Northstar",
      why: "Named in 8 answers you lost",
      priority: "High",
    },
    {
      title: "Get listed in the G2 analytics roundup",
      why: "Cited by 3 of 10 providers",
      priority: "High",
    },
    {
      title: "Add pricing to your public site",
      why: "Models skip brands that hide pricing",
      priority: "Medium",
    },
  ];
  return (
    <div className="relative">
      <FloatChip className="-top-4 -left-2 sm:-left-6">
        <Check className="size-3 text-[#3ecf7a]" strokeWidth={3} aria-hidden />
        2 shipped this week
      </FloatChip>
      <div className="rounded-2xl border border-black/[0.04] bg-card p-6 shadow-[0_32px_64px_-28px_rgba(23,58,110,0.4)] md:p-7 dark:border-white/10">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          Action centre
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">3 open</p>
      </div>
      <div className="mt-5 space-y-3">
        {actions.map((action, index) => (
          <div
            key={action.title}
            className="rb-rise flex items-start gap-3 rounded-lg border border-border bg-card px-3.5 py-3"
            style={delayStyle(150 + index * 130)}
          >
            <span
              aria-hidden
              className="mt-0.5 size-4 shrink-0 rounded border border-foreground/25"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">{action.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{action.why}</p>
            </div>
            <span
              className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                action.priority === "High"
                  ? "bg-[#ff6166]/10 text-[#d6453f]"
                  : "bg-[#52a8ff]/10 text-[#2f7fd6]"
              }`}
            >
              {action.priority}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs text-muted-foreground">
        Each fix is tied to the exact prompts and sources behind it.
      </p>
      </div>
    </div>
  );
}

/** Evidence trail: the stored answer with the mention and its citations. */
function EvidencePanel() {
  return (
    <div className="relative">
      <FloatChip className="-top-4 -right-2 sm:-right-6">
        <span aria-hidden className="size-1.5 rounded-full bg-[color:var(--rb-accent)]" />
        Saved word for word
      </FloatChip>
      <div className="rounded-2xl border border-black/[0.04] bg-card p-6 shadow-[0_32px_64px_-28px_rgba(23,58,110,0.4)] md:p-7 dark:border-white/10">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          Evidence
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          Stored per answer
        </p>
      </div>
      <div className="mt-5 rounded-lg border border-border bg-card p-4">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ProviderLogo provider="claude" className="size-3.5" />
          Claude · &ldquo;Affordable product analytics options?&rdquo;
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          &ldquo;For smaller teams,{" "}
          <mark className="rb-highlight-sweep rounded bg-transparent px-1 py-0.5 font-medium text-foreground">
            your brand
          </mark>{" "}
          is a strong option alongside Northstar, with simpler setup and
          transparent pricing&hellip;&rdquo;
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {["Mentioned", "Position #2", "2 citations"].map((chip, index) => (
            <span
              key={chip}
              className="rb-rise rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground"
              style={delayStyle(600 + index * 120)}
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-5 text-xs text-muted-foreground">
        Every claim in your score links back to an answer like this one.
      </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------- bento mini-visuals -- */

// Only providers the audit engine genuinely asks.
const PROVIDER_PILLS = [
  { name: "ChatGPT", provider: "openai", className: "top-[4%] left-[10%] opacity-50" },
  { name: "Claude", className: "top-[13%] right-[12%]" },
  { name: "Gemini", className: "top-[28%] left-[22%]" },
  { name: "Perplexity", className: "top-[44%] left-[6%] opacity-50" },
  { name: "Grok", className: "top-[40%] right-[10%]" },
  { name: "DeepSeek", className: "top-[58%] left-[28%]" },
  { name: "Llama", className: "top-[56%] right-[24%] opacity-50" },
  { name: "Mistral", className: "top-[72%] left-[10%]" },
  { name: "Kimi", className: "top-[74%] right-[8%]" },
  { name: "Nova", className: "top-[88%] right-[26%] opacity-50" },
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
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${appUrl}/#organization`,
              name: APP_NAME,
              url: appUrl,
              description:
                "AI visibility monitoring: measures whether AI answer engines like ChatGPT, Claude, and Gemini mention and recommend your brand.",
            },
            {
              "@type": "WebSite",
              "@id": `${appUrl}/#website`,
              name: APP_NAME,
              url: appUrl,
              publisher: { "@id": `${appUrl}/#organization` },
            },
            {
              "@type": "SoftwareApplication",
              name: APP_NAME,
              url: appUrl,
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web",
              description: `${APP_TAGLINE} Sampled AI visibility reports across ChatGPT, Claude, Gemini and more, with mention rate, position, and cited sources.`,
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
                description: "Free AI visibility audit - no card required.",
              },
              publisher: { "@id": `${appUrl}/#organization` },
            },
            {
              "@type": "FAQPage",
              mainEntity: faqs.map((faq) => ({
                "@type": "Question",
                name: faq.q,
                acceptedAnswer: { "@type": "Answer", text: faq.a },
              })),
            },
          ],
        }}
      />
      <SiteHeader />

      <main>
        {/* Hero - editorial blueprint */}
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
                  Measured from real provider APIs - never simulated
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
                  <Button asChild size="lg" className="group h-11 rounded-none px-6">
                    <Link href={routes.freeAuditSignup}>
                      Run your free audit
                      <ArrowRight
                        data-icon="inline-end"
                        className="transition-transform duration-200 group-hover:translate-x-0.5"
                      />
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

        {/* The shift - why AI answers decide who gets found */}
        <section className="relative overflow-hidden border-b border-border">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-80 dark:opacity-30"
            style={{
              background:
                "radial-gradient(ellipse 40% 50% at 18% 10%, rgba(127,178,255,0.35), transparent 70%), radial-gradient(ellipse 35% 45% at 85% 25%, rgba(255,173,198,0.3), transparent 70%), radial-gradient(ellipse 40% 50% at 50% 95%, rgba(255,217,138,0.3), transparent 70%)",
            }}
          />
          <SectionFrame />

          <div className="relative mx-auto max-w-6xl px-4 pt-16 md:px-6 md:pt-24">
            <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
              <Reveal direction="left">
                <p className="rb-eyebrow">The shift</p>
                <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  AI doesn&rsquo;t give ten links. It names two or three products.
                </h2>
                <p className="mt-4 max-w-lg text-muted-foreground">
                  When a buyer asks ChatGPT or Perplexity what to use, the answer
                  is a short list of names and a citation or two. There is no page
                  two. If your brand isn&rsquo;t in that list, the buyer moves on
                  without ever knowing you exist - and you can&rsquo;t see it
                  happening.
                </p>
                <div className="mt-8 grid grid-cols-3 divide-x divide-border border-y border-border">
                  {[
                    ["1", "answer, not 10 links"],
                    ["2-3", "brands named per answer"],
                    ["0", "clicks if you're absent"],
                  ].map(([stat, label], index) => (
                    <div
                      key={label}
                      className="rb-rise px-4 py-4 first:pl-0"
                      style={delayStyle(200 + index * 100)}
                    >
                      <p className="rb-tabular font-heading text-2xl font-semibold tracking-tight md:text-3xl">
                        {stat}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-6 text-sm text-muted-foreground">
                  {APP_NAME} asks those buyer questions for you, across every
                  major model, and shows you exactly where you stand.
                </p>
              </Reveal>
              <Reveal direction="right" delay={120}>
                <AnswerCard />
              </Reveal>
            </div>
          </div>

          {/* Provider strip */}
          <Reveal className="relative mx-auto max-w-6xl px-4 pt-16 pb-14 md:px-6">
            <p className="text-center text-xs text-muted-foreground">
              Answers measured across
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-sm tracking-wide text-muted-foreground/70">
              {DEFAULT_SCAN_PROVIDERS.map((id, index) => (
                <span
                  key={id}
                  className="rb-rise inline-flex items-center gap-2"
                  style={delayStyle(index * 60)}
                >
                  <ProviderLogo provider={id} />
                  {providerDisplayName(id)}
                </span>
              ))}
            </div>
          </Reveal>
        </section>
        {/* Bento - dark evidence grid */}
        <section className="relative overflow-hidden bg-[color:var(--rb-ink)] text-white">
          <div aria-hidden className="rb-noise pointer-events-none absolute inset-0 opacity-[0.08]" />
          <SectionFrame tone="dark" />
          <div className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <Reveal className="max-w-2xl">
              <p className="font-mono text-[11px] tracking-[0.14em] text-white/40 uppercase">
                The report
              </p>
              <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Evidence, not vibes
              </h2>
              <p className="mt-3 text-white/50">
                Everything below ships in every paid report - and the free audit
                is a real slice of it.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {/* Visibility score - stat + bars */}
              <Reveal className="lg:col-span-2">
              <div className="relative h-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
                <p className="font-mono text-[11px] tracking-[0.14em] text-white/35 uppercase">
                  Visibility score
                </p>
                <h3 className="font-heading mt-2 text-xl font-semibold tracking-tight">
                  A score that moves when you do
                </h3>
                <p className="mt-1.5 max-w-md text-sm leading-relaxed text-white/50">
                  Mentions, position and evidence quality compiled into one number - 
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
                      className={`rb-grow-y flex-1 rounded-full ${i < 25 ? "bg-[#52a8ff]" : "bg-[#52a8ff]/15"}`}
                      style={delayStyle(200 + i * 18)}
                    />
                  ))}
                </div>
              </div>
              </Reveal>

              {/* Citations - glowing source map */}
              <Reveal delay={100} className="lg:row-span-2">
              <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="relative min-h-56 flex-1">
                  <div
                    aria-hidden
                    className="rb-grid-dark absolute inset-0 [mask-image:radial-gradient(ellipse_95%_95%_at_55%_40%,black,transparent_78%)]"
                  />
                  {SOURCE_DOTS.map((dot, i) => (
                    <span
                      key={i}
                      aria-hidden
                      className={`rb-pulse-dot absolute size-1.5 rounded-full ${dot.className}`}
                      style={delayStyle(i * 700)}
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
                    The exact pages that taught each model who to recommend -
                    mapped across the open web, including where you&rsquo;re missing.
                  </p>
                </div>
              </div>
              </Reveal>

              {/* Providers - floating pills */}
              <Reveal delay={150} className="lg:row-span-2">
              <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="relative min-h-72 flex-1">
                  {PROVIDER_PILLS.map((pill, index) => (
                    <span
                      key={pill.name}
                      className={`rb-drift absolute inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-sm text-white/70 ${pill.className}`}
                      style={delayStyle(index * 550)}
                    >
                      <ProviderLogo
                        provider={
                          "provider" in pill
                            ? pill.provider
                            : pill.name.toLowerCase()
                        }
                        className="size-3.5"
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
                    The same buyer questions asked across ChatGPT, Claude, Gemini
                    and more - answers compared side by side.
                  </p>
                </div>
              </div>
              </Reveal>

              {/* Big stat card */}
              <Reveal delay={100}>
              <div className="relative h-full overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_130%_100%_at_50%_-20%,#173a5e,#0a1626_65%)] p-6 text-center md:p-8">
                <div aria-hidden className="rb-noise pointer-events-none absolute inset-0 opacity-[0.1]" />
                <p className="rb-tabular font-heading relative bg-gradient-to-b from-white via-white/75 to-white/15 bg-clip-text text-6xl font-semibold tracking-tight text-transparent">
                  200
                </p>
                <p className="relative mt-1 text-white/70">
                  provider answers per Pro+ audit - 20 questions × 10 AIs
                </p>
                <div className="relative mt-6 flex flex-wrap items-center justify-center gap-2">
                  {["13 AI providers", "Cited sources", "Share of voice"].map((chip) => (
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
              </Reveal>

              {/* Monitoring - trend chart */}
              <Reveal delay={150} className="lg:col-span-2">
              <div className="relative h-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="relative px-2 pt-14">
                  <span
                    className="rb-fade-late absolute top-4 left-[31%] inline-flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-white/10 bg-[#161616] px-2.5 py-1 text-xs font-medium whitespace-nowrap text-white/80"
                    style={delayStyle(900)}
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-[#52a8ff]" />
                    Avg 62.4
                  </span>
                  <span
                    className="rb-fade-late absolute top-4 left-[69%] inline-flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-white/10 bg-[#161616] px-2.5 py-1 text-xs font-medium whitespace-nowrap text-white/80"
                    style={delayStyle(1100)}
                  >
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
                    <line className="rb-fade-late" x1="186" y1="0" x2="186" y2="140" stroke="rgba(255,255,255,0.25)" strokeDasharray="2 4" />
                    <line className="rb-fade-late" x1="414" y1="0" x2="414" y2="140" stroke="rgba(255,255,255,0.25)" strokeDasharray="2 4" />
                    <path
                      className="rb-fade-late"
                      d="M0,84 L20,80 40,86 60,78 80,82 100,74 120,78 140,70 160,74 186,62 210,66 230,54 250,60 270,48 290,56 310,50 330,62 350,58 370,72 390,80 414,96 435,90 455,98 475,88 495,92 515,82 535,86 555,76 575,80 600,68 L600,140 0,140 Z"
                      fill="url(#rb-trend-fill)"
                    />
                    <path
                      className="rb-draw"
                      pathLength={1}
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
              </Reveal>
            </div>
          </div>
        </section>

        <div aria-hidden className="rb-hatch h-8 border-b border-border" />

        {/* What you get - the report turned into moves */}
        <section className="relative bg-background">
          <SectionFrame />
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <Reveal className="max-w-2xl">
              <p className="rb-eyebrow">What you get</p>
              <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                From a score to a plan
              </h2>
              <p className="mt-3 text-muted-foreground">
                The report tells you where you stand. The dashboard turns it
                into who is beating you, what to fix first, and the proof
                behind every number.
              </p>
            </Reveal>

            <div className="mt-14 space-y-20 md:space-y-28">
              <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                <Reveal direction="right" delay={120} className="lg:order-2">
                  <span className="inline-flex rounded-full border border-border bg-background px-3.5 py-1.5 text-sm font-medium shadow-sm">
                    Competitors
                  </span>
                  <h3 className="font-heading mt-5 max-w-md text-3xl font-semibold tracking-tight md:text-4xl">
                    See who wins each question
                  </h3>
                  <p className="mt-4 max-w-md text-muted-foreground">
                    Every audit tallies which brands AI names in your category
                    and how often it&rsquo;s you, so you know exactly who
                    you&rsquo;re losing buyers to.
                  </p>
                  <ul className="mt-6 space-y-3.5">
                    <CheckItem delay={200}>
                      Share of voice against every rival
                    </CheckItem>
                    <CheckItem delay={300}>
                      Question-by-question breakdown
                    </CheckItem>
                    <CheckItem delay={400}>
                      Split by provider and by market
                    </CheckItem>
                  </ul>
                </Reveal>
                <Reveal direction="left" className="lg:order-1">
                  <VisualTile>
                    <ShareOfVoicePanel />
                  </VisualTile>
                </Reveal>
              </div>

              <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                <Reveal direction="left" delay={120}>
                  <span className="inline-flex rounded-full border border-border bg-background px-3.5 py-1.5 text-sm font-medium shadow-sm">
                    Website improvements
                  </span>
                  <h3 className="font-heading mt-5 max-w-md text-3xl font-semibold tracking-tight md:text-4xl">
                    Leave with a fix list, not a grade
                  </h3>
                  <p className="mt-4 max-w-md text-muted-foreground">
                    The action centre reads your results and writes the to-do
                    list, prioritized by how many answers each fix can move.
                  </p>
                  <ul className="mt-6 space-y-3.5">
                    <CheckItem delay={200}>
                      Pages to publish, ranked by impact
                    </CheckItem>
                    <CheckItem delay={300}>
                      Sources worth getting cited on
                    </CheckItem>
                    <CheckItem delay={400}>
                      Every fix tied to its exact prompts
                    </CheckItem>
                  </ul>
                </Reveal>
                <Reveal direction="right">
                  <VisualTile>
                    <ActionListPanel />
                  </VisualTile>
                </Reveal>
              </div>

              <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                <Reveal direction="right" delay={120} className="lg:order-2">
                  <span className="inline-flex rounded-full border border-border bg-background px-3.5 py-1.5 text-sm font-medium shadow-sm">
                    Answers, kept
                  </span>
                  <h3 className="font-heading mt-5 max-w-md text-3xl font-semibold tracking-tight md:text-4xl">
                    Proof you can show your team
                  </h3>
                  <p className="mt-4 max-w-md text-muted-foreground">
                    Every answer is stored word for word. When the score moves,
                    you can open the exact answers that moved it.
                  </p>
                  <ul className="mt-6 space-y-3.5">
                    <CheckItem delay={200}>
                      Full answer text, kept per scan
                    </CheckItem>
                    <CheckItem delay={300}>
                      Provider, position, and mention flagged
                    </CheckItem>
                    <CheckItem delay={400}>
                      Citations linked to their source pages
                    </CheckItem>
                  </ul>
                </Reveal>
                <Reveal direction="left" className="lg:order-1">
                  <VisualTile>
                    <EvidencePanel />
                  </VisualTile>
                </Reveal>
              </div>
            </div>
          </div>
        </section>

        <div aria-hidden className="rb-hatch h-8 border-y border-border" />

        {/* How it works */}
        <section className="relative bg-background">
          <SectionFrame />
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
              <Reveal direction="left">
                <p className="rb-eyebrow">How it works</p>
                <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Measurement you can defend
                </h2>
                <p className="mt-3 text-muted-foreground">
                  No black boxes. Every score decomposes across prompts and
                  providers, and every claim links to its evidence.
                </p>
              </Reveal>
              <Reveal delay={120}>
              <ol className="relative space-y-8 border-l border-border pl-8">
                {[
                  {
                    title: "We read your website",
                    body: "Category, audience and claims extracted from your public pages - you correct anything before the scan.",
                  },
                  {
                    title: "AI gets asked real buyer questions",
                    body: "Generated without your company name, so the measurement is never primed in your favour.",
                  },
                  {
                    title: "Every answer becomes evidence",
                    body: "Mentions, positions, citations and competitor patterns - scored into one number and a prioritized fix list.",
                  },
                ].map((step, index) => (
                  <li
                    key={step.title}
                    className="rb-rise relative"
                    style={delayStyle(index * 160)}
                  >
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
              </Reveal>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="plans" className="relative scroll-mt-20 border-y border-border bg-card">
          <SectionFrame />
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <Reveal className="mx-auto max-w-2xl text-center">
              <p className="rb-eyebrow">Pricing</p>
              <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Start free. Scale when it matters.
              </h2>
              <p className="mt-3 text-muted-foreground">
                The free audit is the trial. Upgrade for more providers,
                monitoring, and the full evidence.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {Object.values(PLAN_CONFIG).map((plan, index) => {
                const popular = plan.id === "founder";
                return (
                  <Reveal key={plan.id} delay={index * 90}>
                  <div
                    className={`rb-card-hover relative flex h-full flex-col rounded-xl border bg-background p-6 ${
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
                  </Reveal>
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
        <section className="relative bg-background">
          <SectionFrame />
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <div className="grid gap-12 lg:grid-cols-[0.9fr_1.3fr]">
              <Reveal direction="left">
                <p className="rb-eyebrow">FAQ</p>
                <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  Honest answers
                </h2>
                <p className="mt-3 text-muted-foreground">
                  What AI visibility measurement can - and cannot - tell you.
                </p>
              </Reveal>
              <Reveal delay={120} className="divide-y divide-border">
                {faqs.map((faq, index) => (
                  <div
                    key={faq.q}
                    className="rb-rise py-6 first:pt-0 last:pb-0"
                    style={delayStyle(index * 110)}
                  >
                    <h3 className="font-medium tracking-tight">{faq.q}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {faq.a}
                    </p>
                  </div>
                ))}
              </Reveal>
            </div>
          </div>
        </section>

        <div aria-hidden className="rb-hatch h-8 border-t border-border" />

        {/* Final CTA */}
        <section className="relative overflow-hidden bg-[color:var(--rb-ink)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_120%,color-mix(in_srgb,var(--rb-accent)_35%,transparent),transparent_60%)]"
          />
          <div aria-hidden className="rb-noise pointer-events-none absolute inset-0 opacity-[0.12]" />
          <SectionFrame tone="dark" />
          <Reveal className="relative mx-auto max-w-6xl px-4 py-24 text-center md:px-6 md:py-32">
            <p className="rb-rise inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/70">
              <Sparkles className="rb-pulse-soft size-3" aria-hidden />
              Two minutes to your first report
            </p>
            <h2
              className="rb-rise font-heading mx-auto mt-6 max-w-2xl text-3xl font-semibold tracking-tight text-balance text-white md:text-5xl"
              style={delayStyle(100)}
            >
              Find out before your competitors do.
            </h2>
            <p
              className="rb-rise mx-auto mt-4 max-w-lg text-white/55"
              style={delayStyle(200)}
            >
              Run a free AI visibility audit. No card needed - a shareable
              report in minutes.
            </p>
            <div
              className="rb-rise mt-9 flex flex-wrap items-center justify-center gap-3"
              style={delayStyle(300)}
            >
              <Button
                asChild
                size="lg"
                className="group h-10 bg-white px-5 text-black shadow-none hover:bg-white/90"
              >
                <Link href={routes.freeAuditSignup}>
                  Start free audit
                  <ArrowRight
                    data-icon="inline-end"
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
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
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
