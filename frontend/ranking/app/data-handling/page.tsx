import { publicPageMetadata } from "@/lib/public-metadata";
import { MarketingShell } from "@/components/site/marketing-shell";
import { PolicyMeta } from "@/components/site/policy-meta";
import { DataRecipients } from "@/components/site/data-recipients";

export const metadata = publicPageMetadata(
  "Data handling",
  "What Arcanoris collects from AI provider scans, how public and premium scan data are scoped, and its retention and deletion rules.",
  "/data-handling",
);

const sections = [
  {
    title: "What we collect",
    body: "Account email, brand metadata, scan configuration, AI provider responses, citations, scores, and billing records needed to operate the product.",
  },
  {
    title: "Public scans",
    body: "Audits require an account. New websites and their report previews are public by default on every plan. Anyone can open the public link, and public reports are included in our sitemap and may appear in search engines. Free includes public sharing. Claiming a report does not change its visibility.",
  },
  {
    title: "Premium data",
    body: "Plus and Pro owners can switch a website between public and private in Website settings. This applies to its reports, including existing ones. Private reports are accessible only to their owner and are excluded from the public sitemap. Search engines may take time to remove previously indexed previews. Full dashboard evidence stays account-scoped even when the report preview is public.",
  },
  {
    title: "Provider relationships",
    body: "Arcanoris is not affiliated with OpenAI, Google, or Perplexity. Answers are sampled via their APIs and may differ from consumer chat interfaces.",
  },
  {
    title: "Retention & deletion",
    body: "You can export account data or permanently delete your account from Settings. Deletion removes owned brands and associated scan history subject to legal retention requirements.",
  },
  {
    title: "Limitations",
    body: "Scores reflect sampled AI answers at a point in time. They do not guarantee search traffic, revenue, or future AI behaviour.",
  },
];

export default function DataHandlingPage() {
  return (
    <MarketingShell narrow>
      <h1 className="font-heading text-4xl font-semibold tracking-tight">
        Data handling
      </h1>
      <PolicyMeta />
      <div className="mt-8 space-y-8">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="font-heading text-lg font-semibold tracking-tight">
              {section.title}
            </h2>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              {section.body}
            </p>
          </section>
        ))}
      </div>
      <DataRecipients />
    </MarketingShell>
  );
}
