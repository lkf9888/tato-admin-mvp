import { deleteOrderAction, saveOfflineOrderAction, updateOrderStatusAction } from "@/app/actions";
import { requireCurrentWorkspace } from "@/lib/auth";
import { StatusBadge } from "@/components/status-badge";
import { getOrderStatusOptions, type Locale } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import {
  cn,
  formatCurrency,
  formatDateTime,
  getDisplayOrderNote,
  getOrderNetEarning,
  normalizeText,
} from "@/lib/utils";

async function fetchOrders(workspaceId: string) {
  return prisma.order.findMany({
    where: { workspaceId, isArchived: false },
    include: { vehicle: { include: { owner: true } } },
    orderBy: { pickupDatetime: "desc" },
  });
}

type SearchableOrder = Awaited<ReturnType<typeof fetchOrders>>[number];

function buildOrderSearchText(order: SearchableOrder, locale: Locale) {
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

function matchesOrderSearch(order: SearchableOrder, query: string, locale: Locale) {
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
  const workspace = await requireCurrentWorkspace();
  const [{ locale, messages }, orders, vehicles, params] = await Promise.all([
    getI18n(),
    fetchOrders(workspace.id),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { nickname: "asc" },
    }),
    searchParams,
  ]);

  const orderMessages = messages.orders;
  const orderStatusOptions = getOrderStatusOptions(locale);
  const searchQuery = params.q?.trim() ?? "";
  const filteredOrders = orders.filter((order) => matchesOrderSearch(order, searchQuery, locale));

  const inputClass =
    "h-12 rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-4 text-[13px] text-[color:var(--ink)] outline-none";
  const subtleButtonClass =
    "inline-flex h-11 items-center justify-center rounded-full border border-[rgba(17,19,24,0.1)] bg-[rgba(255,255,255,0.76)] px-4 text-[12px] font-semibold text-[color:var(--ink)] backdrop-blur transition hover:border-[rgba(17,19,24,0.22)] hover:bg-white";
  const primaryButtonClass =
    "inline-flex h-11 items-center justify-center rounded-full bg-[var(--accent)] px-4 text-[12px] font-semibold text-[color:var(--ink)] shadow-[0_18px_38px_-20px_rgba(89,60,251,0.75)] transition hover:-translate-y-0.5 hover:bg-[#ff7b67]";

  return (
    <div className="space-y-5">
      {params.error ? (
        <div className="rounded-lg border border-amber-200/70 bg-[rgba(247,247,247,0.92)] px-5 py-4 text-sm text-amber-700 shadow-[0_16px_40px_-36px_rgba(17,19,24,0.45)]">
          {orderMessages.importedReadOnly}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.92),rgba(247,247,247,0.96))] p-6 shadow-[0_24px_60px_-42px_rgba(17,19,24,0.45)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-[color:var(--ink-soft)]">
              {orderMessages.createKicker}
            </p>
            <h2 className="mt-2 font-serif text-[2rem] leading-tight text-[color:var(--ink)]">
              {orderMessages.createTitle}
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-[color:var(--ink-soft)]">
              {orderMessages.createCopy}
            </p>
          </div>
          <div className="text-[11px] text-[color:var(--ink-soft)]">
            {orderMessages.createHint}
          </div>
        </div>

        <form action={saveOfflineOrderAction} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <select name="vehicleId" className={inputClass}>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.nickname}
              </option>
            ))}
          </select>
          <input name="renterName" placeholder={orderMessages.placeholders.renterName} className={inputClass} />
          <input name="renterPhone" placeholder={orderMessages.placeholders.phone} className={inputClass} />
          <select name="status" defaultValue="booked" className={inputClass}>
            {orderStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input name="pickupDatetime" type="datetime-local" className={inputClass} />
          <input name="returnDatetime" type="datetime-local" className={inputClass} />
          <input
            name="totalPrice"
            type="number"
            step="0.01"
            placeholder={orderMessages.placeholders.totalPrice}
            className={inputClass}
          />
          <input
            name="depositAmount"
            type="number"
            step="0.01"
            placeholder={orderMessages.placeholders.deposit}
            className={inputClass}
          />
          <input
            name="pickupLocation"
            placeholder={orderMessages.placeholders.pickupLocation}
            className={inputClass}
          />
          <input
            name="returnLocation"
            placeholder={orderMessages.placeholders.returnLocation}
            className={inputClass}
          />
          <input
            name="paymentMethod"
            placeholder={orderMessages.placeholders.paymentMethod}
            className={inputClass}
          />
          <input
            name="contractNumber"
            placeholder={orderMessages.placeholders.contractNumber}
            className={inputClass}
          />
          <input
            name="notes"
            placeholder={orderMessages.placeholders.notes}
            className={cn(inputClass, "xl:col-span-4")}
          />
          <div className="flex items-center xl:col-span-4">
            <button className={primaryButtonClass}>{orderMessages.createOfflineOrder}</button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] p-6 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-[color:var(--ink-soft)]">
              {orderMessages.searchKicker}
            </p>
            <h2 className="mt-2 font-serif text-[1.75rem] leading-tight text-[color:var(--ink)]">
              {orderMessages.searchTitle}
            </h2>
          </div>
          <p className="text-sm text-[color:var(--ink-soft)]">
            {orderMessages.searchSummary(filteredOrders.length)}
          </p>
        </div>

        <form className="mt-5 flex flex-col gap-3 md:flex-row md:items-center">
          <input
            name="q"
            defaultValue={searchQuery}
            placeholder={orderMessages.placeholders.search}
            className="h-12 flex-1 rounded-full border border-[rgba(17,19,24,0.08)] bg-white/84 px-5 text-sm text-[color:var(--ink)] outline-none"
          />
          <button className={primaryButtonClass}>{orderMessages.searchAction}</button>
          {searchQuery ? (
            <a href="/orders" className={subtleButtonClass}>
              {orderMessages.clearSearch}
            </a>
          ) : null}
        </form>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {filteredOrders.length === 0 ? (
          <div className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-6 py-8 text-sm text-[color:var(--ink-soft)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)] lg:col-span-2">
            {orderMessages.emptySearch}
          </div>
        ) : null}

        {filteredOrders.map((order) => {
          const netEarning = getOrderNetEarning(order.sourceMetadata, order.totalPrice);
          const hasNetEarning = netEarning != null;

          return (
            <article
              key={order.id}
              className="h-fit overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]"
            >
              <div className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,247,247,0.98))] px-5 py-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="font-serif text-[2rem] leading-tight text-[color:var(--ink)]">
                      {order.vehicle.nickname} · {order.renterName}
                    </h3>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--ink-soft)]">
                      <span className="rounded-full bg-white/76 px-3 py-1 font-semibold shadow-[0_14px_28px_-24px_rgba(17,19,24,0.45)]">
                        {orderMessages.platePrefix}: {order.vehicle.plateNumber || "—"}
                      </span>
                      <span className="rounded-full bg-white/56 px-3 py-1">
                        {orderMessages.ownerPrefix}: {order.vehicle.owner?.name ?? "—"}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-[color:var(--ink-soft)]">
                      {formatDateTime(order.pickupDatetime, locale)} -{" "}
                      {formatDateTime(order.returnDatetime, locale)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge value={order.source} locale={locale} />
                    <StatusBadge value={order.status} locale={locale} />
                    {order.hasConflict ? <StatusBadge value="conflict" locale={locale} /> : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 text-sm text-[color:var(--ink)] sm:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {orderMessages.phone}
                    </p>
                    <p className="mt-1 font-semibold">{order.renterPhone || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {orderMessages.pickup}
                    </p>
                    <p className="mt-1 font-semibold">{order.pickupLocation || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {orderMessages.return}
                    </p>
                    <p className="mt-1 font-semibold">{order.returnLocation || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {orderMessages.payment}
                    </p>
                    <p className="mt-1 font-semibold">{order.paymentMethod || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {orderMessages.contract}
                    </p>
                    <p className="mt-1 font-semibold">{order.contractNumber || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {orderMessages.createdBy}
                    </p>
                    <p className="mt-1 font-semibold">{order.createdBy}</p>
                  </div>
                </div>

                {hasNetEarning ? (
                  <div className="mt-4 overflow-hidden rounded-lg border border-[rgba(17,19,24,0.06)] bg-[linear-gradient(180deg,rgba(17,19,24,0.96),rgba(24,30,41,0.96))] px-4 py-4 text-white">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-white/60">
                      {orderMessages.importedBreakdown}
                    </p>
                    <div className="mt-3 rounded-md bg-white/8 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">
                        {orderMessages.revenuePrefix}
                      </p>
                      <p className="mt-2 text-xl font-semibold text-white">
                        {formatCurrency(netEarning, locale)}
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-col gap-3">
                  <form action={updateOrderStatusAction} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input type="hidden" name="id" value={order.id} />
                    <select
                      name="status"
                      defaultValue={order.status}
                      className="h-11 rounded-full border border-[rgba(17,19,24,0.08)] bg-white/84 px-4 text-sm text-[color:var(--ink)]"
                    >
                      {orderStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button className={subtleButtonClass}>{orderMessages.updateStatus}</button>
                  </form>

                  {order.source === "offline" ? (
                    <form action={deleteOrderAction}>
                      <input type="hidden" name="id" value={order.id} />
                      <button className="inline-flex h-11 items-center justify-center rounded-full border border-rose-200 bg-white/76 px-4 text-sm font-semibold text-rose-600 transition hover:border-rose-400 hover:text-rose-700">
                        {orderMessages.deleteOfflineOrder}
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>

              {order.source === "offline" ? (
                <details className="border-t border-[color:var(--line)] bg-[rgba(255,255,255,0.38)] px-5 py-4">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-[color:var(--ink)]">
                    {orderMessages.editOfflineOrder}
                  </summary>
                  <form action={saveOfflineOrderAction} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <input type="hidden" name="id" value={order.id} />
                    <select name="vehicleId" defaultValue={order.vehicleId} className={inputClass}>
                      {vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.nickname}
                        </option>
                      ))}
                    </select>
                    <input name="renterName" defaultValue={order.renterName} className={inputClass} />
                    <input
                      name="renterPhone"
                      defaultValue={order.renterPhone ?? ""}
                      className={inputClass}
                    />
                    <select name="status" defaultValue={order.status} className={inputClass}>
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
                      className={inputClass}
                    />
                    <input
                      name="returnDatetime"
                      type="datetime-local"
                      defaultValue={new Date(order.returnDatetime).toISOString().slice(0, 16)}
                      className={inputClass}
                    />
                    <input
                      name="totalPrice"
                      type="number"
                      step="0.01"
                      defaultValue={order.totalPrice ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="depositAmount"
                      type="number"
                      step="0.01"
                      defaultValue={order.depositAmount ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="pickupLocation"
                      defaultValue={order.pickupLocation ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="returnLocation"
                      defaultValue={order.returnLocation ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="paymentMethod"
                      defaultValue={order.paymentMethod ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="contractNumber"
                      defaultValue={order.contractNumber ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="notes"
                      defaultValue={getDisplayOrderNote(order.notes, order.source) ?? ""}
                      className={cn(inputClass, "xl:col-span-4")}
                    />
                    <div className="flex items-center xl:col-span-4">
                      <button className={primaryButtonClass}>{orderMessages.saveOfflineOrder}</button>
                    </div>
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
