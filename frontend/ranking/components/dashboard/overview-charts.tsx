"use client";

import { PALETTE, rgb } from "@/components/dither-kit/palette";
import { Area } from "@/components/dither-kit/area";
import { AreaChart } from "@/components/dither-kit/area-chart";
import { Bar } from "@/components/dither-kit/bar";
import { BarChart } from "@/components/dither-kit/bar-chart";
import type { ChartConfig } from "@/components/dither-kit/chart-context";
import { Grid } from "@/components/dither-kit/grid";
import { ReferenceLine } from "@/components/dither-kit/reference-line";
import { Tooltip } from "@/components/dither-kit/tooltip";
import { XAxis } from "@/components/dither-kit/x-axis";
import { YAxis } from "@/components/dither-kit/y-axis";

/**
 * The overview's three charts, composed from the dither kit in the style of
 * the reference dashboard: one stacked provider bar chart, two line panels
 * with an average marker.
 */

export type ProviderBarRow = {
  label: string;
  openai: number;
  claude: number;
  gemini: number;
  perplexity: number;
  others: number;
};

const BAR_CONFIG = {
  openai: { label: "ChatGPT", color: "green" },
  claude: { label: "Claude", color: "orange" },
  gemini: { label: "Gemini", color: "blue" },
  perplexity: { label: "Perplexity", color: "pink" },
  others: { label: "Other AIs", color: "grey" },
} satisfies ChartConfig;

const LEGEND: Array<{ key: keyof typeof BAR_CONFIG; fill: string }> = [
  { key: "openai", fill: rgb(PALETTE.green.line) },
  { key: "claude", fill: rgb(PALETTE.orange.line) },
  { key: "gemini", fill: rgb(PALETTE.blue.line) },
  { key: "perplexity", fill: rgb(PALETTE.pink.line) },
  { key: "others", fill: rgb(PALETTE.grey.line) },
];

export function ProviderAnswersLegend() {
  return (
    <div className="flex items-center gap-4">
      {LEGEND.map(({ key, fill }) => (
        <span
          key={key}
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground"
        >
          <span
            className="size-2 rounded-full"
            style={{ background: fill }}
          />
          {BAR_CONFIG[key].label}
        </span>
      ))}
    </div>
  );
}

export function ProviderAnswersChart({ data }: { data: ProviderBarRow[] }) {
  if (data.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Run an audit to see answers per provider here.
      </p>
    );
  }
  return (
    <div className="h-80 w-full">
      <BarChart data={data} config={BAR_CONFIG} stackType="stacked">
        <Grid />
        <XAxis dataKey="label" />
        <YAxis />
        <Tooltip labelKey="label" />
        <Bar dataKey="openai" variant="gradient" />
        <Bar dataKey="claude" variant="gradient" />
        <Bar dataKey="gemini" variant="gradient" />
        <Bar dataKey="perplexity" variant="gradient" />
        <Bar dataKey="others" variant="gradient" />
      </BarChart>
    </div>
  );
}

export type TrendRow = { date: string; value: number };

export function TrendChart({
  data,
  label,
  average,
  color = "blue",
}: {
  data: TrendRow[];
  label: string;
  average: number | null;
  color?: "blue" | "green";
}) {
  if (data.length < 2) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Run more audits to see this trend.
      </p>
    );
  }
  const config = { value: { label, color } } satisfies ChartConfig;
  return (
    <div className="h-64 w-full">
      <AreaChart data={data} config={config} bloom="low">
        <Grid />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip labelKey="date" />
        {average !== null ? (
          <ReferenceLine y={average} label={`Avg ${average}`} />
        ) : null}
        <Area dataKey="value" variant="gradient" />
      </AreaChart>
    </div>
  );
}
