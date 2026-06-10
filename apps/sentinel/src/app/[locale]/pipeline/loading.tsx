import { PageTitleSkeleton, StatCardSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-busy="true">
      <div className="flex items-center justify-between mb-5">
        <PageTitleSkeleton className="mb-0" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {Array.from({ length: 4 }, (_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      <div className="rounded-lg border bg-card p-5 mb-6">
        <Skeleton className="h-5 w-40 mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="rounded-md bg-muted/50 px-3 py-2.5">
              <Skeleton className="h-3 w-20 mb-1.5" />
              <Skeleton className="h-6 w-14" />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-5 mb-6">
        <Skeleton className="h-5 w-40 mb-4" />
        <div className="overflow-x-auto">
          <div className="flex gap-3 border-b pb-2">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-3 flex-1" />
            ))}
          </div>
          {Array.from({ length: 8 }, (_, r) => (
            <div
              key={r}
              className="flex gap-3 py-2 border-b border-muted/50 last:border-0"
            >
              {Array.from({ length: 7 }, (_, c) => (
                <Skeleton key={c} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <div className="rounded-lg border bg-card p-5">
          <Skeleton className="h-5 w-48 mb-1" />
          <Skeleton className="h-3 w-full max-w-sm mb-4" />
          <Skeleton className="h-80 md:h-[420px] w-full" />
        </div>
      </div>
    </div>
  );
}
