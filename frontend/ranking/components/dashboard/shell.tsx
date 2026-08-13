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
import { ThemeToggle } from "@/components/theme-toggle";
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

/** One recipe for every nav item — sidebar, admin link, and mobile pills. */
function navItemClass(active: boolean): string {
  return cn(
    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
    active
      ? "bg-[color:var(--sidebar-accent)] font-medium text-foreground"
      : "text-muted-foreground hover:bg-[color:var(--sidebar-accent)]/60 hover:text-foreground",
  );
}

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
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-[color:var(--sidebar)] md:flex">
        <div className="px-4 py-5">
          <Logo />
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {links.map((link) => {
            const active = link.exact
              ? pathname === link.href
              : pathname.startsWith(link.href);
            return (
              <Link key={link.href} href={link.href} className={navItemClass(active)}>
                <link.icon className="size-4" strokeWidth={1.75} />
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
              className={navItemClass(pathname.startsWith("/admin"))}
            >
              <ShieldCheck className="size-4" strokeWidth={1.75} />
              Admin
            </Link>
          ) : null}
        </nav>
        <div className="border-t border-border p-3">
          {/* The plan, always visible. Paid accounts see what they pay for;
              free accounts see the one-click way up. */}
          <Link
            href={routes.billing()}
            className="mb-2 flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>{planName} plan</span>
            {!paid ? (
              <span className="font-semibold text-[color:var(--rb-blue)]">
                Upgrade
              </span>
            ) : null}
          </Link>
          <div className="flex items-center justify-between gap-2 px-1 py-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background uppercase">
                {email[0] ?? "?"}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {email}
              </span>
            </div>
            <div className="flex items-center">
              <ThemeToggle />
              <form action="/api/auth/signout" method="POST">
                <button
                  type="submit"
                  title="Sign out"
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[color:var(--sidebar-accent)] hover:text-foreground"
                >
                  <LogOut className="size-3.5" />
                  <span className="sr-only">Sign out</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur-md md:hidden">
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
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-background px-3 py-2 md:hidden">
          {links.map((link) => {
            const active = link.exact
              ? pathname === link.href
              : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(navItemClass(active), "shrink-0")}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
