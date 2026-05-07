import { deleteOrderAction, saveOfflineOrderAction, updateOrderStatusAction } from "@/app/actions";
import { StatusBadge } from "@/components/status-badge";
import { getOrderStatusOptions } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import {
  formatCurrency,
  formatDateTime,
  getDisplayOrderNote,
  getOrderNetEarning,
  normalizeText,
} from "@/lib/utils";

async function fetchOrders() {
  return prisma.order.findMany({
    include: { vehicle: { include: { owner: true } } },
    orderBy: { pickupDatetime: "desc" },
  });
}

type SearchableOrder = Awaited<ReturnType<typeof fetchOrders>>[number];

function buildOrderSearchText(
  order: SearchableOrder,
  locale: "en" | "zh",
) {
  const netEarning = getOrderNetEarning(order.sourceMetadata, order.totalPrice);

  return normalizeText(
    [
      order.id,
      order.externalOrderId,
      order.source,
      order.status,
      order.renterName,
      order.renterPhone,
      order.vehicle.plateNumber,
      order.vehicle.nickname,
      order.vehicle.brand,
      order.vehicle.model,
      String(order.vehicle.year),
      order.vehicle.owner?.name,
      order.pickupLocation,
      order.returnLocation,
      order.paymentMethod,
      order.contractNumber,
      order.createdBy,
      getDisplayOrderNote(order.notes, order.source),
      formatDateTime(order.pickupDatetime, locale),
      formatDateTime(order.returnDatetime, locale),
      order.pickupDatetime.toISOString(),
      order.returnDatetime.toISOString(),
      netEarning != null ? String(netEarning) : null,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function matchesOrderSearch(
  order: SearchableOrder,
  query: string,
  locale: "en" | "zh",
) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;

  const haystack = buildOrderSearchText(order, locale);
  return normalizedQuery.split(" ").every((term) => haystack.includes(term));
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string }>;
}) {
  const [{ locale, messages }, orders, vehicles, params] = await Promise.all([
    getI18n(),
    fetchOrders(),
    prisma.vehicle.findMany({
      orderBy: { nickname: "asc" },
    }),
    searchParams,
  ]);

  const orderMessages = messages.orders;
  const orderStatusOptions = getOrderStatusOptions(locale);
  const searchQuery = params.q?.trim() ?? "";
  const filteredOrders = orders.filter((order) => matchesOrderSearch(order, searchQuery, locale));

  return (
    <div className="space-y-6">
      {params.error ? (
        <div className="rounded-3xl bg-amber-50 px-5 py-4 text-sm text-amber-700">
          {orderMessages.importedReadOnly}
        </div>
      ) : null}

      <section className="rounded-[1.75rem] border border-white/70 bg-white/90 p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
          {orderMessages.createKicker}
        </p>
        <form action={saveOfflineOrderAction} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <select name="vehicleId" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.nickname}
              </option>
            ))}
          </select>
          <input
            name="renterName"
            placeholder={orderMessages.placeholders.renterName}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="renterPhone"
            placeholder={orderMessages.placeholders.phone}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <select
            name="status"
            defaultValue="booked"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          >
            {orderStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            name="pickupDatetime"
            type="datetime-local"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="returnDatetime"
            type="datetime-local"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="totalPrice"
            type="number"
            step="0.01"
            placeholder={orderMessages.placeholders.totalPrice}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="depositAmount"
            type="number"
            step="0.01"
            placeholder={orderMessages.placeholders.deposit}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="pickupLocation"
            placeholder={orderMessages.placeholders.pickupLocation}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="returnLocation"
            placeholder={orderMessages.placeholders.returnLocation}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="paymentMethod"
            placeholder={orderMessages.placeholders.paymentMethod}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="contractNumber"
            placeholder={orderMessages.placeholders.contractNumber}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="notes"
            placeholder={orderMessages.placeholders.notes}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 xl:col-span-4"
          />
          <button className="rounded-2xl bg-slate-950 px-4 py-3 font-medium text-white xl:col-span-1">
            {orderMessages.createOfflineOrder}
          </button>
        </form>
      </section>

      <section className="rounded-[1.75rem] border border-white/70 bg-white/90 p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
          {orderMessages.searchKicker}
        </p>
        <form className="mt-5 flex flex-col gap-3 md:flex-row md:items-center">
          <input
            name="q"
            defaultValue={searchQuery}
            placeholder={orderMessages.placeholders.search}
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none"
          />
          <button className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white">
            {orderMessages.searchAction}
          </button>
          {searchQuery ? (
            <a
              href="/orders"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-center text-sm font-medium text-slate-700"
            >
              {orderMessages.clearSearch}
            </a>
          ) : null}
        </form>
        <p className="mt-3 text-sm text-slate-500">
          {orderMessages.searchSummary(filteredOrders.length)}
        </p>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        {filteredOrders.length === 0 ? (
          <div className="rounded-[1.75rem] border border-white/70 bg-white/90 px-6 py-8 text-sm text-slate-500 shadow-sm lg:col-span-2">
            {orderMessages.emptySearch}
          </div>
        ) : null}

        {filteredOrders.map((order) => {
          const netEarning = getOrderNetEarning(order.sourceMetadata, order.totalPrice);
          const hasNetEarning = netEarning != null;

          return (
            <article key={order.id} className="h-fit rounded-[1.5rem] border border-white/70 bg-white/90 p-4 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="font-serif text-3xl leading-tight text-slate-950">
                    {order.vehicle.nickname} · {order.renterName}
                  </h3>
                  <p className="mt-1.5 text-sm font-medium text-slate-600">
                    {orderMessages.platePrefix}: {order.vehicle.plateNumber || "—"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatDateTime(order.pickupDatetime, locale)} -{" "}
                    {formatDateTime(order.returnDatetime, locale)}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {orderMessages.ownerPrefix}: {order.vehicle.owner?.name ?? "—"}
                    {hasNetEarning
                      ? ` · ${orderMessages.revenuePrefix}: ${formatCurrency(netEarning, locale)}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge value={order.source} locale={locale} />
                  <StatusBadge value={order.status} locale={locale} />
                  {order.hasConflict ? <StatusBadge value="conflict" locale={locale} /> : null}
                </div>
              </div>

              <div className="mt-3 grid gap-x-4 gap-y-2 text-sm text-slate-600 md:grid-cols-3">
                <p>
                  {orderMessages.phone}: {order.renterPhone || "—"}
                </p>
                <p>
                  {orderMessages.pickup}: {order.pickupLocation || "—"}
                </p>
                <p>
                  {orderMessages.return}: {order.returnLocation || "—"}
                </p>
                <p>
                  {orderMessages.payment}: {order.paymentMethod || "—"}
                </p>
                <p>
                  {orderMessages.contract}: {order.contractNumber || "—"}
                </p>
                <p>
                  {orderMessages.createdBy}: {order.createdBy}
                </p>
              </div>

              {hasNetEarning ? (
                <div className="mt-3 rounded-[1.5rem] bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                    {orderMessages.importedBreakdown}
                  </p>
                  <div className="mt-3 rounded-2xl bg-white px-4 py-2.5 text-sm text-slate-700">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      {orderMessages.revenuePrefix}
                    </p>
                    <p className="mt-1.5 font-semibold text-slate-900">
                      {formatCurrency(netEarning, locale)}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 flex flex-col gap-2.5 md:flex-row md:items-center">
                <form action={updateOrderStatusAction} className="flex items-center gap-3">
                  <input type="hidden" name="id" value={order.id} />
                  <select
                    name="status"
                    defaultValue={order.status}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
                  >
                    {orderStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700">
                    {orderMessages.updateStatus}
                  </button>
                </form>

                {order.source === "offline" ? (
                  <form action={deleteOrderAction}>
                    <input type="hidden" name="id" value={order.id} />
                    <button className="rounded-2xl border border-rose-200 px-4 py-2.5 text-sm font-medium text-rose-600">
                      {orderMessages.deleteOfflineOrder}
                    </button>
                  </form>
                ) : null}
              </div>

              {order.source === "offline" ? (
                <details className="mt-3 rounded-[1.5rem] bg-slate-50 px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-700">
                    {orderMessages.editOfflineOrder}
                  </summary>
                  <form action={saveOfflineOrderAction} className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <input type="hidden" name="id" value={order.id} />
                    <select
                      name="vehicleId"
                      defaultValue={order.vehicleId}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    >
                      {vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.nickname}
                        </option>
                      ))}
                    </select>
                    <input
                      name="renterName"
                      defaultValue={order.renterName}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    />
                    <input
                      name="renterPhone"
                      defaultValue={order.renterPhone ?? ""}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    />
                    <select
                      name="status"
                      defaultValue={order.status}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    >
                      {orderStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <input
                      name="pickupDatetime"
                      type="datetime-local"
                      defaultValue={new Date(order.pickupDatetime).toISOString().slice(0, 16)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    />
                    <input
                      name="returnDatetime"
                      type="datetime-local"
                      defaultValue={new Date(order.returnDatetime).toISOString().slice(0, 16)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    />
                    <input
                      name="totalPrice"
                      type="number"
                      step="0.01"
                      defaultValue={order.totalPrice ?? ""}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    />
                    <input
                      name="depositAmount"
                      type="number"
                      step="0.01"
                      defaultValue={order.depositAmount ?? ""}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    />
                    <input
                      name="pickupLocation"
                      defaultValue={order.pickupLocation ?? ""}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    />
                    <input
                      name="returnLocation"
                      defaultValue={order.returnLocation ?? ""}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    />
                    <input
                      name="paymentMethod"
                      defaultValue={order.paymentMethod ?? ""}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    />
                    <input
                      name="contractNumber"
                      defaultValue={order.contractNumber ?? ""}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    />
                    <input
                      name="notes"
                      defaultValue={getDisplayOrderNote(order.notes, order.source) ?? ""}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 xl:col-span-4"
                    />
                    <button className="rounded-2xl bg-slate-950 px-4 py-3 font-medium text-white xl:col-span-1">
                      {orderMessages.saveOfflineOrder}
                    </button>
                  </form>
                </details>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
