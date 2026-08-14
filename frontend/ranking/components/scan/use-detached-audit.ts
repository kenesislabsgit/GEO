"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const storageKey = options.storageKey;
  useEffect(() => {
    onDoneRef.current = options.onDone;
  }, [options.onDone]);

  const stopPolling = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // The poll re-arms itself through this ref so the callback never has to
  // name itself before it exists.
  const pollRef = useRef<(scanRunId: string) => Promise<void>>(
    async () => {},
  );
  const poll = useCallback(
    async (scanRunId: string) => {
      let response: ProgressResponse;
      try {
        const res = await fetch(
          `/api/scans/${scanRunId}/progress?after=${lastSeq.current}`,
        );
        if (!res.ok) throw new Error("Could not read audit progress.");
        response = (await res.json()) as ProgressResponse;
      } catch {
        // One failed poll is a blip, not a dead audit. Ask again shortly.
        timer.current = setTimeout(
          () => void pollRef.current(scanRunId),
          POLL_MS * 2,
        );
        return;
      }

      if (typeof response.progress === "number") setProgress(response.progress);
      if (response.step) setStep(response.step);
      if (response.events?.length) {
        const fresh = response.events;
        lastSeq.current = Math.max(
          lastSeq.current,
          ...fresh.map((event) => event.seq),
        );
        setEvents((current) =>
          [...current, ...fresh].slice(-MAX_FEED_EVENTS),
        );
      }

      if (response.status === "completed" || response.status === "partial") {
        localStorage.removeItem(storageKey);
        setLoading(false);
        if (response.brandId) onDoneRef.current(response.brandId);
        return;
      }
      if (
        response.status === "failed" ||
        response.status === "cancelled" ||
        response.status === "timed_out"
      ) {
        localStorage.removeItem(storageKey);
        setLoading(false);
        setError(response.errorSummary || "The audit failed.");
        return;
      }
      timer.current = setTimeout(
        () => void pollRef.current(scanRunId),
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
      localStorage.setItem(storageKey, scanRunId);
      setLoading(true);
      setError(null);
      void poll(scanRunId);
    },
    [poll, storageKey],
  );

  const start = useCallback(
    async (body: Record<string, unknown>) => {
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
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, idempotencyKey }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          scanRunId?: string;
          error?: string;
          code?: string;
        };
        if (data.code === "email_unverified") {
          // The audit needs a confirmed address; the page there explains and
          // offers a resend.
          window.location.assign("/verify-email");
          return;
        }
        if (!res.ok || !data.scanRunId) {
          throw new Error(data.error || "Could not start audit");
        }
        track(data.scanRunId);
      } catch (err) {
        setLoading(false);
        setError(err instanceof Error ? err.message : "Could not start audit");
      }
    },
    [track],
  );

  // A reload lands here: if an audit was running for this form, keep showing
  // it rather than pretending nothing is happening. Resuming is deferred a
  // tick so the effect itself does not set state synchronously.
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return stopPolling;
    const id = setTimeout(() => track(stored), 0);
    return () => {
      clearTimeout(id);
      stopPolling();
    };
  }, [storageKey, track, stopPolling]);

  return { loading, error, progress, step, events, start };
}
