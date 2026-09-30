import { VehicleRoiTabs } from "@/components/vehicle-roi-tabs";
import { getI18n } from "@/lib/i18n-server";

/**
 * One page for everything about what a car earns: the cars we run
 * (fleet), what any car would earn here (estimate), and which one to buy
 * (ranking). They were three sidebar entries with three large heroes;
 * this keeps a single compact header and lets each view start on the
 * first screen.
 */
export default async function VehicleRoiLayout({ children }: { children: React.ReactNode }) {
  const { messages } = await getI18n();
  const copy = messages.valuation;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-[var(--line)] pb-2.5">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
            {copy.kicker}
          </p>
          <h2 className="mt-0.5 font-serif text-[1.25rem] leading-tight text-[var(--ink)]">
            {copy.title}
          </h2>
        </div>
        <VehicleRoiTabs
          labels={{ fleet: copy.tabFleet, estimate: copy.tabEstimate, ranking: copy.tabRanking }}
        />
      </header>
      {children}
    </div>
  );
}
