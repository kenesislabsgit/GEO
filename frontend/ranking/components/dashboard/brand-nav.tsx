"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { path: "", label: "Summary", pro: false },
  { path: "/competitors", label: "Competitors", pro: true },
  { path: "/actions", label: "Website Improvements", pro: false },
  { path: "/prompts", label: "Audit Details", pro: false },
  { path: "/history", label: "History", pro: true },
] as const;

export function BrandNav({ brandId, isPaid }: { brandId: string; isPaid: boolean }) {
  const pathname = usePathname();
  const base = `/dashboard/brands/${brandId}`;

  return (
    <nav className="rb-panel-soft flex gap-1 overflow-x-auto p-1.5">
      {tabs.map((tab) => {
        const href = `${base}${tab.path}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.path}
            href={href}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-2 text-sm transition-colors",
              active
                ? "bg-[color:var(--rb-ink)] font-medium text-white shadow-sm"
                : "text-muted-foreground hover:bg-white hover:text-foreground",
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
