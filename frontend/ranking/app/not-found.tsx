import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/site/logo";
import { routes } from "@/lib/routes";

export default function NotFound() {
  return (
    <main className="rb-atmosphere relative flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div aria-hidden className="rb-mesh pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative w-full max-w-md text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="rb-glass mt-8 p-8">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            404
          </p>
          <h1 className="font-heading mt-2 text-2xl font-semibold tracking-tight">
            This page does not exist
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The link may be old, or the page may have moved.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button asChild>
              <Link href={routes.dashboard}>Go to dashboard</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={routes.home}>Back to home</Link>
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
