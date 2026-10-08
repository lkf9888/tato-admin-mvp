"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  type EditableOrder,
  OrderDetailModal,
  type OrderEditorVehicleOption,
} from "@/components/order-detail-modal";
import { BulkActionBar, BulkActionButton } from "@/components/bulk-action-bar";
import { StatusBadge } from "@/components/status-badge";
import type { Locale } from "@/lib/i18n";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";

function labels(locale: Locale) {
  return locale !== "en"
    ? {
        empty: "没有找到符合这个关键字的订单。",
        plate: "车牌",
        owner: "车主",
        pickup: "取车",
        return: "还车",
        price: "金额",
        phone: "电话",
        open: "打开订单详情",
        select: "选择这笔订单",
        selected: (count: number) => `已选 ${count} 笔`,
        markPaid: "标记已收款",
        markUnpaid: "标记未收款",
        clearSelection: "取消选择",
        selectAll: "全选本页",
        syncOwners: "同步给车主",
        syncResult: (synced: number, skipped: number) =>
          skipped > 0 ? `已同步 ${synced} 笔，${skipped} 笔没有绑定车主或同步失败` : `已同步 ${synced} 笔给车主`,
        deleteSelected: "删除",
        confirmDelete: (count: number) => `删除选中的 ${count} 笔订单？可以在回收站恢复。`,
        deleteResult: (deleted: number, skipped: number) =>
          skipped > 0 ? `已删除 ${deleted} 笔，${skipped} 笔已付款的网站订单要在订单里先处理退款` : `已删除 ${deleted} 笔`,
        working: "处理中…",
        paidInFull: "已收齐",
        toCollect: (amount: string) => `待收 ${amount}`,
        confirmUnpaid: "把选中订单的收款全部改回「待收」？收款记录本身会保留。",
        result: (updated: number, skipped: number) =>
          skipped > 0 ? `已更新 ${updated} 笔，跳过 ${skipped} 笔（Turo 和网站订单不在这里记收款）` : `已更新 ${updated} 笔`,
        failed: "操作失败，请重试。",
      }
    : {
        empty: "No orders matched this keyword.",
        plate: "Plate",
        owner: "Owner",
        pickup: "Pickup",
        return: "Return",
        price: "Price",
        phone: "Phone",
        open: "Open order details",
        select: "Select this order",
        selected: (count: number) => `${count} selected`,
        markPaid: "Mark paid",
        markUnpaid: "Mark unpaid",
        clearSelection: "Clear",
        selectAll: "Select all on this page",
        syncOwners: "Sync to owners",
        syncResult: (synced: number, skipped: number) =>
          skipped > 0 ? `${synced} synced; ${skipped} have no owner or failed` : `${synced} synced to owners`,
        deleteSelected: "Delete",
        confirmDelete: (count: number) => `Delete the ${count} selected orders? They can be restored from the trash.`,
        deleteResult: (deleted: number, skipped: number) =>
          skipped > 0 ? `${deleted} deleted; ${skipped} paid site bookings need their refund handled first` : `${deleted} deleted`,
        working: "Working…",
        paidInFull: "Paid in full",
        toCollect: (amount: string) => `To collect ${amount}`,
        confirmUnpaid: "Set every payment on the selected orders back to expected? The payment rows stay.",
        result: (updated: number, skipped: number) =>
          skipped > 0
            ? `${updated} updated, ${skipped} skipped (Turo and rental-site orders are not settled here)`
            : `${updated} updated`,
        failed: "That did not work. Try again.",
      };
}

