import { ListingPageSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <ListingPageSkeleton columns={10} rows={10} filterCount={3} />
  );
}
