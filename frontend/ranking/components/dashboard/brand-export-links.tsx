import Link from "next/link";
import { Download } from "lucide-react";
import { getAccountEntitlements } from "@/lib/billing/account";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";

const EXPORT_TYPES = [
  { type: "scores", label: "Score history" },
  { type: "questions", label: "Questions" },
  { type: "citations", label: "Sources & mentions" },
  { type: "competitors", label: "Competitors" },
  { type: "actions", label: "Actions" },
] as const;

export async function BrandExportLinks({ brandId }: { brandId: string }) {
  const user = await (await import("@/lib/auth/session")).getSessionUser();
  if (!user) return null;
  const entitlements = await getAccountEntitlements(user.id);
  if (!PLAN_CONFIG[entitlements.plan].features.pdfCsvExport) {
    return (
      <p className="text-sm text-muted-foreground">
        CSV exports are available on Pro and Growth.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {EXPORT_TYPES.map((item) => (
        <Button key={item.type} asChild size="sm" variant="outline">
          <Link href={routes.brandExport(brandId, item.type)} download>
            <Download data-icon="inline-start" />
            {item.label}
          </Link>
        </Button>
      ))}
    </div>
  );
}
