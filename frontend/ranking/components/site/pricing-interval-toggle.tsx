"use client";

import { cn } from "@/lib/utils";
import {
  advertisedYearlySavingsPercent,
  type BillingInterval,
} from "@/lib/billing/pricing";

export function PricingIntervalToggle({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (interval: BillingInterval) => void;
}) {
  const savePercent = advertisedYearlySavingsPercent();

  return (
    <div
      role="radiogroup"
      aria-label="Billing interval"
      className="inline-flex rounded-full border border-border bg-muted/60 p-1"
    >
      {(
        [
          { id: "monthly", label: "Monthly" },
          { id: "yearly", label: "Yearly" },
        ] as const
      ).map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            {option.id === "yearly" ? (
              <span className="rounded-full bg-[color:var(--arc-green)]/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[color:var(--arc-green)] uppercase">
                Save {savePercent}%
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
