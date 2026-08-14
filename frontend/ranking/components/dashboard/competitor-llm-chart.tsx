"use client";

import { useMemo } from "react";
import { Bar } from "@/components/dither-kit/bar";
import { BarChart } from "@/components/dither-kit/bar-chart";
import type { ChartConfig } from "@/components/dither-kit/chart-context";
import { Grid } from "@/components/dither-kit/grid";
import { Tooltip } from "@/components/dither-kit/tooltip";
import { XAxis } from "@/components/dither-kit/x-axis";
import { YAxis } from "@/components/dither-kit/y-axis";
import { PALETTE, type DitherColor } from "@/components/dither-kit/palette";
import { ProviderLogo } from "@/components/providers/provider-logo";

// ─── LLM config: dither palette colors + short display names ─────────────────
export const LLM_CONFIG: Record<
  string,
  { color: DitherColor; label: string; shortLabel: string }
> = {
  bedrock_claude: { color: "orange", label: "Claude", shortLabel: "Claude" },
  bedrock_llama: { color: "purple", label: "Llama", shortLabel: "Llama" },
  bedrock_mistral: { color: "red", label: "Mistral", shortLabel: "Mistral" },
  bedrock_nova: { color: "blue", label: "Nova", shortLabel: "Nova" },
  openai: { color: "green", label: "ChatGPT", shortLabel: "ChatGPT" },
  openai_search: { color: "green", label: "ChatGPT", shortLabel: "ChatGPT" },
  claude: { color: "orange", label: "Claude", shortLabel: "Claude" },
  gemini: { color: "blue", label: "Gemini", shortLabel: "Gemini" },
  perplexity: { color: "pink", label: "Perplexity", shortLabel: "Perplexity" },
};

function getLLMColor(provider: string): DitherColor {
  return LLM_CONFIG[provider]?.color ?? "grey";
}
function getLLMLabel(provider: string) {
  return LLM_CONFIG[provider]?.shortLabel ?? provider;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export type CompetitorWithLLM = {
  name: string;
  mentions: number;
  average_rank?: number | null;
  mentionsByProvider: Record<string, number>;
};

/** A competitor the previous audit surfaced that this one didn't. */
export type DroppedCompetitor = {
  name: string;
  previousMentions: number;
};

type Props = {
  competitors: CompetitorWithLLM[];
  allProviders: string[];
  dropped?: DroppedCompetitor[];
};

// ─── Main chart component ─────────────────────────────────────────────────────
export function CompetitorLLMChart({ competitors, allProviders, dropped = [] }: Props) {
  const activeProviders = allProviders.filter((p) =>
    competitors.some((c) => (c.mentionsByProvider[p] ?? 0) > 0),
  );

  // One row per competitor; every active provider present so the stack is
  // dense. Long names are shortened on the axis - the ranked list below the
  // chart carries the full name.
  const chartData = useMemo(
    () =>
      competitors.map((c) => ({
        name: c.name.length > 14 ? `${c.name.slice(0, 13)}…` : c.name,
        ...Object.fromEntries(
          activeProviders.map((p) => [p, c.mentionsByProvider[p] ?? 0]),
        ),
      })),
    [competitors, activeProviders],
  );

  const config = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        activeProviders.map((p) => [
          p,
          { label: getLLMLabel(p), color: getLLMColor(p) },
        ]),
      ),
    [activeProviders],
  );

  if (competitors.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-muted-foreground">
        No competitor signals yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="h-64 w-full">
        <BarChart data={chartData} config={config} stackType="stacked">
          <Grid />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip labelKey="name" />
          {activeProviders.map((provider) => (
            <Bar key={provider} dataKey={provider} variant="gradient" />
          ))}
        </BarChart>
      </div>
      {/* Legend: each provider as its own mark, tinted with its series color. */}
      <div className="flex flex-wrap gap-2">
        {activeProviders.map((provider) => (
          <span
            key={provider}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
          >
            <ProviderLogo
              provider={provider}
              className="size-3"
              // Series color from the dither palette so legend and bars agree.
              style={{
                color: `rgb(${PALETTE[getLLMColor(provider)].line.join(",")})`,
              }}
            />
            {getLLMLabel(provider)}
          </span>
        ))}
      </div>

      {/* Competitor rows with rank badge. Competitors the last audit surfaced
          but this one didn't trail the list as ghosts - same row shape, hollow
          rank marker, dimmed - so churn between runs is visible in place
          instead of narrated. */}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {competitors.map((c, i) => (
          <div key={`${c.name}-${i}`} className="flex items-center justify-between px-5 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                {i + 1}
              </span>
              <span className="text-sm font-medium truncate">{c.name}</span>
            </div>
            <span className="font-mono text-xs text-muted-foreground shrink-0 ml-3">
              {c.mentions} mention{c.mentions !== 1 ? "s" : ""}
              {c.average_rank != null ? ` · avg #${c.average_rank}` : ""}
            </span>
          </div>
        ))}
        {dropped.map((c) => (
          <div
            key={`dropped-${c.name}`}
            className="flex items-center justify-between bg-muted/30 px-5 py-2.5 opacity-70"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden
                className="size-5 shrink-0 rounded-full border border-dashed border-muted-foreground/50"
              />
              <span className="truncate text-sm text-muted-foreground">{c.name}</span>
            </div>
            <span className="ml-3 flex shrink-0 items-center gap-2">
              <span className="rb-chip text-muted-foreground">absent this audit</span>
              <span className="font-mono text-xs text-muted-foreground/70">
                was {c.previousMentions} mention{c.previousMentions !== 1 ? "s" : ""}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
