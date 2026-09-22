import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function FeatureCheck({ className, label }: { className?: string; label?: string }) {
  return (
    <Check
      className={cn("size-4 shrink-0 text-[color:var(--arc-green)] opacity-100", className)}
      strokeWidth={2.5}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
