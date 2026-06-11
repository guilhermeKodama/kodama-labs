import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Composable skeleton blocks shared by route-level loading.tsx files.
 * Pure shapes only — no text and no translations, so they render
 * instantly regardless of locale.
 */

export function PageTitleSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("h-7 md:h-8 w-48 mb-5", className)} />;
}

export function TableToolbarSkeleton({ filterCount = 2 }: { filterCount?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Skeleton className="h-10 flex-1 w-full sm:min-w-[300px]" />
      {Array.from({ length: filterCount }, (_, i) => (
        <Skeleton key={i} className="hidden sm:block h-10 w-28" />
      ))}
    </div>
  );
}

export function TableSkeleton({
  columns = 5,
  rows = 10,
  className,
}: {
  columns?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card overflow-hidden", className)}>
      <div className="border-b bg-muted/50 p-3 flex gap-3">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="p-3 flex gap-3 items-center">
            {Array.from({ length: columns }, (_, c) => (
              <Skeleton
                key={c}
                className={cn("h-4 flex-1", c === 0 && "h-5")}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MobileCardListSkeleton({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card divide-y", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      ))}
    </div>
  );
}

export function PaginationSkeleton() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Skeleton className="h-4 w-44" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 flex-1 sm:flex-initial sm:w-24" />
        <Skeleton className="h-8 flex-1 sm:flex-initial sm:w-24" />
      </div>
    </div>
  );
}

/**
 * Full listing-page skeleton: toolbar + mobile cards + desktop table +
 * pagination. Mirrors the responsive layout of <DataTable>.
 */
export function ListingPageSkeleton({
  columns = 5,
  rows = 10,
  filterCount = 2,
}: {
  columns?: number;
  rows?: number;
  filterCount?: number;
}) {
  return (
    <div className="space-y-4" role="status" aria-busy="true">
      <PageTitleSkeleton className="mb-0" />
      <TableToolbarSkeleton filterCount={filterCount} />
      <MobileCardListSkeleton className="md:hidden" />
      <TableSkeleton columns={columns} rows={rows} className="hidden md:block" />
      <PaginationSkeleton />
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-4 rounded-full" />
      </div>
      <Skeleton className="h-6 w-16 mt-1" />
    </div>
  );
}

export function StatCardsSkeleton({
  count = 7,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3",
        className,
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Card shell with a heading bar and a few content lines. */
export function SectionCardSkeleton({
  lines = 4,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-5 space-y-3", className)}>
      <Skeleton className="h-5 w-40" />
      <div className="space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton
            key={i}
            className={cn("h-4", i % 3 === 0 ? "w-full" : i % 3 === 1 ? "w-5/6" : "w-2/3")}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Detail-page header: back link, title, badge row and meta line —
 * the common shape of [id] pages.
 */
export function DetailHeaderSkeleton() {
  return (
    <div className="space-y-3 mb-6">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-7 md:h-8 w-full max-w-xl" />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-28" />
      </div>
    </div>
  );
}

/**
 * Generic detail-page skeleton: header + responsive grid of section
 * cards. Detail loading.tsx files can use this directly or compose
 * their own from the blocks above.
 */
export function DetailPageSkeleton({
  sections = 4,
}: {
  sections?: number;
}) {
  return (
    <div role="status" aria-busy="true">
      <DetailHeaderSkeleton />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: sections }, (_, i) => (
          <SectionCardSkeleton key={i} lines={i === 0 ? 6 : 4} />
        ))}
      </div>
    </div>
  );
}
