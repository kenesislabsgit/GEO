"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { path: "", label: "Summary", pro: false },
  { path: "/competitors", label: "Competitors", pro: true },
  // The page at /citations was written, styled and gated, and then left out of
  // this list, so the only way to reach it was to type the URL. Every audit
  // has been collecting the pages behind it since.
  { path: "/citations", label: "Sources", pro: true },
  { path: "/actions", label: "Website Improvements", pro: false },
  { path: "/prompts", label: "Audit Details", pro: false },
  { path: "/history", label: "History", pro: true },
] as const;

export function BrandNav({ brandId, isPaid }: { brandId: string; isPaid: boolean }) {
  const pathname = usePathname();
  const base = `/dashboard/brands/${brandId}`;

  // Underline tabs on a single baseline — quieter than the old pill row,
  // and the active page reads at a glance.
  return (
    <nav className="flex gap-0.5 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const href = `${base}${tab.path}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.path}
            href={href}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.pro && !isPaid ? (
              <Lock className="ml-1.5 inline size-3" aria-label="Pro" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
