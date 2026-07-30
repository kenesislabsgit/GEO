import { MarketingShell } from "@/components/site/marketing-shell";

export const metadata = { title: "Data handling" };

const sections = [
  {
    title: "What we collect",
    body: "Account email, brand metadata, scan configuration, AI provider responses, citations, scores, and billing records needed to operate the product.",
  },
  {
    title: "Public scans",
    body: "Anonymous free scans use publicly available website information. Results may appear in a public report until claimed by an verified owner.",
  },
  {
    title: "Premium data",
    body: "Paid scan results, full answers, competitor intelligence, and exports are scoped to your account. Private and secret-link reports are never indexed or exposed in public APIs.",
  },
  {
    title: "Provider relationships",
    body: "RankedByAI is not affiliated with OpenAI, Google, or Perplexity. Answers are sampled via their APIs and may differ from consumer chat interfaces.",
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
    </MarketingShell>
  );
}
