import type { MetadataRoute } from "next";
import { blogPosts } from "@/lib/blog";
import { getPublicReportSitemapEntries } from "@/lib/db/repository";
import { PRODUCT_PAGES } from "@/lib/product-pages";
import { SITE_URL } from "@/lib/site";

// This has no dynamic APIs (no cookies/headers), so Next prerenders it once
// at build time and would otherwise serve that same snapshot until the next
// deploy - newly published or newly-made-public reports wouldn't show up in
// the sitemap for crawlers to find. Revalidating hourly keeps it current
// without making the route fully dynamic.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const latestPost = blogPosts
    .map((p) => p.updated)
    .sort()
    .at(-1);
  // Public reports are the product's own AEO-friendly content - real,
  // specific, per-brand AI-visibility data. robots.ts already allow-lists
  // /report/ for crawlers; without a sitemap entry they're reachable only by
  // whoever already has the direct link.
  const publicReports = await getPublicReportSitemapEntries().catch(() => []);
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/methodology`, changeFrequency: "monthly", priority: 0.7 },
    ...PRODUCT_PAGES.map((page) => ({
      url: `${SITE_URL}${page.href}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    {
      url: `${SITE_URL}/blog`,
      changeFrequency: "weekly",
      priority: 0.7,
      lastModified: latestPost ? new Date(latestPost) : undefined,
    },
    ...blogPosts.map((post) => ({
      url: `${SITE_URL}/blog/${post.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.6,
      lastModified: new Date(post.updated),
    })),
    ...publicReports.map((report) => ({
      url: `${SITE_URL}/report/${report.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.5,
      lastModified: new Date(report.updatedAt),
    })),
    { url: `${SITE_URL}/contact`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
