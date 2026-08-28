"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  Gauge,
  Globe,
  History,
  LayoutDashboard,
  Link2,
  LogOut,
  MapPin,
  MessageSquare,
  Radar,
  Settings,
  Shield,
  TrendingUp,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Emblem, Logo, Wordmark } from "@/components/site/logo";
import { NavLink } from "@/components/dashboard/nav-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { APP_NAME } from "@/lib/constants";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * Dashboard chrome: one collapsible sidebar and a full-width content area.
 * Open rows show icon + label; closed rows show the icon only. Below lg the
 * sidebar gives way to a compact top bar with scrollable tabs.
 */

type NavItem = {
  href: string;
  label: string;
  // Required: collapsed rows are icon-only, so a missing icon would drop
  // that item from the nav. The compiler catches it when a new item is added.
  icon: LucideIcon;
  exact?: boolean;
};

type NavGroup = { label: string | null; items: NavItem[] };

export type ShellBrand = { id: string; name: string; domain: string };

function websiteLabel(brand: ShellBrand): string {
  const name = brand.name.trim();
  const domain = brand.domain.trim();
  // Never use our product name as if it were the customer's site.
  const ours = (value: string) =>
    value.toLowerCase() === APP_NAME.toLowerCase() ||
    value.toLowerCase().includes("arcanoris");
  if (name && !ours(name)) return name;
  if (domain && !ours(domain)) return domain;
  return name || domain;
}

