import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Check, Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { JsonLd } from "@/components/site/json-ld";
import { HeroDemo } from "@/components/site/hero-demo";
import { MonitoringChart } from "@/components/site/monitoring-chart";
import { RegionalGlobe } from "@/components/site/regional-globe";
import { Reveal } from "@/components/site/reveal";
import { ProviderLogo } from "@/components/providers/provider-logo";
import { Button } from "@/components/ui/button";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { PricingPlans } from "@/components/site/pricing-plans";
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
  return { "--arc-delay": `${ms}ms` } as CSSProperties;
}

/* ------------------------------------------------ the shift: AI answer -- */

/**
 * A real AI answer for Kenesis (an on-prem industrial safety video analytics
 * company that piloted this tool): the buyer's question, the products the
 * model named, and the row that hurts - Kenesis, absent.
 */
function AnswerCard() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div aria-hidden className="arc-glow absolute -inset-x-12 inset-y-0" />
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
            className="arc-rise ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm bg-card px-3.5 py-2.5 text-sm"
            style={delayStyle(150)}
          >
            Which on-premise AI video analytics solutions detect unauthorized
            access to restricted zones in industrial facilities?
          </div>
          <div className="space-y-2">
            {[
              { name: "Witvix", note: "recommended first" },
              { name: "viAct", note: "runner up" },
              { name: "Triya", note: "also recommended" },
            ].map((item, index) => (
              <div
                key={item.name}
                className="arc-rise flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5"
                style={delayStyle(300 + index * 90)}
              >
                <span className="arc-tabular flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-semibold">
                  {index + 1}
                </span>
                <span className="text-sm font-medium">{item.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {item.note}
                </span>
              </div>
            ))}
            <div
              className="arc-rise flex items-center gap-3 rounded-lg border border-dashed border-foreground/25 px-3.5 py-2.5"
              style={delayStyle(620)}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-foreground/25 text-[10px] font-semibold text-muted-foreground">
                ?
              </span>
              <span className="text-sm font-medium text-muted-foreground">
                Kenesis
              </span>
              <span className="arc-pulse-soft ml-auto rounded-full bg-[#ff6166]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#d6453f]">
                Not mentioned
              </span>
            </div>
          </div>
          <div
            className="arc-rise flex flex-wrap items-center gap-2 border-t border-border pt-3"
            style={delayStyle(760)}
          >
            <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
              Cited
            </span>
            {["triya.ai", "witvix.com", "cobaltai.com"].map((source) => (
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

/**
 * Registration mark: a 13px plus whose 1px arms sit on a 1px border that
 * lives just outside the parent's padding box. `top/left: 0` is the inner
 * edge of that border, so the box shifts 7px toward the outside.
 */
const CROSS_PX = 13;
const CROSS_LINE = 6;
const CROSS_SHIFT = 7;

type CrossCorner = "tl" | "tr" | "bl" | "br";

const CROSS_ANCHOR: Record<CrossCorner, string> = {
  tl: "top-0 left-0",
  tr: "top-0 right-0",
  bl: "bottom-0 left-0",
  br: "bottom-0 right-0",
};

const CROSS_OFFSET: Record<CrossCorner, { x: number; y: number }> = {
  tl: { x: -CROSS_SHIFT, y: -CROSS_SHIFT },
  tr: { x: CROSS_SHIFT, y: -CROSS_SHIFT },
  bl: { x: -CROSS_SHIFT, y: CROSS_SHIFT },
  br: { x: CROSS_SHIFT, y: CROSS_SHIFT },
};

function Cross({
  corner,
  tone = "light",
}: {
  corner: CrossCorner;
  tone?: "light" | "dark";
}) {
  const color = tone === "dark" ? "text-white/40" : "text-foreground/45";
  const offset = CROSS_OFFSET[corner];

  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute z-10 ${CROSS_ANCHOR[corner]} ${color}`}
      style={{
        width: CROSS_PX,
        height: CROSS_PX,
        transform: `translate(${offset.x}px, ${offset.y}px)`,
      }}
    >
      <span
        className="absolute left-0 h-px w-full bg-current"
        style={{ top: CROSS_LINE }}
      />
      <span
        className="absolute top-0 h-full w-px bg-current"
        style={{ left: CROSS_LINE }}
      />
    </span>
  );
}

/**
 * The hero's technical frame, as a non-interactive overlay: the max-w-6xl
 * guide rails plus corner registration marks, laid over a section without
 * touching its layout. `tone="dark"` is for ink sections.
 *
 * Default marks are the top corners only so adjacent sections don't stamp
 * two pluses on the same seam. The last section passes `marks="both"`.
 */
function SectionFrame({
  tone = "light",
  marks = "top",
}: {
  tone?: "light" | "dark";
  marks?: "top" | "bottom" | "both";
}) {
  const rail = tone === "dark" ? "border-white/10" : "border-border";
  const showTop = marks === "top" || marks === "both";
  const showBottom = marks === "bottom" || marks === "both";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      <div
        className={`absolute inset-y-0 left-1/2 w-full max-w-6xl -translate-x-1/2 border-x ${rail}`}
      >
        {showTop ? (
          <>
            <Cross corner="tl" tone={tone} />
            <Cross corner="tr" tone={tone} />
          </>
        ) : null}
        {showBottom ? (
          <>
            <Cross corner="bl" tone={tone} />
            <Cross corner="br" tone={tone} />
          </>
        ) : null}
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
    <li className="arc-rise flex items-start gap-3" style={delayStyle(delay)}>
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
    <div className="arc-feature-tile relative flex items-center justify-center overflow-hidden rounded-3xl border border-black/[0.04] px-5 py-12 sm:px-10 md:min-h-[540px] md:py-16 dark:border-white/10">
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
      className={`arc-float absolute z-10 inline-flex items-center gap-1.5 rounded-full border border-black/[0.05] bg-card px-3 py-1.5 text-xs font-medium shadow-[0_12px_32px_-12px_rgba(23,58,110,0.45)] dark:border-white/10 ${className}`}
    >
      {children}
    </span>
  );
}

/** Share of voice: who wins the answers in your category. */
function ShareOfVoicePanel() {
  const rows = [
    { name: "Avigilon", value: 46, tone: "bg-[#52a8ff]" },
    { name: "Kenesis", value: 34, tone: "bg-[color:var(--arc-accent)]", you: true },
    { name: "Triya", value: 12, tone: "bg-[#ff6ea9]" },
    { name: "Everyone else", value: 8, tone: "bg-foreground/20" },
  ];
  return (
    <div className="relative">
      <FloatChip className="-top-4 -right-2 sm:-right-6">
        <span aria-hidden className="size-1.5 rounded-full bg-[#3ecf7a]" />
        Kenesis, up 6 pts
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
          <div key={row.name} className="arc-rise" style={delayStyle(index * 90)}>
            <div className="flex items-baseline justify-between text-sm">
              <span className={row.you ? "font-semibold" : "text-muted-foreground"}>
                {row.name}
              </span>
              <span className="arc-tabular font-medium">{row.value}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
              <div
                className={`arc-grow-x h-full rounded-full ${row.tone}`}
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
      title: "Publish a comparison page vs Avigilon",
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
            className="arc-rise flex items-start gap-3 rounded-lg border border-border bg-card px-3.5 py-3"
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
        <span aria-hidden className="size-1.5 rounded-full bg-[color:var(--arc-accent)]" />
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
          <ProviderLogo provider="openai" className="size-3.5" />
          ChatGPT · &ldquo;Real-time alerts for PPE compliance?&rdquo;
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          &ldquo;Recommended:{" "}
          <mark className="arc-highlight-sweep rounded bg-transparent px-1 py-0.5 font-medium text-foreground">
            Kenesis
          </mark>{" "}
          , an on-prem edge platform where everything runs on your own
          hardware, from camera to alert&hellip;&rdquo;
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {["Mentioned", "Position #1", "1 citation"].map((chip, index) => (
            <span
              key={chip}
              className="arc-rise rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground"
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

// The default ten plus Qwen, so the hero strip reflects the full catalog
// without changing what an audit pre-selects by default.
// The full 14-provider library (matches PLAN_CONFIG.agency.providers) -
// DEFAULT_SCAN_PROVIDERS is only the 10 pre-selected for a default scan.
const PROVIDER_STRIP = [
  ...DEFAULT_SCAN_PROVIDERS,
  "groq",
  "minimax",
  "sarvam",
  "qwen",
] as const;

// What a Pro audit actually reports on - real feature names, not
// filler. Two rows moving opposite ways so they don't read as one mechanical
// strip; each is doubled at render time so its own loop has no visible seam.
const STAT_CHIPS_ROW_1 = [
  "14 providers available",
  "Cited sources",
  "Share of voice",
  "Position tracking",
  "Competitor benchmarking",
  "Citation gaps",
] as const;
const STAT_CHIPS_ROW_2 = [
  "Full answer text",
  "Weekly monitoring",
  "Action centre",
  "Email alerts",
  "Multi-market scans",
  "PDF & CSV export",
] as const;

/* ---------------------------------------------------- bento mini-visuals -- */

// Only providers the audit engine genuinely asks, dotted around the radar.
const RADAR_BLIPS = [
  { id: "openai", className: "top-[8%] left-[46%]" },
  { id: "claude", className: "top-[20%] right-[17%]" },
  { id: "gemini", className: "top-[24%] left-[19%]" },
  { id: "perplexity", className: "top-[47%] left-[7%]" },
  { id: "grok", className: "top-[43%] right-[8%]" },
  { id: "deepseek", className: "top-[68%] left-[20%]" },
  { id: "llama", className: "top-[66%] right-[18%]" },
  { id: "mistral", className: "top-[80%] left-[44%]" },
  { id: "kimi", className: "top-[36%] left-[33%]" },
  { id: "nova", className: "top-[58%] right-[36%]" },
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
              logo: `${appUrl}/icon.svg`,
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
          <div aria-hidden className="arc-hatch h-8 border-b border-border" />
          <div className="mx-auto max-w-6xl">
            <div className="relative border-x border-border px-5 py-16 sm:px-8 md:px-12 md:py-28">
              <Cross corner="tl" />
              <Cross corner="tr" />
              <Cross corner="bl" />
              <Cross corner="br" />

              <div
                aria-hidden
                className="arc-halftone absolute inset-6 text-foreground/20 [mask-image:radial-gradient(ellipse_70%_90%_at_30%_45%,black,transparent_75%)]"
              />

              <div className="relative z-10 grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14">
                <div>
                  <h1 className="arc-fade-up font-heading text-4xl leading-[1.06] font-semibold tracking-[-0.03em] text-balance sm:text-5xl">
                    Your buyers are asking AI.
                    <span className="block text-muted-foreground">
                      See who comes up.
                    </span>
                  </h1>

                  <p className="arc-fade-up arc-fade-up-delay-1 mt-5 max-w-md text-base text-pretty text-muted-foreground md:text-lg">
                    One buyer question, asked across ChatGPT, Claude, Gemini
                    and seven more - measured into a score you can act on.
                  </p>

                  {/* A GET form ignores any query string already on `action`
                      (the browser replaces it with the form's own fields on
                      submit) - so mode=signup travels as a real field, not
                      baked into the URL, and the domain rides along with it
                      to /login. The login page turns that into a returnTo
                      that lands the same domain back on the audit form after
                      sign-up, pre-filled and started - see AddBrandScanForm. */}
                  <form
                    action={routes.login()}
                    method="GET"
                    className="arc-fade-up arc-fade-up-delay-2 mt-7 flex max-w-md flex-col gap-2.5 sm:flex-row"
                  >
                    <input type="hidden" name="mode" value="signup" />
                    <input
                      type="text"
                      name="domain"
                      inputMode="url"
                      placeholder="yourcompany.com"
                      aria-label="Your website"
                      className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-card px-4 text-sm shadow-sm outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-1 focus:ring-ring"
                    />
                    <RainbowButton type="submit" className="shrink-0">
                      See where your brand comes up
                      <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
                    </RainbowButton>
                  </form>
                  <p className="arc-fade-up arc-fade-up-delay-3 mt-3 text-xs text-muted-foreground">
                    Free account · no card · report in ~2 minutes ·{" "}
                    <Link href={routes.methodology} className="underline underline-offset-2 hover:text-foreground">
                      How it&rsquo;s measured
                    </Link>
                  </p>
                </div>

                <div className="arc-fade-up arc-fade-up-delay-2">
                  <HeroDemo />
                </div>
              </div>
            </div>
          </div>
          <div aria-hidden className="arc-hatch h-8 border-y border-border" />
        </section>

        {/* The shift - why AI answers decide who gets found */}
        <section className="relative border-b border-border bg-background">
          <SectionFrame />

          <div className="relative overflow-hidden">
            <div className="relative mx-auto max-w-6xl px-4 pt-16 md:px-6 md:pt-24">
            <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
              <Reveal direction="left">
                <p className="arc-eyebrow">The shift</p>
                <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                  AI doesn&rsquo;t give ten links. It names two or three products.
                </h2>
                <p className="mt-4 max-w-md text-muted-foreground">
                  Buyers ask ChatGPT what to use and get a short list of names.
                  There is no page two - if you&rsquo;re not on the list,
                  you&rsquo;re invisible.
                </p>
                <div className="mt-8 grid grid-cols-3 divide-x divide-border border-y border-border">
                  {[
                    ["1", "answer, not 10 links"],
                    ["2-3", "brands named per answer"],
                    ["0", "clicks if you're absent"],
                  ].map(([stat, label], index) => (
                    <div
                      key={label}
                      className="arc-rise px-4 py-4 first:pl-0"
                      style={delayStyle(200 + index * 100)}
                    >
                      <p className="arc-tabular font-heading text-2xl font-semibold tracking-tight md:text-3xl">
                        {stat}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
              </Reveal>
              <Reveal direction="right" delay={120}>
                <AnswerCard />
              </Reveal>
            </div>
          </div>

          {/* Provider strip */}
          <Reveal className="relative mx-auto max-w-6xl px-4 pt-16 pb-14 md:px-6">
            <p className="text-center text-xs text-muted-foreground">
              Answers measured across 14 AI models
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
              {PROVIDER_STRIP.map((id, index) => (
                <span
                  key={id}
                  className="arc-rise opacity-55"
                  style={delayStyle(index * 60)}
                  title={providerDisplayName(id)}
                >
                  <ProviderLogo provider={id} className="size-5" />
                </span>
              ))}
            </div>
          </Reveal>
          </div>
        </section>
        {/* Bento - the evidence grid */}
        <section className="relative bg-background">
          <SectionFrame />
          <div className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <Reveal className="max-w-2xl">
              <p className="arc-eyebrow">The report</p>
              <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Evidence, not vibes
              </h2>
              <p className="mt-3 text-muted-foreground">
                Everything below ships in every paid report - and the free audit
                is a real slice of it.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {/* Visibility score - stat + bars */}
              <Reveal className="lg:col-span-2">
              <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-card p-6 md:p-8">
                <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                  Visibility score
                </p>
                <h3 className="font-heading mt-2 text-xl font-semibold tracking-tight">
                  A score that moves when you do
                </h3>
                <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Mentions, position and evidence quality compiled into one number -
                  comparable scan after scan, never a black box.
                </p>
                <div className="mt-8 flex items-end justify-between gap-4">
                  <p className="arc-tabular font-heading text-5xl font-semibold tracking-tight">
                    62<span className="text-foreground/35">.4</span>
                  </p>
                  <p className="text-sm font-medium text-[color:var(--arc-green)]">+6.2 this month</p>
                </div>
                <div className="mt-4 flex h-20 items-stretch gap-1 md:gap-1.5">
                  {Array.from({ length: 40 }, (_, i) => (
                    <span
                      key={i}
                      className={`flex-1 rounded-full ${i < 25 ? "arc-light-up bg-[color:var(--arc-accent)]" : "bg-[color:var(--arc-accent)]/15"}`}
                      style={delayStyle(200 + i * 18)}
                    />
                  ))}
                </div>
              </div>
              </Reveal>

              {/* Regional growth - interactive globe */}
              <Reveal delay={100} className="lg:row-span-2">
              <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card">
                <div className="relative flex min-h-56 flex-1 items-center justify-center" aria-hidden>
                  <div className="arc-glow absolute inset-0" />
                  <RegionalGlobe className="relative aspect-square w-full max-w-[380px]" />
                </div>
                <div className="p-6 md:p-8">
                  <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    Regional growth
                  </p>
                  <h3 className="font-heading mt-2 text-xl font-semibold tracking-tight">
                    Grow across every market
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    Track search performance across countries and discover
                    where your brand has the most potential.
                  </p>
                </div>
              </div>
              </Reveal>

              {/* Providers - floating pills */}
              <Reveal delay={150} className="lg:row-span-2">
              <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card">
                <div className="relative min-h-72 flex-1">
                  {/* The radar dial: rings, crosshair, and a sweeping beam. */}
                  <div aria-hidden className="absolute inset-0 grid place-items-center">
                    <div className="relative aspect-square w-[86%]">
                      <div className="absolute inset-0 rounded-full border border-border" />
                      <div className="absolute inset-[17%] rounded-full border border-border" />
                      <div className="absolute inset-[34%] rounded-full border border-border" />
                      <div className="absolute top-1/2 right-0 left-0 h-px bg-border" />
                      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
                      <div className="arc-radar-sweep absolute inset-0" />
                      <span className="arc-pulse-dot absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--arc-accent)] shadow-[0_0_16px_4px_color-mix(in_srgb,var(--arc-accent)_45%,transparent)]" />
                    </div>
                  </div>
                  {RADAR_BLIPS.map((blip, index) => (
                    <span
                      key={blip.id}
                      className={`arc-drift absolute grid size-9 place-items-center rounded-full border border-border bg-background shadow-sm ${blip.className}`}
                      style={delayStyle(index * 550)}
                    >
                      <ProviderLogo provider={blip.id} className="size-4" />
                    </span>
                  ))}
                </div>
                <div className="p-6 md:p-8">
                  <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    Providers
                  </p>
                  <h3 className="font-heading mt-2 text-xl font-semibold tracking-tight">
                    One method, every model
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    The same buyer questions asked across ChatGPT, Claude, Gemini
                    and more - answers compared side by side.
                  </p>
                </div>
              </div>
              </Reveal>

              {/* Big stat card */}
              <Reveal delay={100}>
              <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-[radial-gradient(ellipse_130%_100%_at_50%_-20%,var(--arc-accent-soft),var(--card)_65%)] p-6 text-center md:p-8">
                <p className="arc-tabular font-heading relative bg-gradient-to-b from-foreground via-foreground/75 to-foreground/15 bg-clip-text text-6xl font-semibold tracking-tight text-transparent">
                  200
                </p>
                <p className="relative mt-1 text-foreground/70">
                  provider answers per Pro audit - 20 questions × 10 AIs
                </p>
                <div className="mt-6 flex flex-col gap-2">
                  <div className="arc-marquee-mask relative -mx-6 md:-mx-8">
                    <div className="arc-marquee flex w-max items-center gap-2 px-6 md:px-8">
                      {[...STAT_CHIPS_ROW_1, ...STAT_CHIPS_ROW_1].map((chip, i) => (
                        <span
                          key={`${chip}-${i}`}
                          className="shrink-0 rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs whitespace-nowrap text-muted-foreground"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="arc-marquee-mask relative -mx-6 md:-mx-8">
                    <div className="arc-marquee arc-marquee--reverse flex w-max items-center gap-2 px-6 md:px-8">
                      {[...STAT_CHIPS_ROW_2, ...STAT_CHIPS_ROW_2].map((chip, i) => (
                        <span
                          key={`${chip}-${i}`}
                          className="shrink-0 rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs whitespace-nowrap text-muted-foreground"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              </Reveal>

              {/* Monitoring - trend chart */}
              <Reveal delay={150} className="lg:col-span-2">
              <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-card">
                <div className="relative px-2 pt-14">
                  <span
                    className="arc-fade-late absolute top-4 left-[31%] inline-flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium whitespace-nowrap text-foreground/80 shadow-sm"
                    style={delayStyle(900)}
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-[color:var(--arc-accent)]" />
                    Avg 62.4
                  </span>
                  <span
                    className="arc-fade-late absolute top-4 left-[69%] inline-flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium whitespace-nowrap text-foreground/80 shadow-sm"
                    style={delayStyle(1100)}
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-[#ff6166]" />
                    Low 41.2
                  </span>
                  <span
                    aria-hidden
                    className="arc-fade-late absolute top-14 bottom-0 left-[31%] w-px border-l border-dashed border-foreground/20"
                  />
                  <span
                    aria-hidden
                    className="arc-fade-late absolute top-14 bottom-0 left-[69%] w-px border-l border-dashed border-foreground/20"
                  />
                  <MonitoringChart />
                </div>
                <div className="p-6 pt-4 md:p-8 md:pt-4">
                  <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                    Monitoring
                  </p>
                  <h3 className="font-heading mt-2 text-xl font-semibold tracking-tight">
                    Catch the moves that matter
                  </h3>
                  <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
                    Scheduled re-scans chart your visibility across providers and
                    email you when it shifts.
                  </p>
                </div>
              </div>
              </Reveal>
            </div>
          </div>
        </section>

        <div aria-hidden className="arc-hatch h-8 border-b border-border" />

        {/* What you get - the report turned into moves */}
        <section className="relative bg-background">
          <SectionFrame />
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <Reveal className="max-w-2xl">
              <p className="arc-eyebrow">What you get</p>
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

        <div aria-hidden className="arc-hatch h-8 border-y border-border" />

        {/* How it works */}
        <section className="relative bg-background">
          <SectionFrame />
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
              <Reveal direction="left">
                <p className="arc-eyebrow">How it works</p>
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
                    className="arc-rise relative"
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
              <p className="arc-eyebrow">Pricing</p>
              <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Start free. Scale when it matters.
              </h2>
              <p className="mt-3 text-muted-foreground">
                The free audit is the trial. Upgrade for more providers,
                monitoring, and the full evidence.
              </p>
            </Reveal>

            <div className="mt-12">
              <PricingPlans variant="teaser" />
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
                <p className="arc-eyebrow">FAQ</p>
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
                    className="arc-rise py-6 first:pt-0 last:pb-0"
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

        <div aria-hidden className="arc-hatch h-8 border-t border-border" />

        {/* Final CTA */}
        <section className="relative bg-[color:var(--arc-ink)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_120%,color-mix(in_srgb,var(--arc-accent)_35%,transparent),transparent_60%)]"
          />
          <div aria-hidden className="arc-noise pointer-events-none absolute inset-0 opacity-[0.12]" />
          <SectionFrame tone="dark" marks="both" />
          <Reveal className="relative mx-auto max-w-6xl px-4 py-24 text-center md:px-6 md:py-32">
            <p className="arc-rise inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/70">
              <Sparkles className="arc-pulse-soft size-3" aria-hidden />
              Two minutes to your first report
            </p>
            <h2
              className="arc-rise font-heading mx-auto mt-6 max-w-2xl text-3xl font-semibold tracking-tight text-balance text-white md:text-5xl"
              style={delayStyle(100)}
            >
              Find out before your competitors do.
            </h2>
            <p
              className="arc-rise mx-auto mt-4 max-w-lg text-white/55"
              style={delayStyle(200)}
            >
              Run a free AI visibility audit. No card needed - a shareable
              report in minutes.
            </p>
            <div
              className="arc-rise mt-9 flex flex-wrap items-center justify-center gap-3"
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
