import Link from "next/link";
import type { PublicReportDTO } from "@/lib/reports/public-dto";
import { utcTimestamp } from "@/lib/reports/presentation";
import { providerDisplayName } from "@/lib/constants";
import { routes } from "@/lib/routes";

export function MethodologyPanel({ scan }: { scan: PublicReportDTO["scan"] }) {
  return <section aria-label="Run methodology" className="mx-auto max-w-6xl px-4 py-8 md:px-6">
    <details className="rounded-xl border border-border p-4" open>
      <summary className="cursor-pointer text-sm font-semibold">Run methodology · {scan.methodologyVersion}</summary>
      <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
        <div><dt className="font-medium">Provider and exact stored model</dt><dd className="mt-1 space-y-1 break-words text-muted-foreground">{scan.sampling.models.length ? scan.sampling.models.map((entry) => <p key={`${entry.provider}:${entry.model}`}>{providerDisplayName(entry.provider)} · {entry.model}</p>) : "Not recorded"}</dd></div>
        <div><dt className="font-medium">Timestamps and time zone</dt><dd className="mt-1 text-muted-foreground">{scan.sampling.timestampLabel}: {utcTimestamp(scan.createdAt)}{scan.completedAt && scan.sampling.timestampLabel === "Scan created" ? <p>Completed: {utcTimestamp(scan.completedAt)}</p> : null}</dd></div>
        <div><dt className="font-medium">Sample count</dt><dd className="mt-1 text-muted-foreground">{scan.sampling.answerCount} usable {scan.sampling.answerCount === 1 ? "answer" : "answers"} across {scan.promptCount} {scan.promptCount === 1 ? "question" : "questions"}. {scan.sampling.failedCount} unusable or failed responses. {scan.sampling.repetitions}.</dd></div>
        <div><dt className="font-medium">Sampling settings</dt><dd className="mt-1 text-muted-foreground">{scan.sampling.settings} Provider API answers may differ from consumer chat apps.</dd></div>
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">This audit is a snapshot, not evidence of a stable trend. Compare repeated runs using the same questions and models. <Link href={routes.methodology} className="underline underline-offset-4">Read the methodology</Link>.</p>
    </details>
  </section>;
}
