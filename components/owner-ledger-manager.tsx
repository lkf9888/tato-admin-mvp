"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { Locale } from "@/lib/i18n";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

const OwnerLedgerKind = {
  OWNER_NET_EARNING: "OWNER_NET_EARNING",
  MANAGER_COMMISSION: "MANAGER_COMMISSION",
  EXPENSE_REIMBURSEMENT: "EXPENSE_REIMBURSEMENT",
  MANUAL_ADJUSTMENT: "MANUAL_ADJUSTMENT",
  SETTLEMENT_PAYMENT: "SETTLEMENT_PAYMENT",
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

const STATEMENT_KINDS = new Set<OwnerLedgerKind>([
  OwnerLedgerKind.OWNER_NET_EARNING,
  OwnerLedgerKind.MANAGER_COMMISSION,
  OwnerLedgerKind.EXPENSE_REIMBURSEMENT,
  OwnerLedgerKind.MANUAL_ADJUSTMENT,
]);

function copy(locale: Locale) {
  return locale === "zh"
    ? {
        currentBalance: "当前应结余额",
        tatoOwesOwner: "TATO 应付给车主",
        ownerOwesTato: "车主应付给 TATO",
        zeroBalance: "账目已结清",
        monthlyStatement: "Monthly statement",
        ledger: "流水账",
        chartTitle: "最近 12 个月净额",
        empty: "暂无账目。请先给车辆绑定车主并点击重新同步，或手动添加一条账目。",
        month: "月份",
        print: "打印 statement",
        addExpense: "添加费用",
        addPayment: "记录付款",
        addAdjustment: "手动调整",
        resync: "重新同步订单",
        resyncing: "同步中...",
        date: "日期",
        type: "类型",
        detail: "说明",
        credit: "收入 / 应收",
        debit: "扣减 / 已付",
        balance: "余额",
        auto: "自动",
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
        kindLabels: {
          OWNER_NET_EARNING: "车主净收益",
          MANAGER_COMMISSION: "TATO 管理佣金",
          EXPENSE_REIMBURSEMENT: "费用报销",
          MANUAL_ADJUSTMENT: "手动调整",
          SETTLEMENT_PAYMENT: "结算付款",
        },
      }
    : {
        currentBalance: "Current settlement balance",
        tatoOwesOwner: "TATO owes owner",
        ownerOwesTato: "Owner owes TATO",
        zeroBalance: "Settled",
        monthlyStatement: "Monthly statement",
        ledger: "Ledger",
        chartTitle: "Last 12 months net",
        empty: "No ledger items yet. Assign vehicles to this owner and resync, or add a manual item.",
        month: "Month",
        print: "Print statement",
        addExpense: "Add expense",
        addPayment: "Record payment",
        addAdjustment: "Manual adjustment",
        resync: "Resync orders",
        resyncing: "Syncing...",
        date: "Date",
        type: "Type",
        detail: "Detail",
        credit: "Credit",
        debit: "Debit",
        balance: "Balance",
        auto: "Auto",
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
        kindLabels: {
          OWNER_NET_EARNING: "Owner net earning",
          MANAGER_COMMISSION: "TATO commission",
          EXPENSE_REIMBURSEMENT: "Expense reimbursement",
          MANUAL_ADJUSTMENT: "Manual adjustment",
          SETTLEMENT_PAYMENT: "Settlement payment",
        },
      };
}

function monthKey(value: string | Date) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toDateInput(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10);
}

