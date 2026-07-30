import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/site/logo";
import { getSessionUser } from "@/lib/auth/session";
import { routes } from "@/lib/routes";

const nav = [
  { href: routes.pricing, label: "Pricing" },
  { href: routes.methodology, label: "Methodology" },
];

export async function SiteHeader() {
  const user = await getSessionUser();

  return (
    <header className="sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-4 pt-3 md:px-6">
        <div className="flex h-12 items-center justify-between rounded-full border border-border/80 bg-white/70 px-3 shadow-[0_8px_30px_rgba(12,15,20,0.04)] backdrop-blur-xl md:h-14 md:px-4">
          <div className="flex items-center gap-6">
            <Logo />
            <nav className="hidden items-center gap-0.5 md:flex">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-1.5">
            {user ? (
              <>
                <Button asChild variant="ghost" size="sm" className="rounded-full">
                  <Link href={routes.dashboard}>Dashboard</Link>
                </Button>
                <Button asChild size="sm" className="rounded-full">
                  <Link href={routes.newScan()}>Run an audit</Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="rounded-full">
                  <Link href={routes.login({ mode: "signin" })}>Sign in</Link>
                </Button>
                <Button asChild size="sm" className="rounded-full">
                  <Link href={routes.publicScanAnchor}>Choose a plan</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
