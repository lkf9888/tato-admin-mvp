"use client";

import { assignPendingOrderAction, dismissPendingOrderAction } from "@/app/actions";
import { SearchableSelect } from "@/components/searchable-select";
import type { Locale } from "@/lib/i18n";
import { formatDateTime } from "@/lib/utils";

export type PendingOrderRow = {
  id: string;
  externalOrderId: string;
  renterName: string;
  renterPhone: string | null;
  pickupDatetime: string;
  returnDatetime: string;
  pickupLocation: string | null;
  vehicleText: string;
  turoAccount: string | null;
  matchCount: number;
  /** Cars that answer to `vehicleText`, offered first in the picker. */
  candidateVehicleIds: string[];
};

export type PendingVehicleOption = {
  id: string;
  label: string;
  searchText: string;
};

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        kicker: "待分配",
        title: (count: number) => `${count} 笔订单还没挂到车上`,
        intro:
          "预订邮件里只写车型、从来没有车牌,所以车队里有多台同款同年份时,系统无法判断是哪一台 —— 挂错车比不挂更糟,所以它先停在这里。行程本身是真的,下面的信息都来自 Turo 的邮件。",
        resolveHint:
          "你可以直接指定车辆;也可以什么都不做 —— 下次导入覆盖这段时间的 CSV 时,车牌会自动把它挂到正确的车上。",
        several: (count: number) => `车队里有 ${count} 台同款同年份,无法区分`,
        none: "车队里没有能对上这个车型的车",
        reservation: "预订号",
        guest: "客人",
        trip: "行程",
        pickupAt: "取车地点",
        account: "Turo 账户",
        mainAccount: "主账户",
        candidates: "疑似车辆",
        choose: "选择车辆",
        assign: "挂到这台车",
        dismiss: "忽略",
        dismissHint: "只从这个列表里移除,不会建订单。下次同步如果邮件还在,它会再次出现。",
      }
    : {
        kicker: "Unassigned",
        title: (count: number) => `${count} bookings are not on a car yet`,
        intro:
          "Booking email names a model and never a plate, so when the fleet runs several of one model and year there is nothing to tell them apart — and the wrong car is worse than no car, so these wait here. The trips are real; everything below came from Turo's own mail.",
        resolveHint:
          "Pick the car yourself, or do nothing — the next CSV import covering these dates names the plate and files them automatically.",
        several: (count: number) => `${count} cars in the fleet share this model and year`,
        none: "No car in the fleet answers to this model",
        reservation: "Reservation",
        guest: "Guest",
        trip: "Trip",
        pickupAt: "Pickup",
        account: "Turo account",
        mainAccount: "Main account",
        candidates: "Likely cars",
        choose: "Choose a vehicle",
        assign: "Place on this car",
        dismiss: "Dismiss",
        dismissHint:
          "Removes it from this list without creating an order. It reappears on the next sync if the mail is still there.",
      };
}

/**
 * Bookings Turo told us about that we could not place.
 *
 * These used to be counted and dropped. The trip exists either way,
 * and a calendar missing a real booking is its own kind of wrong — so
 * they are held here, described in full, until a plate settles it.
 */
export function PendingOrdersPanel({
  locale,
  rows,
  vehicles,
}: {
  locale: Locale;
  rows: PendingOrderRow[];
  vehicles: PendingVehicleOption[];
}) {
  const t = copy(locale);
  if (rows.length === 0) return null;

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 sm:p-4">
      <p className="text-[10px] uppercase tracking-[0.22em] text-amber-800">{t.kicker}</p>
      <h3 className="mt-1 font-serif text-[1.05rem] text-[var(--ink)] sm:text-[1.25rem]">
        {t.title(rows.length)}
      </h3>
      <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-amber-900">{t.intro}</p>
      <p className="mt-1 max-w-3xl text-[12px] leading-5 text-amber-900">{t.resolveHint}</p>

      <ul className="mt-3 space-y-2">
        {rows.map((row) => {
          // Cars that match the model go to the top of the list; the
          // rest stay reachable, because a mis-named vehicle is exactly
          // the case where the match found nothing.
          const candidates = new Set(row.candidateVehicleIds);
          const options = [
            ...vehicles.filter((vehicle) => candidates.has(vehicle.id)),
            ...vehicles.filter((vehicle) => !candidates.has(vehicle.id)),
          ].map((vehicle) => ({
            value: vehicle.id,
            label: candidates.has(vehicle.id) ? `★ ${vehicle.label}` : vehicle.label,
            searchText: vehicle.searchText,
          }));

          return (
            <li
              key={row.id}
              className="rounded-md border border-amber-200 bg-white/80 px-3 py-2.5 text-[12px] leading-5"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-semibold text-[var(--ink)]">{row.renterName}</span>
                <span className="font-semibold text-[var(--ink)]">{row.vehicleText}</span>
                <span className="text-[var(--ink-soft)] tabular-nums">
                  #{row.externalOrderId}
                </span>
              </div>

              <div className="mt-0.5 text-[var(--ink-soft)]">
                {formatDateTime(row.pickupDatetime, locale)} →{" "}
                {formatDateTime(row.returnDatetime, locale)}
                {row.pickupLocation ? ` · ${row.pickupLocation}` : ""}
                {row.renterPhone ? ` · ${row.renterPhone}` : ""}
              </div>

              <div className="mt-0.5 text-amber-800">
                {row.matchCount > 1 ? t.several(row.matchCount) : t.none}
                {` · ${t.account}: ${row.turoAccount ?? t.mainAccount}`}
              </div>

              <form
                action={assignPendingOrderAction}
                className="mt-2 flex flex-wrap items-center gap-2"
              >
                <input type="hidden" name="pendingId" value={row.id} />
                <div className="min-w-0 flex-1 basis-[min(100%,20rem)]">
                  <SearchableSelect
                    name="vehicleId"
                    options={options}
                    placeholder={t.choose}
                    searchPlaceholder={t.choose}
                    className="h-9 w-full rounded-md border border-[var(--line)] bg-white px-3 text-[12px]"
                  />
                </div>
                <button type="submit" className="btn-primary h-9 shrink-0 text-[12px]">
                  {t.assign}
                </button>
              </form>

              <form action={dismissPendingOrderAction} className="mt-1.5">
                <input type="hidden" name="pendingId" value={row.id} />
                <button
                  type="submit"
                  title={t.dismissHint}
                  className="text-[11px] font-semibold text-[var(--ink-soft)] underline underline-offset-2 transition hover:text-[var(--ink)]"
                >
                  {t.dismiss}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
