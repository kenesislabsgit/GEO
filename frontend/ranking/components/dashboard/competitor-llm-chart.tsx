"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";

// ─── LLM config: colors + short display names ────────────────────────────────
export const LLM_CONFIG: Record<
  string,
  { color: string; label: string; shortLabel: string; emoji: string }
> = {
  bedrock_claude: {
    color: "#D97706",
    label: "Bedrock Claude Haiku",
    shortLabel: "Claude",
    emoji: "🟠",
  },
  bedrock_llama: {
    color: "#7C3AED",
    label: "Bedrock Llama",
    shortLabel: "Llama",
    emoji: "🟣",
  },
  bedrock_mistral: {
    color: "#059669",
    label: "Bedrock Mistral",
    shortLabel: "Mistral",
    emoji: "🟢",
  },
  bedrock_nova: {
    color: "#0EA5E9",
    label: "Bedrock Nova",
    shortLabel: "Nova",
    emoji: "🔵",
  },
  openai: {
    color: "#10B981",
    label: "OpenAI",
    shortLabel: "OpenAI",
    emoji: "🟩",
  },
  openai_search: {
    color: "#34D399",
    label: "OpenAI Search",
    shortLabel: "OAI Search",
    emoji: "🔍",
  },
  claude: {
    color: "#F59E0B",
    label: "Claude",
    shortLabel: "Claude",
    emoji: "🟠",
  },
  gemini: {
    color: "#6366F1",
    label: "Gemini",
    shortLabel: "Gemini",
    emoji: "🟡",
  },
  perplexity: {
    color: "#EC4899",
    label: "Perplexity",
    shortLabel: "Perplexity",
    emoji: "🩷",
  },
};

const FALLBACK_COLOR = "#94A3B8";

function getLLMColor(provider: string) {
  return LLM_CONFIG[provider]?.color ?? FALLBACK_COLOR;
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

type Props = {
  competitors: CompetitorWithLLM[];
  allProviders: string[];
};

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; fill: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-lg text-sm min-w-[180px]">
      <p className="font-semibold text-foreground mb-2">{label}</p>
      {payload
        .filter((p) => p.value > 0)
        .map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="inline-block size-2.5 rounded-sm shrink-0"
                style={{ background: p.fill }}
              />
              {getLLMLabel(p.name)}
            </span>
            <span className="font-mono font-medium text-foreground">{p.value}</span>
          </div>
        ))}
      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        <span className="text-muted-foreground">Total</span>
        <span className="font-mono font-semibold">{total}</span>
      </div>
    </div>
  );
}

// ─── LLM Legend pill ─────────────────────────────────────────────────────────
function LLMPill({ provider }: { provider: string }) {
  const cfg = LLM_CONFIG[provider];
  const color = cfg?.color ?? FALLBACK_COLOR;
  const label = cfg?.shortLabel ?? provider;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
      style={{ background: `${color}18`, color }}
    >
      <span className="inline-block size-2 rounded-full shrink-0" style={{ background: color }} />
      {label}
    </span>
  );
}

// ─── Main chart component ─────────────────────────────────────────────────────
export function CompetitorLLMChart({ competitors, allProviders }: Props) {
  // Build chart data: each entry is one competitor bar
  const chartData = useMemo(
    () =>
      competitors.map((c) => ({
        name: c.name,
        total: c.mentions,
        avgRank: c.average_rank,
        ...c.mentionsByProvider,
      })),
    [competitors],
  );

  const activeProviders = allProviders.filter((p) =>
    competitors.some((c) => (c.mentionsByProvider[p] ?? 0) > 0),
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
      {/* LLM Legend */}
      <div className="flex flex-wrap gap-2 px-1">
        {activeProviders.map((p) => (
          <LLMPill key={p} provider={p} />
        ))}
      </div>

      {/* Chart */}
      <div style={{ height: Math.max(competitors.length * 62 + 16, 120) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
            barCategoryGap="28%"
          >
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              tickCount={5}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={110}
              tick={{ fontSize: 12, fill: "#0c0f14", fontWeight: 500 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: "rgba(11,132,255,0.04)", radius: 6 }}
            />
            {activeProviders.map((provider) => (
              <Bar
                key={provider}
                dataKey={provider}
                stackId="mentions"
                fill={getLLMColor(provider)}
                radius={
                  provider === activeProviders[activeProviders.length - 1]
                    ? [0, 6, 6, 0]
                    : [0, 0, 0, 0]
                }
                maxBarSize={28}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Competitor rows with rank badge */}
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
      </div>
    </div>
  );
}
