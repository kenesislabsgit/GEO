import { blogPosts } from "@/lib/blog";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

/**
 * llms.txt - a plain-markdown site summary for AI crawlers and assistants,
 * per the llmstxt.org convention. Kept in code so blog posts appear
 * automatically.
 */
export function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const body = `# ${APP_NAME}

> ${APP_TAGLINE} ${APP_NAME} measures whether AI answer engines (ChatGPT, Claude, Gemini and more) mention and recommend a brand. It samples provider APIs with unbiased buyer-style prompts, then reports mention rate, position, and the sources the answers cite - labelled by provider and model, with methodology version and timestamps so runs stay comparable.

Results are sampled and non-deterministic; ${APP_NAME} reports rates, not guarantees, and does not promise ranking improvements.

## Pages

- [Home](${base}/): What the product does and a free AI visibility audit.
- [Pricing](${base}/pricing): Free, Plus and Pro plans.
- [Methodology](${base}/methodology): How scores are computed - provider sampling, prompt design, scoring weights, and known limitations.
- [Blog](${base}/blog): Practical writing on generative engine optimization (GEO) and AI visibility.

## Blog posts

${blogPosts
  .map((p) => `- [${p.title}](${base}/blog/${p.slug}): ${p.description}`)
  .join("\n")}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
