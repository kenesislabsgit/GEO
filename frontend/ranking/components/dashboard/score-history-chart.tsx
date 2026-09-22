"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type HistoryPoint = {
  id: string;
  date: string;
  score: number;
  sampleKey: string | null;
  href: string;
};

function AuditDot({
  cx,
  cy,
  payload,
}: {
  cx?: number;
  cy?: number;
  payload?: HistoryPoint;
}) {
  if (cx == null || cy == null || !payload) return null;
  return (
    <a
      href={payload.href}
      aria-label={
        "View audit from " + payload.date + ", score " + payload.score
      }
    >
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill="var(--arc-accent)"
        stroke="var(--background)"
        strokeWidth={2}
      />
    </a>
  );
}

export function ScoreHistoryChart({ data }: { data: HistoryPoint[] }) {
  if (!data.length)
    return (
      <p className="text-sm text-muted-foreground">
        Run an audit to start your score history.
      </p>
    );
  let segment = 0;
  const segments = data.map((point, index) => {
    if (
      index &&
      (!point.sampleKey || point.sampleKey !== data[index - 1].sampleKey)
    )
      segment++;
    return segment;
  });
  const keys = Array.from(new Set(segments), (value) => "score" + value);
  const plotted = data.map((point, index) => ({
    ...point,
    ...Object.fromEntries(
      keys.map((key) => [
        key,
        key === "score" + segments[index] ? point.score : null,
      ]),
    ),
  }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={plotted}
          margin={{ top: 16, right: 16, left: -20, bottom: 4 }}
        >
          <CartesianGrid
            stroke="var(--border)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="id"
            tickFormatter={(id: string) =>
              data.find((point) => point.id === id)?.date ?? ""
            }
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            labelFormatter={(id) =>
              data.find((point) => point.id === id)?.date ?? ""
            }
            contentStyle={{
              background: "var(--card)",
              borderColor: "var(--border)",
              borderRadius: 8,
            }}
          />
          {keys.map((key) => (
            <Line
              key={key}
              name="Score"
              dataKey={key}
              type="linear"
              stroke="var(--arc-accent)"
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
              dot={<AuditDot />}
              activeDot={<AuditDot />}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
