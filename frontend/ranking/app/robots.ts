import type { MetadataRoute } from "next";

const PUBLIC = ["/", "/pricing", "/methodology", "/blog", "/report/"];
const PRIVATE = ["/dashboard", "/admin", "/api/", "/login"];

/**
 * AI crawlers are listed explicitly and allowed on purpose: the product is
 * about being visible in AI answers, so blocking these bots would be
 * self-defeating. They get the same private-area rules as everyone else.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "meta-externalagent",
];

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return {
    rules: [
      {
        userAgent: "*",
        allow: PUBLIC,
        disallow: PRIVATE,
      },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: PUBLIC,
        disallow: PRIVATE,
      })),
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
