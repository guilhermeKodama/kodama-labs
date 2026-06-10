import { Skeleton } from "@/components/ui/skeleton";
import { StatCardSkeleton, TableSkeleton } from "@/components/skeletons";

function LinkRowSkeleton() {
  return (
    <div className="p-4 flex items-start gap-4">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Skeleton className="flex-shrink-0 w-8 h-8 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      </div>

      <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-8 rounded" />
      </div>

      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Skeleton className="flex-shrink-0 w-8 h-8 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      </div>
    </div>
  );
}

function LinkGroupSkeleton({ rows }: { rows: number }) {
  return (
    <div className="rounded-lg border mb-6 overflow-hidden">
      <div className="p-4 border-b">
        <Skeleton className="h-5 w-56" />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }, (_, i) => (
          <LinkRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div role="status" aria-busy="true">
      <Skeleton className="h-7 md:h-8 w-48 mb-2" />
      <Skeleton className="h-3 w-full max-w-3xl mb-5" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {Array.from({ length: 5 }, (_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      <LinkGroupSkeleton rows={4} />
      <LinkGroupSkeleton rows={3} />

      <div className="rounded-lg border bg-card overflow-hidden mb-6">
        <div className="p-4 border-b space-y-2">
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
        <TableSkeleton
          columns={4}
          rows={6}
          className="rounded-none border-0"
        />
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="p-4 border-b">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="p-4 space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-md bg-muted/50"
            >
              <Skeleton className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-16 rounded" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
