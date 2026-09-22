import type { QueryResult, ScanQuestion, ScanRun } from "@/types/database";

export function questionKey(
  result: Pick<QueryResult, "question_position" | "tracked_prompt_id" | "id">,
) {
  return result.question_position != null
    ? `position:${result.question_position}`
    : (result.tracked_prompt_id ?? `unknown:${result.id}`);
}

/** Describe saved evidence, without treating an absent response as a recorded failure. */
export function auditCoverage(
  scan: ScanRun,
  results: QueryResult[],
  questions: ScanQuestion[] = [],
) {
  const tested = new Set(
    results
      .filter(
        (row) =>
          !row.error && (row.raw_answer?.trim() || row.answer_summary?.trim()),
      )
      .map(questionKey),
  );
  const knownQuestions =
    questions.length || new Set(results.map(questionKey)).size;
  const plannedQuestions =
    scan.input_snapshot?.question_count || knownQuestions;
  const providers = scan.input_snapshot?.assistants?.length
    ? scan.input_snapshot.assistants
    : scan.provider_ids;
  const requested = Math.max(
    scan.total_queries,
    plannedQuestions * providers.length,
    results.length,
  );
  const successful = results.filter(
    (row) =>
      !row.error && (row.raw_answer?.trim() || row.answer_summary?.trim()),
  ).length;
  const failed = results.filter((row) => Boolean(row.error)).length;
  const missing = Math.max(0, requested - successful - failed);
  return {
    questions: knownQuestions || null,
    testedQuestions: tested.size,
    requested,
    successful,
    failed,
    missing,
    providers,
    status: scan.status,
  };
}

export type AuditCoverage = ReturnType<typeof auditCoverage>;
