import Link from "next/link";

import { requireCurrentWorkspace } from "@/lib/auth";
import { getMessages } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { getStaffPayoutSummaries } from "@/lib/staff-payout";
import { formatCurrency } from "@/lib/utils";

/**
 * Every staff member's pay at a glance: earned, paid, owed, and the
 * reimbursements alongside. Click through for the ledger behind it.
 */
export default async function StaffPayoutsPage() {
  const workspace = await requireCurrentWorkspace();
  const { locale } = await getI18n();
  const t = getMessages(locale).staffPayouts;
  const rows = await getStaffPayoutSummaries(workspace.id);
  const money = (value: number) => formatCurrency(value, locale);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/staff-schedule" className="text-sm text-[var(--ink-soft)] hover:text-[var(--ink)]">
            ← {t.back}
          </Link>
          <h1 className="mt-1 font-serif text-2xl text-[var(--ink)]">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--ink-soft)]">{t.intro}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--ink-soft)]">{t.empty}</div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => (
            <Link
              key={row.staffId}
              href={`/staff-schedule/payouts/${row.staffId}`}
              className="card flex flex-col gap-3 p-4 transition hover:shadow-sm sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-[var(--ink)]">{row.name}</span>
                    {!row.isActive ? (
                      <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-soft)]">
                        {t.inactive}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-[var(--ink-soft)]">
                    <span>{t.tasksDue(row.countDue)}</span>
                    {row.countUpcoming > 0 ? <span>{t.tasksUpcoming(row.countUpcoming)}</span> : null}
                    <span>
                      {t.defaultRate}:{" "}
                      <span className="text-[var(--ink-mid)]">
                        {row.defaultTaskRate != null ? money(row.defaultTaskRate) : t.notSet}
                      </span>
                    </span>
                    <span>
                      {t.taskEarned} <span className="text-[var(--ink-mid)]">{money(row.earnedDue)}</span>
                    </span>
                    <span>
                      {t.taskPaid} <span className="text-[var(--ink-mid)]">{money(row.taskPaid)}</span>
                    </span>
                    {row.reimbursed > 0 ? (
                      <span>
                        {row.reimbursementOwed < 0 ? t.reimbursementOverpaid : t.reimbursementOwed}{" "}
                        <span className="text-[var(--ink-mid)]">{money(Math.abs(row.reimbursementOwed))}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-left sm:text-right">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                  {row.owed < 0 ? t.totalOverpaid : t.totalOwed}
                </p>
                <p
                  className={`text-lg font-semibold tabular-nums ${
                    row.owed > 0.005 ? "text-[var(--ink)]" : "text-[var(--ink-soft)]"
                  }`}
                >
                  {money(Math.abs(row.owed))}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
