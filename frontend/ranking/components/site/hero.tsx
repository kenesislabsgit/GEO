import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { HeroCrowd } from "@/components/site/hero-crowd";
import { HeroDomainInput } from "@/components/site/hero-domain-input";
import { HeroWordFlip } from "@/components/site/hero-word-flip";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const HERO_AI_LOGOS = [
  {
    key: "gpt",
    kind: "mark",
    light: "/hero-ai-gpt.png",
    dark: "/hero-ai-gpt-dark.png",
  },
  { key: "claude", src: "/hero-ai-claude.png", kind: "sticker" },
  { key: "gemini", src: "/hero-ai-gemini.png", kind: "sticker" },
] as const;

const HERO_AI_LOGO_GAP = "gap-x-[0.1em]";

/** Sticker stack of ChatGPT / Claude / Gemini, sized to the headline. */
function HeroAiStack() {
  const tilt = ["-rotate-[20deg]", "rotate-[4deg]", "rotate-[22deg]"] as const;
  return (
    <span
      className={cn(
        "inline-flex h-[1em] items-center leading-none",
        HERO_AI_LOGO_GAP,
      )}
      aria-hidden
    >
      {HERO_AI_LOGOS.map((logo, i) => (
        <span
          key={logo.key}
          className={cn("relative inline-block size-[1em] shrink-0", tilt[i])}
        >
          {logo.kind === "mark" ? (
            <>
              <Image
                src={logo.light}
                alt=""
                fill
                unoptimized
                className="object-contain dark:hidden"
              />
              <Image
                src={logo.dark}
                alt=""
                fill
                unoptimized
                className="hidden object-contain dark:block"
                style={{ colorScheme: "only light" }}
              />
            </>
          ) : (
            <Image
              src={logo.src}
              alt=""
              fill
              unoptimized
              className="object-contain"
              style={{ colorScheme: "only light" }}
            />
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * Mobile stacks copy above the crowd; desktop keeps the full hero backdrop.
 */
export function LandingHero() {
  return (
    <section className="relative isolate overflow-hidden bg-background text-foreground md:min-h-[100svh]">
      <div className="relative z-30 mx-auto flex max-w-5xl flex-col items-center justify-start px-6 pt-8 pb-8 text-center sm:pt-12 md:min-h-[100svh] md:pt-20 md:pb-20">
        <p className="arc-fade-up inline-flex items-center gap-2 rounded-full border border-foreground/15 bg-background/50 px-2.5 py-1 text-xs text-foreground/80 backdrop-blur-sm">
          <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-background uppercase">
            New
          </span>
          Free AI visibility audit
          <ArrowRight className="size-3" aria-hidden />
        </p>

        <h1
          aria-label="When buyers ask AI, do they recommend your brand?"
          className="arc-fade-up font-heading mt-6 flex w-full flex-col items-center text-[clamp(1.15rem,4.2vw,3rem)] leading-none font-semibold tracking-[-0.03em]"
        >
          <span className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-0">
            <span className="whitespace-nowrap">When buyers ask AI</span>
            <HeroAiStack />
          </span>
          <span className="mt-1 inline-block whitespace-nowrap text-foreground/50">
            do they recommend your <HeroWordFlip />
          </span>
        </h1>

        <p className="arc-fade-up arc-fade-up-delay-1 mt-5 max-w-lg text-sm text-pretty text-foreground/65 sm:text-base md:text-lg">
          The free audit checks ChatGPT. Plus and Pro add Claude, Gemini and
          more, so you see who outranks you and what to fix.
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
          className="arc-fade-up arc-fade-up-delay-2 mt-8 w-full max-w-md space-y-3"
        >
          <input type="hidden" name="mode" value="signup" />
          <div className="flex h-12 select-none items-center rounded-xl border border-foreground/25 bg-background px-3.5 shadow-sm [-webkit-tap-highlight-color:transparent] focus-within:border-foreground/50">
            <span
              aria-hidden
              className="shrink-0 select-none font-mono text-xs text-foreground/40"
            >
              https://
            </span>
            <HeroDomainInput />
          </div>
          <RainbowButton type="submit" className="h-12 w-full shadow-md">
            Run free audit
            <ArrowRight className="size-4" aria-hidden />
          </RainbowButton>
        </form>
        <p className="arc-fade-up arc-fade-up-delay-3 mt-4 text-xs text-foreground/45">
          Free account · no card · ~2 min on ChatGPT
        </p>
      </div>
      <div
        aria-hidden
        data-hero-illustration
        className="relative isolate h-72 overflow-hidden bg-background md:absolute md:inset-0 md:h-auto"
      >
        <HeroCrowd />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[28%] bg-gradient-to-b from-background via-background/50 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background to-transparent" />
      </div>
    </section>
  );
}
