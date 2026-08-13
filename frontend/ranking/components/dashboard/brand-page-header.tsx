import { BrandNav } from "@/components/dashboard/brand-nav";

export function BrandPageHeader({
  brandId,
  brandName,
  title,
  description,
  isPaid,
}: {
  brandId: string;
  brandName: string;
  title: string;
  description?: string;
  isPaid: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="rb-eyebrow">{brandName}</p>
        <h1 className="font-heading mt-1 text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <BrandNav brandId={brandId} isPaid={isPaid} />
    </div>
  );
}
