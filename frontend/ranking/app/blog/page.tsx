import Link from "next/link";
import { MarketingShell } from "@/components/site/marketing-shell";
import { JsonLd } from "@/components/site/json-ld";
import { Reveal } from "@/components/site/reveal";
import { BLOG_CATEGORIES, blogPosts } from "@/lib/blog";
import { routes } from "@/lib/routes";
import { SITE_URL } from "@/lib/site";

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
  const [featured, ...rest] = posts;

  return (
    <MarketingShell narrow>
      <JsonLd
        id="json-ld-blog"
        data={{
          "@context": "https://schema.org",
          "@type": "Blog",
          name: "Arcanoris Blog",
          url: `${SITE_URL}/blog`,
          description: metadata.description,
          blogPost: posts.map((post) => ({
            "@type": "BlogPosting",
            headline: post.title,
            url: `${SITE_URL}${routes.blogPost(post.slug)}`,
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
      {featured ? (
        <Reveal className="mt-12">
          <Link
            href={routes.blogPost(featured.slug)}
            className="group relative block overflow-hidden rounded-xl border border-border bg-card p-6 md:p-8"
          >
            <div
              aria-hidden
              className="arc-halftone pointer-events-none absolute inset-y-0 right-0 w-48 text-foreground/[0.06] [mask-image:linear-gradient(to_left,black,transparent)]"
            />
            <p className="relative flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: BLOG_CATEGORIES[featured.category].color }}
              />
              Latest
            </p>
            <h2 className="font-heading relative mt-3 text-2xl font-semibold tracking-tight text-balance transition-colors group-hover:text-primary md:text-3xl">
              {featured.title}
            </h2>
            <p className="relative mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {featured.description}
            </p>
            <p className="relative mt-4 font-mono text-xs text-muted-foreground">
              {formatDate(featured.published)} · {featured.readingMinutes} min read
            </p>
          </Link>
        </Reveal>
      ) : null}
      <ul className="mt-4 flex flex-col divide-y divide-border">
        {rest.map((post, i) => (
          <li key={post.slug}>
            <Reveal delay={i * 60} direction="up">
              <Link
                href={routes.blogPost(post.slug)}
                className="group block py-8"
              >
                <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: BLOG_CATEGORIES[post.category].color }}
                  />
                  {formatDate(post.published)} · {post.readingMinutes} min read
                </p>
                <h2 className="font-heading mt-2 text-xl font-semibold tracking-tight transition-colors group-hover:text-primary">
                  {post.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {post.description}
                </p>
              </Link>
            </Reveal>
          </li>
        ))}
      </ul>
    </MarketingShell>
  );
}
