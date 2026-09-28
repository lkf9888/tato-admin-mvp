"use client";

import { assignPendingOrderAction, dismissPendingOrderAction } from "@/app/actions";
import { InfoHint } from "@/components/info-hint";
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
  /** 停用 (`VehicleStatus.inactive`). Sync never files a booking on one
   *  by itself, so the picker keeps it reachable -- a trip it really
   *  took before it was switched off still belongs to it -- but never
   *  recommends it. Optional so the panel reads the same without it. */
  deactivated?: boolean;
};

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        kicker: "待分配",
        title: (count: number) => `${count} 笔订单还没挂到车上`,
        intro:
          "预订邮件里只写车型、从来没有车牌,所以车队里有多台同款同年份时,系统无法判断是哪一台 —— 挂错车比不挂更糟,所以它先停在这里。行程本身是真的,下面的信息都来自 Turo 的邮件。",
        resolveHint:
          "你可以直接指定车辆;也可以什么都不做 —— 下次导入覆盖这段时间的 CSV 时,车牌会自动把它挂到正确的车上。\n\n停用的车不会被自动分配订单:同步只在它停用之后的行程上把它排除。它停用前确实跑过的行程仍然算它一份,所以这类订单会继续留在这里等你判断。",
        several: (count: number) => `车队里有 ${count} 台同款同年份,无法区分`,
        none: "车队里没有能对上这个车型的车",
        allDeactivated: "对得上的车都已停用,默认不会自动挂上去",
        deactivatedTag: "停用",
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
          "Pick the car yourself, or do nothing — the next CSV import covering these dates names the plate and files them automatically.\n\nDeactivated cars are never given bookings automatically: sync rules one out only for trips after it was switched off. Trips it really took before then still count as possibly its, so those stay here for you to decide.",
        several: (count: number) => `${count} cars in the fleet share this model and year`,
        none: "No car in the fleet answers to this model",
        allDeactivated: "Every car that answers to this model is deactivated, so none is chosen by default",
        deactivatedTag: "deactivated",
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
      <h3 className="mt-1 flex items-center gap-1.5 font-serif text-[1.05rem] text-[var(--ink)] sm:text-[1.25rem]">
        {t.title(rows.length)}
        <InfoHint text={`${t.intro}\n\n${t.resolveHint}`} />
      </h3>

      <ul className="mt-3 space-y-2">
        {rows.map((row) => {
          // Active cars that match the model go to the top, starred.
          // Deactivated matches follow, tagged and unstarred: sync will
          // not choose them, but a trip one took before it was switched
          // off is still its. Everything else stays reachable, because
          // a mis-named vehicle is exactly the case where the match
          // found nothing.
          const candidates = new Set(row.candidateVehicleIds);
          const isCandidate = (vehicle: PendingVehicleOption) => candidates.has(vehicle.id);
          const options = [
            ...vehicles.filter((vehicle) => isCandidate(vehicle) && !vehicle.deactivated),
            ...vehicles.filter((vehicle) => isCandidate(vehicle) && vehicle.deactivated),
            ...vehicles.filter((vehicle) => !isCandidate(vehicle) && !vehicle.deactivated),
            ...vehicles.filter((vehicle) => !isCandidate(vehicle) && vehicle.deactivated),
          ].map((vehicle) => ({
            value: vehicle.id,
            label: vehicle.deactivated
              ? `${vehicle.label} (${t.deactivatedTag})`
              : isCandidate(vehicle)
                ? `★ ${vehicle.label}`
                : vehicle.label,
            searchText: vehicle.deactivated
              ? `${vehicle.searchText} ${t.deactivatedTag}`
              : vehicle.searchText,
          }));
          const candidateVehicles = vehicles.filter(isCandidate);
          const allDeactivated =
            candidateVehicles.length > 0 && candidateVehicles.every((vehicle) => vehicle.deactivated);

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
                {allDeactivated
                  ? t.allDeactivated
                  : row.matchCount > 1
                    ? t.several(row.matchCount)
                    : t.none}
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
