import {
  DirectBookingHeader,
  DirectBookingLinkTabs,
  type DirectBookingSection,
} from "@/components/direct-booking-nav";
import { getDirectBookingSummary, getDirectBookingTabBadges } from "@/lib/direct-booking-summary";
import { getMessages, type Locale } from "@/lib/i18n";

/**
 * The page name and tab row on the direct-booking pages that are not
 * /direct-booking itself (the rental website, change requests), so each
 * looks like one more tab of the same page.
 */
export async function DirectBookingSubpageFrame({
  workspaceId,
  locale,
  active,
}: {
  workspaceId: string;
  locale: Locale;
  active: DirectBookingSection;
}) {
  const messages = getMessages(locale);
  const directMessages = messages.directBookingPage;
  const [summary, badges] = await Promise.all([
    getDirectBookingSummary(workspaceId),
    getDirectBookingTabBadges(workspaceId),
  ]);

  return (
    <>
      <DirectBookingHeader
        pageName={directMessages.kicker}
        stripeReady={summary.stripeReady}
        stripeMissingLabel={directMessages.stripeMissing}
      />
      <DirectBookingLinkTabs
        label={directMessages.tabsLabel}
        active={active}
        items={[
          { key: "vehicles", label: directMessages.tabVehicles, badge: badges.vehicleCount },
          { key: "rules", label: directMessages.tabRules },
          { key: "locations", label: directMessages.tabLocations, badge: badges.locationCount },
          {
            key: "email",
            label: directMessages.tabEmail,
            badge: badges.emailEnabled ? directMessages.emailOn : directMessages.emailOff,
          },
          {
            key: "agreement",
            label: messages.directBookingAgreement.tab,
            badge: badges.agreementCustom
              ? messages.directBookingAgreement.tabCustom
              : messages.directBookingAgreement.tabDefault,
          },
          {
            key: "requests",
            label: directMessages.tabRequests,
            badge: badges.pendingRequests || null,
          },
          {
            key: "deposits",
            label: messages.directBookingDeposits.tab,
            badge: badges.heldDeposits || null,
          },
          { key: "ads", label: messages.directBookingAds.tab },
          {
            key: "site",
            label: directMessages.tabSite,
            badge: directMessages.siteStateLabels[badges.siteState],
          },
        ]}
      />
    </>
  );
}
