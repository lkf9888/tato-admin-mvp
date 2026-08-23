"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CalendarView } from "@/components/calendar-view";
import type { EditableOrder } from "@/components/order-detail-modal";
import { SearchableSelect } from "@/components/searchable-select";
import type { Locale } from "@/lib/i18n";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

const ledgerKinds = {
  OWNER_NET_EARNING: "OWNER_NET_EARNING",
  MANAGER_COMMISSION: "MANAGER_COMMISSION",
  CLEANING_FEE: "CLEANING_FEE",
  EXPENSE_REIMBURSEMENT: "EXPENSE_REIMBURSEMENT",
  MANUAL_ADJUSTMENT: "MANUAL_ADJUSTMENT",
  SETTLEMENT_PAYMENT: "SETTLEMENT_PAYMENT",
  DIRECT_TO_OWNER: "DIRECT_TO_OWNER",
} as const;

type PublicLedgerKind = (typeof ledgerKinds)[keyof typeof ledgerKinds];
type ShareTab = "ledger" | "statements" | "calendar";

export type PublicOwnerVehicle = {
  id: string;
  label: string;
  plateNumber: string;
  secondaryLabel: string;
};

export type PublicLedgerReceipt = {
  id: string;
  url: string;
  filename: string | null;
  contentType: string | null;
  size: number | null;
  uploadedAt: string;
};

export type PublicLedgerItem = {
  id: string;
  kind: PublicLedgerKind;
  amount: number;
  occurredAt: string;
  createdAt: string;
  note: string | null;
  isAuto: boolean;
  receipts: PublicLedgerReceipt[];
  vehicle: {
    id: string;
    plateNumber: string;
    nickname: string;
  } | null;
  order: {
    id: string;
    renterName: string;
    pickupDatetime: string;
    returnDatetime: string;
  } | null;
};

function copy(locale: Locale, operatorName: string) {
  return locale === "en"
    ? {
        tabs: { ledger: "Ledger", statements: "Monthly statement", calendar: "Calendar" },
        language: "Language",
        currentBalance: "Current balance",
        tatoOwesOwner: `${operatorName} owes you`,
        ownerOwesTato: "You owe TATO",
        settled: "Settled",
        dateFrom: "From",
        dateTo: "To",
        clear: "Clear",
        date: "Date",
        description: "Description",
        income: "Income",
        debit: "Deductions",
        balance: "Balance",
        noLedger: "No ledger items in this period.",
        noStatement: "No statement items in this month.",
        month: "Month",
        print: "Print",
        grossIncome: "Income",
        deductions: "Deductions",
        net: "Net",
        receipts: "Receipts",
        ownerVehicleCount: (count: number) => `${count} vehicle${count === 1 ? "" : "s"}`,
        kindLabels: {
          OWNER_NET_EARNING: "Owner net earning",
          MANAGER_COMMISSION: `${operatorName} commission`,
          DIRECT_TO_OWNER: "Collected directly by owner",
          CLEANING_FEE: "Cleaning fee",
          EXPENSE_REIMBURSEMENT: "Reimbursement",
          MANUAL_ADJUSTMENT: "Adjustment",
          SETTLEMENT_PAYMENT: "Payment",
        },
      }
    : {
        tabs: { ledger: "流水账", statements: "月度对账单", calendar: "日历" },
        language: "语言",
        currentBalance: "当前余额",
        tatoOwesOwner: `${operatorName} 应付给您`,
        ownerOwesTato: "您应付给 TATO",
        settled: "账目已结清",
        dateFrom: "起始",
        dateTo: "截止",
        clear: "清除",
        date: "日期",
        description: "说明",
        income: "收入",
        debit: "支出",
        balance: "余额",
        noLedger: "这个时间段暂无流水账。",
        noStatement: "这个月份暂无对账项目。",
        month: "月份",
        print: "打印",
        grossIncome: "收入",
        deductions: "扣款",
        net: "净额",
        receipts: "凭证",
        ownerVehicleCount: (count: number) => `${count} 台车`,
        kindLabels: {
          OWNER_NET_EARNING: "车主净收益",
          MANAGER_COMMISSION: `${operatorName} 佣金`,
          DIRECT_TO_OWNER: "租金已由车主直接收取",
          CLEANING_FEE: "洗车费",
          EXPENSE_REIMBURSEMENT: "报销",
          MANUAL_ADJUSTMENT: "手动调整",
          SETTLEMENT_PAYMENT: "付款",
        },
      };
}

