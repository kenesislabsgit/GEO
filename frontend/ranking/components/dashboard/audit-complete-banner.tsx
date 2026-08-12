"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";

/**
 * Shown once, straight after an audit finishes — the arrival "?completed=1"
 * only ever comes from the audit redirect, so ordinary visits never see it.
 * Dismissing just cleans the URL.
 */
export function AuditCompleteBanner() {
  const router = useRouter();
  const params = useSearchParams();
  if (params.get("completed") !== "1") return null;

  return (
    <div className="mb-6 flex items-start justify-between gap-3 rounded-lg border border-[color:var(--rb-blue)]/30 bg-[color:var(--rb-blue-soft)] px-4 py-3 text-sm">
      <div className="flex gap-2.5">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[color:var(--rb-blue)]" aria-hidden />
        <div>
          <p className="font-medium">Your audit is ready</p>
          <p className="mt-0.5 text-muted-foreground">
            Your score is below, with who AI recommends instead, the pages it
            read, and what to improve first.
          </p>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        onClick={() => router.replace(window.location.pathname)}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
