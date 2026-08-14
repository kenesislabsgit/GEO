import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { MarketingShell } from "@/components/site/marketing-shell";
import { JsonLd } from "@/components/site/json-ld";
import { Button } from "@/components/ui/button";
import { blogPosts, getPost, type PostBlock } from "@/lib/blog";
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
  }
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  return (
    <MarketingShell narrow>
      <JsonLd
        data={{
          "@context": "https://schema.org",
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
        <p className="mt-8 font-mono text-xs text-muted-foreground">
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
      <div className="mt-14 rounded-xl border border-border bg-card p-6">
        <p className="font-heading text-lg font-semibold tracking-tight">
          See where you stand in AI answers
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Run a free audit and get a provider-labelled report on whether
          ChatGPT-style answers recommend your brand.
        </p>
        <Button asChild size="sm" className="mt-4">
          <Link href={routes.freeAuditSignup}>
            Start free audit
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </MarketingShell>
  );
}
