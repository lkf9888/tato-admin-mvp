import { InvestmentRankingTool } from "@/components/investment-ranking-tool";
import { getI18n } from "@/lib/i18n-server";

/**
 * Which car to buy, ranked. Sits next to the income estimator because it
 * runs on the same fitted model — this one just keeps subtracting until
 * what is left is a return rather than a revenue.
 *
 * Nothing here touches the database; the whole ranking is computed in
 * the browser from static model files.
 */
export default async function InvestmentRankingPage() {
  const { locale, messages } = await getI18n();
  const copy = messages.investmentRanking;

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.92),rgba(247,247,247,0.96))] p-3 shadow-[0_20px_48px_-40px_rgba(17,19,24,0.45)] sm:p-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-soft)]">
          {copy.kicker}
        </p>
        <h2 className="mt-1 font-serif text-[1.25rem] leading-tight text-[color:var(--ink)] sm:text-[1.45rem]">
          {copy.title}
        </h2>
        <p className="mt-2 max-w-4xl text-[12px] leading-5 text-[color:var(--ink-soft)]">
          {copy.intro}
        </p>
      </section>

      <InvestmentRankingTool locale={locale} copy={copy} />
    </div>
  );
}
