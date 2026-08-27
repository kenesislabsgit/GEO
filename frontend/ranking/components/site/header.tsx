import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HeaderBar } from "@/components/site/header-bar";
import { Logo } from "@/components/site/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSessionUser } from "@/lib/auth/session";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const nav = [
  { href: routes.pricing, label: "Pricing" },
  { href: routes.methodology, label: "Methodology" },
  { href: routes.blog, label: "Blog" },
];

export async function SiteHeader({ overlay = false }: { overlay?: boolean }) {
  const user = await getSessionUser();

  return (
    <HeaderBar overlay={overlay}>
      <div className="mx-auto flex h-14 max-w-6xl min-w-0 items-center justify-between gap-2 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  overlay
                    ? "text-foreground/70 hover:text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ThemeToggle
            className={
              overlay
                ? "text-foreground hover:bg-foreground/10 hover:text-foreground"
                : undefined
            }
          />
          {user ? (
            <>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className={cn(
                  "hidden sm:inline-flex",
                  overlay &&
                    "text-foreground hover:bg-foreground/10 hover:text-foreground",
                )}
              >
                <Link href={routes.dashboard}>Dashboard</Link>
              </Button>
              <Button
                asChild
                size="sm"
                className={
                  overlay
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : undefined
                }
              >
                <Link href={routes.newScan()}>
                  <span className="sm:hidden">Audit</span>
                  <span className="hidden sm:inline">Run an audit</span>
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className={
                  overlay
                    ? "text-foreground hover:bg-foreground/10 hover:text-foreground"
                    : undefined
                }
              >
                <Link href={routes.login({ mode: "signin" })}>Sign in</Link>
              </Button>
              <Button
                asChild
                size="sm"
                className={
                  overlay
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : undefined
                }
              >
                <Link href={routes.freeAuditSignup}>Run free audit</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </HeaderBar>
  );
}
