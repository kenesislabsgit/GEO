"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CreditCard,
  LogOut,
  Package,
  Radar,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "@/components/site/logo";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const links = [
  { href: routes.brands, label: "Websites", icon: Package, exact: false },
  { href: routes.scans, label: "Audit history", icon: Radar, exact: false },
  { href: routes.alerts, label: "Alerts", icon: Bell, exact: false },
  {
    href: routes.billing(),
    label: "Billing",
    icon: CreditCard,
    exact: false,
  },
  {
    href: routes.settings,
    label: "Settings",
    icon: Settings,
    exact: false,
  },
];

export function DashboardShell({
  children,
  email,
  isAdmin = false,
  planName = "Free",
  paid = false,
  unreadAlerts = 0,
}: {
  children: React.ReactNode;
  email: string;
  isAdmin?: boolean;
  planName?: string;
  paid?: boolean;
  unreadAlerts?: number;
}) {
  const pathname = usePathname();

  return (
    <div className="rb-atmosphere relative flex min-h-screen">
      <div
        aria-hidden
        className="rb-mesh pointer-events-none absolute inset-0 opacity-50"
      />

      <aside className="relative z-10 sticky top-0 hidden h-screen w-64 shrink-0 flex-col p-3 md:flex">
        <div className="rb-glass flex h-full flex-col overflow-hidden rounded-[1.25rem]">
          <div className="px-4 py-5">
            <Logo />
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 px-2.5">
            {links.map((link) => {
              const active = link.exact
                ? pathname === link.href
                : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-full px-3.5 py-2 text-sm transition-colors",
                    active
                      ? "bg-[color:var(--rb-ink)] font-medium text-white shadow-sm"
                      : "text-muted-foreground hover:bg-[color:var(--rb-mist)] hover:text-foreground",
                  )}
                >
                  <link.icon className="size-4" />
                  {link.label}
                  {link.href === routes.alerts && unreadAlerts > 0 ? (
                    <span className="ml-auto rounded-full bg-[color:var(--rb-blue)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {unreadAlerts > 9 ? "9+" : unreadAlerts}
                    </span>
                  ) : null}
                </Link>
              );
            })}
            {isAdmin ? (
              <Link
                href="/admin"
                className={cn(
                  "flex items-center gap-2.5 rounded-full px-3.5 py-2 text-sm transition-colors",
                  pathname.startsWith("/admin")
                    ? "bg-[color:var(--rb-ink)] font-medium text-white shadow-sm"
                    : "text-muted-foreground hover:bg-[color:var(--rb-mist)] hover:text-foreground",
                )}
              >
                <ShieldCheck className="size-4" />
                Admin
              </Link>
            ) : null}
          </nav>
          <div className="border-t border-border/70 p-3">
            {/* The plan, always visible. Paid accounts see what they pay for;
                free accounts see the one-click way up. */}
            <Link
              href={routes.billing()}
              className={cn(
                "mb-2 flex items-center justify-between rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                paid
                  ? "bg-[color:var(--rb-ink)] text-white"
                  : "bg-[color:var(--rb-mist)] text-muted-foreground hover:text-foreground",
              )}
            >
              <span>{planName} plan</span>
              {!paid ? <span className="text-[color:var(--rb-blue)]">Upgrade</span> : null}
            </Link>
            <div className="flex items-center justify-between gap-2 rounded-2xl bg-[color:var(--rb-mist)]/80 px-2.5 py-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--rb-ink)] text-[11px] font-semibold text-white uppercase">
                  {email[0] ?? "?"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {email}
                </span>
              </div>
              <form action="/api/auth/signout" method="POST">
                <button
                  type="submit"
                  title="Sign out"
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white hover:text-foreground"
                >
                  <LogOut className="size-3.5" />
                  <span className="sr-only">Sign out</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between px-4 pt-3 md:hidden">
          <div className="rb-glass flex h-11 w-full items-center justify-between rounded-full px-3">
            <Logo />
            <form action="/api/auth/signout" method="POST">
              <button
                type="submit"
                className="flex items-center gap-1.5 text-sm text-muted-foreground"
              >
                <LogOut className="size-3.5" />
                Sign out
              </button>
            </form>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto px-3 py-2 md:hidden">
          {links.map((link) => {
            const active = link.exact
              ? pathname === link.href
              : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "shrink-0 rounded-full px-3.5 py-1.5 text-sm",
                  active
                    ? "bg-[color:var(--rb-ink)] font-medium text-white"
                    : "bg-white/70 text-muted-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
