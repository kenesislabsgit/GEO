import { routes } from "@/lib/routes";

/** Public product pages written for buyers and AI crawlers. Keep this list
 * as the source for footer, sitemap, and cross-links so a new page cannot
 * be forgotten in one of them. */
export const PRODUCT_PAGES = [
  {
    href: routes.reporting,
    label: "Reporting & alerts",
    description:
      "Scheduled re-scans, email alerts, shareable reports, and Pro CSV/PDF exports.",
  },
  {
    href: routes.gettingStarted,
    label: "Getting started",
    description:
      "Time to first audit, what you need to sign up, and what is not required.",
  },
  {
    href: routes.scale,
    label: "Scale & reliability",
    description:
      "How high-volume checks are queued, retried, and capped by plan.",
  },
  {
    href: routes.providers,
    label: "Provider coverage",
    description:
      "Every supported AI provider, how we query it, and which plans include it.",
  },
  {
    href: routes.actionCentre,
    label: "Action centre",
    description:
      "How website improvements are prioritized and turned into a coding prompt.",
  },
] as const;
