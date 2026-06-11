import { Skeleton } from "@/components/ui/skeleton";
import { MobileCardListSkeleton, TableSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="max-w-5xl" role="status" aria-busy="true">
      <Skeleton className="h-4 w-24 mb-4" />

      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-full max-w-sm" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
        <Skeleton className="flex-shrink-0 h-6 w-32 rounded-full" />
      </div>

      <div className="rounded-lg border bg-card overflow-hidden mt-5">
        <MobileCardListSkeleton
          rows={6}
          className="md:hidden rounded-none border-0"
        />
        <TableSkeleton
          columns={5}
          rows={8}
          className="hidden md:block rounded-none border-0"
        />
      </div>
    </div>
  );
}
