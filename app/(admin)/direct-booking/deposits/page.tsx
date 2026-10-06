import Link from "next/link";

import { DepositOverviewActions } from "@/components/deposit-overview-actions";
import { DirectBookingSubpageFrame } from "@/components/direct-booking-subpage-frame";
import { requireCurrentWorkspace } from "@/lib/auth";
import { formatBookingMoment, utcToZonedDate } from "@/lib/booking-time";
import { DEPOSIT_RETURN_DAYS, listDeposits, type DepositRow } from "@/lib/direct-booking-deposits";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";

type SearchParams = Promise<{ q?: string; vehicle?: string; history?: string }>;

/**
 * Every deposit held, and the ones given back: how each came in, when
 * it is due back, and where it goes. Search and a car filter, because
 * the question is usually "what do we owe this person".
 */
export default async function DepositsPage({ searchParams }: { searchParams: SearchParams }) {
  const workspace = await requireCurrentWorkspace();
  const query = await searchParams;
  const history = query.history === "1";
  const [{ locale, messages }, rows, vehicles] = await Promise.all([
    getI18n(),
    listDeposits({ workspaceId: workspace.id, history, query: query.q, vehicleId: query.vehicle || undefined }),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id, isArchived: false },
      select: { id: true, plateNumber: true, nickname: true, brand: true, model: true },
      orderBy: { plateNumber: "asc" },
    }),
  ]);
  const copy = messages.directBookingDeposits;
  const money = (value: number) => formatCurrency(value, locale);
  const day = (value: Date) => formatBookingMoment(value).slice(0, 10);
  const now = new Date();
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const tabHref = (toHistory: boolean) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.vehicle) params.set("vehicle", query.vehicle);
    if (toHistory) params.set("history", "1");
    return `/direct-booking/deposits${params.size ? `?${params}` : ""}`;
  };

  function due(row: DepositRow) {
    if (row.pickupAt > now) return { text: copy.upcoming, tone: "text-[color:var(--ink-soft)]" };
    if (row.returnAt > now) return { text: copy.onTrip, tone: "text-[color:var(--ink-soft)]" };
    return row.dueBy < now
      ? { text: copy.overdue(day(row.dueBy)), tone: "font-semibold text-[color:var(--bad-fg)]" }
      : { text: copy.dueBy(day(row.dueBy)), tone: "text-[color:var(--ink)]" };
  }

  return (
    <div className="space-y-3">
      <DirectBookingSubpageFrame workspaceId={workspace.id} locale={locale} active="deposits" />
      <section className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[1.05rem] font-semibold text-[color:var(--ink)]">{copy.title}</h3>
          {!history && rows.length > 0 ? (
            <p className="text-[12px] font-medium tabular-nums text-[color:var(--ink)]">
              {copy.totalHeld(rows.length, money(total))}
            </p>
          ) : null}
        </div>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[color:var(--ink-soft)]">{copy.intro(DEPOSIT_RETURN_DAYS)}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] p-0.5">
            {[false, true].map((toHistory) => (
              <Link
                key={String(toHistory)}
                href={tabHref(toHistory)}
                className={`rounded px-3 py-1 text-[12px] font-medium ${
                  toHistory === history ? "bg-white text-[color:var(--ink)] shadow-sm" : "text-[color:var(--ink-soft)]"
                }`}
              >
                {toHistory ? copy.history : copy.held}
              </Link>
            ))}
          </div>
          <form className="flex min-w-0 flex-1 flex-wrap gap-2" action="/direct-booking/deposits">
            {history ? <input type="hidden" name="history" value="1" /> : null}
            <input
              name="q"
              defaultValue={query.q ?? ""}
              placeholder={copy.searchPlaceholder}
              className="h-8 min-w-0 flex-1 rounded-md border border-[color:var(--line)] bg-white px-2 text-[12px] sm:max-w-xs"
            />
            <select
              name="vehicle"
              defaultValue={query.vehicle ?? ""}
              className="h-8 min-w-0 max-w-[12rem] rounded-md border border-[color:var(--line)] bg-white px-2 text-[12px]"
            >
              <option value="">{copy.allVehicles}</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.plateNumber} · {vehicle.nickname?.trim() || `${vehicle.brand} ${vehicle.model}`}
                </option>
              ))}
            </select>
            <button type="submit" className="h-8 rounded-md border border-[color:var(--line)] bg-white px-3 text-[12px] font-medium">
              {copy.filterAction}
            </button>
          </form>
        </div>

        {rows.length === 0 ? (
          <p className="mt-3 text-[12px] text-[color:var(--ink-soft)]">{history ? copy.emptyHistory : copy.empty}</p>
        ) : null}
      </section>

      {rows.map((row) => {
        const status = due(row);
        return (
          <article
            key={row.orderId}
            className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 text-[12px] sm:px-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-[color:var(--ink)]">
                  {row.renterName}{" "}
                  <span className="font-normal text-[color:var(--ink-soft)]">
                    {[row.renterPhone, row.renterEmail].filter(Boolean).join(" · ")}
                  </span>
                </p>
                <p className="mt-0.5 text-[color:var(--ink-mid)]">
                  {row.plateNumber} · {row.vehicleLabel} · {formatBookingMoment(row.pickupAt)} – {formatBookingMoment(row.returnAt)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[15px] font-semibold tabular-nums text-[color:var(--ink)]">{money(row.amount)}</p>
                <Link href={`/orders/${row.orderId}`} className="text-[11px] text-[color:var(--ink-soft)] underline">
                  {copy.openOrder}
                </Link>
              </div>
            </div>

            <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] text-[color:var(--ink-soft)]">{copy.colCollected}</dt>
                <dd className={row.collectedVia ? "text-[color:var(--ink)]" : "text-[color:var(--warn-fg)]"}>
                  {row.collectedVia ? copy.via[row.collectedVia] : copy.notRecorded}
                  {row.collectedAt ? ` · ${day(row.collectedAt)}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-[color:var(--ink-soft)]">{copy.colDue}</dt>
                <dd className={row.settled ? "text-[color:var(--ok-fg)]" : status.tone}>
                  {row.settled
                    ? `${copy.returned(day(row.settled.at), money(row.settled.refunded))}${
                        row.settled.refunded < row.amount ? ` · ${copy.kept(money(row.amount - row.settled.refunded))}` : ""
                      }`
                    : status.text}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-[color:var(--ink-soft)]">{copy.colRefundTo}</dt>
                <dd className={`break-all ${row.viaStripe || row.refundTo ? "text-[color:var(--ink)]" : "text-[color:var(--warn-fg)]"}`}>
                  {row.viaStripe ? copy.refundToCard : row.refundTo || copy.notRecorded}
                </dd>
              </div>
            </dl>
            {row.settled?.note ? <p className="mt-1 text-[color:var(--ink-mid)]">{row.settled.note}</p> : null}

            {!row.settled ? (
              <DepositOverviewActions
                locale={locale}
                orderId={row.orderId}
                amount={row.amount}
                viaStripe={row.viaStripe}
                collectedVia={row.viaStripe ? null : row.collectedVia}
                collectedOn={row.collectedAt && !row.viaStripe ? utcToZonedDate(row.collectedAt) : ""}
                refundTo={row.refundTo}
              />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
