import OpenAI from "openai";
import { brandUnderstandingSchema, type BrandUnderstanding } from "@/lib/ai/schemas/analysis";
import { normalizeDomain, stripWww } from "@/lib/security/url";
import { extractLinks, pickSupportingPages, safeFetchPage } from "./fetch";
import { providerKeyMissing } from "@/lib/ai/providers/demo";

function extractMeta(html: string, property: string): string | null {
  const propRe = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const contentFirst = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  );
  return html.match(propRe)?.[1] ?? html.match(contentFirst)?.[1] ?? null;
}

function extractTitle(html: string): string | null {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function understandWebsite(domainInput: string): Promise<BrandUnderstanding> {
  const domain = normalizeDomain(domainInput);
  const homepage = await safeFetchPage(domain);
  const origin = new URL(homepage.finalUrl).origin;
  const links = extractLinks(homepage.body, homepage.finalUrl);
  const supporting = pickSupportingPages(links, origin);

  const pages = [homepage];
  for (const link of supporting) {
    try {
      pages.push(await safeFetchPage(link));
    } catch {
      // optional pages may fail
    }
  }

  const title = extractTitle(homepage.body);
  const description =
    extractMeta(homepage.body, "description") ??
    extractMeta(homepage.body, "og:description");
  const ogTitle = extractMeta(homepage.body, "og:title");
  const combinedText = pages
    .map((p) => stripTags(p.body).slice(0, 4000))
    .join("\n\n")
    .slice(0, 12000);

  if (providerKeyMissing("openai")) {
    const nameGuess =
      ogTitle?.split(/[|\-–]/)?.[0]?.trim() ||
      title?.split(/[|\-–]/)?.[0]?.trim() ||
      stripWww(domain);
    return brandUnderstandingSchema.parse({
      name: nameGuess,
      canonicalDomain: domain,
      aliases: [nameGuess, stripWww(domain).split(".")[0]!],
      description:
        description ??
        `${nameGuess} appears to operate at ${domain}. Category inferred from limited public homepage text.`,
      category: "Software",
      targetAudience: "Business buyers researching this category",
      primaryUseCases: ["Core product evaluation", "Vendor comparison"],
      location: null,
      likelyCompetitors: [],
      confidence: {
        name: description ? 0.7 : 0.45,
        category: 0.35,
        description: description ? 0.6 : 0.3,
        competitors: 0.1,
      },
    });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_ANALYSIS_MODEL ?? "gpt-5.6-luna";
  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "Extract company understanding from fetched website text. Never invent facts. If uncertain, lower confidence and keep fields generic. Return JSON only matching the schema fields.",
      },
      {
        role: "user",
        content: JSON.stringify({
          domain,
          title,
          ogTitle,
          description,
          text: combinedText,
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "brand_understanding",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            canonicalDomain: { type: "string" },
            aliases: { type: "array", items: { type: "string" } },
            description: { type: "string" },
            category: { type: "string" },
            targetAudience: { type: "string" },
            primaryUseCases: { type: "array", items: { type: "string" } },
            location: { type: ["string", "null"] },
            likelyCompetitors: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  domain: { type: ["string", "null"] },
                },
                required: ["name", "domain"],
              },
            },
            confidence: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "number" },
                category: { type: "number" },
                description: { type: "number" },
                competitors: { type: "number" },
              },
              required: ["name", "category", "description", "competitors"],
            },
          },
          required: [
            "name",
            "canonicalDomain",
            "aliases",
            "description",
            "category",
            "targetAudience",
            "primaryUseCases",
            "location",
            "likelyCompetitors",
            "confidence",
          ],
        },
      },
    },
  });

  const parsed = JSON.parse(response.output_text || "{}");
  parsed.canonicalDomain = domain;
  return brandUnderstandingSchema.parse(parsed);
}
