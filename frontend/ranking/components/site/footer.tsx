import Link from "next/link";
import { Logo } from "@/components/site/logo";
import { routes } from "@/lib/routes";

const columns = [
  {
    title: "Product",
    links: [
      { href: routes.publicScanAnchor, label: "Free scan" },
      { href: routes.pricing, label: "Pricing" },
      { href: routes.dashboard, label: "Dashboard" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: routes.methodology, label: "Methodology" },
      { href: routes.privacy, label: "Privacy" },
      { href: routes.terms, label: "Terms" },
      { href: routes.refund, label: "Refunds" },
      { href: routes.dataHandling, label: "Data handling" },
      { href: routes.contact, label: "Contact" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
        <div className="flex flex-col justify-between gap-12 md:flex-row">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Measure whether AI answer engines recommend your brand before
              your competitors do. Sampled from OpenAI, Gemini, and Perplexity
              APIs.
            </p>
          </div>
          <div className="flex gap-16">
            {columns.map((column) => (
              <div key={column.title}>
                <p className="text-sm font-medium tracking-tight">
                  {column.title}
                </p>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-12 border-t border-border pt-6">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} RankedByAI. Results are sampled from
            provider APIs and may differ from consumer AI interfaces.
          </p>
        </div>
      </div>
    </footer>
  );
}
