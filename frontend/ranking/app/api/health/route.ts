import { NextResponse } from "next/server";
import { one } from "@/lib/db/pg";

/**
 * Web liveness/readiness. Reports whether the database answers and whether
 * a worker has been seen recently - deployment probes and the admin page
 * both read this.
 */
export async function GET() {
  try {
    const worker = await one<{ last: string | null }>(
      `select max(heartbeat_at)::text as last from scan_runs
       where heartbeat_at > timezone('utc', now()) - interval '10 minutes'`,
    );
    const queue = await one<{ queued: number; running: number }>(
      `select
         count(*) filter (where status = 'queued')::int as queued,
         count(*) filter (where status in ('running', 'cancel_requested'))::int as running
       from scan_runs`,
    );
    return NextResponse.json({
      ok: true,
      db: true,
      workerSeenRecently: Boolean(worker?.last),
      queue: { queued: queue?.queued ?? 0, running: queue?.running ?? 0 },
    });
  } catch {
    return NextResponse.json({ ok: false, db: false }, { status: 503 });
  }
}
