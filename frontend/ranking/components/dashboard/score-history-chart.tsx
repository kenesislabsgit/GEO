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

export function ScoreHistoryChart({
  data,
}: {
  data: Array<{ date: string; score: number }>;
}) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No historical scores yet. Run multiple scans to see change over time.
      </p>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 100]}
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--popover)",
              color: "var(--popover-foreground)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="var(--rb-blue)"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "var(--rb-blue)", strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
