import { PageTitleSkeleton, PaginationSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-busy="true">
      <PageTitleSkeleton className="mb-2" />
      <Skeleton className="h-4 w-full max-w-3xl mb-5" />

      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4">
              <Skeleton className="h-3 w-16 mb-2" />
              <Skeleton className="h-6 w-10" />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 flex-1 w-full sm:min-w-[280px]" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-24" />
          ))}
        </div>

        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-full mb-1" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
                <Skeleton className="h-4 w-4 mt-1 flex-shrink-0" />
              </div>
            </div>
          ))}
        </div>

        <PaginationSkeleton />
      </div>
    </div>
  );
}
