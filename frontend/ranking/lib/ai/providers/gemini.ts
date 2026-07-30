import { GoogleGenAI } from "@google/genai";
import { MAX_PROVIDER_ANSWER_CHARS } from "@/lib/constants";
import { createDemoResult, providerKeyMissing } from "./demo";
import type {
  AISearchProvider,
  ProviderCitation,
  ProviderQueryInput,
  ProviderQueryResult,
} from "./types";
import { emptyProviderResult } from "./types";

const DEFAULT_MODEL = process.env.GEMINI_SEARCH_MODEL ?? "gemini-2.5-flash";

export const geminiSearchProvider: AISearchProvider = {
  id: "gemini",
  displayName: "Gemini",
  async runQuery(input: ProviderQueryInput): Promise<ProviderQueryResult> {
    const model = DEFAULT_MODEL;
    if (providerKeyMissing("gemini")) {
      return createDemoResult("gemini", model, input);
    }

    const started = Date.now();
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model,
        contents: input.query,
        config: {
          tools: [{ googleSearch: {} }],
          systemInstruction:
            input.systemInstruction ??
            "Provide a neutral, useful answer for a buyer researching options. Use Google Search grounding. Do not mention that a specific brand is being evaluated.",
        },
      });

      let rawAnswer = response.text ?? "";
      if (rawAnswer.length > MAX_PROVIDER_ANSWER_CHARS) {
        rawAnswer = rawAnswer.slice(0, MAX_PROVIDER_ANSWER_CHARS);
      }

      const citations: ProviderCitation[] = [];
      const chunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      for (const chunk of chunks) {
        const uri = chunk.web?.uri;
        if (!uri) continue;
        let domain: string | null = null;
        try {
          domain = new URL(uri).hostname;
        } catch {
          domain = null;
        }
        citations.push({
          url: uri,
          title: chunk.web?.title ?? null,
          domain,
        });
      }

      return {
        provider: "gemini",
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
          raw: {
            groundingMetadata: response.candidates?.[0]?.groundingMetadata,
          },
        },
        error: rawAnswer ? null : "Empty response from Gemini",
        timestamp: new Date().toISOString(),
        isDemo: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gemini request failed";
      return emptyProviderResult("gemini", model, input.query, message);
    }
  },
};
