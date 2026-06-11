import { Skeleton } from "@/components/ui/skeleton";
import {
  PageTitleSkeleton,
  SectionCardSkeleton,
  StatCardsSkeleton,
} from "@/components/skeletons";

/**
 * Locale-level fallback. The root page redirects to /dashboard, so this
 * mirrors the dashboard skeleton to avoid a blank flash while routes
 * without their own loading.tsx resolve.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true">
      <PageTitleSkeleton className="mb-6" />

      <StatCardsSkeleton count={7} className="mb-6" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <Skeleton className="h-5 w-40 mb-4" />
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-md bg-muted/50"
              >
                <Skeleton className="h-5 w-16" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        </div>

        <SectionCardSkeleton lines={2} />
      </div>
    </div>
  );
}
