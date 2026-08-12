"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuditProgress } from "@/components/scan/audit-progress";
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
  const started = useRef(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(1);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A Pro run costs real money and about five minutes, so it waits for a
  // click. This used to start on mount, which meant a refresh, a back-then-
  // forward, or a second tab each paid for another full audit.
  function startAudit() {
    if (started.current) return;
    started.current = true;
    setRunning(true);
    setStep("starting");
    setError(null);

    async function continueAudit() {
      try {
        const response = await fetch("/api/audit-run/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandId,
            domain,
            mode: "pro",
            assistants: providers,
            limitPerAssistant: PRO_AUDIT_QUESTION_COUNT,
            resume: true,
          }),
        });
        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Could not continue the audit");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as {
              event?: string;
              step?: string;
              progress?: number;
              message?: string;
              brandId?: string;
            };
            if (typeof event.progress === "number") setProgress(event.progress);
            if (event.step) setStep(event.step);
            if (event.event === "error") {
              throw new Error(event.message || "Audit continuation failed");
            }
            if (event.event === "done") {
              router.replace(routes.brand(event.brandId ?? brandId));
              router.refresh();
              return;
            }
          }
        }
        throw new Error("The audit ended before the report was saved");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Audit continuation failed");
        // Let them try again without reloading the page.
        started.current = false;
        setRunning(false);
      }
    }

    void continueAudit();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rb-panel p-6">
        <h1 className="font-heading text-2xl font-semibold">Completing your Pro report</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Reusing the existing website crawl and free results, then collecting the additional provider, competitor, source, and improvement evidence.
        </p>
        {running ? (
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
