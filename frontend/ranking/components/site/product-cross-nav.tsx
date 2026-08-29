import Link from "next/link";
import { PRODUCT_PAGES } from "@/lib/product-pages";

export function ProductCrossNav({ current }: { current: string }) {
  return (
    <nav aria-label="More product pages" className="border-t border-border pt-10">
      <p className="text-xs text-muted-foreground">Also on this site</p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {PRODUCT_PAGES.filter((page) => page.href !== current).map((page) => (
          <li key={page.href}>
            <Link
              href={page.href}
              className="block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <p className="text-sm font-medium">{page.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {page.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
