/**
 * Live audit events, held in memory by the process that owns the Python run.
 * The audit runner and the API routes share one Node process today (and the
 * progress row in scan_runs remains the durable source of truth), so a ring
 * buffer here is enough to give the progress page a live feed without a
 * schema change. When the audit moves to a separate worker, these events
 * should move to a table or a pub/sub channel with it.
 */

export type AuditProgressEvent = {
  /** Monotonic per-scan sequence number, for client-side dedup. */
  seq: number;
  at: string;
  step: string;
  progress: number;
  message: string | null;
  assistant: string | null;
  questions: string[];
};

const MAX_EVENTS_PER_SCAN = 200;
const MAX_TRACKED_SCANS = 50;

const buffers = new Map<string, AuditProgressEvent[]>();
const sequences = new Map<string, number>();

export function recordAuditEvent(
  scanRunId: string,
  event: Omit<AuditProgressEvent, "seq" | "at">,
): void {
  const seq = (sequences.get(scanRunId) ?? 0) + 1;
  sequences.set(scanRunId, seq);

  let buffer = buffers.get(scanRunId);
  if (!buffer) {
    // Cap how many scans are tracked so a long-lived process cannot grow
    // without bound; the oldest tracked scan is dropped first.
    if (buffers.size >= MAX_TRACKED_SCANS) {
      const oldest = buffers.keys().next().value;
      if (oldest) {
        buffers.delete(oldest);
        sequences.delete(oldest);
      }
    }
    buffer = [];
    buffers.set(scanRunId, buffer);
  }

  buffer.push({ ...event, seq, at: new Date().toISOString() });
  if (buffer.length > MAX_EVENTS_PER_SCAN) {
    buffer.splice(0, buffer.length - MAX_EVENTS_PER_SCAN);
  }
}

export function getAuditEvents(
  scanRunId: string,
  afterSeq = 0,
): AuditProgressEvent[] {
  const buffer = buffers.get(scanRunId);
  if (!buffer) return [];
  return afterSeq > 0 ? buffer.filter((event) => event.seq > afterSeq) : buffer;
}
