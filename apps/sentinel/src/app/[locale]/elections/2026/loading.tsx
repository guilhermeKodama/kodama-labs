import {
  StatCardsSkeleton,
  SectionCardSkeleton,
} from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="max-w-5xl" role="status" aria-busy="true">
      <Skeleton className="h-7 md:h-8 w-48 mb-2" />
      <Skeleton className="h-4 w-96 max-w-full mb-4" />
      <Skeleton className="h-14 w-full rounded-lg mb-6" />

      <StatCardsSkeleton count={4} className="mb-8" />

      <Skeleton className="h-5 w-40 mb-3" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>

      <Skeleton className="h-5 w-32 mb-3" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCardSkeleton lines={5} />
        <SectionCardSkeleton lines={5} />
      </div>
    </div>
  );
}
