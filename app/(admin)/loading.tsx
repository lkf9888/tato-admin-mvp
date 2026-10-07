import { ListSkeleton } from "@/components/page-skeletons";

/** Any admin page without a placeholder of its own. */
export default function AdminLoading() {
  return <ListSkeleton rows={5} filters={0} />;
}
