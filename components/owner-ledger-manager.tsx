"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { SearchableSelect } from "@/components/searchable-select";
import type { Locale } from "@/lib/i18n";
import { cn, formatCurrency, formatCurrencyInputText, formatDate } from "@/lib/utils";

const OwnerLedgerKind = {
  OWNER_NET_EARNING: "OWNER_NET_EARNING",
  MANAGER_COMMISSION: "MANAGER_COMMISSION",
  CLEANING_FEE: "CLEANING_FEE",
  EXPENSE_REIMBURSEMENT: "EXPENSE_REIMBURSEMENT",
  MANUAL_ADJUSTMENT: "MANUAL_ADJUSTMENT",
  SETTLEMENT_PAYMENT: "SETTLEMENT_PAYMENT",
  DIRECT_TO_OWNER: "DIRECT_TO_OWNER",
} as const;

type OwnerLedgerKind = (typeof OwnerLedgerKind)[keyof typeof OwnerLedgerKind];

type OwnerOption = {
  id: string;
  name: string;
};

type VehicleOption = {
  id: string;
  label: string;
};

type LedgerReceipt = {
  id: string;
  url: string;
  filename: string | null;
  contentType: string | null;
  size: number | null;
  uploadedAt: string;
};

type LedgerItem = {
  id: string;
  ownerId: string;
  vehicleId: string | null;
  orderId: string | null;
  kind: OwnerLedgerKind;
  amount: number;
  occurredAt: string;
  note: string | null;
  isAuto: boolean;
  createdAt: string;
  receipts?: LedgerReceipt[];
  vehicle: {
    id: string;
    plateNumber: string;
    nickname: string;
    brand: string;
    model: string;
    year: number;
  } | null;
  order: {
    id: string;
    renterName: string;
    pickupDatetime: string;
    returnDatetime: string;
  } | null;
};

