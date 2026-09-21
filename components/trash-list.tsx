"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    subtitle: string;
    empty: string;
    restoreAction: string;
    restoringAction: string;
    restoreFailed: string;
    deletedAt: string;
    restoredNotice: string;
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

  const visible = orders.filter((order) => !restored.has(order.id));

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-lg font-semibold text-[var(--ink)]">{labels.title}</h1>
        <p className="mt-0.5 text-[12px] text-[color:var(--ink-soft)]">{labels.subtitle}</p>
      </header>

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
          {visible.map((order) => (
            <li
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-white px-3 py-2"
            >
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
    </div>
  );
}
