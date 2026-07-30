"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

type ProgressState = {
  status: string;
  progress: number;
  completedQueries: number;
  totalQueries: number;
  slug: string | null;
  demoMode: boolean;
  errorSummary: string | null;
};

const STAGES = [
  { at: 0, label: "Reading website" },
  { at: 4, label: "Understanding company" },
  { at: 8, label: "Preparing buyer questions" },
  { at: 12, label: "Checking AI providers" },
  { at: 70, label: "Analysing mentions" },
  { at: 80, label: "Comparing competitors" },
  { at: 88, label: "Finding sources" },
  { at: 94, label: "Calculating score" },
  { at: 98, label: "Preparing report" },
] as const;

export type ScanDestination =
  | { type: "public" }
  | { type: "dashboard"; brandId: string };

export function ScanProgress({
  scanId,
  destination = { type: "public" },
}: {
  scanId: string;
  destination?: ScanDestination;
}) {
  const router = useRouter();
  const [state, setState] = useState<ProgressState | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const terminal =
    state?.status === "completed" ||
    state?.status === "partial" ||
    state?.status === "failed" ||
    state?.status === "cancelled";

  const destType = destination.type;
  const destBrandId =
    destination.type === "dashboard" ? destination.brandId : null;

  useEffect(() => {
    let alive = true;
    let failures = 0;
    const tick = async () => {
      try {
        const res = await fetch(`/api/scans/${scanId}/progress`);
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
      const res = await fetch("/api/scans/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: destination.brandId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Retry failed");
      router.push(routes.scanProgress(data.scanRunId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
      setRetrying(false);
    }
  }

  const progress = state?.progress ?? 0;
  const failed = state?.status === "failed" || state?.status === "cancelled";

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="rb-glass p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-[color:var(--rb-mist)]">
            {failed ? (
              <RefreshCw className="size-4.5 text-destructive" />
            ) : (
              <Loader2 className="size-4.5 animate-spin text-foreground" />
            )}
          </div>
          <div>
            <h1 className="font-heading text-xl font-semibold tracking-tight">
              {failed
                ? "Scan did not complete"
                : "Running your AI visibility scan"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {destination.type === "dashboard"
                ? "You can leave this page — the scan keeps running."
                : "Live progress from the job queue — not a simulated timer."}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {state
                ? `${state.completedQueries} of ${state.totalQueries} provider checks · ${state.status}`
                : "Connecting…"}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="mt-2" />
        </div>

        {!failed ? (
          <ol className="mt-6 space-y-2.5">
            {STAGES.map((stage, i) => {
              const done =
                progress > (STAGES[i + 1]?.at ?? 100) ||
                state?.status === "completed" ||
                state?.status === "partial";
              const active = !done && progress >= stage.at && !terminal;
              return (
                <li key={stage.label} className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                      done
                        ? "border-foreground bg-foreground text-background"
                        : active
                          ? "border-foreground"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {done ? (
                      <Check className="size-3" />
                    ) : active ? (
                      <span className="size-1.5 animate-pulse rounded-full bg-foreground" />
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "text-sm",
                      done || active
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {stage.label}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}

        {state?.demoMode && !failed ? (
          <Alert className="mt-6">
            <AlertTitle>Demo mode</AlertTitle>
            <AlertDescription>
              Provider API keys are not configured, so this scan uses labelled
              fixtures. The live OpenAI, Gemini, and Perplexity integrations
              remain fully wired.
            </AlertDescription>
          </Alert>
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
              {state?.status === "cancelled" ? "Scan cancelled" : "Scan failed"}
            </AlertTitle>
            <AlertDescription>
              <p>
                {state?.errorSummary ??
                  "All provider checks failed. No usage was consumed for failed checks."}
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
                          Retry scan
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
              automatically — leave this page open.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
