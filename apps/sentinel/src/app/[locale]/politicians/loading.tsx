import { ListingPageSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <ListingPageSkeleton columns={9} rows={10} filterCount={5} />
  );
}
