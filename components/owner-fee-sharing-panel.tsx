"use client";

import { useMemo, useState } from "react";

import { ActionSubmitButton } from "@/components/action-submit-button";
import { InfoHint } from "@/components/info-hint";
import { saveOwnerFeeSharingAction } from "@/app/actions";
import type { Locale } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";

export type FeeShareRow = {
  column: string;
  group: string;
  /** Whether a positive value in this column adds to or reduces the trip. */
  sign: "credit" | "debit";
  /** Resolved for this owner: OWNER or MANAGER. */
  target: "OWNER" | "MANAGER";
  /** True when this owner departs from the workspace policy. */
  isOverride: boolean;
};

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        title: "费用共享",
        intro:
          "Turo 的每笔行程收入里,除了租金还可能包含三十种额外收费或折扣。这里逐项决定哪些和这位车主分账、哪些由公司留下。不共享的项目会作为一条明确的扣款出现在对账单上,并写明是哪一项 —— 账要能对得上。",
        defaultNote:
          "没有单独设置的项目跟随工作区的默认规则(在「账户设置 → 车主分账规则」里)。所以这里只需要标出这位车主的例外。",
        shared: "分给车主",
        withheld: "公司留下",
        overrideTag: "例外",
        save: "保存费用共享设置",
        saving: "保存中…",
        saved: "已保存,并已重算这位车主的订单",
        calcTitle: "净收益计算",
        calcIntro:
          "下面这道算式就是这位车主的净收益怎么来的。数字取自已导入的订单,随上面的开关实时变化 —— 保存之前就能看出改动会把净收益推到哪里。",
        calcPayout: (count: number) => `Turo 打款总额(${count} 笔已导入订单)`,
        calcDeductions: "减去:公司留下的项目",
        calcNet: "车主净收益",
        calcNone: "目前没有任何项目由公司留下,净收益等于打款总额。",
        calcEmpty:
          "这位车主名下还没有已导入的订单,所以暂时算不出金额。上面的设置照样会生效,等 CSV 导入后就会按这套规则计算。",
        calcAbsorb: "负数表示这一项是折扣或退款,由公司承担,所以会把车主的净收益抬高。",
        calcNote: "佣金和洗车费在净收益之后单独计算,不在这道算式里。",
        onlyUsed: "只看有金额的项目",
        zeroHidden: (count: number) => `已折叠 ${count} 项金额为 0 的收费`,
        groups: {
          rent: "租金加价",
          discount: "折扣与优惠",
          usage: "超时超里程",
          service: "服务性收入",
          reimbursement: "费用报销",
          penalty: "罚金与赔偿",
          other: "其他",
        } as Record<string, string>,
      }
    : {
        title: "Fee sharing",
        intro:
          "A Turo trip's earnings bundle thirty possible charges and discounts on top of the rent. This decides, one by one, which of them this owner participates in and which the company keeps. Anything withheld appears on the statement as an explicit deduction naming the charge — the arithmetic has to be checkable.",
        defaultNote:
          "Anything not set here follows the workspace default (Account settings → Owner revenue split), so this page only needs to record this owner's exceptions.",
        shared: "Owner's",
        withheld: "Company keeps",
        overrideTag: "exception",
        save: "Save fee sharing",
        saving: "Saving…",
        saved: "Saved — this owner’s orders were resynced",
        calcTitle: "Net earning, worked out",
        calcIntro:
          "This is where the owner's net earning comes from. The figures are this owner's own imported orders and they follow the switches above as you set them, so a change can be read before it is saved.",
        calcPayout: (count: number) => `Turo payout (${count} imported orders)`,
        calcDeductions: "Less: what the company keeps",
        calcNet: "Owner's net earning",
        calcNone: "Nothing is withheld, so the net earning is the whole payout.",
        calcEmpty:
          "No imported orders for this owner yet, so there is nothing to total. The settings still apply — they take effect on the next CSV import.",
        calcAbsorb:
          "A negative line is a discount or refund the company carries, so it raises the owner's net rather than lowering it.",
        calcNote:
          "Commission and the cleaning fee are settled after this figure and are not part of it.",
        onlyUsed: "Only charges with money in them",
        zeroHidden: (count: number) => `${count} charges at zero are folded away`,
        groups: {
          rent: "Rent uplift",
          discount: "Discounts",
          usage: "Extra usage",
          service: "Service income",
          reimbursement: "Cost reimbursements",
          penalty: "Penalties and damages",
          other: "Other",
        } as Record<string, string>,
      };
}

