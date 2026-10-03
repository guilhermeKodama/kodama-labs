import {
  ScorecardSkeleton,
  TabsBarSkeleton,
  SectionCardSkeleton,
} from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="max-w-5xl" role="status" aria-busy="true">
      {/* Back link */}
      <Skeleton className="h-4 w-24 mb-4" />

      {/* Profile header: name, party/position line, status badges */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </div>

      {/* Scorecard strip */}
      <ScorecardSkeleton />

      {/* Tab bar */}
      <TabsBarSkeleton />

      {/* Default (Overview) tab: data grids */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCardSkeleton lines={6} />
        <SectionCardSkeleton lines={6} />
      </div>
    </div>
  );
}
