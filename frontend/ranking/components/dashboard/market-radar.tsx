"use client";

import { Radar } from "@/components/dither-kit/radar";
import { RadarChart } from "@/components/dither-kit/radar-chart";
import { Legend } from "@/components/dither-kit/legend";
import { Tooltip } from "@/components/dither-kit/tooltip";

const CONFIG = { rate: { label: "Mention rate %", color: "blue" } } as const;

export type ContinentRate = { continent: string; rate: number };

/** Mention rate by continent, as a dithered radar. */
export function MarketRadar({ data }: { data: ContinentRate[] }) {
  return (
    <div className="h-72 w-full">
      <RadarChart data={data} config={CONFIG} nameKey="continent" bloom="low">
        <Tooltip labelKey="continent" />
        <Radar dataKey="rate" variant="gradient" />
      </RadarChart>
    </div>
  );
}
