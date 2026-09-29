import Link from "next/link";
import type { AuditCoverage } from "@/lib/audit/coverage";
import { providerDisplayName } from "@/lib/constants";

export function AuditCoverageNotice({
  coverage,
  detailsHref,
  retryHref,
}: {
  coverage: AuditCoverage;
  detailsHref?: string;
  retryHref?: string;
}) {
  const incomplete =
    coverage.status !== "completed" ||
    coverage.missing > 0 ||
    coverage.failed > 0;
  const available = coverage.assistants.filter(
    (assistant) => assistant.successful > 0,
  );
  const complete = available.filter(
    (assistant) =>
      assistant.requested != null &&
      assistant.successful >= assistant.requested,
  );
  const availability =
    coverage.successful > 0 && coverage.missing === 0 && coverage.failed === 0
      ? "AI answers are available, but this audit stopped before all analysis finished."
      : complete.length && complete.length < coverage.providers.length
        ? complete
            .map((assistant) => providerDisplayName(assistant.provider))
            .join(", ") +
          " results are available, with limited coverage from the other selected assistants."
        : available.length
          ? coverage.successful +
            " AI answers are available from " +
            available
              .map((assistant) => providerDisplayName(assistant.provider))
              .join(", ") +
            "; some requested results are unavailable."
          : "Results are not available for this audit. Run it again to get a new result.";
  return (
    <section
      aria-label="Audit coverage"
      className={
        "rounded-lg border px-4 py-3 text-sm " +
        (incomplete ? "border-amber-500/40 bg-amber-500/5" : "border-border")
      }
    >
      {incomplete ? (
        <>
          <p className="font-semibold">Audit incomplete</p>
          <p className="mt-1 text-muted-foreground">{availability}</p>
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {coverage.questions != null ? (
          <p className={incomplete ? "mt-2" : ""}>
            {coverage.questions} buyer questions
          </p>
        ) : null}
        {detailsHref ? (
          <Link
            href={detailsHref}
            className="inline-flex min-h-11 items-center text-[color:var(--arc-accent)] hover:underline"
          >
            View audit details
          </Link>
        ) : null}
        {incomplete && retryHref ? (
          <Link
            href={retryHref}
            className="inline-flex min-h-11 items-center text-[color:var(--arc-accent)] hover:underline"
          >
            Run again
          </Link>
        ) : null}
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer py-2">Coverage details</summary>
        <p>
          {coverage.requested} checks requested · {coverage.successful} answers
          available · {coverage.failed} failed · {coverage.missing} unavailable
        </p>
        <ul className="mt-2 space-y-1">
          {coverage.assistants.map((assistant) => (
            <li key={assistant.provider}>
              {providerDisplayName(assistant.provider)}: {assistant.successful}
              {assistant.requested != null
                ? " of " + assistant.requested
                : ""}{" "}
              answers available
              {assistant.failed ? " · " + assistant.failed + " failed" : ""}
            </li>
          ))}
        </ul>
        {coverage.questions == null ? (
          <p className="mt-2">
            The question count is unavailable for this older audit.
          </p>
        ) : null}
        {coverage.missing > 0 ? (
          <p className="mt-2">
            Unavailable results are excluded from these findings.
          </p>
        ) : null}
      </details>
    </section>
  );
}
