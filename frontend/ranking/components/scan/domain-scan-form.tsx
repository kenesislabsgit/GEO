"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuditProgress } from "@/components/scan/audit-progress";
import {
  FREE_AUDIT_PROVIDER,
  FREE_AUDIT_QUESTION_COUNT,
} from "@/lib/constants";

export function DomainScanForm() {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  // The runner's own step name, not its log line. The wording shown to the
  // customer lives in lib/audit/progress-copy.
  const [scanStep, setScanStep] = useState<string | null>(null);

  async function startAudit() {
    setLoading(true);
    setError(null);
    setScanProgress(1);
    setScanStep("starting");
    try {
      const res = await fetch("/api/audit-run/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          mode: "free",
          assistants: [FREE_AUDIT_PROVIDER],
          limitPerAssistant: FREE_AUDIT_QUESTION_COUNT,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not start audit");
      }
      await readAuditStream(res.body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start audit");
    } finally {
      setLoading(false);
    }
  }

  async function readAuditStream(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
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
          reportPath?: string;
        };
        if (typeof event.progress === "number") setScanProgress(event.progress);
        if (event.step) setScanStep(event.step);
        if (event.event === "done" && event.reportPath) {
          router.push(event.reportPath);
          return;
        }
        if (event.event === "error") {
          throw new Error(event.message || "Audit failed");
        }
      }
    }
  }

  return (
    <div
      id="scan"
      className="w-full rounded-2xl border border-white/70 bg-white/80 p-1.5 shadow-[0_1px_2px_rgba(12,15,20,0.04),0_24px_64px_rgba(12,15,20,0.1)] backdrop-blur-xl"
    >
      <div className="rounded-[14px] bg-white p-4 sm:p-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (domain.trim() && !loading) void startAudit();
          }}
        >
          <label htmlFor="domain" className="text-sm font-medium">
            Company website
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Globe className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="domain"
                placeholder="yourcompany.com"
                className="h-12 rounded-xl border-border/80 bg-[color:var(--rb-mist)] pl-10 text-base shadow-none focus-visible:bg-white"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button type="submit" size="lg" className="h-12 rounded-xl px-6" disabled={loading || !domain.trim()}>
              {loading ? (
                <><Loader2 data-icon="inline-start" className="animate-spin" />Auditing...</>
              ) : (
                <>Start free audit<ArrowRight data-icon="inline-end" /></>
              )}
            </Button>
          </div>
          {!loading ? (
            <p className="mt-3 text-xs text-muted-foreground">
              5 buyer questions · 1 AI provider · no account required
            </p>
          ) : null}
        </form>
        {loading ? (
          <AuditProgress
            progress={scanProgress}
            step={scanStep}
            plan="free"
            providers={[FREE_AUDIT_PROVIDER]}
            questionCount={FREE_AUDIT_QUESTION_COUNT}
          />
        ) : null}
        {error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>Audit could not continue</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
