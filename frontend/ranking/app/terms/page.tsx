import { MarketingShell } from "@/components/site/marketing-shell";

export const metadata = { title: "Terms" };

const sections = [
  {
    title: "Service",
    body: "RankedByAI provides directional AI visibility measurement based on official provider API samples. Results may differ from consumer AI interfaces and can vary between runs.",
  },
  {
    title: "No ranking guarantees",
    body: "Scores and recommendations are advisory, evidence-based guidance only. We do not guarantee placement, ranking, or recommendation in any AI product.",
  },
  {
    title: "Billing",
    body: "Paid plans are billed through Dodo Payments and can be managed or cancelled from the customer portal at any time. Usage limits apply on all plans, including trials.",
  },
];

export default function TermsPage() {
  return (
    <MarketingShell narrow>
      <h1 className="font-heading text-4xl font-semibold tracking-tight">
        Terms
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
