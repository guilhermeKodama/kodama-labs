import { SectionCardSkeleton, StatCardSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="max-w-5xl" role="status" aria-busy="true">
      {/* Back link */}
      <Skeleton className="h-4 w-20 mb-4" />

      {/* Title + contract number */}
      <Skeleton className="h-7 w-full max-w-xl mb-1" />
      <Skeleton className="h-5 w-48 mb-5" />

      {/* Value cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {Array.from({ length: 4 }, (_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      {/* Contract details + contracting org / supplier */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <SectionCardSkeleton lines={8} />
        <SectionCardSkeleton lines={8} />
      </div>

      {/* Documents list */}
      <div className="rounded-lg border bg-card mb-6 overflow-hidden">
        <div className="p-4 border-b">
          <Skeleton className="h-5 w-56" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 p-3">
              <Skeleton className="h-4 w-4 flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
      </div>

      {/* Alerts list */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="p-4 border-b">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="p-4 space-y-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-md bg-muted/50"
            >
              <Skeleton className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
