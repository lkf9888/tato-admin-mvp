"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { MobileSheet } from "@/components/mobile-chrome";
import type { EditableOrder } from "@/components/order-detail-modal";
import { getMessages, getStatusLabel, type Locale } from "@/lib/i18n";
import { cn, formatCurrency } from "@/lib/utils";

type Handover = {
  taskId: string;
  status: string;
  staff: { id: string; name: string; color: string } | null;
} | null;

/**
 * A trip tapped on the phone's calendar: a card from the bottom with
 * what is needed to act on it -- who, which car, when and where each
 * handover is and who does it, what the trip earned -- and the three
 * things done next: message the guest, assign the handover, open the
 * order. The calendar stays behind it, so closing the card is a step
 * back rather than a page back.
 *
 * The earnings are the order's own `totalPrice`, which the calendar
 * payload already resolves with getOrderNetEarning.
 */
export function CalendarOrderSheet({
  order,
  locale,
  readOnly,
  onClose,
  onOpenOrder,
}: {
  order: EditableOrder | null;
  locale: Locale;
  readOnly?: boolean;
  onClose: () => void;
  onOpenOrder: () => void;
}) {
  const t = getMessages(locale).calendar.mobile.sheet;
  const [handover, setHandover] = useState<{ pickup: Handover; return: Handover } | null>(null);

  useEffect(() => {
    setHandover(null);
    if (!order || readOnly) return;
    let cancelled = false;
    fetch(`/api/orders/${order.id}/handover`, { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) setHandover(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [order, readOnly]);

  if (!order) return null;
  const pickup = new Date(order.pickupDatetime);
  const ret = new Date(order.returnDatetime);
  const days = Math.max(1, Math.ceil((ret.getTime() - pickup.getTime()) / 86_400_000));
  const when = (date: Date) =>
    date.toLocaleString(locale === "en" ? "en-CA" : "zh-CN", {
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const staffLine = (task: Handover, kind: "pickup" | "return") => {
    if (!handover) return null;
    if (!task?.staff) return t.noStaff;
    return kind === "pickup" ? t.deliveredBy(task.staff.name) : t.collectedBy(task.staff.name);
  };
  const statusTone =
    order.status === "ongoing"
      ? "bg-emerald-100 text-emerald-800"
      : order.status === "cancelled"
        ? "bg-rose-100 text-rose-700"
        : order.status === "completed"
          ? "bg-[var(--surface-muted)] text-[var(--ink-mid)]"
          : "bg-[var(--brand-soft)] text-[var(--brand)]";
  // The handover worth assigning: the pickup until it has happened,
  // then the return.
  const assignTask = pickup.getTime() > Date.now() ? handover?.pickup : handover?.return;
  const assignLabel = pickup.getTime() > Date.now() ? t.assignPickup : t.assignReturn;

  const rows: Array<{ label: string; main: string; sub: string | null; strong?: boolean }> = [
    {
      label: t.pickup,
      main: when(pickup),
      sub:
        [order.pickupLocation, order.pickupSpot, staffLine(handover?.pickup ?? null, "pickup")].filter(Boolean).join(" · ") ||
        null,
    },
    {
      label: t.return,
      main: when(ret),
      sub:
        [order.returnLocation || order.pickupLocation, order.returnSpot, staffLine(handover?.return ?? null, "return")]
          .filter(Boolean)
          .join(" · ") || null,
    },
    {
      label: t.earning,
      main: order.totalPrice != null ? formatCurrency(order.totalPrice, locale) : "—",
      sub: t.days(days),
      strong: true,
    },
  ];

  const action =
    "tap-compact flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] text-[13px] font-semibold text-[var(--ink)]";

  return (
    <MobileSheet open onClose={onClose} label={order.renterName} closeLabel={t.close}>
      <div className="pr-10">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="truncate text-[18px] font-bold text-[var(--ink)]">{order.renterName}</h2>
          <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", statusTone)}>
            {getStatusLabel(order.status, locale)}
          </span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] font-semibold",
              order.source === "turo" ? "bg-[var(--ink)] text-[var(--surface)]" : "bg-[var(--brand-soft)] text-[var(--brand)]",
            )}
          >
            {getStatusLabel(order.source, locale)}
          </span>
        </div>
        <p className="mt-1 truncate text-[12px] text-[var(--ink-soft)]">
          {[order.vehicleName, order.vehiclePlateNumber, order.externalOrderId ? `#${order.externalOrderId}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <dl className="mt-2.5">
        {rows.map((row, index) => (
          <div
            key={row.label}
            className={cn("flex items-start gap-3 py-2.5", index < rows.length - 1 && "border-b border-[var(--line)]")}
          >
            <dt className="w-8 shrink-0 pt-px text-[12px] text-[var(--ink-soft)]">{row.label}</dt>
            <dd className="min-w-0 text-[14px] leading-[1.35] text-[var(--ink)]">
              <span className={cn(row.strong && "font-semibold")}>{row.main}</span>
              {row.sub ? (
                row.strong ? (
                  <span className="text-[12px] text-[var(--ink-soft)]"> · {row.sub}</span>
                ) : (
                  <span className="block text-[12px] text-[var(--ink-soft)]">{row.sub}</span>
                )
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {order.handoverNote ? (
        <p className="mt-1 whitespace-pre-line rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-[12px] leading-[1.4] text-[var(--ink-mid)]">
          {order.handoverNote}
        </p>
      ) : null}

      <div className="mt-2.5 flex gap-2">
        <Link
          href={`/messages?order=${encodeURIComponent(order.id)}`}
          className={cn(action, "border-[var(--brand)] bg-[var(--brand)] text-white")}
        >
          <MessageSquare className="h-4 w-4" aria-hidden />
          {t.message}
        </Link>
        {!readOnly && assignTask ? (
          <Link href={`/staff-schedule?assign=${encodeURIComponent(assignTask.taskId)}`} className={action}>
            {assignLabel}
          </Link>
        ) : null}
        <button type="button" onClick={onOpenOrder} className={action}>
          {t.openOrder}
        </button>
      </div>
    </MobileSheet>
  );
}