export function OwnerLedgerManager({
  locale,
  owners,
  selectedOwner,
  vehicles,
  items,
}: {
  locale: Locale;
  owners: OwnerOption[];
  selectedOwner: OwnerOption;
  vehicles: VehicleOption[];
  items: LedgerItem[];
}) {
  const labels = copy(locale);
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const newest = [...items]
      .filter((item) => STATEMENT_KINDS.has(item.kind))
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())[0];
    return newest ? monthKey(newest.occurredAt) : monthKey(new Date());
  });
  const [isPending, startTransition] = useTransition();

  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime() ||
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [items],
  );

  const runningRows = useMemo(() => {
    let running = 0;
    return [...items]
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
      .map((item) => {
        running += item.amount;
        return { item, running };
      })
      .reverse();
  }, [items]);

  const statementItems = useMemo(
    () => sortedItems.filter((item) => STATEMENT_KINDS.has(item.kind)),
    [sortedItems],
  );

  const months = useMemo(() => {
    const set = new Set(statementItems.map((item) => monthKey(item.occurredAt)));
    set.add(monthKey(new Date()));
    return Array.from(set).sort().reverse();
  }, [statementItems]);

  const selectedStatementItems = statementItems.filter((item) => monthKey(item.occurredAt) === selectedMonth);
  const statementIncome = selectedStatementItems.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0);
  const statementDeductions = selectedStatementItems.filter((item) => item.amount < 0).reduce((sum, item) => sum + item.amount, 0);
  const statementNet = statementIncome + statementDeductions;
  const totalBalance = items.reduce((sum, item) => sum + item.amount, 0);

  const chartMonths = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1);
      const key = monthKey(date);
      const total = statementItems
        .filter((item) => monthKey(item.occurredAt) === key)
        .reduce((sum, item) => sum + item.amount, 0);
      return { key, label: key.slice(5), total };
    });
  }, [statementItems]);
  const maxChartValue = Math.max(1, ...chartMonths.map((month) => Math.abs(month.total)));

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
    const response = await fetch(`/api/owners/${selectedOwner.id}/ledger/resync`, {
      method: "POST",
    });
    if (response.ok) {
      startTransition(() => router.refresh());
    }
  }

  return (
    <div className="space-y-3">
      <section className="grid gap-2.5 lg:grid-cols-[1.05fr_1.5fr]">
        <div className="rounded-lg border border-[var(--line)] bg-white/90 p-3 shadow-sm sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">
                {labels.currentBalance}
              </p>
              <p className="mt-1 font-serif text-[1.35rem] font-semibold text-[var(--ink)]">
                {formatCurrency(Math.abs(totalBalance), locale)}
              </p>
              <p className="mt-0.5 text-[12px] text-[var(--ink-soft)]">
                {totalBalance > 0
                  ? labels.tatoOwesOwner
                  : totalBalance < 0
                    ? labels.ownerOwesTato
                    : labels.zeroBalance}
              </p>
            </div>
            <form>
              <select
                name="ownerId"
                value={selectedOwner.id}
                onChange={(event) => router.push(`/owner-statements?ownerId=${event.target.value}`)}
                className="h-9 rounded-full border border-[var(--line)] bg-white px-3 text-[12px]"
              >
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </form>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              className="rounded-full border border-[var(--line)] bg-white px-3 py-2 text-[12px] font-semibold"
              onClick={() => setModal({ mode: "create", kind: OwnerLedgerKind.EXPENSE_REIMBURSEMENT })}
            >
              + {labels.addExpense}
            </button>
            <button
              className="rounded-full border border-[var(--line)] bg-white px-3 py-2 text-[12px] font-semibold"
              onClick={() => setModal({ mode: "create", kind: OwnerLedgerKind.SETTLEMENT_PAYMENT })}
            >
              + {labels.addPayment}
            </button>
            <button
              className="rounded-full border border-[var(--line)] bg-white px-3 py-2 text-[12px] font-semibold"
              onClick={() => setModal({ mode: "create", kind: OwnerLedgerKind.MANUAL_ADJUSTMENT })}
            >
              + {labels.addAdjustment}
            </button>
            <button
              className="rounded-full bg-[var(--accent)] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
              onClick={resync}
              disabled={isPending}
            >
              {isPending ? labels.resyncing : labels.resync}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-white/90 p-4 shadow-sm sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
              {labels.chartTitle}
            </p>
            <p className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--ink)]">
              {formatCurrency(statementNet, locale)} · {selectedMonth}
            </p>
          </div>
          <div className="mt-4 flex h-36 items-end gap-2">
            {chartMonths.map((month) => (
              <div key={month.key} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                <div className="flex h-28 w-full items-end rounded-full bg-slate-100 px-1">
                  <div
                    className={cn(
                      "w-full rounded-full transition-all",
                      month.total >= 0 ? "bg-[var(--accent)]" : "bg-rose-400",
                    )}
                    style={{ height: `${Math.max(6, (Math.abs(month.total) / maxChartValue) * 100)}%` }}
                    title={`${month.key}: ${formatCurrency(month.total, locale)}`}
                  />
                </div>
                <span className="text-[10px] text-[var(--ink-soft)]">{month.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-white/90 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
              {labels.monthlyStatement}
            </p>
            <h2 className="mt-1 font-serif text-2xl font-semibold text-[var(--ink)]">
              {selectedOwner.name} · {selectedMonth}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="h-10 rounded-full border border-[var(--line)] bg-white px-3 text-sm"
            >
              {months.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
            <button
              onClick={() => window.print()}
              className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold"
            >
              {labels.print}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label={labels.credit} value={formatCurrency(statementIncome, locale)} tone="positive" />
          <Metric label={labels.debit} value={formatCurrency(Math.abs(statementDeductions), locale)} tone="negative" />
          <Metric label="Net" value={formatCurrency(statementNet, locale)} tone={statementNet >= 0 ? "positive" : "negative"} />
        </div>

        <LedgerTable
          labels={labels}
          locale={locale}
          rows={selectedStatementItems.map((item) => ({ item, running: 0 }))}
          statementMode
          onEdit={(item) => setModal({ mode: "edit", item })}
          onDelete={deleteItem}
        />
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-white/90 p-4 shadow-sm sm:p-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
          {labels.ledger}
        </p>
        <LedgerTable
          labels={labels}
          locale={locale}
          rows={runningRows}
          onEdit={(item) => setModal({ mode: "edit", item })}
          onDelete={deleteItem}
        />
      </section>

      {modal ? (
        <LedgerModal
          labels={labels}
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

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "negative";
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-soft)]">{label}</p>
      <p className={cn("mt-0.5 text-base font-semibold", tone === "positive" ? "text-emerald-700" : "text-rose-700")}>
        {value}
      </p>
    </div>
  );
}

function LedgerTable({
  labels,
  locale,
  rows,
  statementMode = false,
  onEdit,
  onDelete,
}: {
  labels: ReturnType<typeof copy>;
  locale: Locale;
  rows: { item: LedgerItem; running: number }[];
  statementMode?: boolean;
  onEdit: (item: LedgerItem) => void;
  onDelete: (item: LedgerItem) => void;
}) {
  if (rows.length === 0) {
    return <div className="mt-3 rounded-lg bg-slate-50 px-4 py-5 text-center text-[12px] text-[var(--ink-soft)]">{labels.empty}</div>;
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--line)]">
      <table className="min-w-[760px] w-full text-[12px]">
        <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-[0.12em] text-[var(--ink-soft)]">
          <tr>
            <th className="px-3 py-2">{labels.date}</th>
            <th className="px-3 py-2">{labels.type}</th>
            <th className="px-3 py-2">{labels.detail}</th>
            <th className="px-3 py-2 text-right">{labels.credit}</th>
            <th className="px-3 py-2 text-right">{labels.debit}</th>
            {!statementMode ? <th className="px-3 py-2 text-right">{labels.balance}</th> : null}
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)] bg-white">
          {rows.map(({ item, running }) => (
            <tr key={item.id} className="align-top">
              <td className="whitespace-nowrap px-3 py-3 text-[var(--ink-soft)]">
                {formatDate(item.occurredAt, locale)}
              </td>
              <td className="px-3 py-3">
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-[var(--ink)]">
                  {labels.kindLabels[item.kind]}
                </span>
                {item.isAuto ? (
                  <span className="ml-1 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
                    {labels.auto}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-3">
                {item.vehicle ? (
                  <p className="font-semibold text-[var(--ink)]">
                    {item.vehicle.plateNumber} · {item.vehicle.nickname}
                  </p>
                ) : null}
                {item.order ? (
                  <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                    {item.order.renterName} · {formatDate(item.order.pickupDatetime, locale)}
                  </p>
                ) : null}
                {item.note ? (
                  <p className="mt-1 whitespace-pre-wrap text-[13px] text-[var(--ink-soft)]">{item.note}</p>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-emerald-700">
                {item.amount > 0 ? formatCurrency(item.amount, locale) : ""}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-rose-700">
                {item.amount < 0 ? formatCurrency(Math.abs(item.amount), locale) : ""}
              </td>
              {!statementMode ? (
                <td className="whitespace-nowrap px-3 py-3 text-right text-[var(--ink-soft)]">
                  {formatCurrency(running, locale)}
                </td>
              ) : null}
              <td className="whitespace-nowrap px-3 py-3 text-right">
                <button className="mr-3 text-xs font-semibold text-[var(--ink)]" onClick={() => onEdit(item)}>
                  {labels.edit}
                </button>
                <button className="text-xs font-semibold text-rose-600" onClick={() => onDelete(item)}>
                  {labels.delete}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LedgerModal({
  labels,
  ownerId,
  vehicles,
  modal,
  onClose,
  onSaved,
}: {
  labels: ReturnType<typeof copy>;
  ownerId: string;
  vehicles: VehicleOption[];
  modal: NonNullable<ModalState>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = modal.mode === "edit";
  const initialItem = modal.mode === "edit" ? modal.item : null;
  const fixedKind = modal.mode === "edit" ? modal.item.kind : modal.kind;
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      isEdit
        ? `/api/owners/${ownerId}/ledger/${initialItem!.id}`
        : `/api/owners/${ownerId}/ledger`,
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
    setSaving(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error || "Save failed");
      return;
    }

    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
              {isEdit ? labels.editTitle : labels.createTitle}
            </p>
            <h3 className="mt-1 font-serif text-2xl font-semibold text-[var(--ink)]">
              {labels.kindLabels[kind]}
            </h3>
          </div>
          <button className="rounded-full border border-[var(--line)] px-3 py-1 text-sm" onClick={onClose}>
            {labels.cancel}
          </button>
        </div>

        {initialItem?.isAuto ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {labels.autoEditHint}
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

        <div className="mt-4 grid gap-3">
          {!isEdit ? (
            <label className="grid gap-1 text-sm font-medium">
              {labels.type}
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as OwnerLedgerKind)}
                className="h-11 rounded-md border border-[var(--line)] bg-white px-3"
              >
                <option value={OwnerLedgerKind.EXPENSE_REIMBURSEMENT}>
                  {labels.kindLabels.EXPENSE_REIMBURSEMENT}
                </option>
                <option value={OwnerLedgerKind.SETTLEMENT_PAYMENT}>
                  {labels.kindLabels.SETTLEMENT_PAYMENT}
                </option>
                <option value={OwnerLedgerKind.MANUAL_ADJUSTMENT}>
                  {labels.kindLabels.MANUAL_ADJUSTMENT}
                </option>
              </select>
            </label>
          ) : null}

          {kind === OwnerLedgerKind.SETTLEMENT_PAYMENT ? (
            <label className="grid gap-1 text-sm font-medium">
              {labels.direction}
              <select
                value={direction}
                onChange={(event) => setDirection(event.target.value as "managerToOwner" | "ownerToManager")}
                className="h-11 rounded-md border border-[var(--line)] bg-white px-3"
              >
                <option value="managerToOwner">{labels.managerToOwner}</option>
                <option value="ownerToManager">{labels.ownerToManager}</option>
              </select>
            </label>
          ) : null}

          <label className="grid gap-1 text-sm font-medium">
            {kind === OwnerLedgerKind.MANUAL_ADJUSTMENT ? labels.signedAmount : labels.amount}
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              type="number"
              step="0.01"
              className="h-11 rounded-md border border-[var(--line)] bg-white px-3"
            />
          </label>

          <label className="grid gap-1 text-sm font-medium">
            {labels.date}
            <input
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
              type="date"
              className="h-11 rounded-md border border-[var(--line)] bg-white px-3"
            />
          </label>

          <label className="grid gap-1 text-sm font-medium">
            {labels.vehicle}
            <select
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
              className="h-11 rounded-md border border-[var(--line)] bg-white px-3"
            >
              <option value="">{labels.noVehicle}</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm font-medium">
            {labels.note}
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
            />
          </label>
        </div>

        <button
          className="mt-5 h-11 w-full rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-50"
          onClick={save}
          disabled={saving}
        >
          {saving ? labels.saving : labels.save}
        </button>
      </div>
    </div>
  );
}
