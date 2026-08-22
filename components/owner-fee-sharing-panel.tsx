"use client";

import { useState } from "react";

import { saveOwnerFeeSharingAction } from "@/app/actions";
import type { Locale } from "@/lib/i18n";

export type FeeShareRow = {
  column: string;
  group: string;
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
          "Turo 的每笔行程收入里,除了租金还可能包含十几种额外收费。这里决定哪些和这位车主分账、哪些由公司留下。不共享的项目会作为一条明确的扣款出现在对账单上,并写明是哪一项 —— 账要能对得上。",
        defaultNote:
          "没有单独设置的项目跟随工作区的默认规则(在「账户设置 → 车主分账规则」里)。所以这里只需要标出这位车主的例外。",
        shared: "分给车主",
        withheld: "公司留下",
        overrideTag: "例外",
        save: "保存费用共享设置",
        groups: {
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
          "A Turo trip's earnings bundle a dozen possible charges on top of the rent. This decides which of them this owner participates in and which the company keeps. Anything withheld appears on the statement as an explicit deduction naming the charge — the arithmetic has to be checkable.",
        defaultNote:
          "Anything not set here follows the workspace default (Account settings → Owner revenue split), so this page only needs to record this owner's exceptions.",
        shared: "Owner's",
        withheld: "Company keeps",
        overrideTag: "exception",
        save: "Save fee sharing",
        groups: {
          usage: "Extra usage",
          service: "Service income",
          reimbursement: "Cost reimbursements",
          penalty: "Penalties and damages",
          other: "Other",
        } as Record<string, string>,
      };
}

/**
 * Which charges an owner participates in, one line per charge.
 *
 * The workspace already had a three-way split — reimbursements,
 * service, penalties — which is the right default and too coarse to
 * settle a real agreement on. One owner's contract covers the cleaning
 * fee and not the late fee; both are "penalties and reimbursements" to
 * a category setting. So the decision is per charge, per owner, and
 * only the departures are stored.
 */
export function OwnerFeeSharingPanel({
  locale,
  ownerId,
  rows,
}: {
  locale: Locale;
  ownerId: string;
  rows: FeeShareRow[];
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

  // Grouped for reading. A flat list of 20 charges is a wall.
  const groups = rows.reduce<Record<string, FeeShareRow[]>>((acc, row) => {
    (acc[row.group] ??= []).push(row);
    return acc;
  }, {});

  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="font-serif text-[1.05rem] text-[var(--ink)]">{t.title}</h2>
        <p className="mt-1 text-[12px] leading-5 text-[var(--ink-soft)]">{t.intro}</p>
        <p className="mt-1 text-[12px] leading-5 text-[var(--ink-soft)]">{t.defaultNote}</p>
      </div>

      <form action={saveOwnerFeeSharingAction} className="space-y-4">
        <input type="hidden" name="ownerId" value={ownerId} />

        {Object.entries(groups).map(([group, feeRows]) => (
          <div key={group}>
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
              {t.groups[group] ?? group}
            </p>
            <ul className="mt-1.5 space-y-1">
              {feeRows.map((row) => (
                <li
                  key={row.column}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--line)] px-3 py-1.5"
                >
                  <span className="min-w-0 text-[12px] text-[var(--ink)]">
                    {row.column}
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
              ))}
            </ul>
          </div>
        ))}

        <button type="submit" className="btn-primary">
          {t.save}
        </button>
      </form>
    </section>
  );
}
