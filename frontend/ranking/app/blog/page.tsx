import Link from "next/link";
import { MarketingShell } from "@/components/site/marketing-shell";
import { JsonLd } from "@/components/site/json-ld";
import { blogPosts } from "@/lib/blog";
import { routes } from "@/lib/routes";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata = {
  title: "Blog",
  description:
    "Practical writing on generative engine optimization (GEO), AI visibility, and how to measure whether ChatGPT, Gemini, and Perplexity recommend your brand.",
  alternates: { canonical: "/blog" },
};

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function BlogIndexPage() {
  const posts = [...blogPosts].sort((a, b) =>
    b.published.localeCompare(a.published),
  );

  return (
    <MarketingShell narrow>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Blog",
          name: "RankedByAI Blog",
          url: `${appUrl}/blog`,
          description: metadata.description,
          blogPost: posts.map((post) => ({
            "@type": "BlogPosting",
            headline: post.title,
            url: `${appUrl}${routes.blogPost(post.slug)}`,
            datePublished: post.published,
            dateModified: post.updated,
          })),
        }}
      />
      <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
        Blog
      </p>
      <h1 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
        Notes on AI visibility
      </h1>
      <p className="mt-4 max-w-xl text-muted-foreground">
        How answer engines pick the brands they recommend, and how to measure
        your place in those answers without fooling yourself.
      </p>
      <ul className="mt-12 flex flex-col divide-y divide-border">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link
              href={routes.blogPost(post.slug)}
              className="group block py-8"
            >
              <p className="font-mono text-xs text-muted-foreground">
                {formatDate(post.published)} · {post.readingMinutes} min read
              </p>
              <h2 className="font-heading mt-2 text-xl font-semibold tracking-tight transition-colors group-hover:text-primary">
                {post.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {post.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </MarketingShell>
  );
}
