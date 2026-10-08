"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { BulkActionBar, BulkActionButton } from "@/components/bulk-action-bar";
import { getStatusLabel, type Locale } from "@/lib/i18n";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";

type TrashedOrder = {
  id: string;
  renterName: string;
  vehiclePlateNumber?: string | null;
  vehicleName: string;
  pickupDatetime: string;
  returnDatetime: string;
  deletedAt: string;
  source: "turo" | "offline";
  totalPrice?: number | null;
};

export function TrashList({
  locale,
  labels,
  orders,
}: {
  locale: Locale;
  labels: {
    title: string;
    empty: string;
    restoreAction: string;
    restoringAction: string;
    restoreFailed: string;
    deletedAt: string;
    restoredNotice: string;
    selectAll: string;
    selected: string;
    restoreSelected: string;
    clearSelection: string;
    restoredMany: string;
    restoredSome: string;
  };
  orders: TrashedOrder[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Removed from the list the moment the server confirms, rather than
  // waiting for the refresh. A row that sits there after you restored
  // it invites a second click, and a second restore is a 404.
  const [restored, setRestored] = useState<Set<string>>(new Set());

  async function restore(order: TrashedOrder) {
    if (busyId) return;
    setBusyId(order.id);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${order.id}/restore`, { method: "POST" });
      if (!response.ok) throw new Error(String(response.status));
      setRestored((current) => new Set(current).add(order.id));
      setNotice(labels.restoredNotice.replace("{renter}", order.renterName));
      router.refresh();
    } catch {
      setError(labels.restoreFailed);
    } finally {
      setBusyId(null);
    }
  }

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  /** One at a time through the same restore, so each one re-checks its car's calendar. */
  async function restorePicked() {
    if (bulkBusy) return;
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    const done: string[] = [];
    for (const id of picked) {
      const response = await fetch(`/api/orders/${id}/restore`, { method: "POST" }).catch(() => null);
      if (response?.ok) done.push(id);
    }
    const failed = picked.size - done.length;
    setRestored((current) => new Set([...current, ...done]));
    setPicked(new Set());
    setBulkBusy(false);
    if (failed > 0) {
      setError(labels.restoredSome.replace("{count}", String(done.length)).replace("{failed}", String(failed)));
    } else {
      setNotice(labels.restoredMany.replace("{count}", String(done.length)));
    }
    router.refresh();
  }

  const visible = orders.filter((order) => !restored.has(order.id));
  const allPicked = visible.length > 0 && visible.every((order) => picked.has(order.id));

  return (
    <div className="space-y-3">
      <h1 className="sr-only">{labels.title}</h1>

      {notice ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="rounded-lg border border-[var(--line)] bg-white px-4 py-10 text-center text-sm text-[color:var(--ink-soft)]">
          {labels.empty}
        </p>
      ) : (
        <ul className="grid gap-2">
          <li>
            <label className="flex w-fit cursor-pointer items-center gap-2 px-1 text-[11.5px] text-[color:var(--ink-soft)]">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={allPicked}
                onChange={(event) =>
                  setPicked(event.target.checked ? new Set(visible.map((order) => order.id)) : new Set())
                }
              />
              {labels.selectAll}
            </label>
          </li>
          {visible.map((order) => (
            <li
              key={order.id}
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2",
                picked.has(order.id) ? "border-[var(--accent)]" : "border-[var(--line)]",
              )}
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={picked.has(order.id)}
                onChange={() =>
                  setPicked((current) => {
                    const next = new Set(current);
                    if (next.has(order.id)) next.delete(order.id);
                    else next.add(order.id);
                    return next;
                  })
                }
              />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-[var(--ink)]">
                  {order.renterName}
                  <span className="ml-2 rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--ink-soft)]">
                    {getStatusLabel(order.source, locale)}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[11.5px] text-[color:var(--ink-soft)]">
                  {order.vehiclePlateNumber || order.vehicleName} ·{" "}
                  {formatDateTime(order.pickupDatetime, locale)} →{" "}
                  {formatDateTime(order.returnDatetime, locale)}
                  {order.totalPrice != null
                    ? ` · ${formatCurrency(order.totalPrice, locale)}`
                    : ""}
                </p>
                <p className="mt-0.5 text-[10.5px] text-[color:var(--ink-soft)]/80">
                  {labels.deletedAt} {formatDateTime(order.deletedAt, locale)}
                </p>
              </div>
              </label>
              <button
                type="button"
                onClick={() => void restore(order)}
                disabled={busyId === order.id}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center rounded-md border border-[var(--line)] bg-white px-3 text-[12px] font-semibold text-[var(--ink)] transition",
                  "hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50",
                )}
              >
                {busyId === order.id ? labels.restoringAction : labels.restoreAction}
              </button>
            </li>
          ))}
        </ul>
      )}

      <BulkActionBar
        count={picked.size}
        countLabel={labels.selected.replace("{count}", String(picked.size))}
        clearLabel={labels.clearSelection}
        onClear={() => setPicked(new Set())}
      >
        <BulkActionButton tone="primary" disabled={bulkBusy} onClick={() => void restorePicked()}>
          {bulkBusy ? labels.restoringAction : labels.restoreSelected}
        </BulkActionButton>
      </BulkActionBar>
    </div>
  );
}
