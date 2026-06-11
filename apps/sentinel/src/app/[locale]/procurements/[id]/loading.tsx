import {
  MobileCardListSkeleton,
  StatCardSkeleton,
  TableSkeleton,
} from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="max-w-5xl" role="status" aria-busy="true">
      {/* Back link */}
      <Skeleton className="h-5 w-20 mb-4" />

      {/* Title + org line */}
      <Skeleton className="h-7 w-full max-w-xl mb-1" />
      <Skeleton className="h-5 w-72 mb-5" />

      {/* Value / item / contract info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {Array.from({ length: 4 }, (_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      {/* Procurement details card */}
      <div className="rounded-lg border bg-card p-5 mb-6">
        <Skeleton className="h-5 w-44 mb-3" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-3 gap-x-6">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
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
              <div className="flex-1 min-w-0 space-y-1">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
              <Skeleton className="h-4 w-14 flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* Items: mobile cards + desktop table */}
      <div className="rounded-lg border bg-card mb-6 overflow-hidden">
        <div className="p-4 border-b">
          <Skeleton className="h-5 w-24" />
        </div>
        <MobileCardListSkeleton rows={4} className="md:hidden rounded-none border-0" />
        <TableSkeleton columns={8} rows={6} className="hidden md:block rounded-none border-0" />
      </div>

      {/* Linked contracts: mobile cards + desktop table */}
      <div className="rounded-lg border bg-card mb-6 overflow-hidden">
        <div className="p-4 border-b">
          <Skeleton className="h-5 w-48" />
        </div>
        <MobileCardListSkeleton rows={2} className="md:hidden rounded-none border-0" />
        <TableSkeleton columns={4} rows={3} className="hidden md:block rounded-none border-0" />
      </div>
    </div>
  );
}
