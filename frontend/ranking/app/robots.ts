import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

const PUBLIC = [
  "/",
  "/pricing",
  "/methodology",
  "/reporting",
  "/getting-started",
  "/scale",
  "/providers",
  "/action-centre",
  "/blog",
  "/report/",
];
const PRIVATE = ["/dashboard", "/admin", "/api/", "/login"];

/**
 * AI crawlers are listed explicitly and allowed on purpose: the product is
 * this site's current crawl policy. Training and search access are separate
 * choices. Each listed agent gets the same private-area restrictions.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Google-Extended",
  "meta-externalagent",
];

export default function robots(): MetadataRoute.Robots {
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
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