type ModalState =
  | null
  | { mode: "create"; kind: OwnerLedgerKind }
  | { mode: "edit"; item: LedgerItem };

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        title: "流水账",
        backPrefix: "返回",
        viewAsOwner: "以车主视角查看",
        currentBalance: "当前余额",
        tatoOwesOwner: "TATO 应付给车主",
        ownerOwesTato: "车主应付给 TATO",
        zeroBalance: "账目已结清",
        periodSubtotal: "筛选区间小计",
        addExpense: "添加报销",
        addPayment: "记录收款",
        addAdjustment: "手动调整",
        resync: "重新同步自动行",
        resyncing: "同步中...",
        confirmResync: "重新同步会按订单重建自动账目，手动账目和凭证会保留。继续吗？",
        dateFrom: "起始",
        dateTo: "截止",
        clearDateRange: "清除筛选",
        empty: "暂无账目。请先给车辆绑定车主并重新同步，或手动添加一条账目。",
        date: "日期",
        type: "类型",
        detail: "说明",
        credit: "收入（车主得款）",
        balance: "余额",
        breakdownToggle: "计算明细(内部)",
        breakdownGross: "Turo 打款",
        breakdownNet: "车主净收益",
        debit: "支出（车主抵扣）",
        auto: "auto",
        edit: "修改",
        delete: "删除",
        confirmDelete: "确定删除这条账目吗？",
        save: "保存",
        saving: "保存中...",
        cancel: "取消",
        amount: "金额",
        signedAmount: "带正负号金额",
        vehicle: "车辆",
        noVehicle: "不指定车辆",
        note: "备注",
        direction: "付款方向",
        managerToOwner: "TATO → 车主",
        ownerToManager: "车主 → TATO",
        createTitle: "新增账目",
        editTitle: "修改账目",
        autoEditHint: "自动生成的账目被修改后，会变成手动账目，后续订单同步不会覆盖这条修改。",
        receipts: "凭证",
        uploadReceipts: "上传凭证",
        dragHint: "选择图片或 PDF",
        fileCount: (count: number) => `${count} 个文件待上传`,
        uploadFailed: "账目已保存，但凭证上传失败，请重新打开账目补传。",
        remove: "移除",
        kindLabels: {
          OWNER_NET_EARNING: "车主净收益",
          MANAGER_COMMISSION: "TATO 佣金",
          DIRECT_TO_OWNER: "租金已由车主直接收取",
          CLEANING_FEE: "洗车费",
          EXPENSE_REIMBURSEMENT: "报销",
          MANUAL_ADJUSTMENT: "手动调整",
          SETTLEMENT_PAYMENT: "Payment",
        },
      }
    : {
        title: "Ledger",
        backPrefix: "Back",
        viewAsOwner: "View as owner",
        currentBalance: "Current balance",
        tatoOwesOwner: "TATO owes owner",
        ownerOwesTato: "Owner owes TATO",
        zeroBalance: "Settled",
        periodSubtotal: "Period subtotal",
        addExpense: "Add reimbursement",
        addPayment: "Record payment",
        addAdjustment: "Manual adjustment",
        resync: "Resync auto rows",
        resyncing: "Syncing...",
        confirmResync: "Resyncing rebuilds automatic rows from orders. Manual rows and receipts are preserved. Continue?",
        dateFrom: "From",
        dateTo: "To",
        clearDateRange: "Clear",
        empty: "No ledger items yet. Assign vehicles to this owner and resync, or add a manual item.",
        date: "Date",
        type: "Type",
        detail: "Description",
        credit: "Income",
        balance: "Balance",
        breakdownToggle: "How this was calculated (internal)",
        breakdownGross: "Turo payout",
        breakdownNet: "Owner net earning",
        debit: "Deductions",
        auto: "auto",
        edit: "Edit",
        delete: "Delete",
        confirmDelete: "Delete this ledger item?",
        save: "Save",
        saving: "Saving...",
        cancel: "Cancel",
        amount: "Amount",
        signedAmount: "Signed amount",
        vehicle: "Vehicle",
        noVehicle: "No vehicle",
        note: "Note",
        direction: "Payment direction",
        managerToOwner: "TATO → owner",
        ownerToManager: "Owner → TATO",
        createTitle: "Add ledger item",
        editTitle: "Edit ledger item",
        autoEditHint: "Editing an auto row turns it into a manual row so future order syncs will not overwrite it.",
        receipts: "Receipts",
        uploadReceipts: "Upload receipts",
        dragHint: "Choose images or PDFs",
        fileCount: (count: number) => `${count} file(s) ready`,
        uploadFailed: "The ledger item was saved, but receipt upload failed. Reopen it to retry.",
        remove: "Remove",
        kindLabels: {
          OWNER_NET_EARNING: "Owner net earning",
          MANAGER_COMMISSION: "TATO commission",
          DIRECT_TO_OWNER: "Collected directly by owner",
          CLEANING_FEE: "Cleaning fee",
          EXPENSE_REIMBURSEMENT: "Reimbursement",
          MANUAL_ADJUSTMENT: "Adjustment",
          SETTLEMENT_PAYMENT: "Payment",
        },
      };
}

function toDateInput(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10);
}

