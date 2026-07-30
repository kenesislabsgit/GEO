import type { ProviderId } from "@/types/database";

export type ProviderCitation = {
  url: string;
  title: string | null;
  domain: string | null;
  startIndex?: number;
  endIndex?: number;
};

export type ProviderSource = {
  url: string;
  title: string | null;
  domain: string | null;
};

export type ProviderUsageMetadata = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  searchCalls?: number;
  raw?: Record<string, unknown>;
};

export type ProviderQueryInput = {
  query: string;
  country?: string;
  language?: string;
  systemInstruction?: string;
};

export type ProviderQueryResult = {
  provider: ProviderId;
  model: string;
  query: string;
  rawAnswer: string;
  citations: ProviderCitation[];
  sources: ProviderSource[];
  latencyMs: number;
  usage: ProviderUsageMetadata;
  error: string | null;
  timestamp: string;
  isDemo: boolean;
};

export interface AISearchProvider {
  id: ProviderId;
  displayName: string;
  runQuery(input: ProviderQueryInput): Promise<ProviderQueryResult>;
}

export function emptyProviderResult(
  provider: ProviderId,
  model: string,
  query: string,
  error: string,
): ProviderQueryResult {
  return {
    provider,
    model,
    query,
    rawAnswer: "",
    citations: [],
    sources: [],
    latencyMs: 0,
    usage: {},
    error,
    timestamp: new Date().toISOString(),
    isDemo: false,
  };
}
