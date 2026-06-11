import { Skeleton } from "@/components/ui/skeleton";
import {
  MobileCardListSkeleton,
  SectionCardSkeleton,
  StatCardSkeleton,
  TableSkeleton,
} from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="max-w-5xl" role="status" aria-busy="true">
      <Skeleton className="h-4 w-20 mb-4" />

      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-2/3 max-w-md" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 mb-6">
        {Array.from({ length: 4 }, (_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <SectionCardSkeleton lines={6} />
        <SectionCardSkeleton lines={6} />
      </div>

      <MobileCardListSkeleton rows={5} className="md:hidden" />
      <TableSkeleton columns={4} rows={5} className="hidden md:block" />
    </div>
  );
}
