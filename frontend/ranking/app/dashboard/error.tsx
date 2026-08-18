"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="arc-panel max-w-md p-8 text-center">
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          This page hit a problem
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your audits and data are safe. Try again, or head back to the
          dashboard.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href={routes.dashboard}>Dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