export function OrdersRowList({
  orders,
  vehicleOptions,
  locale,
  paymentInfo = {},
}: {
  orders: EditableOrder[];
  vehicleOptions: OrderEditorVehicleOption[];
  locale: Locale;
  /** Hand-entered orders only: what has come in and what is still due.
   *  Their rows can be selected and marked paid or unpaid in bulk. */
  paymentInfo?: Record<string, { received: number; outstanding: number }>;
}) {
  const t = labels(locale);
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkPayment(action: "paid" | "unpaid") {
    if (action === "unpaid" && !window.confirm(t.confirmUnpaid)) return;
    setBusy(true);
    setNotice(null);
    const response = await fetch("/api/orders/bulk-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds], action }),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) {
      setNotice(t.failed);
      return;
    }
    setNotice(t.result(payload.updated ?? 0, payload.skipped ?? 0));
    setSelectedIds(new Set());
    router.refresh();
  }
  async function bulkSyncOwners() {
    setBusy(true);
    setNotice(null);
    const response = await fetch("/api/orders/bulk-owner-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds] }),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) {
      setNotice(t.failed);
      return;
    }
    setNotice(t.syncResult(payload.synced ?? 0, (payload.skipped ?? []).length));
    setSelectedIds(new Set());
    router.refresh();
  }

  /** One order at a time through the same delete as the panel, so a paid
   *  site booking is refused here exactly as it is there. */
  async function bulkDelete() {
    if (!window.confirm(t.confirmDelete(selectedIds.size))) return;
    setBusy(true);
    setNotice(null);
    const ids = [...selectedIds];
    const deleted: string[] = [];
    let skipped = 0;
    for (const id of ids) {
      const response = await fetch(`/api/orders/${id}`, { method: "DELETE" }).catch(() => null);
      if (response?.ok) deleted.push(id);
      else skipped += 1;
    }
    setBusy(false);
    setRows((current) => current.filter((order) => !deleted.includes(order.id)));
    setSelectedIds(new Set());
    setNotice(t.deleteResult(deleted.length, skipped));
    router.refresh();
  }

  const [rows, setRows] = useState(orders);
  const [selectedOrder, setSelectedOrder] = useState<EditableOrder | null>(null);

  const handleSaved = (updatedOrder: EditableOrder) => {
    setRows((current) =>
      current.map((order) => (order.id === updatedOrder.id ? updatedOrder : order)),
    );
    setSelectedOrder(updatedOrder);
  };

  const handleDeleted = (orderId: string) => {
    setRows((current) => current.filter((order) => order.id !== orderId));
    setSelectedOrder(null);
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-4 py-5 text-[12px] text-[color:var(--ink-soft)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
        {t.empty}
      </div>
    );
  }

  return (
    <>
      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.9)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
        <label className="flex cursor-pointer items-center gap-2 border-b border-[color:var(--line)] bg-[var(--surface-muted)]/60 px-2.5 py-1.5 text-[11.5px] text-[color:var(--ink-soft)] sm:px-3">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={rows.length > 0 && rows.every((order) => selectedIds.has(order.id))}
            ref={(element) => {
              if (element) element.indeterminate = selectedIds.size > 0 && !rows.every((order) => selectedIds.has(order.id));
            }}
            onChange={(event) =>
              setSelectedIds(event.target.checked ? new Set(rows.map((order) => order.id)) : new Set())
            }
          />
          {t.selectAll}
        </label>
        <div className="divide-y divide-[color:var(--line)]">
          {rows.map((order) => {
            const payment = paymentInfo[order.id];
            return (
            <div key={order.id} className={cn("flex items-stretch", order.hasConflict ? "bg-rose-50/70" : "bg-white/60")}>
              <label className="flex w-9 shrink-0 cursor-pointer items-start justify-center pt-4 sm:w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selectedIds.has(order.id)}
                  onChange={() => toggleSelected(order.id)}
                  aria-label={`${t.select}: ${order.renterName}`}
                />
              </label>
            <button
              type="button"
              onClick={() => setSelectedOrder(order)}
              className={cn(
                "grid min-w-0 flex-1 gap-2 py-3 pr-3 text-left transition hover:bg-white sm:pr-4 lg:grid-cols-[minmax(13rem,1.4fr)_minmax(11rem,1fr)_minmax(15rem,1.25fr)_minmax(8rem,0.72fr)] lg:items-center",
              )}
              aria-label={`${t.open}: ${order.vehicleName} ${order.renterName}`}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <p className="truncate font-serif text-[0.98rem] font-semibold text-[color:var(--ink)]">
                    {order.vehiclePlateNumber
                      ? `${order.vehiclePlateNumber} · ${order.vehicleName}`
                      : order.vehicleName}
                  </p>
                  {order.hasConflict ? <StatusBadge value="conflict" locale={locale} /> : null}
                </div>
                <p className="mt-1 truncate text-[11px] text-[color:var(--ink-soft)]">
                  {t.owner}: {order.ownerName ?? "-"} · {t.plate}: {order.vehiclePlateNumber ?? "-"}
                </p>
              </div>

              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-[color:var(--ink)]">
                  {order.renterName}
                </p>
                <p className="mt-1 truncate text-[11px] text-[color:var(--ink-soft)]">
                  {t.phone}: {order.renterPhone || "-"}
                </p>
              </div>

              <div className="grid gap-1 text-[11px] text-[color:var(--ink-soft)] sm:grid-cols-2 lg:block">
                <p className="truncate">
                  <span className="font-semibold text-[color:var(--ink)]">{t.pickup}:</span>{" "}
                  {formatDateTime(order.pickupDatetime, locale)}
                </p>
                <p className="truncate">
                  <span className="font-semibold text-[color:var(--ink)]">{t.return}:</span>{" "}
                  {formatDateTime(order.returnDatetime, locale)}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                <StatusBadge value={order.source} locale={locale} />
                <StatusBadge value={order.status} locale={locale} />
                <span className="rounded-full bg-[var(--ink)] px-2.5 py-1 text-[11px] font-semibold text-white">
                  {t.price}: {formatCurrency(order.totalPrice, locale)}
                </span>
                {payment ? (
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                      payment.outstanding > 0.005
                        ? "border-amber-300 bg-amber-50 text-amber-800"
                        : "border-emerald-300 bg-emerald-50 text-emerald-800",
                    )}
                  >
                    {payment.outstanding > 0.005
                      ? t.toCollect(formatCurrency(payment.outstanding, locale))
                      : t.paidInFull}
                  </span>
                ) : null}
              </div>
            </button>
            </div>
            );
          })}
        </div>
      </section>

      {notice ? (
        <p className="rounded-md border border-[color:var(--line)] bg-white px-3 py-2 text-[12px] text-[color:var(--ink-mid)]">
          {notice}
        </p>
      ) : null}

      <BulkActionBar
        count={selectedIds.size}
        countLabel={busy ? t.working : t.selected(selectedIds.size)}
        clearLabel={t.clearSelection}
        onClear={() => setSelectedIds(new Set())}
      >
        <BulkActionButton tone="primary" disabled={busy} onClick={() => void bulkSyncOwners()}>
          {t.syncOwners}
        </BulkActionButton>
        {/* Payments are recorded only on hand-entered orders. */}
        {[...selectedIds].some((id) => paymentInfo[id]) ? (
          <>
            <BulkActionButton disabled={busy} onClick={() => void bulkPayment("paid")}>
              {t.markPaid}
            </BulkActionButton>
            <BulkActionButton disabled={busy} onClick={() => void bulkPayment("unpaid")}>
              {t.markUnpaid}
            </BulkActionButton>
          </>
        ) : null}
        <BulkActionButton tone="danger" disabled={busy} onClick={() => void bulkDelete()}>
          {t.deleteSelected}
        </BulkActionButton>
      </BulkActionBar>

      {selectedOrder ? (
        <OrderDetailModal
          order={selectedOrder}
          vehicleOptions={vehicleOptions}
          locale={locale}
          onClose={() => setSelectedOrder(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      ) : null}
    </>
  );
}
