import { SectionCardSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

function FieldGridSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

function DetailCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-lg border bg-card mb-5 overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-14" />
      </div>
      <div className="p-4">
        <FieldGridSkeleton />
        <FieldGridSkeleton />
        <div className="mt-3 pt-3 border-t space-y-2">
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className={i % 2 === 0 ? "h-4 w-full" : "h-4 w-5/6"} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="max-w-5xl" role="status" aria-busy="true">
      <Skeleton className="h-5 w-28 mb-4" />
      <Skeleton className="h-4 w-full max-w-3xl mb-4" />

      <div className="flex items-start gap-3 mb-5">
        <Skeleton className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <Skeleton className="h-7 w-full max-w-xl" />
          <div className="flex items-center gap-2 mt-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
      </div>

      <SectionCardSkeleton lines={2} className="mb-5" />

      <div className="flex flex-wrap gap-3 mb-6">
        <Skeleton className="h-[58px] w-64 rounded-lg" />
        <Skeleton className="h-[58px] w-64 rounded-lg" />
      </div>

      <DetailCardSkeleton rows={5} />
      <DetailCardSkeleton rows={5} />
    </div>
  );
}
