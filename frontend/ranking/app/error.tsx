"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/site/logo";
import { routes } from "@/lib/routes";

/**
 * The app-level error boundary. The error itself is deliberately not shown:
 * stack traces and database messages help an attacker and frighten a
 * customer. Recovery actions are the whole page.
 */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="arc-atmosphere relative flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div aria-hidden className="arc-mesh pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative w-full max-w-md text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="arc-glass mt-8 p-8">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The page hit a problem it could not recover from. Nothing you did
            caused it, and your data is safe.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={reset}>Try again</Button>
            <Button asChild variant="outline">
              <Link href={routes.dashboard}>Go to dashboard</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Still stuck?{" "}
            <Link href={routes.contact} className="underline hover:text-foreground">
              Contact support
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
