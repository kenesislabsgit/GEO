import { Skeleton } from "@/components/ui/skeleton";

/** Brand-page skeleton: header, verdict panel, stat tiles, two columns. */
export default function BrandLoading() {
  return (
    <div className="space-y-7" aria-busy>
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <div className="rb-panel flex items-center gap-4 p-5">
        <Skeleton className="size-9 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-5 w-56" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rb-panel space-y-3 p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
