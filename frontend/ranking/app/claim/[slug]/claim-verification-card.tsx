"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type StartResponse = {
  verificationId: string;
  domain: string;
  txtRecord: string;
  wellKnownUrl: string;
  wellKnownContent: string;
  error?: string;
};

export function ClaimVerificationCard({
  slug,
  domain,
}: {
  slug: string;
  domain: string;
}) {
  const router = useRouter();
  const [started, setStarted] = useState<StartResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    try {
      const res = await fetch("/api/claim/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = (await res.json()) as StartResponse;
      if (!res.ok) throw new Error(data.error || "Could not start verification");
      setStarted(data);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start verification",
      );
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!started) return;
    setBusy(true);
    setCheckError(null);
    try {
      const res = await fetch("/api/claim/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verificationId: started.verificationId }),
      });
      const data = (await res.json()) as { redirect?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Verification failed");
      toast.success("Domain verified - the report is yours.");
      router.push(data.redirect ?? "/dashboard");
    } catch (error) {
      setCheckError(
        error instanceof Error ? error.message : "Verification failed",
      );
    } finally {
      setBusy(false);
    }
  }

  function copy(value: string) {
    void navigator.clipboard.writeText(value).then(() => toast.success("Copied"));
  }

  if (!started) {
    return (
      <div className="arc-panel p-6">
        <p className="text-sm text-muted-foreground">
          You&apos;ll get a token to publish either as a DNS TXT record on{" "}
          <span className="font-mono">{domain}</span> or as a small file on the
          website. Either proves control.
        </p>
        <Button className="mt-4" onClick={start} disabled={busy}>
          {busy ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <ShieldCheck data-icon="inline-start" />
          )}
          Start verification
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="arc-panel p-6">
        <p className="text-sm font-medium">Option A - DNS TXT record</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add this TXT record to <span className="font-mono">{domain}</span> at
          your DNS provider:
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="block flex-1 overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
            {started.txtRecord}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copy(started.txtRecord)}
          >
            <Copy data-icon="inline-start" />
            Copy
          </Button>
        </div>
      </div>
      <div className="arc-panel p-6">
        <p className="text-sm font-medium">Option B - verification file</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Serve a plain-text file at{" "}
          <span className="font-mono break-all">{started.wellKnownUrl}</span>{" "}
          containing exactly:
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="block flex-1 overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
            {started.wellKnownContent}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copy(started.wellKnownContent)}
          >
            <Copy data-icon="inline-start" />
            Copy
          </Button>
        </div>
      </div>

      {checkError ? (
        <Alert variant="destructive">
          <AlertTitle>Not verified yet</AlertTitle>
          <AlertDescription>{checkError}</AlertDescription>
        </Alert>
      ) : null}

      <Button onClick={check} disabled={busy}>
        {busy ? (
          <Loader2 data-icon="inline-start" className="animate-spin" />
        ) : (
          <CheckCircle2 data-icon="inline-start" />
        )}
        I&apos;ve published it - check now
      </Button>
    </div>
  );
}
