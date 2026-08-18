"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuditProgress } from "@/components/scan/audit-progress";
import { useDetachedAudit } from "@/components/scan/use-detached-audit";
import {
  FREE_AUDIT_QUESTION_COUNT,
  PRO_AUDIT_QUESTION_COUNT,
} from "@/lib/constants";
import { routes } from "@/lib/routes";
import type { ProviderId } from "@/types/database";

const STORAGE_KEY = "rbai_audit_add_brand";

export function AddBrandScanForm({
  isPaid,
  brandLimitReached,
  providers,
  initialDomain,
}: {
  isPaid: boolean;
  brandLimitReached: boolean;
  providers: ProviderId[];
  // The domain typed on the homepage before sign-up, waiting here afterwards.
  initialDomain?: string;
}) {
  const router = useRouter();
  const [domain, setDomain] = useState(initialDomain ?? "");
  const { loading, error, progress, step, events, start } = useDetachedAudit({
    storageKey: STORAGE_KEY,
    onDone: (brandId) => router.push(`${routes.brand(brandId)}?completed=1`),
  });

  function startAudit() {
    void start({
      domain,
      mode: isPaid ? "pro" : "free",
      assistants: providers,
      limitPerAssistant: isPaid
        ? PRO_AUDIT_QUESTION_COUNT
        : FREE_AUDIT_QUESTION_COUNT,
    });
  }

  // A domain that arrived from the homepage's pre-signup form means someone
  // already typed it and clicked "see where your brand comes up" once - the
  // whole point of carrying it through sign-up is that they never have to
  // enter it again, so the audit starts itself instead of waiting on a
  // second click at a form they never meant to see.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    if (brandLimitReached || loading || !initialDomain?.trim()) return;
    // A stale run from an earlier visit takes priority - the hook's own
    // mount effect already resumes it, so starting a second one here would
    // race it into two concurrent audits.
    if (localStorage.getItem(STORAGE_KEY)) return;
    void startAudit();
    // Mount-only: startAudit reads `domain`, which useState already seeded
    // from initialDomain, so this reflects the value this effect cares about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (brandLimitReached) {
    return (
      <div className="arc-panel p-6">
        <h2 className="text-lg font-semibold">Website limit reached</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Upgrade your plan to monitor another website.
        </p>
        <div className="mt-4 flex gap-2">
          <Button asChild size="sm"><Link href={routes.billing({ plan: "agency" })}>Upgrade</Link></Button>
          <Button asChild size="sm" variant="outline"><Link href={routes.brands}>View websites</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="arc-panel p-6">
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
      {loading ? (
        <AuditProgress
          progress={progress}
          step={step}
          plan={isPaid ? "pro" : "free"}
          providers={providers}
          questionCount={isPaid ? PRO_AUDIT_QUESTION_COUNT : FREE_AUDIT_QUESTION_COUNT}
          events={events}
        />
      ) : null}
      {error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Audit could not continue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
