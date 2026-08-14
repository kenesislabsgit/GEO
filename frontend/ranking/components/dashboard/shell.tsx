"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  Globe,
  History,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/site/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * Dashboard chrome: a slim icon rail, a collapsible grouped nav column, and
 * a full-width content area - panels divided by hairlines, in the style of
 * the reference analytics dashboards. Below lg the two columns give way to
 * a compact top bar with scrollable tabs.
 */

type NavItem = {
  href: string;
  label: string;
  icon?: LucideIcon;
  exact?: boolean;
};

type NavGroup = { label: string | null; items: NavItem[] };

export type ShellBrand = { id: string; name: string };

/** The per-website analysis sections - the heart of the product's nav. */
const BRAND_SECTIONS: Array<{ path: string; label: string; exact?: boolean }> = [
  { path: "", label: "Summary", exact: true },
  { path: "/competitors", label: "Competitors" },
  { path: "/citations", label: "Sources" },
  { path: "/markets", label: "Markets" },
  { path: "/actions", label: "Website improvements" },
  { path: "/prompts", label: "Audit details" },
  { path: "/history", label: "History" },
  { path: "/settings", label: "Monitoring" },
];

function buildNav(
  isAdmin: boolean,
  activeBrand: ShellBrand | null,
): NavGroup[] {
  const groups: NavGroup[] = [
    {
      label: null,
      items: [
        { href: routes.dashboard, label: "Dashboard", icon: LayoutDashboard, exact: true },
        { href: routes.brands, label: "Websites", icon: Globe, exact: true },
      ],
    },
  ];
  if (activeBrand) {
    groups.push({
      label: activeBrand.name,
      items: BRAND_SECTIONS.map((section) => ({
        href: `${routes.brand(activeBrand.id)}${section.path}`,
        label: section.label,
        exact: section.exact,
      })),
    });
  }
  groups.push(
    {
      label: "Monitoring",
      items: [
        { href: routes.scans, label: "Audit history", icon: History },
        { href: routes.alerts, label: "Alerts", icon: Bell },
      ],
    },
    {
      label: "Account",
      items: [
        { href: routes.billing(), label: "Billing", icon: CreditCard },
        { href: routes.settings, label: "Settings", icon: Settings },
      ],
    },
  );
  if (isAdmin) {
    groups[groups.length - 1].items.push({
      href: "/admin",
      label: "Admin",
      icon: Shield,
    });
  }
  return groups;
}

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export function DashboardShell({
  children,
  email,
  isAdmin = false,
  planName = "Free",
  paid = false,
  unreadAlerts = 0,
  brands = [],
}: {
  children: React.ReactNode;
  email: string;
  isAdmin?: boolean;
  planName?: string;
  paid?: boolean;
  unreadAlerts?: number;
  brands?: ShellBrand[];
}) {
  const pathname = usePathname();
  // The analysis group follows the website being viewed; anywhere else it
  // shows the account's most recent website so the sections are always one
  // click away.
  const pathBrandId = pathname.match(/^\/dashboard\/brands\/([^/]+)/)?.[1];
  const activeBrand =
    brands.find((brand) => brand.id === pathBrandId) ?? brands[0] ?? null;
  const groups = buildNav(isAdmin, activeBrand);
  const [collapsed, setCollapsed] = useState(false);

  // Remember the collapse choice per browser; read after mount (deferred a
  // tick) so SSR and the first client render agree.
  useEffect(() => {
    const stored = localStorage.getItem("rbai-nav-collapsed") === "1";
    if (!stored) return;
    const id = setTimeout(() => setCollapsed(true), 0);
    return () => clearTimeout(id);
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((current) => {
      localStorage.setItem("rbai-nav-collapsed", current ? "0" : "1");
      return !current;
    });
  };

  const alertBadge =
    unreadAlerts > 0 ? (
      <span className="ml-auto rounded-full bg-[color:var(--rb-accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
        {unreadAlerts > 9 ? "9+" : unreadAlerts}
      </span>
    ) : null;

  return (
    <div className="rb-dash flex min-h-screen flex-col">
      {/* ── Mobile top bar (below lg) ─────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background lg:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Logo />
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {planName}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
            <form action="/api/auth/signout" method="POST">
              <button
                type="submit"
                title="Sign out"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <LogOut className="size-3.5" />
                <span className="sr-only">Sign out</span>
              </button>
            </form>
          </div>
        </div>
        <nav className="rb-scrollbar-none flex gap-1 overflow-x-auto border-t border-border px-2">
          {groups
            .flatMap((group) => group.items)
            .map((item) => {
              const active = isActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] transition-colors",
                    active
                      ? "border-foreground font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                  {item.href === routes.alerts ? alertBadge : null}
                </Link>
              );
            })}
        </nav>
      </header>

      <div className="flex flex-1">
        {/* ── Icon rail ──────────────────────────────────────────────── */}
        {/* Both columns pin to the viewport: navigation never scrolls away,
            and the account block sits at the bottom of the screen, not the
            bottom of the page. */}
        <aside className="sticky top-0 hidden h-screen w-16 shrink-0 flex-col items-center border-r border-border py-4 lg:flex">
          <Link
            href={routes.dashboard}
            title="RankedByAI"
            className="flex size-9 items-center justify-center rounded-lg bg-foreground text-sm font-bold text-background"
          >
            R
          </Link>
          <div className="mt-6 flex flex-col items-center gap-1.5">
            {groups
              .flatMap((group) => group.items)
              .filter(
                (item): item is NavItem & { icon: LucideIcon } =>
                  Boolean(item.icon),
              )
              .map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    className={cn(
                      "relative flex size-9 items-center justify-center rounded-lg transition-colors",
                      active
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-[17px]" />
                    {item.href === routes.alerts && unreadAlerts > 0 ? (
                      <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-[color:var(--rb-accent)]" />
                    ) : null}
                    <span className="sr-only">{item.label}</span>
                  </Link>
                );
              })}
          </div>
          <div className="mt-auto flex flex-col items-center gap-1.5">
            <span
              title={email}
              className="flex size-8 items-center justify-center rounded-full bg-muted text-[11px] font-semibold uppercase"
            >
              {email[0] ?? "?"}
            </span>
            <ThemeToggle />
            <form action="/api/auth/signout" method="POST">
              <button
                type="submit"
                title="Sign out"
                className="flex size-9 items-center justify-center rounded-lg text-destructive/80 transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="size-[17px]" />
                <span className="sr-only">Sign out</span>
              </button>
            </form>
          </div>
        </aside>

        {/* ── Nav column ─────────────────────────────────────────────── */}
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border lg:flex",
            collapsed ? "w-0 overflow-hidden border-r-0" : "w-60",
          )}
        >
          <div className="flex h-14 shrink-0 items-center justify-between px-5">
            <span className="text-[15px] font-semibold tracking-tight">
              RankedByAI
            </span>
            <button
              type="button"
              onClick={toggleCollapsed}
              title="Collapse navigation"
              className="flex size-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronsLeft className="size-3.5" />
            </button>
          </div>
          {/* Long section lists scroll inside the column; the account block
              below stays pinned to the bottom of the viewport. */}
          <nav className="rb-scrollbar-none flex-1 space-y-4 overflow-y-auto px-3 pb-4">
            {groups.map((group, index) => (
              <div key={group.label ?? index}>
                {group.label ? (
                  <p className="truncate px-2.5 pb-1.5 font-mono text-[11px] tracking-[0.12em] text-muted-foreground/70 lowercase">
                    {group.label}
                  </p>
                ) : null}
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isActive(pathname, item);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13.5px] transition-colors",
                          active
                            ? "border border-border bg-muted/60 font-medium text-foreground"
                            : "border border-transparent text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {item.label}
                        {item.href === routes.alerts ? alertBadge : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="border-t border-border px-5 py-3">
            <p className="truncate text-xs text-muted-foreground" title={email}>
              {email}
            </p>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {planName}
              </span>
              {!paid ? (
                <Link
                  href={routes.billing()}
                  className="text-[12px] font-medium text-[color:var(--rb-accent)] hover:underline"
                >
                  Upgrade
                </Link>
              ) : null}
            </div>
          </div>
        </aside>

        {/* Expand handle when the nav column is collapsed. */}
        {collapsed ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            title="Expand navigation"
            className="sticky top-0 hidden h-14 items-start self-start border-border px-2 pt-4 text-muted-foreground transition-colors hover:text-foreground lg:flex"
          >
            <ChevronsRight className="size-3.5" />
          </button>
        ) : null}

        {/* ── Content ────────────────────────────────────────────────── */}
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
