"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CtaVariant = "default" | "outline";

type VerdictOption = {
  key: "high" | "review" | "none";
  body: ReactNode;
  short: string;
  signal: number;
  tone: string;
  label: string;
  cta: string;
  ctaVariant: CtaVariant;
  href: string;
};

export type VerdictCardProps = {
  brandName: string;
  mentionPct: number;
  topCompetitorName: string | null;
  topCompetitorMentions: number;
  hasScan: boolean;
  initialKey: "high" | "review" | "none";
  hrefs: {
    actions: string;
    competitors: string;
    scan: string;
  };
};

function EntityChip({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-[12rem] align-middle">
      <span className="truncate rounded-md border border-border bg-muted/70 px-1.5 py-px text-[12.5px] font-medium text-foreground">
        {name}
      </span>
    </span>
  );
}

function ValuePill({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "green" | "amber" | "default";
}) {
  return (
    <span
      className={cn(
        "inline-flex align-middle rounded-md border px-1.5 py-px text-[12.5px] font-medium",
        tone === "green" &&
          "border-[color:var(--arc-green)]/30 text-[color:var(--arc-green)]",
        tone === "amber" &&
          "border-[color:var(--arc-amber)]/30 text-[color:var(--arc-amber)]",
        tone === "default" && "border-border text-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Meter({ signal, tone }: { signal: number; tone: string }) {
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className="w-1 rounded-full transition-colors duration-300 motion-reduce:transition-none"
          style={{
            height: 10,
            background: bar < signal ? tone : "var(--border)",
          }}
        />
      ))}
    </span>
  );
}

function buildOptions(input: VerdictCardProps): VerdictOption[] {
  const mention = `${input.mentionPct}%`;
  const actionsHref = input.hasScan ? input.hrefs.actions : input.hrefs.scan;
  const competitor = input.topCompetitorName;

  return [
    {
      key: "high",
      body: (
        <>
          Keep <EntityChip name={input.brandName} /> in AI answers — mention rate{" "}
          <ValuePill tone="green">{mention}</ValuePill>
        </>
      ),
      short: `Hold ${input.brandName}'s mention rate · ${mention}`,
      signal: 3,
      tone: "var(--arc-green)",
      label: "High confidence",
      cta: "Accept",
      ctaVariant: "default",
      href: actionsHref,
    },
    {
      key: "review",
      body: competitor ? (
        <>
          Close the gap against <EntityChip name={competitor} /> —{" "}
          <ValuePill tone="amber">
            {input.topCompetitorMentions} mentions
          </ValuePill>
        </>
      ) : (
        <>
          Review who AI names when it skips{" "}
          <EntityChip name={input.brandName} />.
        </>
      ),
      short: competitor
        ? `Compare against ${competitor}`
        : "See who AI recommends instead",
      signal: 2,
      tone: "var(--arc-amber)",
      label: "Needs review",
      cta: "Configure",
      ctaVariant: "outline",
      href: input.hrefs.competitors,
    },
    {
      key: "none",
      body: input.hasScan ? (
        <>
          Fall back to the{" "}
          <span className="font-medium text-foreground">full action centre</span>{" "}
          across every open item.
        </>
      ) : (
        <>
          Fall back to a{" "}
          <span className="font-medium text-foreground">new audit</span> before
          guessing at fixes.
        </>
      ),
      short: input.hasScan
        ? "Full action centre across every item"
        : "Run a full audit first",
      signal: 0,
      tone: "var(--muted-foreground)",
      label: "No signal",
      cta: input.hasScan ? "Accept full plan" : "Run audit",
      ctaVariant: "outline",
      href: actionsHref,
    },
  ];
}

export function VerdictCard(input: VerdictCardProps) {
  const router = useRouter();
  const options = buildOptions(input);
  const initialIndex = Math.max(
    0,
    options.findIndex((option) => option.key === input.initialKey),
  );
  const [selected, setSelected] = useState(initialIndex);
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const active = options[selected] ?? options[0];
  if (!active) return null;
  const others = options
    .map((option, index) => ({ option, index }))
    .filter(({ index }) => index !== selected);

  return (
    <div>
      <div className="px-5 pt-5 pb-4">
        <h2 className="text-[14px] font-medium text-foreground">
          Want me to act on this audit?
        </h2>
        <p
          key={active.key}
          className="arc-fade-in mt-1.5 min-h-12 text-[13px] leading-relaxed text-muted-foreground"
        >
          {active.body}
        </p>
      </div>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 motion-reduce:transition-none"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border bg-muted/30 px-2 py-2">
            <p className="px-1.5 pb-1 text-[11px] font-medium text-muted-foreground">
              Other options
            </p>
            {others.map(({ option, index }) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  setSelected(index);
                  setAccepted(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors duration-100 hover:bg-muted"
              >
                <Meter signal={option.signal} tone={option.tone} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                  {option.short}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {option.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-2.5">
        <span className="flex items-center gap-2">
          <Meter signal={active.signal} tone={active.tone} />
          <span className="text-[12.5px] font-medium text-muted-foreground">
            {active.label}
          </span>
        </span>

        <span className="-mr-0.5 flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="px-2.5 text-[12.5px]"
          >
            Alternatives
          </Button>
          <Button
            variant={accepted ? "default" : active.ctaVariant}
            size="sm"
            onClick={() => {
              if (accepted) return;
              setAccepted(true);
              router.push(active.href);
            }}
            className={cn(
              "text-[12.5px]",
              accepted &&
                "border-transparent bg-[color:var(--arc-green)] text-white hover:bg-[color:var(--arc-green)] hover:text-white",
            )}
          >
            {accepted ? "Accepted" : active.cta}
          </Button>
        </span>
      </div>
    </div>
  );
}
