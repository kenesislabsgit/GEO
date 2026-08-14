import type { MetadataRoute } from "next";
import { blogPosts } from "@/lib/blog";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const latestPost = blogPosts
    .map((p) => p.updated)
    .sort()
    .at(-1);
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/methodology`, changeFrequency: "monthly", priority: 0.7 },
    {
      url: `${base}/blog`,
      changeFrequency: "weekly",
      priority: 0.7,
      lastModified: latestPost ? new Date(latestPost) : undefined,
    },
    ...blogPosts.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.6,
      lastModified: new Date(post.updated),
    })),
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
