import { Skeleton } from "@/components/ui/skeleton";

function AnalysisCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4 md:p-5 min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Skeleton className="h-5 w-24 rounded" />
          <Skeleton className="h-5 w-20 rounded" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-4 w-20 ml-auto" />
      </div>

      <div className="flex items-center gap-2 mb-3 p-2 -mx-2">
        <Skeleton className="h-4 w-4 flex-shrink-0 rounded" />
        <div className="min-w-0 flex-1 space-y-1">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      </div>

      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>

      <div className="mt-3 pt-3 border-t">
        <Skeleton className="h-4 w-28" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div role="status" aria-busy="true">
      <Skeleton className="h-7 md:h-8 w-48 mb-2" />
      <Skeleton className="h-4 w-full max-w-3xl mb-5" />

      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <AnalysisCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
