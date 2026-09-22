import type { AuditCoverage } from "@/lib/audit/coverage";
import { providerDisplayName } from "@/lib/constants";

export function AuditCoverageNotice({ coverage }: { coverage: AuditCoverage }) {
  const partial =
    coverage.status === "partial" ||
    coverage.missing > 0 ||
    coverage.failed > 0;
  return (
    <section
      aria-label="Audit coverage"
      className={`rounded-lg border p-4 text-sm ${partial ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-muted/30"}`}
    >
      <p className="font-semibold">
        {partial ? "Partial evidence" : "Audit coverage"} ·{" "}
        {coverage.status.replaceAll("_", " ")}
      </p>
      <p className="mt-1">
        {coverage.questions ?? "Unknown"} distinct questions ·{" "}
        {coverage.testedQuestions} with usable answers
      </p>
      <p className="mt-1">
        {coverage.requested} requested checks · {coverage.successful} successful
        · {coverage.failed} recorded failures · {coverage.missing} without a
        saved result
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Requested providers:{" "}
        {coverage.providers.map(providerDisplayName).join(", ") ||
          "Not recorded"}
        . Missing results may be skipped or unavailable; they are not successful
        checks. A snapshot is not a stable trend.
      </p>
    </section>
  );
}
