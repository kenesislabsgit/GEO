/**
 * Page header for a website's analysis pages. Navigation between sections
 * lives in the one place navigation lives - the dashboard sidebar (and the
 * mobile top bar); this is just the title block.
 */
export function BrandPageHeader({
  brandName,
  title,
  description,
}: {
  brandId?: string;
  brandName: string;
  title: string;
  description?: string;
  isPaid?: boolean;
}) {
  return (
    <div>
      <p className="arc-eyebrow">{brandName}</p>
      <h1 className="font-heading mt-1 text-2xl font-semibold tracking-tight">
        {title}
      </h1>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
