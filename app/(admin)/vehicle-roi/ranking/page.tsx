import { InvestmentRankingTool } from "@/components/investment-ranking-tool";
import { getI18n } from "@/lib/i18n-server";

/**
 * Which car to buy, ranked. Runs on the same fitted model as the
 * estimate — it just keeps subtracting until what is left is a return
 * rather than a revenue.
 *
 * Nothing here touches the database; the whole ranking is computed in
 * the browser from static model files.
 */
export default async function VehicleRoiRankingPage() {
  const { locale, messages } = await getI18n();

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-5 text-[var(--ink-soft)]">{messages.valuation.introRanking}</p>
      <InvestmentRankingTool locale={locale} copy={messages.investmentRanking} />
    </div>
  );
}
