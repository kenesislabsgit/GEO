"use client";

import { Star } from "lucide-react";

import { ALL_PROVIDERS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export type StatsBentoTile = {
  label: string;
  value: string;
  detail?: string;
};

export type StatsBentoProps = {
  className?: string;
  primary?: StatsBentoTile;
  secondary?: StatsBentoTile & { bars?: number[] };
  tertiary?: StatsBentoTile;
  rating?: StatsBentoTile;
};

const DEFAULT_BARS = [10, 20, 40, 30, 60, 50, 80, 70, 90, 100, 110];

const DEFAULT_PRIMARY: StatsBentoTile = {
  label: "Named per answer",
  value: "2–3",
  detail:
    "AI names two or three products. Miss the list and you are invisible.",
};

const DEFAULT_SECONDARY: StatsBentoTile & { bars?: number[] } = {
  label: "AIs on Plus",
  value: "5",
  bars: DEFAULT_BARS,
};

const DEFAULT_TERTIARY: StatsBentoTile = {
  value: String(ALL_PROVIDERS.length),
  label: "AIs in catalog",
};

const DEFAULT_RATING: StatsBentoTile = {
  value: "0–100",
  label: "Visibility score",
};

export function StatsBento({
  className,
  primary = DEFAULT_PRIMARY,
  secondary = DEFAULT_SECONDARY,
  tertiary = DEFAULT_TERTIARY,
  rating = DEFAULT_RATING,
}: StatsBentoProps) {
  const bars = secondary.bars ?? DEFAULT_BARS;

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col justify-center bg-background",
        className,
      )}
    >
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 md:grid-cols-6 md:grid-rows-2">
        <div className="relative flex flex-col justify-between overflow-hidden rounded-3xl bg-primary p-10 md:col-span-3 md:row-span-2">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(45deg,color-mix(in_srgb,var(--primary-foreground)_35%,transparent)_0px_1px,transparent_1px_10px)] mask-[radial-gradient(ellipse_80%_50%_at_100%_0%,#000_70%,transparent_110%)] opacity-30"
          />
          <div>
            <span className="mb-6 inline-block rounded-full bg-primary-foreground/10 px-3 py-1 text-[10px] font-semibold tracking-widest text-primary-foreground/60 uppercase">
              {primary.label}
            </span>
            <h3 className="font-heading text-6xl tracking-tighter text-primary-foreground">
              {primary.value}
            </h3>
          </div>
          {primary.detail ? (
            <p className="max-w-xs text-sm text-primary-foreground/60">
              {primary.detail}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between rounded-3xl border border-border bg-muted p-8 md:col-span-3">
          <div>
            <p className="mb-1 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              {secondary.label}
            </p>
            <p className="font-heading text-3xl text-foreground">
              {secondary.value}
            </p>
          </div>
          <div aria-hidden className="flex h-8 items-end gap-1">
            {bars.map((height, index) => (
              <div
                key={`${height}-${index}`}
                className="w-1.5 rounded-full bg-foreground"
                style={{ height: `${Math.min(height, 100)}%` }}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col justify-center rounded-3xl border border-border bg-card p-6 text-center md:col-span-1">
          <p className="font-heading text-2xl text-foreground">{tertiary.value}</p>
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            {tertiary.label}
          </p>
        </div>

        <div className="flex items-center gap-4 rounded-3xl bg-muted p-6 md:col-span-2">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background text-foreground shadow-sm">
            <Star className="size-4 fill-current" aria-hidden />
          </div>
          <div>
            <p className="text-sm leading-none text-foreground">{rating.value}</p>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              {rating.label}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StatsBento;
