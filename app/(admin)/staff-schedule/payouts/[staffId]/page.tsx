import { notFound } from "next/navigation";

import { StaffPayoutView } from "@/components/staff-payout-view";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { getStaffPayoutDetail } from "@/lib/staff-payout";

type Params = Promise<{ staffId: string }>;

export default async function StaffPayoutDetailPage({ params }: { params: Params }) {
  const { staffId } = await params;
  const workspace = await requireCurrentWorkspace();
  const { locale } = await getI18n();

  const detail = await getStaffPayoutDetail(workspace.id, staffId);
  if (!detail) notFound();

  return <StaffPayoutView locale={locale} {...detail} />;
}
