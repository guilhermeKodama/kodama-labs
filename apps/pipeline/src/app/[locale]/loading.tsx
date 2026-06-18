import { ListingPageSkeleton, StatCardsSkeleton } from "@/components/skeletons";

// Content-only skeleton — chrome (PageLayout) lives in layout.tsx; duplicating
// it in fallbacks broke hydration in sentinel and degraded to MPA navigation.
export default function Loading() {
  return (
    <div className="space-y-5">
      <StatCardsSkeleton count={4} />
      <ListingPageSkeleton />
    </div>
  );
}
