import Link from "next/link";
import { MarketingShell } from "@/components/site/marketing-shell";
import { publicPageMetadata } from "@/lib/public-metadata";

export const metadata = publicPageMetadata(
  "Editorial policy",
  "Who publishes Arcanoris articles, how we cite technical sources, and how to request a correction.",
  "/editorial-policy",
);

export default function EditorialPolicyPage() {
  return (
    <MarketingShell narrow>
      <h1 className="font-heading text-4xl font-semibold">Editorial policy</h1>
      <div className="mt-6 space-y-5 leading-relaxed text-muted-foreground">
        <p>
          Arcanoris publishes these articles as product education. The Arcanoris
          editorial team is the organizational author and contact for
          corrections. This is not an independent endorsement of our product.
        </p>
        <p>
          Technical claims link to provider documentation, standards, or
          research where available. Practical content advice is editorial
          guidance, not a verified ranking factor or a promise of citations. A
          source describing Google Search does not establish how every AI
          provider behaves.
        </p>
        <p>
          Publication dates show when an article first appeared; updated dates
          mark material revisions. Documentation can change after review. The
          measurement guide distinguishes an audit snapshot from repeated
          observations and uncertainty.
        </p>
        <p>
          <Link
            href="/contact?intent=other"
            className="underline underline-offset-4"
          >
            Send the editorial team a correction
          </Link>{" "}
          with the article URL, the disputed passage, and a primary source. We
          review corrections and update the article when a change is warranted.
        </p>
      </div>
    </MarketingShell>
  );
}
