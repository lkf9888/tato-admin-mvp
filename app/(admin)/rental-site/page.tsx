import { redirect } from "next/navigation";

/**
 * The rental website settings moved under direct booking, as its last
 * tab. Old bookmarks and links land there with their query intact.
 */
export default async function RentalSiteRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const each of Array.isArray(value) ? value : value == null ? [] : [value]) {
      query.append(key, each);
    }
  }
  redirect(`/direct-booking/site${query.size ? `?${query}` : ""}`);
}
