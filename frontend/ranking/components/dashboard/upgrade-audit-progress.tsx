"use client";

import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuditProgress } from "@/components/scan/audit-progress";
import { useDetachedAudit } from "@/components/scan/use-detached-audit";
import { PRO_AUDIT_QUESTION_COUNT } from "@/lib/constants";
import { routes } from "@/lib/routes";
import type { ProviderId } from "@/types/database";

export function UpgradeAuditProgress({
  brandId,
  domain,
  providers,
}: {
  brandId: string;
  domain: string;
  providers: ProviderId[];
}) {
  const router = useRouter();
  // The run belongs to the server; this page only watches it. Reloading picks
  // the same run back up, and the server refuses to start a second run for
  // the same website while one is going — so a refresh cannot double-pay.
  const { loading, error, progress, step, start } = useDetachedAudit({
    storageKey: `rbai_audit_upgrade_${brandId}`,
    onDone: (doneBrandId) => {
      router.replace(routes.brand(doneBrandId));
      router.refresh();
    },
  });

  // A Pro run costs real money and about five minutes, so it waits for a
  // click. This used to start on mount, which meant a refresh, a back-then-
  // forward, or a second tab each paid for another full audit.
  function startAudit() {
    void start({
      brandId,
      domain,
      mode: "pro",
      assistants: providers,
      limitPerAssistant: PRO_AUDIT_QUESTION_COUNT,
      resume: true,
    });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rb-panel p-6">
        <h1 className="font-heading text-2xl font-semibold">Completing your Pro report</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Reusing the existing website crawl and free results, then collecting the additional provider, competitor, source, and improvement evidence.
        </p>
        {loading ? (
          <AuditProgress
            progress={progress}
            step={step}
            plan="pro"
            providers={providers}
            questionCount={PRO_AUDIT_QUESTION_COUNT}
          />
        ) : (
          <div className="mt-5 border-t border-border pt-5">
            <p className="text-sm text-muted-foreground">
              {PRO_AUDIT_QUESTION_COUNT} buyer questions across{" "}
              {providers.length} AI {providers.length === 1 ? "provider" : "providers"}.
              This takes about five minutes.
            </p>
            <Button className="mt-4 w-full" onClick={startAudit}>
              <Play data-icon="inline-start" />
              Start my Pro audit
            </Button>
          </div>
        )}
        {error ? (
          <Alert variant="destructive" className="mt-5">
            <AlertTitle>Could not complete the report</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
