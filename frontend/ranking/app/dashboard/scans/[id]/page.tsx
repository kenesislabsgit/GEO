import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getBrandById, getScanRun } from "@/lib/db/repository";
import { ScanProgress } from "@/components/scan/scan-progress";

export const metadata = { title: "Scan progress" };

export default async function DashboardScanProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const { id } = await params;

  const scan = await getScanRun(id);
  if (!scan) notFound();
  const brand = await getBrandById(scan.brand_id);
  if (!brand || brand.owner_id !== user.id) notFound();

  return (
    <div className="py-6">
      <div className="mx-auto mb-6 w-full max-w-xl">
        <p className="text-sm text-muted-foreground">{brand.name}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {brand.canonical_domain}
        </p>
      </div>
      <ScanProgress
        scanId={scan.id}
        destination={{ type: "dashboard", brandId: brand.id }}
      />
    </div>
  );
}
