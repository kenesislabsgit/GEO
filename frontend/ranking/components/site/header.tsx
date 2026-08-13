import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/site/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSessionUser } from "@/lib/auth/session";
import { routes } from "@/lib/routes";

const nav = [
  { href: routes.pricing, label: "Pricing" },
  { href: routes.methodology, label: "Methodology" },
];

export async function SiteHeader() {
  const user = await getSessionUser();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href={routes.dashboard}>Dashboard</Link>
              </Button>
              <Button asChild size="sm">
                <Link href={routes.newScan()}>Run an audit</Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href={routes.login({ mode: "signin" })}>Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href={routes.publicScanAnchor}>Choose a plan</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