/** Catalogue order, so the panel reads the way the export does. */
const GROUP_ORDER = [
  "rent",
  "discount",
  "usage",
  "service",
  "reimbursement",
  "penalty",
  "other",
];

/**
 * Which charges an owner participates in, one line per charge, and the
 * net earning those choices produce.
 *
 * The workspace already had a three-way split — reimbursements,
 * service, penalties — which is the right default and too coarse to
 * settle a real agreement on. One owner's contract covers the cleaning
 * fee and not the late fee; both are "penalties and reimbursements" to
 * a category setting. So the decision is per charge, per owner, and
 * only the departures are stored.
 *
 * The calculator underneath is the same decision read as arithmetic.
 * Thirty switches say what the rule is; only the total says what the
 * rule does, and an owner's net earning is the number both sides of
 * the agreement actually argue about.
 */
export function OwnerFeeSharingPanel({
  locale,
  ownerId,
  rows,
  totals,
  payoutTotal,
  orderCount,
}: {
  locale: Locale;
  ownerId: string;
  rows: FeeShareRow[];
  totals: Record<string, number>;
  payoutTotal: number;
  orderCount: number;
}) {
  const t = copy(locale);

  // Held in state, and it has to be.
  //
  // The first version styled the selected side from the `rows` prop,
  // which is computed on the server and does not change when a radio
  // is clicked. The click worked -- the input's checked state really
  // did move -- and absolutely nothing on screen did, so the control
  // read as dead. A toggle that does not move when pressed is broken
  // whatever the form later submits.
  const [choices, setChoices] = useState<Record<string, "OWNER" | "MANAGER">>(() =>
    Object.fromEntries(rows.map((row) => [row.column, row.target])),
  );

  // Thirty rows, and on a typical fleet a dozen of them are zero for
  // every trip this owner has ever run. Folding those away by default
  // leaves the list at the length of the actual agreement; the switch
  // brings them back for anyone setting terms ahead of the money.
  const [onlyUsed, setOnlyUsed] = useState(true);

  const amountOf = (column: string) => totals[column] ?? 0;
  const hasAmount = (column: string) => Math.abs(amountOf(column)) >= 0.005;

  const visibleRows = onlyUsed && orderCount > 0 ? rows.filter((row) => hasAmount(row.column)) : rows;
  const hiddenCount = rows.length - visibleRows.length;

  // Grouped for reading. A flat list of thirty charges is a wall.
  const groups = visibleRows.reduce<Record<string, FeeShareRow[]>>((acc, row) => {
    (acc[row.group] ??= []).push(row);
    return acc;
  }, {});

  // The deduction list, live. Every column the company keeps comes off
  // the payout with the sign the export gave it: a positive amount is
  // money the operator takes, a negative one is a discount it carries.
  const calculation = useMemo(() => {
    const deductions = rows
      .filter((row) => choices[row.column] === "MANAGER" && hasAmount(row.column))
      .map((row) => ({ column: row.column, amount: amountOf(row.column) }));
    const withheld = deductions.reduce((sum, line) => sum + line.amount, 0);
    return {
      deductions,
      withheld: Math.round(withheld * 100) / 100,
      net: Math.round((payoutTotal - withheld) * 100) / 100,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices, rows, totals, payoutTotal]);

  const hasAbsorbed = calculation.deductions.some((line) => line.amount < 0);

  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="flex items-center gap-1.5 font-serif text-[1.05rem] text-[var(--ink)]">
          {t.title}
          <InfoHint text={`${t.intro}\n\n${t.defaultNote}`} />
        </h2>
      </div>

      <form action={saveOwnerFeeSharingAction} className="space-y-4">
        <input type="hidden" name="ownerId" value={ownerId} />

        {orderCount > 0 ? (
          <label className="flex items-center gap-2 text-[11.5px] text-[var(--ink-mid)]">
            <input
              type="checkbox"
              checked={onlyUsed}
              onChange={(event) => setOnlyUsed(event.target.checked)}
              className="h-3.5 w-3.5"
            />
            {t.onlyUsed}
            {onlyUsed && hiddenCount > 0 ? (
              <span className="text-[var(--ink-soft)]">· {t.zeroHidden(hiddenCount)}</span>
            ) : null}
          </label>
        ) : null}

        {GROUP_ORDER.filter((group) => groups[group]?.length).map((group) => (
          <div key={group}>
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
              {t.groups[group] ?? group}
            </p>
            <ul className="mt-1.5 space-y-1">
              {groups[group].map((row) => {
                const amount = amountOf(row.column);
                return (
                  <li
                    key={row.column}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--line)] px-3 py-1.5"
                  >
                    <span className="min-w-0 text-[12px] text-[var(--ink)]">
                      {row.column}
                      {/* The amount this owner has actually seen in this
                          column. Without it every row looks equally
                          worth arguing over, and most of them are not. */}
                      {orderCount > 0 ? (
                        <span
                          className={`ml-2 tabular-nums ${
                            hasAmount(row.column)
                              ? "font-semibold text-[var(--ink-mid)]"
                              : "text-[var(--ink-soft)]"
                          }`}
                        >
                          {formatCurrency(amount, locale)}
                        </span>
                      ) : null}
                      {choices[row.column] !== row.target || row.isOverride ? (
                        <span className="ml-2 rounded-full border border-[var(--line)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ink-soft)]">
                          {t.overrideTag}
                        </span>
                      ) : null}
                    </span>

                    <span className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--line)] p-0.5">
                      {(["OWNER", "MANAGER"] as const).map((value) => (
                        <label
                          key={value}
                          className={`tap-press cursor-pointer rounded-[5px] px-2.5 py-1 text-[11px] font-semibold transition ${
                            choices[row.column] === value
                              ? "bg-[var(--ink)] text-white"
                              : "text-[var(--ink-soft)] hover:bg-[var(--surface-muted)]"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`fee:${row.column}`}
                            value={value}
                            checked={choices[row.column] === value}
                            onChange={() =>
                              setChoices((current) => ({ ...current, [row.column]: value }))
                            }
                            className="sr-only"
                          />
                          {value === "OWNER" ? t.shared : t.withheld}
                        </label>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* Every hidden row still needs to submit, or folding the zero
            charges away would silently reset them to the workspace
            default on save. */}
        {rows
          .filter((row) => !visibleRows.includes(row))
          .map((row) => (
            <input
              key={row.column}
              type="hidden"
              name={`fee:${row.column}`}
              value={choices[row.column]}
            />
          ))}

        <ActionSubmitButton label={t.save} pendingLabel={t.saving} savedLabel={t.saved} />
      </form>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4">
        <h3 className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-[var(--ink)]">
          {t.calcTitle}
          <InfoHint text={`${t.calcIntro}\n\n${t.calcNote}`} />
        </h3>

        {orderCount === 0 ? (
          <p className="mt-2 text-[12px] leading-5 text-[var(--ink-soft)]">{t.calcEmpty}</p>
        ) : (
          <dl className="mt-3 space-y-1 text-[12px]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[var(--ink-mid)]">{t.calcPayout(orderCount)}</dt>
              <dd className="shrink-0 font-semibold tabular-nums text-[var(--ink)]">
                {formatCurrency(payoutTotal, locale)}
              </dd>
            </div>

            {calculation.deductions.length === 0 ? (
              <p className="pt-1 text-[var(--ink-soft)]">{t.calcNone}</p>
            ) : (
              <>
                <p className="pt-2 text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
                  {t.calcDeductions}
                </p>
                {calculation.deductions.map((line) => (
                  <div
                    key={line.column}
                    className="flex items-baseline justify-between gap-3 pl-3"
                  >
                    <dt className="min-w-0 text-[var(--ink-mid)]">{line.column}</dt>
                    <dd
                      className={`shrink-0 tabular-nums ${
                        line.amount < 0 ? "text-emerald-700" : "text-[var(--ink)]"
                      }`}
                    >
                      {line.amount < 0 ? "+" : "−"}
                      {formatCurrency(Math.abs(line.amount), locale)}
                    </dd>
                  </div>
                ))}
              </>
            )}

            <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-[var(--line)] pt-2">
              <dt className="font-semibold text-[var(--ink)]">{t.calcNet}</dt>
              <dd className="shrink-0 font-serif text-[1.05rem] tabular-nums text-[var(--ink)]">
                {formatCurrency(calculation.net, locale)}
              </dd>
            </div>
          </dl>
        )}

        {hasAbsorbed ? (
          <p className="mt-2 text-[11px] leading-4 text-[var(--ink-soft)]">{t.calcAbsorb}</p>
        ) : null}
      </section>
    </section>
  );
}
