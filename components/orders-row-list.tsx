"use client";

import { useState } from "react";

import {
  type EditableOrder,
  OrderDetailModal,
  type OrderEditorVehicleOption,
} from "@/components/order-detail-modal";
import { StatusBadge } from "@/components/status-badge";
import type { Locale } from "@/lib/i18n";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";

function labels(locale: Locale) {
  return locale === "zh"
    ? {
        empty: "没有找到符合这个关键字的订单。",
        plate: "车牌",
        owner: "车主",
        pickup: "取车",
        return: "还车",
        price: "金额",
        phone: "电话",
        open: "打开订单详情",
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
      };
}

export function OrdersRowList({
  orders,
  vehicleOptions,
  locale,
}: {
  orders: EditableOrder[];
  vehicleOptions: OrderEditorVehicleOption[];
  locale: Locale;
}) {
  const t = labels(locale);
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
        <div className="divide-y divide-[color:var(--line)]">
          {rows.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => setSelectedOrder(order)}
              className={cn(
                "grid w-full gap-2 px-3 py-3 text-left transition hover:bg-white sm:px-4 lg:grid-cols-[minmax(13rem,1.4fr)_minmax(11rem,1fr)_minmax(15rem,1.25fr)_minmax(8rem,0.72fr)] lg:items-center",
                order.hasConflict ? "bg-rose-50/70" : "bg-white/60",
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
              </div>
            </button>
          ))}
        </div>
      </section>

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
