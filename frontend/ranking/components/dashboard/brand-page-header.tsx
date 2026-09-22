import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/**
 * Page header for a website's analysis pages. Navigation between sections
 * lives in the one place navigation lives - the dashboard sidebar (and the
 * mobile top bar); this is just the title block.
 */
export function BrandPageHeader({
  brandId,
  brandName,
  title,
  description,
  newAudit = false,
}: {
  brandId?: string;
  brandName: string;
  title: string;
  description?: string;
  isPaid?: boolean;
  newAudit?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="arc-eyebrow">{brandName}</p>
        <h1 className="font-heading mt-1 text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {newAudit && brandId ? (
        <Button asChild size="sm">
          <Link href={routes.newScan(brandId)}>
            <Plus data-icon="inline-start" />
            New audit
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
