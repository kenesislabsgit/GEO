"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  const [progress, setProgress] = useState(1);
  const [message, setMessage] = useState("Preparing your full report");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

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
              progress?: number;
              message?: string;
              brandId?: string;
            };
            if (typeof event.progress === "number") setProgress(event.progress);
            if (event.message) setMessage(event.message);
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
      }
    }

    void continueAudit();
  }, [brandId, domain, providers, router]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rb-panel p-6">
        <h1 className="font-heading text-2xl font-semibold">Completing your Pro report</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Reusing the existing website crawl and free results, then collecting the additional provider, competitor, source, and improvement evidence.
        </p>
        <AuditProgress
          progress={progress}
          message={message}
          questionCount={5}
          providerCount={providers.length}
        />
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
