import { redirect } from "next/navigation";

/**
 * Moved: the estimator is now a tab of /vehicle-roi. Kept as a redirect
 * so bookmarks and links already sent keep landing somewhere useful.
 */
export default function RentalEstimateMoved() {
  redirect("/vehicle-roi/estimate");
}
