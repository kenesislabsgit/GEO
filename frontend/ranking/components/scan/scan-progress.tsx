"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  activeStageIndex,
  auditStages,
  type AuditPlan,
} from "@/lib/audit/progress-copy";
import { ThinkingOrb } from "thinking-orbs";
import {
  orbStateForStage,
  ReasoningTimeline,
} from "@/components/scan/reasoning-timeline";
import type { AuditFeedEvent } from "@/components/scan/use-detached-audit";
import { ProviderBadge } from "@/components/providers/provider-logo";
import { routes } from "@/lib/routes";

type ProgressState = {
  status: string;
  step: string | null;
  progress: number;
  completedQueries: number;
  totalQueries: number;
  slug: string | null;
  errorSummary: string | null;
  providers?: string[];
  events?: AuditFeedEvent[];
  cancelRequested?: boolean;
};

export type ScanDestination =
  | { type: "public" }
  | { type: "dashboard"; brandId: string };

const ENDED_BADLY = new Set(["failed", "cancelled", "timed_out"]);

export function ScanProgress({
  scanId,
  destination = { type: "public" },
  plan = "free",
}: {
  scanId: string;
  destination?: ScanDestination;
  /** Chooses the stage list - pro audits have more visible stages. */
  plan?: AuditPlan;
}) {
  const router = useRouter();
  const [state, setState] = useState<ProgressState | null>(null);
  const [events, setEvents] = useState<AuditFeedEvent[]>([]);
  const [unreachable, setUnreachable] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const lastSeq = useRef(0);

  const destType = destination.type;
  const destBrandId =
    destination.type === "dashboard" ? destination.brandId : null;

  useEffect(() => {
    let alive = true;
    let failures = 0;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/scans/${scanId}/progress?after=${lastSeq.current}`,
        );
        if (!res.ok) {
          failures += 1;
          if (failures >= 5 && alive) setUnreachable(true);
          return;
        }
        failures = 0;
        const data = (await res.json()) as ProgressState;
        if (!alive) return;
        setUnreachable(false);
        setState(data);
        if (data.events?.length) {
          const fresh = data.events;
          lastSeq.current = Math.max(
            lastSeq.current,
            ...fresh.map((event) => event.seq),
          );
          setEvents((current) => [...current, ...fresh].slice(-200));
        }
        if (data.status === "completed" || data.status === "partial") {
          if (destType === "dashboard" && destBrandId) {
            router.push(routes.brand(destBrandId));
          } else if (data.slug) {
            router.push(routes.publicReport(data.slug));
          }
        }
      } catch {
        failures += 1;
        if (failures >= 5 && alive) setUnreachable(true);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [scanId, router, destType, destBrandId]);

  async function retry() {
    if (destination.type !== "dashboard") return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/scans/${scanId}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Retry failed");
      // The same scan re-enters the queue under its stored settings; this
      // page keeps polling the same id.
      lastSeq.current = 0;
      setEvents([]);
      setRetrying(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
      setRetrying(false);
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/scans/${scanId}/cancel`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cancel failed");
      toast.success("Cancellation requested. The audit is stopping.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  const progress = state?.progress ?? 0;
  const failed = ENDED_BADLY.has(state?.status ?? "");
  const queued = state?.status === "queued";
  const stopping =
    state?.status === "cancel_requested" || Boolean(state?.cancelRequested);
  const stages = auditStages(plan);
  const activeIdx = activeStageIndex(stages, state?.step ?? null, progress);

  const providers = state?.providers ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Header: what's happening and how far along, at page scale. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-4">
          {!failed ? (
            <ThinkingOrb
              state={orbStateForStage(stages[activeIdx]?.id)}
              size={64}
              aria-label="Audit running"
              className="shrink-0"
            />
          ) : null}
          <div className="min-w-0">
            <p className="arc-eyebrow">
              {failed
                ? "Audit stopped"
                : queued
                  ? "Audit queued"
                  : stopping
                    ? "Stopping"
                    : "Live audit"}
            </p>
            <h1 className="font-heading mt-1.5 text-2xl font-semibold tracking-tight">
              {failed ? (
                "Scan did not complete"
              ) : queued ? (
                "Waiting for the next available audit slot"
              ) : stopping ? (
                "Stopping this audit"
              ) : (
                <span className="arc-shimmer">
                  Running your AI visibility audit
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {destination.type === "dashboard"
                ? "You can leave this page - the audit keeps running."
                : "Live progress from the job queue - not a simulated timer."}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="arc-tabular font-heading text-4xl font-semibold tracking-tight">
            {Math.round(progress)}
            <span className="text-xl text-muted-foreground">%</span>
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {state
              ? `${state.completedQueries}/${state.totalQueries} checks · ${state.status.replace("_", " ")}`
              : "connecting…"}
          </p>
        </div>
      </div>
      <Progress value={progress} className="mt-4" />

      {queued ? (
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <Clock className="size-4 shrink-0" aria-hidden />
          Your audit is in the queue and starts as soon as a worker is free.
          This page updates by itself.
        </div>
      ) : null}

      {!failed && !queued ? (
        <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1fr_240px]">
          {/* The audit as reasoning steps, with the live feed inside. */}
          <section className="arc-panel p-5">
            <ReasoningTimeline
              stages={stages}
              activeIndex={activeIdx}
              complete={
                state?.status === "completed" || state?.status === "partial"
              }
              providers={providers}
              events={events}
            />
          </section>

          {/* Who is being asked. */}
          <aside className="arc-panel p-5">
            <p className="arc-eyebrow">Asking</p>
            {providers.length > 0 ? (
              <div className="mt-3 space-y-2.5 text-sm">
                {providers.map((provider) => (
                  <ProviderBadge key={provider} provider={provider} />
                ))}
              </div>
            ) : (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Connecting…
              </p>
            )}
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Each provider answers the same buyer questions. Every answer is
                stored with who was recommended and why.
              </p>
            </div>
          </aside>
        </div>
      ) : null}

      {(queued || (!failed && !stopping && state)) &&
      destination.type === "dashboard" ? (
        <div className="mt-4">
          <Button
            size="sm"
            variant="outline"
            onClick={cancel}
            disabled={cancelling}
          >
            {cancelling ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <XCircle data-icon="inline-start" />
            )}
            Cancel audit
          </Button>
        </div>
      ) : null}

      {state?.errorSummary && state.status === "partial" ? (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Partial failures</AlertTitle>
          <AlertDescription>{state.errorSummary}</AlertDescription>
        </Alert>
      ) : null}
      {failed ? (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>
            {state?.status === "cancelled"
              ? "Scan cancelled"
              : state?.status === "timed_out"
                ? "Scan timed out"
                : "Scan failed"}
          </AlertTitle>
          <AlertDescription>
            <p>
              {state?.errorSummary ??
                "The audit did not finish. Unused provider checks were released."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {destination.type === "dashboard" ? (
                <>
                  <Button size="sm" onClick={retry} disabled={retrying}>
                    {retrying ? (
                      <>
                        <Loader2
                          data-icon="inline-start"
                          className="animate-spin"
                        />
                        Retrying…
                      </>
                    ) : (
                      <>
                        <RefreshCw data-icon="inline-start" />
                        Retry with the same settings
                      </>
                    )}
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={routes.brand(destination.brandId)}>
                      Back to brand
                    </Link>
                  </Button>
                </>
              ) : (
                <Button asChild size="sm" variant="outline">
                  <Link href={routes.home}>Back to home</Link>
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      {unreachable ? (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Connection issue</AlertTitle>
          <AlertDescription>
            We can&apos;t reach the scan right now. We&apos;ll keep retrying
            automatically - leave this page open.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
