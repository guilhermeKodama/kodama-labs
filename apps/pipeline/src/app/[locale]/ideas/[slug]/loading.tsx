import { Skeleton } from "@/components/ui/skeleton";
import { DetailHeaderSkeleton, SectionCardSkeleton } from "@/components/skeletons";

// Content-only (no chrome). FunnelSkeleton: a row of stage boxes + edge chips.
export default function Loading() {
  return (
    <div className="space-y-5">
      <DetailHeaderSkeleton />
      <div className="hidden md:flex items-center gap-2 overflow-hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="contents">
            <Skeleton className="h-20 flex-1 rounded-lg" />
            {i < 6 ? <Skeleton className="h-5 w-16 rounded-full shrink-0" /> : null}
          </div>
        ))}
      </div>
      <div className="md:hidden space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
      <SectionCardSkeleton />
    </div>
  );
}
