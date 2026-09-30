import { VehicleRoiTabs } from "@/components/vehicle-roi-tabs";
import { getI18n } from "@/lib/i18n-server";

/**
 * One page for everything about what a car earns: the cars we run
 * (fleet), what any car would earn here (estimate), and which one to buy
 * (ranking).
 *
 * No visible heading: the sidebar already says where you are and the
 * tabs say which view, so a title above them only pushed the content
 * down — which on a phone meant a screen of header before any numbers.
 * The name stays in an sr-only h1 so a screen reader still announces
 * the page.
 */
export default async function VehicleRoiLayout({ children }: { children: React.ReactNode }) {
  const { messages } = await getI18n();
  const copy = messages.valuation;

  return (
    <div className="space-y-3">
      <h1 className="sr-only">{copy.title}</h1>
      <VehicleRoiTabs
        label={copy.title}
        labels={{ fleet: copy.tabFleet, estimate: copy.tabEstimate, ranking: copy.tabRanking }}
      />
      {children}
    </div>
  );
}
