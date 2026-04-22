import { PayoutsPanel } from "@/components/payouts-panel";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import {
  getWorkspaceConnectSnapshot,
  isStripeConnectConfigured,
  summarizeConnectStatus,
} from "@/lib/stripe-connect";
import { formatDateTime } from "@/lib/utils";

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{
    return?: string;
    refresh?: string;
  }>;
}) {
  const [{ locale }, workspace, params] = await Promise.all([
    getI18n(),
    requireCurrentWorkspace(),
    searchParams,
  ]);

  const snapshot = await getWorkspaceConnectSnapshot(workspace.id);
  const status = summarizeConnectStatus(snapshot);

  return (
    <PayoutsPanel
      locale={locale}
      configured={isStripeConnectConfigured()}
      snapshot={{
        accountId: snapshot.accountId,
        country: snapshot.country,
        chargesEnabled: snapshot.chargesEnabled,
        payoutsEnabled: snapshot.payoutsEnabled,
        detailsSubmitted: snapshot.detailsSubmitted,
        onboardedAtLabel: snapshot.onboardedAt
          ? formatDateTime(snapshot.onboardedAt, locale)
          : null,
      }}
      status={status}
      returnedFromStripe={params.return === "1" || params.refresh === "1"}
    />
  );
}
