"use client";

import { ActionSubmitButton } from "@/components/action-submit-button";
import { deleteOwnerCommissionAction, saveOwnerCommissionAction } from "@/app/actions";
import type { Locale } from "@/lib/i18n";
import { formatDate } from "@/lib/utils";

export type CommissionRuleRow = {
  id: string;
  ratePercent: number;
  settlement: "COMPANY_COLLECTS" | "OWNER_COLLECTS";
  effectiveFrom: string;
  note: string | null;
  /** True for the row currently in force. */
  isCurrent: boolean;
};

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        title: "管理佣金",
        intro:
          "佣金按行程开始那一天生效的条款计算。改了比例之后,之前已经结算的行程不会被重算 —— 所以上个季度的对账单永远对得上。",
        currentNone: "还没有设置佣金条款。目前按车辆各自的佣金比例计算,租金视为先进公司。",
        current: (rate: string, settlement: string, from: string) =>
          `当前:${rate},${settlement},自 ${from} 起`,
        rateLabel: "佣金比例(%)",
        rateHint: "写协议上的百分比,例如 20 表示 20%。",
        settlementLabel: "租金先打给谁",
        settlementCompany: "先进公司账户",
        settlementCompanyHint: "我们收到全款,扣除佣金后把余款付给车主。对账单是一张付款单。",
        settlementOwner: "先进车主账户",
        settlementOwnerHint:
          "车主直接收到租金,我们再向车主收取佣金。对账单是一张收款单,余额为负表示车主应付给我们。",
        fromLabel: "从哪天开始生效",
        fromHint: "这一天(含)之后开始的行程按这套条款计算,之前的行程不受影响。",
        noteLabel: "备注(可选)",
        save: "保存这套条款",
        saving: "保存中…",
        saved: "已保存,并已重算这位车主的订单",
        historyTitle: "条款历史",
        historyEmpty: "还没有任何条款记录。",
        currentTag: "生效中",
        futureTag: "未来生效",
        remove: "删除",
        removeHint: "删除后,这一天之后的行程会退回到更早的一套条款。",
      }
    : {
        title: "Management commission",
        intro:
          "Commission is charged at whatever terms were in force on the day a trip started. Changing the rate does not reprice trips that were already settled, so last quarter's statements keep reconciling.",
        currentNone:
          "No commission terms set. Each vehicle's own rate applies, and rent is treated as landing with the company.",
        current: (rate: string, settlement: string, from: string) =>
          `Currently ${rate}, ${settlement}, from ${from}`,
        rateLabel: "Commission rate (%)",
        rateHint: "The percentage as the agreement writes it — 20 means 20%.",
        settlementLabel: "Who receives the rent first",
        settlementCompany: "The company",
        settlementCompanyHint:
          "We receive the full amount, take the commission and pay the owner the remainder. The statement is a payout.",
        settlementOwner: "The owner",
        settlementOwnerHint:
          "The owner is paid directly and we invoice the commission. The statement is a bill, and a negative balance means the owner owes us.",
        fromLabel: "In force from",
        fromHint:
          "Trips starting on or after this date use these terms. Earlier trips are untouched.",
        noteLabel: "Note (optional)",
        save: "Save these terms",
        saving: "Saving…",
        saved: "Saved — this owner’s orders were resynced",
        historyTitle: "Terms history",
        historyEmpty: "No terms recorded yet.",
        currentTag: "In force",
        futureTag: "Starts later",
        remove: "Remove",
        removeHint: "Removing this hands trips after that date back to the previous terms.",
      };
}

/**
 * Commission terms for one owner.
 *
 * Presented as a history rather than a settings form, because that is
 * what it is. A rate is a term of an agreement; renegotiating it should
 * add a row with a start date, not overwrite the number last month's
 * statement was produced from.
 */
