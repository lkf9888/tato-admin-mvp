import { redirect } from "next/navigation";

type SearchParams = Promise<{ ownerId?: string }>;

export default async function OwnerStatementsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  redirect(params.ownerId ? `/owners?ownerId=${params.ownerId}` : "/owners");
}
