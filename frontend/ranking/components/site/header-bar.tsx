"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Sticky chrome for the marketing header. Overlay mode sits on the hero
 * as transparent glass, then fills in once the page scrolls so links
 * stay readable over the sections below.
 */
export function HeaderBar({
  overlay = false,
  children,
}: {
  overlay?: boolean;
  children: ReactNode;
}) {
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    if (!overlay) return;

    const onScroll = () => {
      setSolid(window.scrollY > 40);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [overlay]);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-colors duration-300",
        overlay
          ? solid
            ? "border-b border-border bg-background/80 backdrop-blur-md"
            : "border-b border-transparent bg-transparent"
          : "border-b border-border bg-background/80 backdrop-blur-md",
      )}
    >
      {children}
    </header>
  );
}
