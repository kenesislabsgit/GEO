import { MarketingShell } from "@/components/site/marketing-shell";

export const metadata = { title: "Privacy" };

const sections = [
  {
    title: "What we store",
    body: "Account, brand, scan, and billing metadata required to deliver the product. Raw AI answers and citations are stored to power your reports and history.",
  },
  {
    title: "How data is protected",
    body: "Row-level security scopes every table to its owner. Service-role credentials never ship to the browser. Public reports expose only explicitly public fields.",
  },
  {
    title: "Your controls",
    body: "You can export all of your data as JSON or permanently delete your account and owned brand data from Settings at any time.",
  },
];

export default function PrivacyPage() {
  return (
    <MarketingShell narrow>
      <h1 className="font-heading text-4xl font-semibold tracking-tight">
        Privacy
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