/** The per-website analysis sections - the heart of the product's nav. */
const BRAND_SECTIONS: Array<{
  path: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}> = [
  { path: "", label: "Summary", icon: Gauge, exact: true },
  { path: "/competitors", label: "Competitors", icon: Users },
  { path: "/citations", label: "Sources", icon: Link2 },
  { path: "/markets", label: "Markets", icon: MapPin },
  { path: "/actions", label: "Action centre", icon: Wrench },
  { path: "/prompts", label: "Audit details", icon: MessageSquare },
  { path: "/history", label: "History", icon: TrendingUp },
  { path: "/settings", label: "Schedule", icon: Radar },
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
      label: websiteLabel(activeBrand),
      items: BRAND_SECTIONS.map((section) => ({
        href: `${routes.brand(activeBrand.id)}${section.path}`,
        label: section.label,
        icon: section.icon,
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
      href: routes.admin,
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
  // Width animation stays off until the stored choice is applied, so a
  // remembered "closed" nav doesn't open-then-slide on first paint.
  const [animateWidth, setAnimateWidth] = useState(false);

  // Remember the collapse choice per browser; read after mount (deferred a
  // tick) so SSR and the first client render agree.
  useEffect(() => {
    const stored = localStorage.getItem("rbai-nav-collapsed") === "1";
    if (stored) setCollapsed(true);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateWidth(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((current) => {
      localStorage.setItem("rbai-nav-collapsed", current ? "0" : "1");
      return !current;
    });
  };

  const alertBadge =
    unreadAlerts > 0 ? (
      <span className="ml-auto rounded-full bg-[color:var(--arc-accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
        {unreadAlerts > 9 ? "9+" : unreadAlerts}
      </span>
    ) : null;

  return (
    <div className="arc-dash flex min-h-screen flex-col">
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
        <nav className="arc-scrollbar-none flex gap-1 overflow-x-auto border-t border-border px-2">
          {groups
            .flatMap((group) => group.items)
            .map((item) => {
              const active = isActive(pathname, item);
              return (
                <NavLink
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
                </NavLink>
              );
            })}
        </nav>
      </header>

      <div className="flex flex-1">
        {/* Width lives on this wrapper so the toggle can sit on the
            right edge without being clipped. Inner chrome stays 240px
            so icons never jump while labels fade and get clipped. */}
        <div
          className={cn(
            "relative sticky top-0 z-20 hidden h-screen shrink-0 lg:block motion-reduce:transition-none",
            animateWidth
              ? "transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
              : "",
            collapsed ? "w-16" : "w-60",
          )}
        >
          <aside className="flex h-full w-full flex-col overflow-hidden border-r border-border">
            <div className="flex h-full w-60 flex-col">
              <div className="flex h-14 shrink-0 items-center">
                <Link
                  href={routes.dashboard}
                  title={APP_NAME}
                  className="flex w-16 shrink-0 items-center justify-center"
                >
                  <Emblem className="size-7" />
                  <span className="sr-only">{APP_NAME}</span>
                </Link>
                <Wordmark
                  className={cn(
                    "h-4 w-auto min-w-0 text-foreground transition-opacity duration-200 ease-out motion-reduce:transition-none",
                    collapsed ? "opacity-0" : "opacity-100 delay-100",
                  )}
                />
              </div>

              <nav className="arc-scrollbar-none flex flex-1 flex-col gap-3 overflow-y-auto pb-4">
                {groups.map((group, index) => (
                  <div key={group.label ?? index} className="flex flex-col gap-1">
                    {index > 0 ? (
                      collapsed ? (
                        <div
                          aria-hidden
                          className="flex h-5 shrink-0 items-center justify-center"
                        >
                          <div className="h-px w-4 bg-border" />
                        </div>
                      ) : group.label ? (
                        <p className="pointer-events-none select-none px-4 pt-3 pb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/50">
                          {group.label}
                        </p>
                      ) : (
                        <div className="h-2 shrink-0" />
                      )
                    ) : null}
                    {group.items.map((item) => {
                      const active = isActive(pathname, item);
                      const Icon = item.icon;
                      const showAlert = item.href === routes.alerts;
                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          title={item.label}
                          className={cn(
                            "relative flex h-9 items-center rounded-lg text-[13.5px] transition-colors",
                            active
                              ? "bg-muted font-medium text-foreground"
                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                          )}
                        >
                          <span className="relative flex w-16 shrink-0 items-center justify-center">
                            <Icon className="size-[15px]" />
                            {showAlert && unreadAlerts > 0 ? (
                              <span
                                className={cn(
                                  "absolute top-1.5 right-3.5 size-1.5 rounded-full bg-[color:var(--arc-accent)] transition-opacity duration-200 motion-reduce:transition-none",
                                  collapsed
                                    ? "opacity-100 delay-100"
                                    : "opacity-0",
                                )}
                              />
                            ) : null}
                          </span>
                          <span
                            className={cn(
                              "min-w-0 truncate whitespace-nowrap pr-4 transition-opacity duration-200 ease-out motion-reduce:transition-none",
                              collapsed
                                ? "opacity-0"
                                : "opacity-100 delay-100",
                            )}
                          >
                            {item.label}
                          </span>
                          {showAlert ? (
                            <span
                              className={cn(
                                "transition-opacity duration-200 ease-out motion-reduce:transition-none",
                                collapsed
                                  ? "opacity-0"
                                  : "opacity-100 delay-100",
                              )}
                            >
                              {alertBadge}
                            </span>
                          ) : null}
                        </NavLink>
                      );
                    })}
                  </div>
                ))}
              </nav>

              <div className="mt-auto border-t border-border">
                {collapsed ? (
                  <div className="flex w-16 flex-col items-center gap-1 py-3">
                    <span
                      title={email}
                      className="flex size-8 items-center justify-center rounded-full bg-muted text-[11px] font-semibold uppercase"
                    >
                      {email[0] ?? "?"}
                    </span>
                    <ThemeToggle className="size-8 text-muted-foreground" />
                    <form action="/api/auth/signout" method="POST">
                      <button
                        type="submit"
                        title="Sign out"
                        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <LogOut className="size-3.5" />
                        <span className="sr-only">Sign out</span>
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 px-3 py-3">
                    <span
                      title={email}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold uppercase"
                    >
                      {email[0] ?? "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-[12px] text-muted-foreground"
                        title={email}
                      >
                        {email}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {planName}
                        </span>
                        {!paid ? (
                          <Link
                            href={routes.billing()}
                            className="text-[11px] font-medium text-[color:var(--arc-accent)] hover:underline"
                          >
                            Upgrade
                          </Link>
                        ) : null}
                      </div>
                    </div>
                    <ThemeToggle className="size-8 shrink-0 text-muted-foreground" />
                    <form action="/api/auth/signout" method="POST">
                      <button
                        type="submit"
                        title="Sign out"
                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <LogOut className="size-3.5" />
                        <span className="sr-only">Sign out</span>
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </aside>
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            className="absolute top-3.5 right-0 z-20 flex size-6 translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          >
            {collapsed ? (
              <ChevronsRight className="size-3.5" />
            ) : (
              <ChevronsLeft className="size-3.5" />
            )}
          </button>
        </div>

        {/* ── Content ────────────────────────────────────────────────── */}
        {/* Named so the View Transition (triggered by NavLink) only
            cross-fades this region - without a name here the browser's
            default transition captures the whole viewport, sidebar
            included, which flashes chrome that never actually changed. */}
        <main className="min-w-0 flex-1 [view-transition-name:dash-main]">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
