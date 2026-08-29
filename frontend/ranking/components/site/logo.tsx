import Link from "next/link";
import {
  EMBLEM_SEA,
  EMBLEM_SUN,
  EMBLEM_VIEW_BOX,
  SEA,
  SUN,
  WORDMARK_INK,
  WORDMARK_SEA,
  WORDMARK_SUN,
  WORDMARK_VIEW_BOX,
} from "@/lib/brand";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";

// Both marks carry overflow-visible: an svg clips to its box by default, so
// artwork that reaches the edge of its viewBox loses a sliver whenever layout
// puts the box on a fractional device pixel - which reads as a flattened edge.

/** The sun-over-horizon mark on its own, for icons and tight spaces. */
export function Emblem({ className }: { className?: string }) {
  return (
    <svg
      viewBox={EMBLEM_VIEW_BOX}
      fill="none"
      aria-hidden
      className={cn("shrink-0 overflow-visible", className)}
    >
      <path fill={SUN} d={EMBLEM_SUN} />
      <path fill={SEA} d={EMBLEM_SEA} />
    </svg>
  );
}

/** "Arcanoris" set in Geist, with the sun standing in for the o. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={WORDMARK_VIEW_BOX}
      fill="none"
      role="img"
      aria-label={APP_NAME}
      className={cn("shrink-0 overflow-visible", className)}
    >
      <path fill="currentColor" d={WORDMARK_INK} />
      <path fill={SUN} d={WORDMARK_SUN} />
      <path fill={SEA} d={WORDMARK_SEA} />
    </svg>
  );
}

export function Logo({
  className,
  invert = false,
  large = false,
}: {
  className?: string;
  invert?: boolean;
  large?: boolean;
}) {
  return (
    <Link
      href="/"
      aria-label={APP_NAME}
      className={cn(
        // Block-level, not inline: an inline box sits on a text baseline, and
        // the fractional offset that comes with it makes the mark rasterise
        // differently in the footer than in the header.
        "flex w-fit items-center",
        invert ? "text-white" : "text-foreground",
        large ? "gap-2.5" : "gap-2",
        className,
      )}
    >
      <Emblem className={large ? "size-8" : "size-[22px]"} />
      <Wordmark className={large ? "h-[23px] w-auto" : "h-4 w-auto"} />
    </Link>
  );
}
