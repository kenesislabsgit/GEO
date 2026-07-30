import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export function ProReportLock({
  title,
  description,
  brandId,
}: {
  title: string;
  description: string;
  brandId: string;
}) {
  return (
    <div className="rb-empty px-6 py-12 text-center">
      <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-white text-muted-foreground shadow-sm">
        <Lock className="size-4" />
      </span>
      <h2 className="mt-4 text-base font-semibold">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-lg text-sm text-muted-foreground">
        {description}
      </p>
      <Button asChild size="sm" className="mt-5">
        <Link
          href={routes.billing({
            plan: "founder",
            returnTo: routes.brandUpgrade(brandId),
          })}
        >
          Unlock the full report
          <ArrowUpRight data-icon="inline-end" />
        </Link>
      </Button>
    </div>
  );
}