function isValidTab(value?: string | null): value is ShareTab {
  return value === "ledger" || value === "statements" || value === "calendar";
}

function dateInputValue(value: Date | string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function monthKey(value: Date | string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

function monthLabel(value: string, locale: Locale) {
  const [year, month] = value.split("-");
  if (!year || !month) return value;
  if (locale === "en") return `${year}-${month}`;
  return `${year}年${Number(month)}月`;
}

function isImageReceipt(receipt: Pick<PublicLedgerReceipt, "contentType" | "filename" | "url">) {
  if (receipt.contentType?.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(receipt.filename || receipt.url);
}

function sortLedger(items: PublicLedgerItem[]) {
  return [...items].sort(
    (left, right) =>
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime() ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function ledgerRowsWithBalance(items: PublicLedgerItem[]) {
  let runningBalance = 0;
  return [...items]
    .sort(
      (left, right) =>
        new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime() ||
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    )
    .map((item) => {
      runningBalance += item.amount;
      return { ...item, runningBalance };
    })
    .reverse();
}

function amountClass(amount: number) {
  if (amount > 0) return "text-emerald-700";
  if (amount < 0) return "text-amber-700";
  return "text-[var(--ink-soft)]";
}

function signedCurrency(amount: number, locale: Locale) {
  return formatCurrency(amount, locale);
}

export function OwnerPublicShareView({
  locale,
  owner,
  vehicles,
  ledgerItems,
  calendarOrders,
  activeTab,
  maskSensitive,
  operatorName,
}: {
  locale: Locale;
  owner: { id: string; name: string };
  /** Whose statement this is, from the owner's side. Their agreement
   *  is with this company, not with the software. */
  operatorName: string;
  vehicles: PublicOwnerVehicle[];
  ledgerItems: PublicLedgerItem[];
  calendarOrders: EditableOrder[];
  activeTab: ShareTab;
  maskSensitive: boolean;
}) {
  const labels = copy(locale, operatorName);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const sortedRows = useMemo(() => ledgerRowsWithBalance(ledgerItems), [ledgerItems]);
  const statementItems = useMemo(
    () => ledgerItems.filter((item) => item.kind !== ledgerKinds.SETTLEMENT_PAYMENT),
    [ledgerItems],
  );
  const months = useMemo(() => {
    const keys = Array.from(new Set(statementItems.map((item) => monthKey(item.occurredAt)).filter(Boolean)));
    return keys.sort((left, right) => right.localeCompare(left));
  }, [statementItems]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const month = selectedMonth || months[0] || monthKey(new Date());
  const totalBalance = ledgerItems.reduce((sum, item) => sum + item.amount, 0);
  const filteredRows = useMemo(() => {
    if (!dateFrom && !dateTo) return sortedRows;
    return sortedRows.filter((item) => {
      const value = dateInputValue(item.occurredAt);
      if (dateFrom && value < dateFrom) return false;
      if (dateTo && value > dateTo) return false;
      return true;
    });
  }, [dateFrom, dateTo, sortedRows]);
  const monthlyItems = useMemo(
    () => sortLedger(statementItems.filter((item) => monthKey(item.occurredAt) === month)),
    [month, statementItems],
  );
  const incomeTotal = monthlyItems.reduce((sum, item) => sum + Math.max(0, item.amount), 0);
  const deductionTotal = monthlyItems.reduce((sum, item) => sum + Math.min(0, item.amount), 0);
  const netTotal = incomeTotal + deductionTotal;

  function hrefFor(nextTab: ShareTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    params.set("lang", locale);
    return `${pathname}?${params.toString()}`;
  }

  function changeLanguage(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", value);
    params.set("tab", activeTab);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <main className="min-h-screen bg-[var(--page)] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)]">{owner.name}</h1>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--ink-soft)]">
              {vehicles.length > 0 ? (
                vehicles.map((vehicle) => (
                  <span key={vehicle.id} className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-blue-600" />
                    {vehicle.plateNumber}
                  </span>
                ))
              ) : (
                <span>{labels.ownerVehicleCount(0)}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-blue-500" aria-hidden>
              ◎
            </span>
            <div className="w-40">
              <SearchableSelect
                value={locale}
                onChange={changeLanguage}
                options={[
                  { value: "zh", label: "简体中文" },
                  { value: "zh-Hant", label: "繁體中文" },
                  { value: "en", label: "English" },
                ]}
                placeholder={labels.language}
                searchPlaceholder={labels.language}
                className="h-10 text-sm"
              />
            </div>
          </div>
        </header>

        <nav className="flex gap-6 border-b border-[var(--line)] text-sm font-medium">
          {(["ledger", "statements", "calendar"] as ShareTab[]).map((tab) => (
            <Link
              key={tab}
              href={hrefFor(tab)}
              className={cn(
                "border-b-2 px-1 pb-3 pt-1",
                activeTab === tab
                  ? "border-neutral-950 text-[var(--ink)]"
                  : "border-transparent text-[var(--ink-soft)] hover:text-[var(--ink)]",
              )}
            >
              {labels.tabs[tab]}
            </Link>
          ))}
        </nav>

        {activeTab === "calendar" ? (
          <CalendarView
            locale={locale}
            readOnly
            maskSensitive={maskSensitive}
            vehicleOptions={vehicles.map((vehicle) => ({
              id: vehicle.id,
              label: vehicle.label,
              plateNumber: vehicle.plateNumber,
              secondaryLabel: vehicle.secondaryLabel,
              ownerId: owner.id,
              ownerName: owner.name,
            }))}
            ownerOptions={[{ id: owner.id, label: owner.name }]}
            orders={calendarOrders}
          />
        ) : (
          <>
            <BalancePanel labels={labels} locale={locale} totalBalance={totalBalance} />

            {activeTab === "ledger" ? (
              <>
                <DateFilters
                  labels={labels}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onDateFrom={setDateFrom}
                  onDateTo={setDateTo}
                />
                <LedgerTable
                  labels={labels}
                  locale={locale}
                  rows={filteredRows}
                />
              </>
            ) : (
              <>
                <section className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <label className="text-sm text-[var(--ink-soft)]">
                    {labels.month}
                    <div className="mt-1 w-48">
                      <SearchableSelect
                        value={month}
                        onChange={setSelectedMonth}
                        options={(months.length ? months : [month]).map((value) => ({
                          value,
                          label: monthLabel(value, locale),
                        }))}
                        placeholder={labels.month}
                        searchPlaceholder={labels.month}
                        className="h-10 text-sm"
                      />
                    </div>
                  </label>
                  <button type="button" className="btn-secondary" onClick={() => window.print()}>
                    {labels.print}
                  </button>
                </section>
                <MonthlyStatement
                  labels={labels}
                  locale={locale}
                  month={month}
                  rows={monthlyItems}
                  incomeTotal={incomeTotal}
                  deductionTotal={deductionTotal}
                  netTotal={netTotal}
                />
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function BalancePanel({
  labels,
  locale,
  totalBalance,
}: {
  labels: ReturnType<typeof copy>;
  locale: Locale;
  totalBalance: number;
}) {
  return (
    <section
      className={cn(
        "card border-yellow-200 bg-yellow-50 p-5",
        Math.abs(totalBalance) < 0.005 ? "border-[var(--line)] bg-white" : "",
      )}
    >
      <div className="text-sm text-[var(--ink-soft)]">{labels.currentBalance}</div>
      <div className="mt-1 text-4xl font-semibold tabular-nums">
        {formatCurrency(Math.abs(totalBalance), locale)}
      </div>
      <div className="mt-2 text-sm text-[var(--ink-mid)]">
        {totalBalance > 0 ? labels.tatoOwesOwner : totalBalance < 0 ? labels.ownerOwesTato : labels.settled}
      </div>
    </section>
  );
}

function DateFilters({
  labels,
  dateFrom,
  dateTo,
  onDateFrom,
  onDateTo,
}: {
  labels: ReturnType<typeof copy>;
  dateFrom: string;
  dateTo: string;
  onDateFrom: (value: string) => void;
  onDateTo: (value: string) => void;
}) {
  const active = Boolean(dateFrom || dateTo);
  return (
    <section className="card flex flex-wrap items-center gap-2 p-3">
      <label className="inline-flex items-center gap-2 text-sm text-[var(--ink-soft)]">
        {labels.dateFrom}
        <input
          type="date"
          className="input h-10 w-40 text-sm"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={(event) => onDateFrom(event.target.value)}
        />
      </label>
      <label className="inline-flex items-center gap-2 text-sm text-[var(--ink-soft)]">
        {labels.dateTo}
        <input
          type="date"
          className="input h-10 w-40 text-sm"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={(event) => onDateTo(event.target.value)}
        />
      </label>
      {active ? (
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={() => {
            onDateFrom("");
            onDateTo("");
          }}
        >
          {labels.clear}
        </button>
      ) : null}
    </section>
  );
}

function LedgerTable({
  labels,
  locale,
  rows,
}: {
  labels: ReturnType<typeof copy>;
  locale: Locale;
  rows: Array<PublicLedgerItem & { runningBalance: number }>;
}) {
  if (rows.length === 0) {
    return <div className="card p-10 text-center text-[var(--ink-soft)]">{labels.noLedger}</div>;
  }

  return (
    <section className="card overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-[var(--surface-muted)]">
          <tr className="text-left">
            <th className="px-4 py-3 font-medium">{labels.date}</th>
            <th className="px-4 py-3 font-medium">{labels.description}</th>
            <th className="px-4 py-3 text-right font-medium">{labels.income}</th>
            <th className="px-4 py-3 text-right font-medium">{labels.debit}</th>
            <th className="px-4 py-3 text-right font-medium">{labels.balance}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {rows.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-3 text-[var(--ink-mid)]">
                {formatDate(item.occurredAt, locale)}
              </td>
              <td className="px-4 py-3">
                <LedgerDescription labels={labels} locale={locale} item={item} />
              </td>
              <td className={cn("whitespace-nowrap px-4 py-3 text-right font-medium", amountClass(item.amount))}>
                {item.amount > 0 ? signedCurrency(item.amount, locale) : null}
              </td>
              <td className={cn("whitespace-nowrap px-4 py-3 text-right font-medium", amountClass(item.amount))}>
                {item.amount < 0 ? signedCurrency(item.amount, locale) : null}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--ink-mid)]">
                {formatCurrency(item.runningBalance, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MonthlyStatement({
  labels,
  locale,
  month,
  rows,
  incomeTotal,
  deductionTotal,
  netTotal,
}: {
  labels: ReturnType<typeof copy>;
  locale: Locale;
  month: string;
  rows: PublicLedgerItem[];
  incomeTotal: number;
  deductionTotal: number;
  netTotal: number;
}) {
  if (rows.length === 0) {
    return <div className="card p-10 text-center text-[var(--ink-soft)]">{labels.noStatement}</div>;
  }

  const incomeRows = rows.filter((item) => item.amount > 0);
  const deductionRows = rows.filter((item) => item.amount < 0);

  return (
    <section className="card p-4">
      <div className="mb-4 flex flex-col gap-2 border-b border-[var(--line)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-sm text-[var(--ink-soft)]">{labels.tabs.statements}</div>
          <h2 className="text-2xl font-semibold">{monthLabel(month, locale)}</h2>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right text-sm">
          <SummaryValue label={labels.grossIncome} value={incomeTotal} locale={locale} />
          <SummaryValue label={labels.deductions} value={deductionTotal} locale={locale} />
          <SummaryValue label={labels.net} value={netTotal} locale={locale} strong />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <StatementColumn title={labels.grossIncome} locale={locale} labels={labels} rows={incomeRows} />
        <StatementColumn title={labels.deductions} locale={locale} labels={labels} rows={deductionRows} />
      </div>
    </section>
  );
}

function SummaryValue({
  label,
  value,
  locale,
  strong = false,
}: {
  label: string;
  value: number;
  locale: Locale;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-[var(--ink-soft)]">{label}</div>
      <div className={cn("tabular-nums", amountClass(value), strong ? "text-lg font-semibold" : "font-medium")}>
        {formatCurrency(value, locale)}
      </div>
    </div>
  );
}

function StatementColumn({
  title,
  rows,
  labels,
  locale,
}: {
  title: string;
  rows: PublicLedgerItem[];
  labels: ReturnType<typeof copy>;
  locale: Locale;
}) {
  return (
    <div className="border border-[var(--line)]">
      <div className="border-b border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-sm font-semibold">{title}</div>
      {rows.length === 0 ? (
        <div className="px-3 py-6 text-sm text-[var(--ink-soft)]">{labels.noStatement}</div>
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {rows.map((item) => (
            <div key={item.id} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-3 text-sm">
              <LedgerDescription labels={labels} locale={locale} item={item} compact />
              <div className={cn("whitespace-nowrap text-right font-medium tabular-nums", amountClass(item.amount))}>
                {formatCurrency(item.amount, locale)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerDescription({
  labels,
  locale,
  item,
  compact = false,
}: {
  labels: ReturnType<typeof copy>;
  locale: Locale;
  item: PublicLedgerItem;
  compact?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--ink-mid)]">
          {labels.kindLabels[item.kind]}
        </span>
        {item.vehicle ? (
          <span className="inline-flex items-center gap-1 text-[var(--ink-soft)]">
            <span className="h-2 w-2 rounded-full bg-blue-600" />
            {item.vehicle.plateNumber}
          </span>
        ) : null}
        {item.order ? (
          <span className="text-[var(--ink-soft)]">
            {item.order.renterName} · {formatDate(item.order.pickupDatetime, locale)} →{" "}
            {formatDate(item.order.returnDatetime, locale)}
          </span>
        ) : null}
      </div>
      {item.note ? (
        <div className={cn("whitespace-pre-wrap text-[var(--ink-mid)]", compact ? "mt-1 text-sm" : "mt-2")}>
          {item.note}
        </div>
      ) : null}
      <ReceiptPreviewList receipts={item.receipts} label={labels.receipts} compact={compact} />
    </div>
  );
}

function ReceiptPreviewList({
  receipts,
  label,
  compact = false,
}: {
  receipts: PublicLedgerReceipt[];
  label: string;
  compact?: boolean;
}) {
  const [preview, setPreview] = useState<PublicLedgerReceipt | null>(null);
  if (receipts.length === 0) return null;

  return (
    <>
      <div className={cn("flex flex-wrap gap-2", compact ? "mt-2" : "mt-3")}>
        {receipts.map((receipt) =>
          isImageReceipt(receipt) ? (
            <button
              key={receipt.id}
              type="button"
              className="h-14 w-14 overflow-hidden border border-[var(--line)] bg-[var(--surface-muted)] hover:opacity-90"
              onClick={() => setPreview(receipt)}
              title={receipt.filename || label}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={receipt.url} alt={receipt.filename || label} className="h-full w-full object-cover" />
            </button>
          ) : (
            <a
              key={receipt.id}
              href={receipt.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              {receipt.filename || label}
            </a>
          ),
        )}
      </div>
      {preview ? (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setPreview(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center text-3xl leading-none text-white hover:bg-white/10"
            onClick={(event) => {
              event.stopPropagation();
              setPreview(null);
            }}
            aria-label="Close"
          >
            x
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.url}
            alt={preview.filename || label}
            className="max-h-full max-w-full object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}

export function resolveShareTab(value?: string | null): ShareTab {
  return isValidTab(value) ? value : "ledger";
}
