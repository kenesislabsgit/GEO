import Link from "next/link";
import { ArrowUpRight, PartyPopper } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { listBrandsForOwner } from "@/lib/db/repository";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { routes } from "@/lib/routes";

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<{ claimed?: string; claimError?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const brands = await listBrandsForOwner(user.id);
  const params = await searchParams;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Websites
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Company websites you monitor and audit.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href={routes.newScan()}>
            New audit
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>

      {params.claimError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm">
            <span className="font-medium">{params.claimError}</span> is already
            claimed by another account. If you believe you own this brand,
            contact support to open an ownership dispute.
          </p>
        </div>
      ) : null}

      {params.claimed ? (
        <div className="flex items-center gap-3 rounded-xl border border-[color:var(--rb-green)]/30 bg-[color:var(--rb-green)]/5 px-4 py-3">
          <PartyPopper className="size-4 shrink-0 text-[color:var(--rb-green)]" />
          <p className="text-sm">
            <span className="font-medium">{params.claimed}</span> is now yours.
            Upgrade to run multi-provider monitoring and unlock the action
            centre.
          </p>
        </div>
      ) : null}

      {brands.length === 0 ? (
        <div className="rb-empty p-10 text-center">
          <p className="font-medium">No websites yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Add your company website and run your first AI visibility audit.
          </p>
          <Button asChild size="sm" className="mt-5">
            <Link href={routes.newScan()}>Run an audit</Link>
          </Button>
        </div>
      ) : (
        <div className="rb-list">
          <div className="divide-y divide-border">
            {brands.map((brand) => (
              <Link
                key={brand.id}
                href={`/dashboard/brands/${brand.id}`}
                className="flex items-center justify-between gap-4 bg-card px-5 py-4 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{brand.name}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {brand.canonical_domain}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="shrink-0 rounded-full text-[11px] capitalize"
                >
                  {brand.visibility}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
