import {
  MobileCardListSkeleton,
  SectionCardSkeleton,
  StatCardSkeleton,
  TableSkeleton,
} from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="max-w-5xl" role="status" aria-busy="true">
      {/* Back link */}
      <Skeleton className="h-4 w-24 mb-4" />

      {/* Profile header: name, party/position line, status badges */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 mb-6">
        {Array.from({ length: 4 }, (_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      {/* Politician data + personal data */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <SectionCardSkeleton lines={6} />
        <SectionCardSkeleton lines={6} />
      </div>

      {/* Financial summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <SectionCardSkeleton lines={4} />
      </div>

      {/* Donations table */}
      <div className="rounded-lg border bg-card overflow-hidden mb-6">
        <div className="p-4 border-b">
          <Skeleton className="h-5 w-52" />
        </div>
        <MobileCardListSkeleton rows={4} className="md:hidden border-0 rounded-none" />
        <TableSkeleton columns={10} rows={6} className="hidden md:block border-0 rounded-none" />
      </div>

      {/* Asset declaration table */}
      <div className="rounded-lg border bg-card overflow-hidden mb-6">
        <div className="p-4 border-b">
          <Skeleton className="h-5 w-52" />
        </div>
        <MobileCardListSkeleton rows={3} className="md:hidden border-0 rounded-none" />
        <TableSkeleton columns={4} rows={5} className="hidden md:block border-0 rounded-none" />
      </div>

      {/* Political links */}
      <SectionCardSkeleton lines={4} className="mb-6" />
    </div>
  );
}
