import OpenAI from "openai";
import {
  generatedPromptsSchema,
  type BrandUnderstanding,
  type GeneratedPrompt,
} from "@/lib/ai/schemas/analysis";
import { FREE_PROMPT_COUNT } from "@/lib/constants";
import { providerKeyMissing } from "@/lib/ai/providers/demo";

const TEMPLATE_PROMPTS: Array<Omit<GeneratedPrompt, "country" | "language">> = [
  {
    prompt: "What are the best products in this category for businesses right now?",
    promptType: "discovery",
    buyerStage: "awareness",
    rationale: "Category leader discovery without brand priming.",
  },
  {
    prompt: "Which product is best for the primary buyer persona in this market?",
    promptType: "persona",
    buyerStage: "problem_discovery",
    rationale: "Persona-fit recommendation check.",
  },
  {
    prompt: "What is the best product for the main use case in this category?",
    promptType: "use_case",
    buyerStage: "purchase_intent",
    rationale: "Use-case recommendation ranking.",
  },
  {
    prompt: "Which tools would you recommend for teams facing the core problem in this space?",
    promptType: "problem",
    buyerStage: "problem_discovery",
    rationale: "Problem-led recommendation.",
  },
  {
    prompt: "What are the best affordable or budget options in this category?",
    promptType: "pricing",
    buyerStage: "purchase_intent",
    rationale: "Budget-sensitive shortlist.",
  },
  {
    prompt: "Which options are best for enterprise or scaling teams?",
    promptType: "enterprise",
    buyerStage: "purchase_intent",
    rationale: "Enterprise readiness recommendation.",
  },
  {
    prompt: "What products would you recommend for buyers in this region?",
    promptType: "geography",
    buyerStage: "purchase_intent",
    rationale: "Regional recommendation coverage.",
  },
  {
    prompt: "Which products integrate best with common stacks in this category?",
    promptType: "integration",
    buyerStage: "comparison",
    rationale: "Integration-oriented research.",
  },
  {
    prompt: "What are the best alternatives to the category leader?",
    promptType: "alternatives",
    buyerStage: "alternatives",
    rationale: "Alternatives discovery without naming the customer.",
  },
  {
    prompt: "How should a buyer compare the top options before purchasing?",
    promptType: "comparison",
    buyerStage: "comparison",
    rationale: "Comparison-oriented purchase research.",
  },
];

function fillTemplates(
  brand: BrandUnderstanding,
  country: string,
  language: string,
): GeneratedPrompt[] {
  return TEMPLATE_PROMPTS.slice(0, FREE_PROMPT_COUNT).map((item) => {
    const category = brand.category || "this category";
    const persona = brand.targetAudience || "business buyers";
    const useCase = brand.primaryUseCases[0] || "the main use case";
    const prompt = item.prompt
      .replace("this category", category)
      .replace("this market", category)
      .replace("this space", category)
      .replace("the primary buyer persona", persona)
      .replace("the main use case", useCase)
      .replace("this region", country === "US" ? "the United States" : country);

    // Ensure customer brand name is not injected into discovery prompts.
    if (prompt.toLowerCase().includes(brand.name.toLowerCase())) {
      return {
        ...item,
        prompt: item.prompt.replace("this category", category),
        country,
        language,
      };
    }

    return { ...item, prompt, country, language };
  });
}

export async function generateBuyerPrompts(input: {
  brand: BrandUnderstanding;
  country?: string;
  language?: string;
  count?: number;
}): Promise<GeneratedPrompt[]> {
  const country = input.country ?? "US";
  const language = input.language ?? "en";
  const count = input.count ?? FREE_PROMPT_COUNT;

  if (providerKeyMissing("openai")) {
    return fillTemplates(input.brand, country, language).slice(0, count);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_ANALYSIS_MODEL ?? "gpt-5.6-luna";

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "Generate unbiased buyer-intent questions for AI visibility measurement. Never include the customer's brand name in discovery prompts. Cover category, persona, use case, problem, budget, enterprise, regional, integration, alternatives, and comparison intents.",
      },
      {
        role: "user",
        content: JSON.stringify({
          category: input.brand.category,
          targetAudience: input.brand.targetAudience,
          useCases: input.brand.primaryUseCases,
          country,
          language,
          count,
          forbiddenBrandName: input.brand.name,
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "generated_prompts",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompts: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  prompt: { type: "string" },
                  promptType: { type: "string" },
                  buyerStage: { type: "string" },
                  rationale: { type: "string" },
                  country: { type: "string" },
                  language: { type: "string" },
                },
                required: [
                  "prompt",
                  "promptType",
                  "buyerStage",
                  "rationale",
                  "country",
                  "language",
                ],
              },
            },
          },
          required: ["prompts"],
        },
      },
    },
  });

  const parsed = generatedPromptsSchema.parse(
    JSON.parse(response.output_text || '{"prompts":[]}'),
  );

  const filtered = parsed.prompts
    .filter(
      (p) =>
        !p.prompt.toLowerCase().includes(input.brand.name.toLowerCase()),
    )
    .slice(0, count);

  if (filtered.length < count) {
    const fallback = fillTemplates(input.brand, country, language);
    return [...filtered, ...fallback].slice(0, count);
  }

  return filtered;
}
