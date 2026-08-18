import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { MarketingShell } from "@/components/site/marketing-shell";
import { JsonLd } from "@/components/site/json-ld";
import { Button } from "@/components/ui/button";
import { BLOG_CATEGORIES, blogPosts, getPost, type PostBlock } from "@/lib/blog";
import { APP_NAME } from "@/lib/constants";
import { routes } from "@/lib/routes";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: routes.blogPost(post.slug) },
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: `${post.published}T00:00:00.000Z`,
      modifiedTime: `${post.updated}T00:00:00.000Z`,
      url: routes.blogPost(post.slug),
    },
  };
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function Block({ block }: { block: PostBlock }) {
  switch (block.type) {
    case "h2":
      return (
        <h2 className="font-heading mt-10 text-xl font-semibold tracking-tight">
          {block.text}
        </h2>
      );
    case "p":
      return <p className="mt-5 leading-relaxed">{block.text}</p>;
    case "list":
      return (
        <ul className="mt-5 flex list-disc flex-col gap-2.5 pl-5 leading-relaxed">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote className="mt-6 border-l-2 border-[color:var(--arc-accent)] py-1 pl-4 font-heading text-lg leading-snug tracking-tight text-balance">
          {block.text}
        </blockquote>
      );
    case "code":
      return (
        <div className="mt-6 overflow-hidden rounded-lg border border-border">
          {block.label ? (
            <div className="border-b border-border bg-muted/40 px-4 py-2 font-mono text-[11px] tracking-[0.1em] text-muted-foreground uppercase">
              {block.label}
            </div>
          ) : null}
          <pre className="overflow-x-auto bg-card p-4 text-[12.5px] leading-relaxed">
            <code className="font-mono whitespace-pre">{block.code}</code>
          </pre>
        </div>
      );
    case "table":
      return (
        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40">
                {block.headers.map((header) => (
                  <th
                    key={header}
                    className="border-b border-border px-4 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className={i > 0 ? "border-t border-border" : undefined}>
                  {row.map((cell, j) => (
                    <td key={j} className="px-4 py-3 leading-relaxed">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "stats":
      return (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {block.items.map((item) => (
            <div key={item.label} className="rounded-lg border border-border p-4">
              <p className="arc-tabular font-heading text-2xl font-semibold tracking-tight">
                {item.value}
              </p>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                {item.label}
              </p>
            </div>
          ))}
        </div>
      );
  }
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const categoryColor = BLOG_CATEGORIES[post.category].color;

  return (
    <MarketingShell narrow>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "BlogPosting",
              headline: post.title,
              description: post.description,
              datePublished: post.published,
              dateModified: post.updated,
              url: `${appUrl}${routes.blogPost(post.slug)}`,
              author: { "@type": "Organization", name: APP_NAME, url: appUrl },
              publisher: { "@type": "Organization", name: APP_NAME, url: appUrl },
              mainEntityOfPage: {
                "@type": "WebPage",
                "@id": `${appUrl}${routes.blogPost(post.slug)}`,
              },
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: appUrl },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: "Blog",
                  item: `${appUrl}${routes.blog}`,
                },
                {
                  "@type": "ListItem",
                  position: 3,
                  name: post.title,
                  item: `${appUrl}${routes.blogPost(post.slug)}`,
                },
              ],
            },
          ],
        }}
      />
      <article>
        <Link
          href={routes.blog}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          All posts
        </Link>
        <p className="mt-8 flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: categoryColor }}
          />
          <span style={{ color: categoryColor }}>{post.category}</span>
          <span aria-hidden>·</span>
          {formatDate(post.published)} · {post.readingMinutes} min read
        </p>
        <h1 className="font-heading mt-3 text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          {post.title}
        </h1>
        <div className="mt-4 text-[15px] text-foreground/90">
          {post.blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </div>
      </article>
      <div className="relative mt-14 overflow-hidden rounded-xl border border-border bg-card p-6">
        <div
          aria-hidden
          className="arc-halftone pointer-events-none absolute inset-y-0 right-0 w-40 text-foreground/[0.07] [mask-image:linear-gradient(to_left,black,transparent)]"
        />
        <p className="relative font-heading text-lg font-semibold tracking-tight">
          See where you stand in AI answers
        </p>
        <p className="relative mt-2 max-w-md text-sm text-muted-foreground">
          Run a free audit and get a provider-labelled report on whether
          ChatGPT-style answers recommend your brand.
        </p>
        <Button asChild size="sm" className="relative mt-4">
          <Link href={routes.freeAuditSignup}>
            Start free audit
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </MarketingShell>
  );
}
