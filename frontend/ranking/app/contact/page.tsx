import {
  FileText,
  Globe2,
  Radar,
  ShieldCheck,
} from "lucide-react";
import { MarketingShell } from "@/components/site/marketing-shell";
import { ContactForm } from "@/components/site/contact-form";
import { getSessionUser } from "@/lib/auth/session";
import { isContactIntent } from "@/lib/contact/schema";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { APP_NAME } from "@/lib/constants";
import { routes } from "@/lib/routes";

export const metadata = {
  title: "Contact sales",
  description:
    "Talk to us about the Pro plan, multi-website monitoring, or a custom setup. Typical reply within one business day.",
  alternates: { canonical: routes.contact },
};

const PRO_FEATURES = [
  {
    icon: Globe2,
    text: "Up to 20 websites on one plan, with a 10k monthly check allowance",
  },
  {
    icon: Radar,
    text: "The full provider catalog: run any 10 per audit, including Perplexity, Grok, and DeepSeek",
  },
  {
    icon: FileText,
    text: "Daily monitoring, CSV exports, and PDF reports you can send to a client",
  },
  {
    icon: ShieldCheck,
    text: "A person on the other end before you buy. No self-serve checkout for Pro",
  },
];

const GROWTH_FEATURES = [
  {
    icon: Globe2,
    text: `Up to ${PLAN_CONFIG.growth.features.brands} websites, with daily monitoring`,
  },
  {
    icon: Radar,
    text: `The ${PLAN_CONFIG.growth.features.providersPerScan} most-used AIs, checked on every audit`,
  },
  {
    icon: FileText,
    text: "CSV exports, PDF reports, and impact tracking on completed fixes",
  },
];

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const [user, params] = await Promise.all([getSessionUser(), searchParams]);
  const defaultInterest = isContactIntent(params.intent) ? params.intent : "pro";
  const growthWaitlist = defaultInterest === "growth";
  const features = growthWaitlist ? GROWTH_FEATURES : PRO_FEATURES;

  return (
    <MarketingShell>
      <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <p className="arc-eyebrow">{growthWaitlist ? "Waitlist" : "Sales"}</p>
          <h1 className="font-heading mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            {growthWaitlist
              ? "Join the Growth list"
              : "Contact our sales team"}
          </h1>
          <p className="mt-4 max-w-md text-lg text-muted-foreground">
            {growthWaitlist
              ? `Growth isn't self-serve yet. Tell us about your sites and we'll email you when a spot opens.`
              : `Get started with ${APP_NAME} Pro: multi-website AI visibility, the full provider set, and a plan we set up with you.`}
          </p>
          <div className="mt-10">
            <p className="text-sm font-medium">
              {growthWaitlist ? "What Growth includes" : "What Pro includes"}
            </p>
            <ul className="mt-4 space-y-4">
              {features.map((feature) => (
                <li key={feature.text} className="flex items-start gap-3">
                  <feature.icon
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="text-sm leading-relaxed text-foreground/80">
                    {feature.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-10 text-sm text-muted-foreground">
            Plus stays self-serve. Pro is by request so we can size checks,
            websites, and providers to the work.
          </p>
        </div>
        <ContactForm
          defaultEmail={user?.email ?? ""}
          defaultInterest={defaultInterest}
        />
      </div>
    </MarketingShell>
  );
}
