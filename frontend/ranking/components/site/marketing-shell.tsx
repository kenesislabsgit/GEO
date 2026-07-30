import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { cn } from "@/lib/utils";

export function MarketingShell({
  children,
  className,
  narrow = false,
}: {
  children: React.ReactNode;
  className?: string;
  narrow?: boolean;
}) {
  return (
    <div className="rb-atmosphere relative flex min-h-screen flex-col overflow-hidden">
      <div aria-hidden className="rb-mesh pointer-events-none absolute inset-0 opacity-70" />
      <div
        aria-hidden
        className="rb-grid pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_70%_50%_at_50%_0%,black,transparent)]"
      />
      <SiteHeader />
      <main
        className={cn(
          "relative mx-auto w-full flex-1 px-4 py-14 md:px-6 md:py-20",
          narrow ? "max-w-3xl" : "max-w-6xl",
          className,
        )}
      >
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
