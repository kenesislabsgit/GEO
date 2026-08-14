"use client";

import { Area } from "@/components/dither-kit/area";
import { AreaChart } from "@/components/dither-kit/area-chart";

const CONFIG = { score: { label: "Visibility", color: "blue" } } as const;

// Mirrors the old hand-drawn trend: steady climb, a visible dip past the
// second marker, then recovery - so the "Avg"/"Low" chips still line up.
const POINTS = [
  56, 60, 54, 62, 58, 66, 62, 70, 66, 78, 74, 86, 80, 92, 84, 90, 78, 82, 68,
  60, 44, 50, 42, 52, 48, 58, 54, 64, 60, 72,
];

const DATA = POINTS.map((score, step) => ({ step, score }));

/** The Monitoring bento card's decorative dither trend. */
export function MonitoringChart() {
  return (
    <div
      aria-hidden
      className="h-36 w-full [mask-image:linear-gradient(to_bottom,black_45%,transparent_98%)]"
    >
      <AreaChart
        data={DATA}
        config={CONFIG}
        interactive={false}
        bloom="low"
        margins={{ top: 4, right: 0, bottom: 0, left: 0 }}
      >
        <Area dataKey="score" variant="gradient" />
      </AreaChart>
    </div>
  );
}
