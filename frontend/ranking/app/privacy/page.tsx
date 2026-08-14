import { MarketingShell } from "@/components/site/marketing-shell";

export const metadata = { title: "Privacy" };

const sections = [
  {
    title: "What we store",
    body: "Account, brand, scan, and billing metadata required to deliver the product. Raw AI answers and citations are stored to power your reports and history.",
  },
  {
    title: "How data is protected",
    body: "Every query is scoped to the owning account on the server. Secrets never ship to the browser. Public reports expose only explicitly public fields; private reports reveal nothing on any surface, including preview images.",
  },
  {
    title: "How long we keep things",
    body: "Report data (answers, scores, citations, actions) is kept while your account exists. Operational data ages out automatically: live progress events after 30 days, hashed-IP abuse records after 90 days, billing webhook payload bodies after 90 days (the processed-event record itself is kept for billing integrity), and raw crawl artifacts on audit machines after 14 days. When you delete your account, billing usage records are kept in anonymized form only, as required for financial accuracy.",
  },
  {
    title: "Your controls",
    body: "You can export all of your data as JSON or permanently delete your account and owned data from Settings at any time. Deletion cancels running audits and your subscription, and signs out every session.",
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
