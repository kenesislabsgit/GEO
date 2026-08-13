"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/site/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const links = [
  { href: routes.brands, label: "Websites" },
  { href: routes.scans, label: "Audit history" },
  { href: routes.alerts, label: "Alerts" },
  { href: routes.billing(), label: "Billing" },
  { href: routes.settings, label: "Settings" },
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
    <div className="rb-dash flex min-h-screen flex-col">
      {/* Top chrome: identity left, account right — one hairline under it. */}
      <header className="bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo />
            <span className="hidden rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-block">
              {planName}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!paid ? (
              <Link
                href={routes.billing()}
                className="mr-1 hidden text-[13px] font-medium text-[color:var(--rb-accent)] hover:underline sm:block"
              >
                Upgrade
              </Link>
            ) : null}
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
            <span
              title={email}
              className="ml-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background uppercase"
            >
              {email[0] ?? "?"}
            </span>
          </div>
        </div>

        {/* Section tabs — underline indicator on a shared hairline. */}
        <nav className="border-b border-border">
          <div className="rb-scrollbar-none mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-2 md:px-4">
            {[...links, ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : [])].map(
              (link) => {
                const active = pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[13px] transition-colors",
                      active
                        ? "border-foreground font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {link.label}
                    {link.href === routes.alerts && unreadAlerts > 0 ? (
                      <span className="ml-1.5 rounded-full bg-[color:var(--rb-accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {unreadAlerts > 9 ? "9+" : unreadAlerts}
                      </span>
                    ) : null}
                  </Link>
                );
              },
            )}
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-6">
        {children}
      </main>
    </div>
  );
}
