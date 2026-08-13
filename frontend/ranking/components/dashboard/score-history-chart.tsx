"use client";

import { Area } from "@/components/dither-kit/area";
import { AreaChart } from "@/components/dither-kit/area-chart";
import { Grid } from "@/components/dither-kit/grid";
import { Tooltip } from "@/components/dither-kit/tooltip";
import { XAxis } from "@/components/dither-kit/x-axis";
import { YAxis } from "@/components/dither-kit/y-axis";

const CONFIG = { score: { label: "Score", color: "blue" } } as const;

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
      <AreaChart data={data} config={CONFIG} bloom="low">
        <Grid />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip labelKey="date" />
        <Area dataKey="score" variant="gradient" />
      </AreaChart>
    </div>
  );
}
