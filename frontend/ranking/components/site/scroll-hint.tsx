"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

const HINT_GONE_AFTER_PX = 28;

/**
 * Wraps a table (or any wide block) that must scroll sideways on phones.
 * Shows a "swipe" label and a fading right edge until the user has
 * actually scrolled, so the rest of the columns are not a surprise.
 */
export function HorizontalScrollHint({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  const [atStart, setAtStart] = useState(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const update = () => {
      const overflow = el.scrollWidth > el.clientWidth + 8;
      setCanScroll(overflow);
      setAtStart(el.scrollLeft < HINT_GONE_AFTER_PX);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const showNudge = canScroll && atStart;

  return (
    <div>
      <p className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs md:hidden">
        <span className="text-muted-foreground">Free · Plus · Pro</span>
        <span
          className={`inline-flex items-center gap-0.5 font-medium text-foreground transition-opacity ${
            showNudge ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden={!showNudge}
        >
          {label}
          <ChevronRight className="size-3.5 motion-safe:animate-pulse" />
        </span>
      </p>
      <div className="relative">
        <div
          ref={scrollerRef}
          className="overflow-x-auto overscroll-x-contain"
        >
          {children}
        </div>
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-background to-transparent transition-opacity md:hidden ${
            showNudge ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          aria-hidden
          className={`pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/95 p-1 text-muted-foreground shadow-sm md:hidden ${
            showNudge ? "flex" : "hidden"
          }`}
        >
          <ChevronRight className="size-4 motion-safe:animate-pulse" />
        </div>
      </div>
    </div>
  );
}
