"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  auditStorageKey,
  readAuditRun,
  storeAuditRun,
} from "@/lib/scans/client-storage";

/**
 * Client side of the detached audit. Starting returns an id at once; the run
 * belongs to the server. This hook polls the run's progress row and - because
 * the id is kept in localStorage - picks a still-running audit back up after
 * a reload or a wander to another tab, which used to kill it.
 */

export type AuditFeedEvent = {
  seq: number;
  at: string;
  step: string;
  progress: number;
  message: string | null;
  assistant: string | null;
  questions: string[];
};

type ProgressResponse = {
  status: string;
  step: string | null;
  progress: number;
  brandId: string | null;
  errorSummary: string | null;
  events?: AuditFeedEvent[];
};

const POLL_MS = 2500;
const MAX_FEED_EVENTS = 40;

export function useDetachedAudit(options: {
  storageKey: string;
  userId: string;
  onDone: (brandId: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState<string | null>(null);
  const [events, setEvents] = useState<AuditFeedEvent[]>([]);
  const lastSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDoneRef = useRef(options.onDone);
  const storageKey = auditStorageKey(options.storageKey, options.userId);
  const alive = useRef(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const starting = useRef(false);
  useEffect(() => {
    onDoneRef.current = options.onDone;
  }, [options.onDone]);

  const stopPolling = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // The poll re-arms itself through this ref so the callback never has to
  // name itself before it exists.
  const pollRef = useRef<
    (scanRunId: string, run: number, failures?: number) => Promise<void>
  >(async () => {});
  const poll = useCallback(
    async (scanRunId: string, run: number, failures = 0) => {
      const current = () => alive.current && generation.current === run;
      if (!current()) return;
      const controller = new AbortController();
      request.current = controller;
      const timeout = setTimeout(() => controller.abort(), 15_000);
      let response: ProgressResponse;
      try {
        const res = await fetch(
          `/api/scans/${encodeURIComponent(scanRunId)}/progress?after=${lastSeq.current}`,
          { signal: controller.signal },
        );
        if (!current()) return;
        if ([400, 401, 403, 404, 410].includes(res.status)) {
          storeAuditRun(storageKey, null);
          setLoading(false);
          setError(
            res.status === 401
              ? "Your session expired. Sign in again to view your audit."
              : "This saved audit is no longer available. You can start another audit.",
          );
          return;
        }
        if (!res.ok) throw new Error("Could not read audit progress.");
        response = (await res.json()) as ProgressResponse;
      } catch {
        if (!current()) return;
        if (failures >= 5) {
          setLoading(false);
          setError(
            "Could not reconnect to your audit. It may still be running; reload to check its progress.",
          );
          return;
        }
        timer.current = setTimeout(
          () => void pollRef.current(scanRunId, run, failures + 1),
          POLL_MS * 2,
        );
        return;
      } finally {
        clearTimeout(timeout);
      }

      if (!current()) return;

      if (typeof response.progress === "number") setProgress(response.progress);
      if (response.step) setStep(response.step);
      if (response.events?.length) {
        const fresh = response.events;
        lastSeq.current = Math.max(
          lastSeq.current,
          ...fresh.map((event) => event.seq),
        );
        setEvents((current) => [...current, ...fresh].slice(-MAX_FEED_EVENTS));
      }

      if (response.status === "completed" || response.status === "partial") {
        storeAuditRun(storageKey, null);
        setLoading(false);
        if (response.brandId) onDoneRef.current(response.brandId);
        return;
      }
      if (
        response.status === "failed" ||
        response.status === "cancelled" ||
        response.status === "timed_out"
      ) {
        storeAuditRun(storageKey, null);
        setLoading(false);
        setError(response.errorSummary || "The audit failed.");
        return;
      }
      timer.current = setTimeout(
        () => void pollRef.current(scanRunId, run),
        POLL_MS,
      );
    },
    [storageKey],
  );
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  const track = useCallback(
    (scanRunId: string) => {
      stopPolling();
      storeAuditRun(storageKey, scanRunId);
      lastSeq.current = 0;
      setEvents([]);
      setLoading(true);
      setError(null);
      void poll(scanRunId, generation.current);
    },
    [poll, storageKey, stopPolling],
  );

  const start = useCallback(
    async (body: Record<string, unknown>) => {
      if (starting.current) return;
      starting.current = true;
      stopPolling();
      const run = generation.current;
      setLoading(true);
      setError(null);
      setProgress(1);
      setStep("starting");
      try {
        // One key per click: a network retry of this exact request joins the
        // scan it already created instead of paying for a second one.
        const idempotencyKey =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const res = await fetch("/api/audit-run/start", {
          signal: AbortSignal.timeout(30_000),
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, idempotencyKey }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          scanRunId?: string;
          error?: string;
          code?: string;
        };
        // A started job survives navigation; retain its ID for the next visit.
        if (res.ok && data.scanRunId) storeAuditRun(storageKey, data.scanRunId);
        if (!alive.current || generation.current !== run) return;
        if (!res.ok || !data.scanRunId) {
          throw new Error(data.error || "Could not start audit");
        }
        track(data.scanRunId);
      } catch (err) {
        if (!alive.current || generation.current !== run) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : "Could not start audit");
      } finally {
        starting.current = false;
      }
    },
    [track, stopPolling, storageKey],
  );

  // A reload lands here: if an audit was running for this form, keep showing
  // it rather than pretending nothing is happening. Resuming is deferred a
  // tick so the effect itself does not set state synchronously.
  useEffect(() => {
    alive.current = true;
    const stored = readAuditRun(storageKey);
    const id = stored ? setTimeout(() => track(stored), 0) : undefined;
    return () => {
      alive.current = false;
      clearTimeout(id);
      stopPolling();
    };
  }, [storageKey, track, stopPolling]);

  return { loading, error, progress, step, events, start };
}
