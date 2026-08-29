import Link from "next/link";
import { MarketingShell } from "@/components/site/marketing-shell";
import { ProductCrossNav } from "@/components/site/product-cross-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export const metadata = {
  title: "Action centre",
  description:
    "How Arcanoris turns lost AI answers into a prioritized website-improvement list and a copy-paste prompt for your coding tool.",
  alternates: { canonical: routes.actionCentre },
};

const sampleActions = [
  {
    n: "01",
    title: "Publish the missing comparison the answers already cite",
    why: "Lost on several buyer questions to a competitor whose comparison page was in the citations.",
  },
  {
    n: "02",
    title: "Put pricing and limits on a crawlable page",
    why: "Models skipped the brand on purchase-intent questions where rivals stated price in plain HTML.",
  },
  {
    n: "03",
    title: "Name the category the way buyers ask it",
    why: "Answers used a category phrase that does not appear on the homepage.",
  },
];

export default function ActionCentrePage() {
  return (
    <MarketingShell narrow>
      <section className="border-b border-border pb-14 md:pb-20">
        <Badge variant="secondary" className="rounded-full font-mono text-[11px]">
          Product
        </Badge>
        <h1 className="font-heading mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
          Action centre
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          The audit does not stop at a score. It writes a numbered list of
          website changes, each tied to the buyer questions you lost and
          the competitor pages that won them.
        </p>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          What a row looks like
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          In the dashboard the list is titled Website Improvements. Each
          row has a title, a one-line reason, and a collapsed proof block:
          the lost questions, who was named instead, and the source
          domains. You can mark a row started, done, or dismissed.
        </p>
        <ol className="mt-6 divide-y divide-border border-y border-border">
          {sampleActions.map((row) => (
            <li key={row.n} className="grid gap-2 py-5 sm:grid-cols-[2rem_1fr]">
              <span className="font-mono text-xs text-muted-foreground">
                {row.n}
              </span>
              <div>
                <p className="text-[15px] font-semibold leading-snug">
                  {row.title}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {row.why}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">
          These three rows are the shape of the list, not a customer
          result.
        </p>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          How priority is set
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          The writer ranks fixes by how many lost answers a change could
          move, using the stored answers, citation gaps, and competitor
          pages it actually read. The number you see is that sort order —
          01 first — not a separate published scoring formula with
          weights.
        </p>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          The free audit includes the first prioritized fix. Plus and Pro
          see the full list.
          Recommendations are directional. They are not a ranking
          guarantee.
        </p>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          The coding prompt
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Plus and Pro can copy one prompt that restates the open fixes
          for Cursor, Claude Code, or a similar tool pointed at the
          website repo. It includes the company facts from the audit, the
          lost buyer questions, and the competitor URLs to study — not
          copy. That is the same evidence already on the improvements
          page, worded so an agent can implement it.
        </p>
      </section>

      <section className="py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Impact after you ship
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          On Pro, marking a fix done stores the visibility score at that
          moment. Later audits show the difference since then. The product
          copy says &ldquo;since completing,&rdquo; never &ldquo;because
          of.&rdquo; AI answers move for many reasons.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="sm">
            <Link href={routes.freeAuditSignup}>See a first fix on your site</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={routes.methodology}>How the score is built</Link>
          </Button>
        </div>
        <div className="mt-14">
          <ProductCrossNav current={routes.actionCentre} />
        </div>
      </section>
    </MarketingShell>
  );
}
