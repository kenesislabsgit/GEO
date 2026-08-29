import { METHODOLOGY_VERSION } from "@/lib/constants";
import { exec, withTransaction } from "@/lib/db/pg";
import {
  createScanRun,
  insertQueryResult,
  recordFreeScan,
  replaceCompetitors,
  replacePrompts,
  replaceRecommendations,
  replaceScanQuestions,
  updateScanRun,
  upsertBrand,
  upsertScore,
} from "@/lib/db/repository";
import { domainToSlug } from "@/lib/utils/slug";
import type { Json, ProviderId } from "@/types/database";

export type AuditExport = {
  generated_at?: string;
  brand?: {
    name?: string;
    domain?: string | null;
    category?: string | null;
    description?: string | null;
    target_audience?: string | null;
    aliases?: string[];
  };
  scan?: {
    status?: string;
    methodology_version?: string;
    provider_ids?: string[];
    response_count?: number;
    provider_coverage?: Record<
      string,
      { responses?: number; recommendations?: number; rejections?: number }
    >;
    partial_providers?: string[];
  };
  summary?: string;
  score?: Record<string, unknown>;
  prompt_matrix?: Array<Record<string, unknown>>;
  query_results?: Array<Record<string, unknown>>;
  top_competitors?: Array<Record<string, unknown>>;
  competitor_evidence?: Array<Record<string, unknown>>;
  web_presence?: Record<string, unknown>;
  recommendations?: Array<Record<string, unknown>>;
  quality?: unknown;
};

function normalizePromptKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export type ImportResult = {
  brandId: string;
  scanRunId: string;
  reportPath: string;
  importedQueryResults: number;
  /** Actual provider checks and estimated spend, for reservation settlement. */
  actualUnits: number;
  actualCostUsd: number;
};

export async function importAuditExport(
  audit: AuditExport,
  options: {
    ownerId?: string | null;
    brandId?: string;
    visibility?: "public" | "private";
    scanType?: "free" | "manual" | "scheduled";
    initiatedBy?: string | null;
    recordFreeScan?: boolean;
    /** Hashed request IP from enqueue time, for the free-scan abuse table. */
    ipHash?: string | null;
    /** Brand locale to keep; the import must not reset what the user set. */
    country?: string | null;
    language?: string | null;
    /**
     * Curated prompts the audit was told to ask, in question order. When
     * present, the import links results to these existing rows instead of
     * replacing the brand's prompts with regenerated ones.
     */
    curatedPrompts?: Array<{ id: string; prompt: string }>;
    /** Selection made on the new-audit page. Used only to label the immutable copy. */
    questionSelection?: {
      mode: "new" | "previous";
      suppliedCount: number;
      sourceScanRunId: string | null;
    };
    // A run row created before the audit started. The import fills it in
    // instead of creating a second one, so the page that has been polling
    // this id sees the same run turn into the finished report.
    scanRunId?: string;
  } = {},
): Promise<ImportResult> {
  // One transaction. Either the whole audit lands - brand, prompts,
  // competitors, answers, score, actions, scan status - or none of it does
  // and the scan row can be marked failed by the caller.
  return withTransaction(() => importInTransaction(audit, options));
}

