import Perplexity from "@perplexity-ai/perplexity_ai";
import { MAX_PROVIDER_ANSWER_CHARS } from "@/lib/constants";
import { createDemoResult, providerKeyMissing } from "./demo";
import type {
  AISearchProvider,
  ProviderCitation,
  ProviderQueryInput,
  ProviderQueryResult,
} from "./types";
import { emptyProviderResult } from "./types";

const DEFAULT_MODEL = process.env.PERPLEXITY_SEARCH_MODEL ?? "sonar-pro";

export const perplexitySearchProvider: AISearchProvider = {
  id: "perplexity",
  displayName: "Perplexity",
  async runQuery(input: ProviderQueryInput): Promise<ProviderQueryResult> {
    const model = DEFAULT_MODEL;
    if (providerKeyMissing("perplexity")) {
      return createDemoResult("perplexity", model, input);
    }

    const started = Date.now();
    try {
      const client = new Perplexity({
        apiKey: process.env.PERPLEXITY_API_KEY,
      });

      // Official SDK chat completions path (web-grounded Sonar / Agent-compatible models).
      const completion = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              input.systemInstruction ??
              "Provide a neutral, useful answer for a buyer researching options. Use web search. Do not mention that a specific brand is being evaluated.",
          },
          { role: "user", content: input.query },
        ],
      });

      const choice = completion.choices?.[0]?.message;
      let rawAnswer =
        typeof choice?.content === "string"
          ? choice.content
          : Array.isArray(choice?.content)
            ? choice.content
                .map((part) =>
                  typeof part === "string"
                    ? part
                    : "text" in part
                      ? String(part.text)
                      : "",
                )
                .join("\n")
            : "";

      if (rawAnswer.length > MAX_PROVIDER_ANSWER_CHARS) {
        rawAnswer = rawAnswer.slice(0, MAX_PROVIDER_ANSWER_CHARS);
      }

      const citations: ProviderCitation[] = [];
      const searchResults =
        (completion as { search_results?: Array<{ url?: string; title?: string }> })
          .search_results ?? [];
      for (const result of searchResults) {
        if (!result.url) continue;
        let domain: string | null = null;
        try {
          domain = new URL(result.url).hostname;
        } catch {
          domain = null;
        }
        citations.push({
          url: result.url,
          title: result.title ?? null,
          domain,
        });
      }

      return {
        provider: "perplexity",
        model,
        query: input.query,
        rawAnswer,
        citations,
        sources: citations.map((c) => ({
          url: c.url,
          title: c.title,
          domain: c.domain,
        })),
        latencyMs: Date.now() - started,
        usage: {
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
        },
        error: rawAnswer ? null : "Empty response from Perplexity",
        timestamp: new Date().toISOString(),
        isDemo: false,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Perplexity request failed";
      return emptyProviderResult("perplexity", model, input.query, message);
    }
  },
};
