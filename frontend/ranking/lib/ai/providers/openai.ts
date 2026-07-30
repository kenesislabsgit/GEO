import OpenAI from "openai";
import { MAX_PROVIDER_ANSWER_CHARS } from "@/lib/constants";
import { createDemoResult, providerKeyMissing } from "./demo";
import type {
  AISearchProvider,
  ProviderCitation,
  ProviderQueryInput,
  ProviderQueryResult,
  ProviderSource,
} from "./types";
import { emptyProviderResult } from "./types";

const DEFAULT_SEARCH_MODEL = process.env.OPENAI_SEARCH_MODEL ?? "gpt-5.6";

function getClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function extractText(response: OpenAI.Responses.Response): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const chunks: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function extractCitations(response: OpenAI.Responses.Response): {
  citations: ProviderCitation[];
  sources: ProviderSource[];
} {
  const citations: ProviderCitation[] = [];
  const sources: ProviderSource[] = [];
  const seen = new Set<string>();

  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type !== "output_text") continue;
      const annotations = content.annotations ?? [];
      for (const annotation of annotations) {
        if (annotation.type !== "url_citation") continue;
        const url = annotation.url;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        let domain: string | null = null;
        try {
          domain = new URL(url).hostname;
        } catch {
          domain = null;
        }
        const citation: ProviderCitation = {
          url,
          title: annotation.title ?? null,
          domain,
          startIndex: annotation.start_index,
          endIndex: annotation.end_index,
        };
        citations.push(citation);
        sources.push({ url, title: citation.title, domain });
      }
    }
  }

  return { citations, sources };
}

async function runWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable =
        /rate|timeout|temporar|429|500|502|503|504/i.test(message) &&
        i < attempts - 1;
      if (!retryable) throw error;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastError;
}

export const openaiSearchProvider: AISearchProvider = {
  id: "openai",
  displayName: "OpenAI",
  async runQuery(input: ProviderQueryInput): Promise<ProviderQueryResult> {
    const model = DEFAULT_SEARCH_MODEL;
    if (providerKeyMissing("openai")) {
      return createDemoResult("openai", model, input);
    }

    const started = Date.now();
    try {
      const client = getClient();
      const response = await runWithRetry(() =>
        client.responses.create({
          model,
          tools: [{ type: "web_search" }],
          tool_choice: "required",
          input: [
            {
              role: "system",
              content:
                input.systemInstruction ??
                "Provide a neutral, useful answer for a buyer researching options. Use current web search. Do not invent citations. Do not mention that any specific brand is being evaluated.",
            },
            {
              role: "user",
              content: input.query,
            },
          ],
        }),
      );

      let rawAnswer = extractText(response);
      if (rawAnswer.length > MAX_PROVIDER_ANSWER_CHARS) {
        rawAnswer = rawAnswer.slice(0, MAX_PROVIDER_ANSWER_CHARS);
      }
      const { citations, sources } = extractCitations(response);

      return {
        provider: "openai",
        model,
        query: input.query,
        rawAnswer,
        citations,
        sources,
        latencyMs: Date.now() - started,
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          totalTokens: response.usage?.total_tokens,
          raw: response.usage ? { ...response.usage } : undefined,
        },
        error: rawAnswer ? null : "Empty response from OpenAI",
        timestamp: new Date().toISOString(),
        isDemo: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenAI request failed";
      return emptyProviderResult("openai", model, input.query, message);
    }
  },
};