function isImageReceipt(receipt: Pick<LedgerReceipt, "contentType" | "filename" | "url">) {
  if (receipt.contentType?.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(receipt.filename || receipt.url);
}

function sortLedgerItems(items: LedgerItem[]) {
  return [...items].sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime() ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/** How a net-earning line was arrived at, keyed by ledger item id. */
export type NetEarningBreakdown = Record<
  string,
  { gross: number; withheld: Array<{ column: string; amount: number }>; net: number }
>;

export function OwnerLedgerManager({
  locale,
  owners,
  selectedOwner,
  vehicles,
  items,
  netEarningBreakdown = {},
  shareToken,
  ownerSelectRoute = "query",
}: {
  locale: Locale;
  owners: OwnerOption[];
  selectedOwner: OwnerOption;
  vehicles: VehicleOption[];
  items: LedgerItem[];
  /** How each net-earning line was arrived at. Admin view only. */
  netEarningBreakdown?: NetEarningBreakdown;
  shareToken?: string | null;
  ownerSelectRoute?: "query" | "ledger";
}) {
  const labels = copy(locale);
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isPending, startTransition] = useTransition();
  const ownerOptions = owners.map((owner) => ({ value: owner.id, label: owner.name }));
  const sortedItems = useMemo(() => sortLedgerItems(items), [items]);
  const totalBalance = useMemo(() => items.reduce((sum, item) => sum + item.amount, 0), [items]);
  const filteredItems = useMemo(() => {
    if (!dateFrom && !dateTo) return sortedItems;
    return sortedItems.filter((item) => {
      const value = item.occurredAt.slice(0, 10);
      if (dateFrom && value < dateFrom) return false;
      if (dateTo && value > dateTo) return false;
      return true;
    });
  }, [dateFrom, dateTo, sortedItems]);
  const filterActive = Boolean(dateFrom || dateTo);
  const periodSubtotal = filteredItems.reduce((sum, item) => sum + item.amount, 0);

  async function deleteItem(item: LedgerItem) {
    if (!confirm(labels.confirmDelete)) return;
    const response = await fetch(`/api/owners/${selectedOwner.id}/ledger/${item.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      startTransition(() => router.refresh());
    }
  }

  async function resync() {
    if (!confirm(labels.confirmResync)) return;
    const response = await fetch(`/api/owners/${selectedOwner.id}/ledger/resync`, {
      method: "POST",
    });
    if (response.ok) {
      startTransition(() => router.refresh());
    }
  }

  return (
    <div className="max-w-5xl p-3 sm:p-6">
      <div className="mb-4">
        <Link href={`/owners/${selectedOwner.id}`} className="text-sm text-[var(--ink-soft)] hover:text-[var(--ink)]">
          &lt; {selectedOwner.name}
        </Link>
        <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between sm:gap-2">
          <h1 className="text-2xl font-semibold">{labels.title}</h1>
          {shareToken ? (
            <a
              href={`/share/${shareToken}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              {labels.viewAsOwner} ↗
            </a>
          ) : null}
        </div>
      </div>

      <section
        className={cn(
          "card mb-4 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between",
          totalBalance > 0
            ? "border-emerald-200 bg-emerald-50"
            : totalBalance < 0
              ? "border-amber-200 bg-amber-50"
              : "",
        )}
      >
        <div>
          <div className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">{labels.currentBalance}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {formatCurrency(Math.abs(totalBalance), locale)}
          </div>
          <div className="mt-1 text-sm text-[var(--ink-mid)]">
            {totalBalance > 0
              ? labels.tatoOwesOwner
              : totalBalance < 0
                ? labels.ownerOwesTato
                : labels.zeroBalance}
          </div>
          {filterActive ? (
            <div className="mt-3 border-t border-[var(--line)]/70 pt-3">
              <div className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">{labels.periodSubtotal}</div>
              <div className="text-lg font-semibold tabular-nums">
                {periodSubtotal >= 0 ? "+" : "-"}
                {formatCurrency(Math.abs(periodSubtotal), locale)}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid w-full grid-cols-2 gap-1.5 sm:w-auto sm:flex sm:flex-wrap sm:justify-end sm:gap-2">
          <button
            className="btn-secondary"
            onClick={() => setModal({ mode: "create", kind: OwnerLedgerKind.EXPENSE_REIMBURSEMENT })}
          >
            + {labels.addExpense}
          </button>
          <button
            className="btn-secondary"
            onClick={() => setModal({ mode: "create", kind: OwnerLedgerKind.SETTLEMENT_PAYMENT })}
          >
            + {labels.addPayment}
          </button>
          <button
            className="btn-secondary"
            onClick={() => setModal({ mode: "create", kind: OwnerLedgerKind.MANUAL_ADJUSTMENT })}
          >
            + {labels.addAdjustment}
          </button>
          <button className="btn-secondary" onClick={resync} disabled={isPending}>
            ↻ {isPending ? labels.resyncing : labels.resync}
          </button>
        </div>
      </section>

      <section className="card mb-4 grid grid-cols-2 gap-2 p-2 sm:flex sm:flex-wrap sm:items-center">
        <label className="inline-flex flex-col gap-1 text-xs text-[var(--ink-soft)] sm:flex-row sm:items-center sm:gap-2">
          {labels.dateFrom}
          <input
            type="date"
            className="input text-sm"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>
        <label className="inline-flex flex-col gap-1 text-xs text-[var(--ink-soft)] sm:flex-row sm:items-center sm:gap-2">
          {labels.dateTo}
          <input
            type="date"
            className="input text-sm"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
        {filterActive ? (
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
          >
            {labels.clearDateRange}
          </button>
        ) : null}
        <div className="min-w-[12rem] sm:ml-auto">
          <SearchableSelect
            value={selectedOwner.id}
            onChange={(value) =>
              router.push(ownerSelectRoute === "ledger" ? `/owners/${value}/ledger` : `/owners?ownerId=${value}`)
            }
            options={ownerOptions}
            placeholder={locale !== "en" ? "车主" : "Owner"}
            searchPlaceholder={locale !== "en" ? "搜索车主" : "Search owner"}
            className="h-10"
          />
        </div>
      </section>

      <LedgerRows
        breakdown={netEarningBreakdown}
        labels={labels}
        locale={locale}
        rows={filteredItems}
        onEdit={(item) => setModal({ mode: "edit", item })}
        onDelete={deleteItem}
      />

      {modal ? (
        <LedgerModal
          labels={labels}
          locale={locale}
          ownerId={selectedOwner.id}
          vehicles={vehicles}
          modal={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            startTransition(() => router.refresh());
          }}
        />
      ) : null}
    </div>
  );
}

function LedgerRows({
  labels,
  locale,
  rows,
  breakdown,
  onEdit,
  onDelete,
}: {
  labels: ReturnType<typeof copy>;
  locale: Locale;
  rows: LedgerItem[];
  breakdown: NetEarningBreakdown;
  onEdit: (item: LedgerItem) => void;
  onDelete: (item: LedgerItem) => void;
}) {
  if (rows.length === 0) {
    return <div className="card p-10 text-center text-[var(--ink-soft)]">{labels.empty}</div>;
  }

  return (
    <>
      <div className="space-y-2 md:hidden">
        {rows.map((item) => (
          <article key={item.id} className="card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs tabular-nums text-[var(--ink-soft)]">
                  {formatDate(item.occurredAt, locale)}
                </div>
                <KindBadge labels={labels} item={item} />
              </div>
              <SignedAmount amount={item.amount} locale={locale} />
            </div>
            <ItemDetail labels={labels} locale={locale} item={item} />
            <div className="mt-3 flex justify-end gap-3 border-t border-[var(--line)] pt-3 text-sm">
              <button className="text-[var(--ink-mid)] hover:text-[var(--ink)]" onClick={() => onEdit(item)}>
                {labels.edit}
              </button>
              <button className="text-red-600 hover:text-red-800" onClick={() => onDelete(item)}>
                {labels.delete}
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-[var(--surface-muted)]">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">{labels.date}</th>
              <th className="px-3 py-2 font-medium">{labels.type}</th>
              <th className="px-3 py-2 font-medium">{labels.detail}</th>
              <th className="px-3 py-2 text-right font-medium">{labels.credit}</th>
              <th className="px-3 py-2 text-right font-medium">{labels.debit}</th>
              <th className="px-3 py-2 text-right font-medium">{labels.balance}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {/* Rows are newest-first, so the running balance is
                accumulated from the bottom up -- the number on a row is
                the balance as it stood after that entry, which is what
                a statement is read against. */}
            {rows.map((item, index) => (
              <tr key={item.id} className="group align-top hover:bg-[var(--surface-muted)]">
                <td className="whitespace-nowrap px-3 py-3 text-[var(--ink-mid)]">
                  {formatDate(item.occurredAt, locale)}
                </td>
                <td className="px-3 py-3">
                  <KindBadge labels={labels} item={item} />
                </td>
                <td className="px-3 py-3">
                  <ItemDetail labels={labels} locale={locale} item={item} compact />
                  {/* Internal only. The owner's copy of this statement
                      is rendered by a different component that is never
                      given this data, so "hidden from the owner" is a
                      fact about the payload rather than about CSS. */}
                  {breakdown[item.id] ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer list-none text-[11px] font-semibold text-[var(--ink-soft)] underline underline-offset-2">
                        {labels.breakdownToggle}
                      </summary>
                      <table className="mt-1.5 w-full max-w-sm text-[11px]">
                        <tbody>
                          <tr>
                            <td className="py-0.5 text-[var(--ink-soft)]">{labels.breakdownGross}</td>
                            <td className="py-0.5 text-right tabular-nums">
                              {formatCurrency(breakdown[item.id].gross, locale)}
                            </td>
                          </tr>
                          {breakdown[item.id].withheld.map((line) => (
                            <tr key={line.column}>
                              <td className="py-0.5 pl-2 text-[var(--ink-soft)]">− {line.column}</td>
                              <td className="py-0.5 text-right tabular-nums text-amber-700">
                                −{formatCurrency(line.amount, locale)}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t border-[var(--line)]">
                            <td className="py-0.5 font-semibold">{labels.breakdownNet}</td>
                            <td className="py-0.5 text-right font-semibold tabular-nums">
                              {formatCurrency(breakdown[item.id].net, locale)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </details>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  {item.amount > 0 ? <SignedAmount amount={item.amount} locale={locale} /> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  {item.amount < 0 ? <SignedAmount amount={item.amount} locale={locale} /> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums text-[var(--ink-mid)]">
                  {formatCurrency(
                    rows.slice(index).reduce((sum, row) => sum + row.amount, 0),
                    locale,
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100">
                    <button className="text-xs font-semibold text-[var(--ink-mid)]" onClick={() => onEdit(item)}>
                      {labels.edit}
                    </button>
                    <button className="text-xs font-semibold text-red-600" onClick={() => onDelete(item)}>
                      {labels.delete}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function KindBadge({ labels, item }: { labels: ReturnType<typeof copy>; item: LedgerItem }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="rounded bg-[var(--surface-muted)] px-2 py-0.5 text-xs">{labels.kindLabels[item.kind]}</span>
      {item.isAuto ? <span className="text-[10px] text-[var(--ink-soft)]">{labels.auto}</span> : null}
    </div>
  );
}

function SignedAmount({ amount, locale }: { amount: number; locale: Locale }) {
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        amount >= 0 ? "text-emerald-700" : "text-amber-700",
      )}
    >
      {formatCurrency(amount, locale)}
    </span>
  );
}

function ItemDetail({
  labels,
  locale,
  item,
  compact = false,
}: {
  labels: ReturnType<typeof copy>;
  locale: Locale;
  item: LedgerItem;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "" : "mt-3"}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-soft)]">
        {item.vehicle ? (
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-blue-600" />
            {item.vehicle.plateNumber} · {item.vehicle.nickname}
          </span>
        ) : null}
        {item.order ? (
          <span>
            {item.order.renterName} · {formatDate(item.order.pickupDatetime, locale)} →{" "}
            {formatDate(item.order.returnDatetime, locale)}
          </span>
        ) : null}
      </div>
      {item.note ? (
        <div className="mt-1 whitespace-pre-wrap text-[var(--ink-mid)]">{item.note}</div>
      ) : null}
      <ReceiptPreviewList receipts={item.receipts ?? []} label={labels.receipts} />
    </div>
  );
}

function ReceiptPreviewList({
  receipts,
  label,
  onRemove,
}: {
  receipts: LedgerReceipt[];
  label: string;
  onRemove?: (id: string) => void;
}) {
  const [preview, setPreview] = useState<LedgerReceipt | null>(null);
  if (receipts.length === 0) return null;

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {receipts.map((receipt) =>
          isImageReceipt(receipt) ? (
            <div key={receipt.id} className="group relative">
              <button
                type="button"
                className="h-14 w-14 overflow-hidden rounded border border-[var(--line)] bg-[var(--surface-muted)] hover:opacity-90"
                onClick={() => setPreview(receipt)}
                title={receipt.filename || label}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receipt.url} alt={receipt.filename || label} className="h-full w-full object-cover" />
              </button>
              {onRemove ? (
                <button
                  type="button"
                  className="absolute right-1 top-1 h-5 w-5 rounded-full bg-red-600 text-xs text-white opacity-0 group-hover:opacity-100"
                  onClick={() => onRemove(receipt.id)}
                >
                  x
                </button>
              ) : null}
            </div>
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
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded text-3xl leading-none text-white hover:bg-white/10"
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

function LedgerModal({
  labels,
  locale,
  ownerId,
  vehicles,
  modal,
  onClose,
  onSaved,
}: {
  labels: ReturnType<typeof copy>;
  locale: Locale;
  ownerId: string;
  vehicles: VehicleOption[];
  modal: NonNullable<ModalState>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = modal.mode === "edit";
  const initialItem = modal.mode === "edit" ? modal.item : null;
  const fixedKind = modal.mode === "edit" ? modal.item.kind : modal.kind;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [kind, setKind] = useState<OwnerLedgerKind>(fixedKind);
  const [amount, setAmount] = useState(
    initialItem
      ? fixedKind === OwnerLedgerKind.MANUAL_ADJUSTMENT
        ? String(initialItem.amount)
        : String(Math.abs(initialItem.amount))
      : "",
  );
  const [direction, setDirection] = useState<"managerToOwner" | "ownerToManager">(
    initialItem && initialItem.amount > 0 ? "ownerToManager" : "managerToOwner",
  );
  const [occurredAt, setOccurredAt] = useState(
    initialItem ? toDateInput(initialItem.occurredAt) : toDateInput(new Date()),
  );
  const [vehicleId, setVehicleId] = useState(initialItem?.vehicleId ?? "");
  const [note, setNote] = useState(initialItem?.note ?? "");
  const existingReceipts = initialItem?.receipts ?? [];
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kindOptions = [
    { value: OwnerLedgerKind.EXPENSE_REIMBURSEMENT, label: labels.kindLabels.EXPENSE_REIMBURSEMENT },
    { value: OwnerLedgerKind.SETTLEMENT_PAYMENT, label: labels.kindLabels.SETTLEMENT_PAYMENT },
    { value: OwnerLedgerKind.MANUAL_ADJUSTMENT, label: labels.kindLabels.MANUAL_ADJUSTMENT },
  ];
  const vehicleOptions = [
    { value: "", label: labels.noVehicle },
    ...vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicle.label })),
  ];

  function appendFiles(files: FileList | null) {
    if (!files?.length) return;
    setReceiptFiles((current) => [...current, ...Array.from(files)]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function save() {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed)) {
      setError("Invalid amount");
      return;
    }

    let signedAmount = parsed;
    if (kind === OwnerLedgerKind.EXPENSE_REIMBURSEMENT) {
      signedAmount = -Math.abs(parsed);
    } else if (kind === OwnerLedgerKind.SETTLEMENT_PAYMENT) {
      signedAmount = direction === "managerToOwner" ? -Math.abs(parsed) : Math.abs(parsed);
    } else if (kind !== OwnerLedgerKind.MANUAL_ADJUSTMENT && initialItem) {
      signedAmount = initialItem.amount < 0 ? -Math.abs(parsed) : Math.abs(parsed);
    }

    setSaving(true);
    setError(null);
    const response = await fetch(
      isEdit ? `/api/owners/${ownerId}/ledger/${initialItem!.id}` : `/api/owners/${ownerId}/ledger`,
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          amount: signedAmount,
          occurredAt: new Date(`${occurredAt}T00:00:00`).toISOString(),
          vehicleId: vehicleId || null,
          note,
        }),
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setSaving(false);
      setError(payload.error || "Save failed");
      return;
    }

    const payload = await response.json().catch(() => ({}));
    const savedItemId = isEdit ? initialItem!.id : payload.item?.id;
    if (savedItemId && receiptFiles.length > 0) {
      const formData = new FormData();
      receiptFiles.forEach((file) => formData.append("files", file));
      const receiptResponse = await fetch(`/api/owners/${ownerId}/ledger/${savedItemId}/receipts`, {
        method: "POST",
        body: formData,
      });
      if (!receiptResponse.ok) {
        setSaving(false);
        setError(labels.uploadFailed);
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">{isEdit ? labels.editTitle : labels.createTitle}</h3>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-2xl leading-none text-[var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-mid)]"
            onClick={onClose}
            aria-label={labels.cancel}
          >
            x
          </button>
        </div>

        {initialItem?.isAuto ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{labels.autoEditHint}</p> : null}
        {error ? <p className="mb-3 text-sm text-rose-600">{error}</p> : null}

        <div className="space-y-3">
          {!isEdit ? (
            <div>
              <label className="label">{labels.type}</label>
              <SearchableSelect value={kind} onChange={(value) => setKind(value as OwnerLedgerKind)} options={kindOptions} />
            </div>
          ) : null}

          {kind === OwnerLedgerKind.SETTLEMENT_PAYMENT ? (
            <div>
              <label className="label">{labels.direction}</label>
              <SearchableSelect
                value={direction}
                onChange={(value) => setDirection(value as "managerToOwner" | "ownerToManager")}
                options={[
                  { value: "managerToOwner", label: labels.managerToOwner },
                  { value: "ownerToManager", label: labels.ownerToManager },
                ]}
              />
            </div>
          ) : null}

          <div>
            <label className="label">{kind === OwnerLedgerKind.MANUAL_ADJUSTMENT ? labels.signedAmount : labels.amount}</label>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              onBlur={(event) => setAmount(formatCurrencyInputText(event.target.value))}
              type="number"
              step="0.01"
              className="input"
            />
          </div>

          <div>
            <label className="label">{labels.date}</label>
            <input value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} type="date" className="input" />
          </div>

          <div>
            <label className="label">{labels.vehicle}</label>
            <SearchableSelect value={vehicleId} onChange={setVehicleId} options={vehicleOptions} placeholder={labels.noVehicle} />
          </div>

          <div>
            <label className="label">{labels.note}</label>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} className="input" />
          </div>

          <div>
            <label className="label">{labels.receipts}</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(event) => appendFiles(event.target.files)}
            />
            <div className="rounded-lg border-2 border-dashed border-[var(--line-strong)] px-3 py-3">
              <button type="button" className="btn-secondary text-sm" disabled={saving} onClick={() => fileInputRef.current?.click()}>
                {labels.uploadReceipts}
              </button>
              <span className="ml-2 text-xs text-[var(--ink-soft)]">{labels.dragHint}</span>
            </div>
            <ReceiptPreviewList receipts={existingReceipts} label={labels.receipts} />
            {receiptFiles.length > 0 ? (
              <div className="mt-2 space-y-1 text-xs text-[var(--ink-soft)]">
                <p>{labels.fileCount(receiptFiles.length)}</p>
                {receiptFiles.map((file, index) => (
                  <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between rounded bg-[var(--surface-muted)] px-2 py-1">
                    <span className="min-w-0 truncate">{file.name}</span>
                    <button
                      type="button"
                      className="text-red-600"
                      onClick={() => setReceiptFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      {labels.remove}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>{labels.cancel}</button>
          <button className="btn-primary" onClick={save} disabled={saving || !amount}>{saving ? labels.saving : labels.save}</button>
        </div>
      </div>
    </div>
  );
}
