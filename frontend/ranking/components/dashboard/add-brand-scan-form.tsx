"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuditProgress } from "@/components/scan/audit-progress";
import {
  FREE_AUDIT_QUESTION_COUNT,
  PRO_AUDIT_QUESTION_COUNT,
} from "@/lib/constants";
import { routes } from "@/lib/routes";
import type { ProviderId } from "@/types/database";

export function AddBrandScanForm({
  isPaid,
  brandLimitReached,
  providers,
}: {
  isPaid: boolean;
  brandLimitReached: boolean;
  providers: ProviderId[];
}) {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  async function startAudit() {
    setLoading(true);
    setError(null);
    setProgress(1);
    setMessage("Starting audit");
    try {
      const res = await fetch("/api/audit-run/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          mode: isPaid ? "pro" : "free",
          assistants: providers,
          limitPerAssistant: isPaid
            ? PRO_AUDIT_QUESTION_COUNT
            : FREE_AUDIT_QUESTION_COUNT,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not start audit");
      }
      await readStream(res.body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start audit");
    } finally {
      setLoading(false);
    }
  }

  async function readStream(body: ReadableStream<Uint8Array>) {
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
          progress?: number;
          message?: string;
          brandId?: string;
        };
        if (typeof event.progress === "number") setProgress(event.progress);
        if (event.message) setMessage(event.message);
        if (event.event === "done" && event.brandId) {
          router.push(routes.brand(event.brandId));
          return;
        }
        if (event.event === "error") throw new Error(event.message || "Audit failed");
      }
    }
  }

  if (brandLimitReached) {
    return (
      <div className="rb-panel p-6">
        <h2 className="text-lg font-semibold">Website limit reached</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Upgrade your plan to monitor another website.
        </p>
        <div className="mt-4 flex gap-2">
          <Button asChild size="sm"><Link href={routes.billing({ plan: "growth" })}>Upgrade</Link></Button>
          <Button asChild size="sm" variant="outline"><Link href={routes.brands}>View websites</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rb-panel p-6">
      <h2 className="text-lg font-semibold">Audit a website</h2>
      {/* Pro moved from five questions to twenty; this line kept promising
          five to the people paying for the deeper run. */}
      <p className="mt-1 text-sm text-muted-foreground">
        {isPaid
          ? `${PRO_AUDIT_QUESTION_COUNT} buyer questions will be checked across ${providers.length} AI ${providers.length === 1 ? "provider" : "providers"}.`
          : `The free audit checks ${FREE_AUDIT_QUESTION_COUNT} buyer questions with one AI provider.`}
      </p>
      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (domain.trim() && !loading) void startAudit();
        }}
      >
        <label htmlFor="dash-domain" className="text-sm font-medium">Company website</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Globe className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="dash-domain" placeholder="yourcompany.com" className="h-11 pl-9" value={domain} onChange={(event) => setDomain(event.target.value)} disabled={loading} />
          </div>
          <Button type="submit" size="lg" className="h-11" disabled={loading || !domain.trim()}>
            {loading ? <><Loader2 className="animate-spin" />Auditing...</> : <>Start audit<ArrowRight data-icon="inline-end" /></>}
          </Button>
        </div>
      </form>
      {loading ? <AuditProgress progress={progress} message={message} questionCount={isPaid ? PRO_AUDIT_QUESTION_COUNT : FREE_AUDIT_QUESTION_COUNT} providerCount={providers.length} /> : null}
      {error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Audit could not continue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
