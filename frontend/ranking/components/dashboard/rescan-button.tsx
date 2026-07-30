import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/**
 * Brand-level scan CTA. Routes to the dashboard scan flow with the brand
 * preselected so plan limits, providers, and usage are reviewed before start.
 */
export function RescanButton({ brandId }: { brandId: string }) {
  return (
    <Button asChild size="sm">
      <Link href={routes.newScan(brandId)}>
        <RefreshCw data-icon="inline-start" />
        Run again
      </Link>
    </Button>
  );
}
