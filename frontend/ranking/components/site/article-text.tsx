import Link from "next/link";

/** A small, escaped inline-link format for our own article data; no raw HTML. */
export function ArticleText({ text }: { text: string }) {
  return text.split(/(\[[^\]]+\]\([^\s)]+\))/g).map((part, index) => {
    const match = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part);
    if (!match) return part;
    const [, label, href] = match;
    if (!(
      href.startsWith("https://") ||
      (href.startsWith("/") && !href.startsWith("//"))
    ))
      return label;
    return (
      <Link
        key={index}
        href={href}
        className="text-foreground underline decoration-foreground/40 underline-offset-4 hover:decoration-foreground"
      >
        {label}
      </Link>
    );
  });
}