export function OwnerCommissionPanel({
  locale,
  ownerId,
  rules,
}: {
  locale: Locale;
  ownerId: string;
  rules: CommissionRuleRow[];
}) {
  const t = copy(locale);
  const current = rules.find((rule) => rule.isCurrent) ?? null;
  const today = new Date().toISOString().slice(0, 10);

  const settlementLabel = (settlement: CommissionRuleRow["settlement"]) =>
    settlement === "OWNER_COLLECTS" ? t.settlementOwner : t.settlementCompany;

  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="font-serif text-[1.05rem] text-[var(--ink)]">{t.title}</h2>
        <p className="mt-1 text-[12px] leading-5 text-[var(--ink-soft)]">{t.intro}</p>
      </div>

      <p className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[12px] leading-5 text-[var(--ink)]">
        {current
          ? t.current(
              `${current.ratePercent}%`,
              settlementLabel(current.settlement),
              formatDate(new Date(current.effectiveFrom), locale),
            )
          : t.currentNone}
      </p>

      <form action={saveOwnerCommissionAction} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="ownerId" value={ownerId} />

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-[var(--ink)]">{t.rateLabel}</span>
          <input
            name="ratePercent"
            type="number"
            min={0}
            max={100}
            step="0.1"
            required
            defaultValue={current?.ratePercent ?? 20}
            className="input"
          />
          <span className="text-[11px] leading-4 text-[var(--ink-soft)]">{t.rateHint}</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-[var(--ink)]">{t.fromLabel}</span>
          <input
            name="effectiveFrom"
            type="date"
            required
            defaultValue={today}
            className="input"
          />
          <span className="text-[11px] leading-4 text-[var(--ink-soft)]">{t.fromHint}</span>
        </label>

        <fieldset className="flex flex-col gap-1 sm:col-span-2">
          <legend className="text-[12px] font-semibold text-[var(--ink)]">
            {t.settlementLabel}
          </legend>
          {(
            [
              ["COMPANY_COLLECTS", t.settlementCompany, t.settlementCompanyHint],
              ["OWNER_COLLECTS", t.settlementOwner, t.settlementOwnerHint],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className="tap-row flex items-start gap-2 rounded-md border border-[var(--line)] px-3 py-2"
            >
              <input
                type="radio"
                name="settlement"
                value={value}
                defaultChecked={(current?.settlement ?? "COMPANY_COLLECTS") === value}
                className="mt-0.5 h-4 w-4"
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-[var(--ink)]">{label}</span>
                <span className="block text-[11px] leading-4 text-[var(--ink-soft)]">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[12px] font-semibold text-[var(--ink)]">{t.noteLabel}</span>
          <input name="note" type="text" className="input" />
        </label>

        <div className="sm:col-span-2">
          <ActionSubmitButton label={t.save} pendingLabel={t.saving} savedLabel={t.saved} />
        </div>
      </form>

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
          {t.historyTitle}
        </p>
        {rules.length === 0 ? (
          <p className="text-[12px] text-[var(--ink-soft)]">{t.historyEmpty}</p>
        ) : (
          <ul className="space-y-1.5">
            {rules.map((rule) => {
              const startsLater = new Date(rule.effectiveFrom).getTime() > Date.now();
              return (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--line)] px-3 py-2 text-[12px]"
                >
                  <span className="min-w-0">
                    <span className="font-semibold text-[var(--ink)]">{rule.ratePercent}%</span>
                    <span className="text-[var(--ink-soft)]">
                      {" · "}
                      {settlementLabel(rule.settlement)}
                      {" · "}
                      {formatDate(new Date(rule.effectiveFrom), locale)}
                    </span>
                    {rule.isCurrent ? (
                      <span className="ml-2 rounded-full bg-[var(--ink)] px-2 py-0.5 text-[10px] font-semibold text-white">
                        {t.currentTag}
                      </span>
                    ) : startsLater ? (
                      <span className="ml-2 rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink-soft)]">
                        {t.futureTag}
                      </span>
                    ) : null}
                    {rule.note ? (
                      <span className="block text-[11px] text-[var(--ink-soft)]">{rule.note}</span>
                    ) : null}
                  </span>
                  <form action={deleteOwnerCommissionAction}>
                    <input type="hidden" name="ruleId" value={rule.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-soft)] transition hover:border-red-300 hover:text-red-600"
                      title={t.removeHint}
                    >
                      {t.remove}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
