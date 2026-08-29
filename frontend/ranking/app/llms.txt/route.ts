import { blogPosts } from "@/lib/blog";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { SITE_URL } from "@/lib/site";

/**
 * llms.txt - a plain-markdown site summary for AI crawlers and assistants,
 * per the llmstxt.org convention. Kept in code so blog posts appear
 * automatically.
 */
export function GET() {
  const body = `# ${APP_NAME}

> ${APP_TAGLINE} ${APP_NAME} measures whether AI answer engines (ChatGPT, Claude, Gemini and more) mention and recommend a brand. It samples provider APIs with unbiased buyer-style prompts, then reports mention rate, position, and the sources the answers cite - labelled by provider and model, with methodology version and timestamps so runs stay comparable.

Results are sampled and non-deterministic; ${APP_NAME} reports rates, not guarantees, and does not promise ranking improvements.

## Pages

- [Home](${SITE_URL}/): What the product does and a free AI visibility audit.
- [Pricing](${SITE_URL}/pricing): Plus and Pro plans.
- [Getting started](${SITE_URL}/getting-started): Browser signup, first audit, no SDK or customer API keys.
- [Reporting & alerts](${SITE_URL}/reporting): Scheduled re-scans, email alerts, shareable links, Pro CSV/PDF.
- [Provider coverage](${SITE_URL}/providers): Every supported AI provider and which plan includes it.
- [Action centre](${SITE_URL}/action-centre): Prioritized website fixes tied to lost buyer questions.
- [Scale & reliability](${SITE_URL}/scale): Queue, retries, and monthly check caps.
- [Contact](${SITE_URL}/contact): Sales form for the Pro plan and other inquiries.
- [Methodology](${SITE_URL}/methodology): How scores are computed - provider sampling, prompt design, scoring weights, and known limitations.
- [Blog](${SITE_URL}/blog): Practical writing on generative engine optimization (GEO) and AI visibility.

## Blog posts

${blogPosts
  .map((p) => `- [${p.title}](${SITE_URL}/blog/${p.slug}): ${p.description}`)
  .join("\n")}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
