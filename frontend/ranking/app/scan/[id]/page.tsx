import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { ScanProgress } from "@/components/scan/scan-progress";

export default async function ScanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="rb-atmosphere relative flex min-h-screen flex-col overflow-hidden">
      <div aria-hidden className="rb-mesh pointer-events-none absolute inset-0 opacity-60" />
      <SiteHeader />
      <main className="relative flex flex-1 items-center px-4 py-16">
        <div className="relative mx-auto w-full">
          <ScanProgress scanId={id} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
