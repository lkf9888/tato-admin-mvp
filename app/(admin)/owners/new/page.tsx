import { NewOwnerForm } from "@/app/(admin)/owners/new/new-owner-form";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";

export default async function NewOwnerPage() {
  await requireCurrentWorkspace();
  const { locale } = await getI18n();
  return <NewOwnerForm locale={locale} />;
}