async function importInTransaction(
  audit: AuditExport,
  options: Parameters<typeof importAuditExport>[1] & object,
): Promise<ImportResult> {
  const domain = normalizeDomain(audit.brand?.domain);
  if (!domain) {
    throw new Error("audit_export.brand.domain is required");
  }

  const now = new Date().toISOString();
  const brand = await upsertBrand({
    id: options.brandId,
    owner_id: options.ownerId ?? null,
    name: asString(audit.brand?.name, domain),
    canonical_domain: domain,
    slug: domainToSlug(domain),
    logo_url: null,
    description: asNullableString(audit.brand?.description),
    category: asNullableString(audit.brand?.category),
    target_audience: asNullableString(audit.brand?.target_audience),
    aliases: audit.brand?.aliases?.filter(Boolean) ?? [
      asString(audit.brand?.name, domain),
    ],
    default_country: options.country ?? "us",
    default_language: options.language ?? "en",
    visibility: options.visibility ?? "public",
    claimed_at: null,
    metadata_confidence: {
      source: "geo_audit_import",
      quality: audit.quality ?? null,
    } as Json,
  });

  const testedPromptIndexes = new Set(
    (audit.query_results ?? [])
      .map((row) => Number(row.prompt_index))
      .filter((index) => Number.isInteger(index) && index > 0),
  );
  const allPromptRows = (audit.prompt_matrix ?? []).map((row, index) => ({
    row,
    promptIndex: index + 1,
  }));
  const promptRows = allPromptRows.filter(({ promptIndex }) =>
    testedPromptIndexes.size ? testedPromptIndexes.has(promptIndex) : true,
  );

  const promptIdByIndex = new Map<number, string>();
  let prompts: Array<{ id: string; prompt: string }>;
  if (options.curatedPrompts?.length) {
    // The audit asked exactly the user's saved questions, in order. Nothing
    // is regenerated and nothing the user curated is touched.
    prompts = options.curatedPrompts;
    options.curatedPrompts.forEach((prompt, index) => {
      // Monitoring owns an immutable copy of its question text rather than a
      // mutable brand-prompt row. Those local ids must not be written into the
      // UUID foreign-key column; scan_questions keeps the exact text instead.
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          prompt.id,
        )
      ) {
        promptIdByIndex.set(index + 1, prompt.id);
      }
    });
  } else {
    const stored = await replacePrompts(
      brand.id,
      promptRows
        .map(({ row }) => ({
          prompt: asString(row.prompt, ""),
          prompt_type: asString(row.prompt_type, "unknown"),
          buyer_stage: asString(row.buyer_stage, "unknown"),
          // Geo-localized questions carry their market's country code; every
          // other question is "global". The market's display name rides in
          // rationale - the one spare per-prompt column - so the report can
          // say "India", not "in".
          country:
            asString(row.market_country, "global").toLowerCase() || "global",
          language: "en",
          active: true,
          is_custom: false,
          rationale: asString(row.market, "") || null,
        }))
        .filter((row) => row.prompt),
    );
    prompts = stored;
    stored.forEach((prompt, index) =>
      promptIdByIndex.set(
        promptRows[index]?.promptIndex ?? index + 1,
        prompt.id,
      ),
    );
  }

  const providerIds = Array.from(
    new Set(
      (audit.scan?.provider_ids?.length
        ? audit.scan.provider_ids
        : (audit.query_results ?? []).map((row) =>
            asString(row.provider, "openai"),
          )
      ).map(toProviderId),
    ),
  );

  await replaceCompetitors(
    brand.id,
    (audit.top_competitors ?? []).map((row) => ({
      name: asString(row.name, "Unknown"),
      domain: findCompetitorDomain(row.name, audit.competitor_evidence),
      aliases: [],
    })),
  );

  // Recorded as running, and marked finished only once every panel the report
  // shows has been stored. A run that dies partway through importing used to
  // leave a scan already labelled "completed" holding answers but no score,
  // competitors or actions, and the dashboard showed that as a finished audit
  // with empty panels rather than as the failure it was.
  const finalStatus =
    audit.scan?.status === "partial" ? "partial" : "completed";
  const scanFields = {
    brand_id: brand.id,
    initiated_by: options.initiatedBy ?? null,
    scan_type: options.scanType ?? "free",
    status: "running" as const,
    provider_ids: providerIds,
    total_queries:
      audit.query_results?.length ?? audit.scan?.response_count ?? 0,
    completed_queries:
      audit.query_results?.length ?? audit.scan?.response_count ?? 0,
    started_at: audit.generated_at ?? now,
    completed_at: now,
    error_summary: audit.scan?.partial_providers?.length
      ? `No usable company recommendations were retained from: ${audit.scan.partial_providers.join(", ")}.`
      : null,
    summary: asNullableString(audit.summary),
    methodology_version: asString(
      audit.scan?.methodology_version,
      METHODOLOGY_VERSION,
    ),
    demo_mode: false,
    cancelled_at: null,
    country: options.country ?? "us",
    language: options.language ?? "en",
  };
  const scan = options.scanRunId
    ? await updateScanRun(options.scanRunId, scanFields)
    : await createScanRun(scanFields);
  if (!scan) {
    throw new Error(
      `Scan run ${options.scanRunId} to import into was not found.`,
    );
  }

  await replaceScanQuestions(
    scan.id,
    allPromptRows
      .map(({ row, promptIndex }) => {
        const prompt = asString(row.prompt, "").trim();
        const supplied =
          promptIndex <= (options.questionSelection?.suppliedCount ?? 0);
        return {
          position: promptIndex,
          prompt,
          source: supplied
            ? options.questionSelection?.mode === "previous"
              ? ("reused" as const)
              : ("user" as const)
            : ("generated" as const),
          source_scan_run_id:
            supplied && options.questionSelection?.mode === "previous"
              ? options.questionSelection.sourceScanRunId
              : null,
        };
      })
      .filter((row) => row.prompt),
  );

  // A retried import starts clean instead of stacking a second set of
  // answers onto the same scan.
  await exec(`delete from query_results where scan_run_id = $1`, [scan.id]);

  let actualCostUsd = 0;
  for (const row of audit.query_results ?? []) {
    const provider = toProviderId(row.provider);
    actualCostUsd += asNumber(row.estimated_cost, 0);
    await insertQueryResult({
      scan_run_id: scan.id,
      tracked_prompt_id: promptIdByIndex.get(Number(row.prompt_index)) ?? null,
      question_position: Number(row.prompt_index) || null,
      provider,
      model: asString(row.model, "unknown"),
      raw_answer: asString(row.raw_answer, ""),
      answer_summary: asNullableString(row.answer_summary),
      brand_mentioned: Boolean(row.brand_mentioned),
      brand_position: asNumberOrNull(row.brand_position),
      // The engine does not measure sentiment; storing a fabricated
      // "neutral" made the product look like it did.
      brand_sentiment: null,
      confidence: asNumberOrNull(row.analysis_confidence),
      recommended_brands: (row.recommended_brands ?? []) as Json,
      citations: (row.citations ?? []) as Json,
      sources: (row.verified_mentions ?? []) as Json,
      claims: [] as Json,
      latency_ms: null,
      usage_metadata: {
        parse_error: row.parse_error ?? null,
        collection_mode: row.collection_mode ?? null,
      } as Json,
      estimated_cost: asNumberOrNull(row.estimated_cost),
      error: asNullableString(row.parse_error),
      is_demo: false,
    });
  }

  await upsertScore({
    brand_id: brand.id,
    scan_run_id: scan.id,
    overall_score: asNumber(audit.score?.overall_score, 0),
    mention_score: asNumber(audit.score?.mention_score, 0),
    position_score: asNumber(audit.score?.position_score, 0),
    citation_score: asNumber(audit.score?.citation_score, 0),
    sentiment_score: asNumber(audit.score?.sentiment_score, 0),
    mention_rate: asNumber(audit.score?.mention_rate, 0),
    average_position: asNumberOrNull(audit.score?.average_position),
    share_of_voice: asNumber(audit.score?.share_of_voice, 0),
    competitor_scores: (audit.score?.competitor_scores ?? {}) as Json,
    methodology_version: asString(
      audit.scan?.methodology_version,
      METHODOLOGY_VERSION,
    ),
    // The complete breakdown as the engine computed it, weights included.
    // The frontend renders this object; it never recomputes a score.
    breakdown: (audit.score ?? {}) as Json,
  });

  // Lost buyer questions arrive as objects (prompt text + who won it). Keep the
  // readable detail on `evidence` for the UI, and resolve the tracked prompt ids
  // into `affected_prompts` so improvements can be joined back to questions.
  const promptIdByText = new Map(
    prompts.map((prompt) => [normalizePromptKey(prompt.prompt), prompt.id]),
  );

  await replaceRecommendations(
    brand.id,
    scan.id,
    (audit.recommendations ?? []).map((row, index) => {
      const affected = Array.isArray(row.affected_prompts)
        ? (row.affected_prompts as Array<Record<string, unknown>>).filter(
            (item) => item && typeof item === "object",
          )
        : [];
      const affectedIds = affected
        .map((item) =>
          promptIdByText.get(normalizePromptKey(asString(item.prompt, ""))),
        )
        .filter((value): value is string => Boolean(value));
      const evidence = {
        ...((row.evidence ?? {}) as Record<string, unknown>),
        affected_prompts: affected,
      };
      return {
        title: asString(row.title, "Recommendation"),
        explanation: asString(row.explanation, ""),
        evidence: evidence as Json,
        action_type: "content",
        priority: asNumber(row.priority, index + 1),
        estimated_impact: asNullableString(row.estimated_impact),
        affected_prompts: Array.from(new Set(affectedIds)),
        // Pass a brief through when the audit provides one; the Python
        // exporter does not today, but nulling unconditionally meant even
        // future briefs would be dropped at the door.
        suggested_content_brief: (row.suggested_content_brief ?? null) as Json,
        status: "open",
      };
    }),
  );

  if (options.recordFreeScan !== false) {
    await recordFreeScan({
      domain,
      normalized_domain: domain,
      ip_hash: options.ipHash ?? null,
      scan_run_id: scan.id,
    });
  }

  await updateScanRun(scan.id, { status: finalStatus });

  return {
    brandId: brand.id,
    scanRunId: scan.id,
    reportPath: `/report/${brand.slug}`,
    importedQueryResults: audit.query_results?.length ?? 0,
    actualUnits: audit.query_results?.length ?? 0,
    actualCostUsd,
  };
}

function normalizeDomain(value: unknown): string | null {
  const raw = asNullableString(value);
  if (!raw || ["unknown", "none", "n/a", "-"].includes(raw.toLowerCase())) {
    return null;
  }
  const withProtocol = raw.includes("://") ? raw : `https://${raw}`;
  try {
    const host = new URL(withProtocol).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return raw.toLowerCase().replace(/^www\./, "");
  }
}

function toProviderId(value: unknown): ProviderId {
  const provider = asString(value, "openai") as ProviderId;
  const known: ProviderId[] = [
    "openai",
    "openai_search",
    "claude",
    "gemini",
    "perplexity",
    "bedrock_claude",
    "bedrock_nova",
    "bedrock_llama",
    "bedrock_mistral",
    "grok",
    "deepseek",
    "kimi",
    "groq",
    "minimax",
    "sarvam",
    "qwen",
  ];
  return known.includes(provider) ? provider : "openai";
}

function findCompetitorDomain(
  name: unknown,
  evidenceRows: AuditExport["competitor_evidence"],
): string | null {
  const key = asString(name, "").toLowerCase();
  const match = (evidenceRows ?? []).find(
    (row) => asString(row.company_name, "").toLowerCase() === key,
  );
  return normalizeDomain(match?.website_url);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
