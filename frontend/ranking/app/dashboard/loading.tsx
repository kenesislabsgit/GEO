import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton in the rough shape of a dashboard page — header row, stat tiles,
 * a list — so navigation feels like the page is arriving rather than the
 * app pausing.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-8" aria-busy>
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rb-panel space-y-3 p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="rb-list divide-y divide-border">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex items-center justify-between px-5 py-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-7 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
