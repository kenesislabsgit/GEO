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
 * Dashboard chrome: a slim icon rail, a collapsible grouped nav column, and
 * a full-width content area - panels divided by hairlines, in the style of
 * the reference analytics dashboards. Below lg the two columns give way to
 * a compact top bar with scrollable tabs.
 */

type NavItem = {
  href: string;
  label: string;
  // Required, not optional: the icon rail is the *only* navigation once the
  // labeled column is collapsed, so an item without one doesn't just look
  // bare there - it silently disappears from the app. Making this required
  // means the compiler catches that the moment a new item is added, instead
  // of a user discovering it's stranded behind the collapse toggle.
  icon: LucideIcon;
  exact?: boolean;
};

type NavGroup = { label: string | null; items: NavItem[] };

export type ShellBrand = { id: string; name: string };

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
  { path: "/actions", label: "Website improvements", icon: Wrench },
  { path: "/prompts", label: "Audit details", icon: MessageSquare },
  { path: "/history", label: "History", icon: TrendingUp },
  { path: "/settings", label: "Monitoring", icon: Radar },
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
        {/* ── Icon rail ──────────────────────────────────────────────── */}
        {/* Both columns pin to the viewport: navigation never scrolls away,
            and the account block sits at the bottom of the screen, not the
            bottom of the page. */}
        <aside className="sticky top-0 hidden h-screen w-16 shrink-0 flex-col items-center border-r border-border lg:flex">
          {/* Fixed to the same h-14 as the labeled column's header row, so
              every row below starts from the same y-offset in both columns. */}
          <Link
            href={routes.dashboard}
            title={APP_NAME}
            className="flex h-14 w-full shrink-0 items-center justify-center"
          >
            <Emblem className="size-7" />
            <span className="sr-only">{APP_NAME}</span>
          </Link>
          {/* Every item in every group renders here - this rail is the only
              navigation once the labeled column is collapsed, so it has to
              carry full parity with it, not just the top-level shortcuts.
              Scrolls independently when the list outgrows the viewport,
              same as the labeled column does. Row height (size-9), row gap
              (gap-1) and group gap (gap-4) all match the labeled column's
              link/space-y-1/space-y-4 exactly, and the h-6 divider spacer
              matches its h-6 group label, so every icon lines up with its
              text row instead of drifting group by group. */}
          <div className="arc-scrollbar-none flex w-full flex-1 flex-col items-center gap-4 overflow-y-auto px-1 pb-4">
            {groups.map((group, index) => (
              <div
                key={group.label ?? index}
                className="flex w-full flex-col items-center gap-1"
              >
                {index > 0 ? (
                  <div
                    aria-hidden
                    className="flex h-6 w-full shrink-0 items-center justify-center"
                  >
                    <div className="h-px w-6 bg-border" />
                  </div>
                ) : null}
                {group.items.map((item) => {
                  const active = isActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      title={item.label}
                      className={cn(
                        "relative flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                        active
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <Icon className="size-[15px]" />
                      {item.href === routes.alerts && unreadAlerts > 0 ? (
                        <span className="absolute top-1 right-1 size-1.5 rounded-full bg-[color:var(--arc-accent)]" />
                      ) : null}
                      <span className="sr-only">{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-auto flex flex-col items-center gap-1.5 pb-4">
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
        {/* Width and border-color both transition (never toggled with a
            hard class swap), and overflow-hidden stays on permanently so
            the fixed-width content below gets clipped smoothly as the
            column shrinks instead of reflowing/wrapping mid-animation. */}
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r transition-[width,border-color] duration-300 ease-in-out lg:flex",
            collapsed ? "w-0 border-transparent" : "w-60 border-border",
          )}
        >
          {/* Locked to the expanded width so text never squeezes into a
              vertical sliver while the column above it is animating - it
              just fades out a little faster than the column collapses. */}
          <div
            className={cn(
              "flex h-full w-60 shrink-0 flex-col transition-opacity duration-150 ease-in-out",
              collapsed ? "pointer-events-none opacity-0" : "opacity-100",
            )}
          >
            <div className="flex h-14 shrink-0 items-center justify-between px-5">
              <Wordmark className="h-4 w-auto text-foreground" />
              <button
                type="button"
                onClick={toggleCollapsed}
                title="Collapse navigation"
                tabIndex={collapsed ? -1 : 0}
                className="flex size-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronsLeft className="size-3.5" />
              </button>
            </div>
            {/* Long section lists scroll inside the column; the account block
                below stays pinned to the bottom of the viewport. Row height
                (h-9), row gap (space-y-1), group gap (space-y-4) and the h-6
                label row all match the icon rail's own row/gap/divider sizing,
                so every link lines up with its icon next door. */}
            <nav className="arc-scrollbar-none flex-1 space-y-4 overflow-y-auto px-3 pb-4">
              {groups.map((group, index) => (
                <div key={group.label ?? index} className="flex flex-col gap-1">
                  {group.label ? (
                    <p className="flex h-6 items-center truncate px-2.5 font-mono text-[11px] tracking-[0.12em] text-muted-foreground/70 lowercase">
                      {group.label}
                    </p>
                  ) : null}
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const active = isActive(pathname, item);
                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          tabIndex={collapsed ? -1 : 0}
                          className={cn(
                            "flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13.5px] transition-colors",
                            active
                              ? "border border-border bg-muted/60 font-medium text-foreground"
                              : "border border-transparent text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {item.label}
                          {item.href === routes.alerts ? alertBadge : null}
                        </NavLink>
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
                    tabIndex={collapsed ? -1 : 0}
                    className="text-[12px] font-medium text-[color:var(--arc-accent)] hover:underline"
                  >
                    Upgrade
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </aside>

        {/* Expand handle, always mounted so it can fade in as soon as the
            column starts collapsing rather than popping in once width
            animation finishes - inert (no hit target, no tab stop) while
            the column is expanded instead of unmounted. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Expand navigation"
          aria-hidden={!collapsed}
          tabIndex={collapsed ? 0 : -1}
          className={cn(
            "sticky top-0 hidden h-14 items-start self-start border-border px-2 pt-4 text-muted-foreground transition-[opacity,color] duration-200 ease-in-out hover:text-foreground lg:flex",
            collapsed
              ? "pointer-events-auto opacity-100 delay-150"
              : "pointer-events-none w-0 px-0 opacity-0",
          )}
        >
          <ChevronsRight className="size-3.5" />
        </button>

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
