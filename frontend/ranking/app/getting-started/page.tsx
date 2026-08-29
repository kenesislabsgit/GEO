import Link from "next/link";
import { MarketingShell } from "@/components/site/marketing-shell";
import { ProductCrossNav } from "@/components/site/product-cross-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FREE_AUDIT_QUESTION_COUNT,
  FREE_SCAN_CACHE_DAYS,
} from "@/lib/constants";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { routes } from "@/lib/routes";

export const metadata = {
  title: "Getting started",
  description:
    "How to run a first Arcanoris AI visibility audit in the browser. No SDK, no customer API keys, no installer.",
  alternates: { canonical: routes.gettingStarted },
};

const steps = [
  {
    title: "Create an account",
    body: "Sign up with email or Google. That is the only credential. You do not give us OpenAI, Claude, or Gemini keys. Arcanoris calls those APIs on your behalf.",
  },
  {
    title: "Add the company website",
    body: "Enter the public domain. We read public pages to learn category, audience, and claims. Nothing is installed on your servers.",
  },
  {
    title: "Start the audit",
    body: `The free audit asks ${FREE_AUDIT_QUESTION_COUNT} buyer questions to ChatGPT with web search. Paid plans let you pick providers and, after the first run, keep a tracked question list.`,
  },
  {
    title: "Stay on the progress page",
    body: "The run is a background job. You can watch percent complete. When it finishes, you get the score, answers, and the first improvement. A second free audit on the same site waits until the cache window ends.",
  },
];

const timelines = [
  {
    plan: "Free",
    ready: "First report after one audit",
    body: `${FREE_AUDIT_QUESTION_COUNT} questions, one provider. One run per website every ${FREE_SCAN_CACHE_DAYS} days. No scheduled monitoring. The public report is the deliverable.`,
  },
  {
    plan: "Plus",
    ready: "Same day you subscribe",
    body: `Self-serve checkout, then a 20-question audit across ${PLAN_CONFIG.founder.features.providers.length} providers. Turn on weekly monitoring from website settings when you want the next run to happen without clicking.`,
  },
  {
    plan: "Pro",
    ready: "After a short setup with us",
    body: `Pro is not self-serve. Use the contact form. We confirm websites, markets, and check volume, then you add sites and start audits in the same browser app. Daily monitoring and CSV/PDF are on once the plan is active.`,
  },
];

export default function GettingStartedPage() {
  return (
    <MarketingShell narrow>
      <section className="border-b border-border pb-14 md:pb-20">
        <Badge variant="secondary" className="rounded-full font-mono text-[11px]">
          Product
        </Badge>
        <h1 className="font-heading mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
          Getting started
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Arcanoris is a web app. There is no installer, no SDK, and no
          customer-side integration work before the first report.
        </p>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Time to first report
        </h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Signup, add a domain, start the audit, wait on the progress page.
          Duration depends on how many questions and providers you selected
          and how busy those APIs are. A free run is five questions to
          ChatGPT. A Plus run is 20 questions times five providers. A Pro
          run is 20 questions times up to ten providers.
        </p>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Setup, step by step
        </h2>
        <ol className="mt-6 space-y-6">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span className="font-mono text-xs text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <p className="font-medium">{step.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-b border-border py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          A browser is enough
        </h2>
        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
          {[
            "Sign in with email or Google and add the public domain.",
            "Arcanoris calls the AI providers. You keep your own keys off the form.",
            "Nothing is installed on your servers. The free audit does not need a card.",
          ].map((item) => (
            <li key={item} className="flex gap-3">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="py-14">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          When each plan is fully operational
        </h2>
        <div className="arc-list mt-6 divide-y divide-border">
          {timelines.map((row) => (
            <div key={row.plan} className="bg-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{row.plan}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {row.ready}
                </p>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {row.body}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="sm">
            <Link href={routes.freeAuditSignup}>Start the free audit</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={routes.methodology}>Read the methodology</Link>
          </Button>
        </div>
        <div className="mt-14">
          <ProductCrossNav current={routes.gettingStarted} />
        </div>
      </section>
    </MarketingShell>
  );
}
