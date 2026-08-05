import { SectionCardSkeleton, StatCardsSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <StatCardsSkeleton count={4} />
      <SectionCardSkeleton />
      <SectionCardSkeleton />
    </div>
  );
}
