"use client";

import { useEffect, useMemo, useState } from "react";

import type { OrderStatus } from "@prisma/client";

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
  /** As Turo's mail last put it. Optional so the panel reads the same
   *  without it; with it, a cancelled trip is never counted as under way. */
  status?: OrderStatus;
};

export type PendingVehicleOption = {
  id: string;
  label: string;
  searchText: string;
  /** Archived (归档, which 停用 was folded into). Sync never files a
   *  booking on one by itself, so the picker keeps it reachable -- a
   *  trip it really took before it was archived still belongs to it --
   *  but never recommends it. Optional so the panel reads the same
   *  without it. */
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
          "你可以直接指定车辆;也可以什么都不做 —— 下次导入覆盖这段时间的 CSV 时,车牌会自动把它挂到正确的车上。\n\n归档的车不会被自动分配新订单:同步只在它最后一笔订单之后的行程上把它排除。它归档前确实跑过的行程仍然算它一份,所以这类订单会继续留在这里等你判断。",
        several: (count: number) => `车队里有 ${count} 台同款同年份,无法区分`,
        none: "车队里没有能对上这个车型的车",
        allDeactivated: "对得上的车都已归档,默认不会自动挂上去",
        deactivatedTag: "已归档",
        reservation: "预订号",
        guest: "客人",
        trip: "行程",
        pickupAt: "取车地点",
        account: "Turo 账户",
        mainAccount: "主账户",
        candidates: "疑似车辆",
        choose: "选择车辆",
        assign: "挂上",
        expand: "展开",
        collapse: "收起",
        countInGroup: (count: number) => `${count} 笔`,
        nextPickup: (when: string) => `最近取车 ${when}`,
        underway: (count: number) => `${count} 笔已经在进行中`,
        underwayTag: "进行中",
        underwayHint: "已经取车、还没还车:车在客人手上,日历上却没有这笔订单,这段时间它看起来是空的。先挂这几笔。",
        dismiss: "忽略",
        dismissHint: "只从这个列表里移除,不会建订单。下次同步如果邮件还在,它会再次出现。",
      }
    : {
        kicker: "Unassigned",
        title: (count: number) => `${count} bookings are not on a car yet`,
        intro:
          "Booking email names a model and never a plate, so when the fleet runs several of one model and year there is nothing to tell them apart — and the wrong car is worse than no car, so these wait here. The trips are real; everything below came from Turo's own mail.",
        resolveHint:
          "Pick the car yourself, or do nothing — the next CSV import covering these dates names the plate and files them automatically.\n\nArchived cars are never given new bookings automatically: sync rules one out only for trips after its last booking. Trips it really took before it was archived still count as possibly its, so those stay here for you to decide.",
        several: (count: number) => `${count} cars in the fleet share this model and year`,
        none: "No car in the fleet answers to this model",
        allDeactivated: "Every car that answers to this model is archived, so none is chosen by default",
        deactivatedTag: "archived",
        reservation: "Reservation",
        guest: "Guest",
        trip: "Trip",
        pickupAt: "Pickup",
        account: "Turo account",
        mainAccount: "Main account",
        candidates: "Likely cars",
        choose: "Choose a vehicle",
        assign: "Place",
        expand: "Show",
        collapse: "Hide",
        countInGroup: (count: number) => `${count} booking${count === 1 ? "" : "s"}`,
        nextPickup: (when: string) => `next pickup ${when}`,
        underway: (count: number) => `${count} already under way`,
        underwayTag: "under way",
        underwayHint:
          "Picked up and not yet returned: the car is with a guest, but the calendar has no booking for it and shows it as free. Place these first.",
        dismiss: "Dismiss",
        dismissHint:
          "Removes it from this list without creating an order. It reappears on the next sync if the mail is still there.",
      };
}

type Copy = ReturnType<typeof copy>;

type SelectOption = { value: string; label: string; searchText: string };

type Group = {
  key: string;
  vehicleText: string;
  turoAccount: string | null;
  rows: PendingOrderRow[];
  options: SelectOption[];
  reason: string;
};

const EXPANDED_KEY = "tato.pendingOrders.expanded";

/**
 * Picked up and not yet returned. These are the urgent ones: the car is
 * already out, and until it is placed the calendar shows that car free
 * for dates it is not -- the "next pickup" line, which looks only
 * forward, never mentions them.
 */
function isUnderway(row: PendingOrderRow, now: number) {
  if (row.status === "cancelled") return false;
  return (
    new Date(row.pickupDatetime).getTime() <= now && new Date(row.returnDatetime).getTime() > now
  );
}

/**
 * The picker for one group. Active cars that match the model go to the
 * top, starred. Deactivated matches follow, tagged and unstarred: sync
 * will not choose them, but a trip one took before it was archived
 * is still its. Everything else stays reachable, because a mis-named
 * vehicle is exactly the case where the match found nothing.
 */
function buildOptions(candidateIds: string[], vehicles: PendingVehicleOption[], t: Copy) {
  const candidates = new Set(candidateIds);
  const isCandidate = (vehicle: PendingVehicleOption) => candidates.has(vehicle.id);
  const options: SelectOption[] = [
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
    searchText: vehicle.deactivated ? `${vehicle.searchText} ${t.deactivatedTag}` : vehicle.searchText,
  }));
  const candidateVehicles = vehicles.filter(isCandidate);
  const allDeactivated =
    candidateVehicles.length > 0 && candidateVehicles.every((vehicle) => vehicle.deactivated);
  return { options, allDeactivated };
}

/**
 * Bookings grouped by what makes them the same problem.
 *
 * Every booking for one model on one account has the same candidates,
 * so the explanation and the picker's ordering are worked out once per
 * group instead of once per card. The stored match count is part of the
 * key too: it can differ within a model when a deactivated car is ruled
 * out for some trip dates and not others, and a header that states one
 * count for rows that have another would be wrong for some of them.
 *
 * Groups holding a trip already under way come first -- that car is out
 * with a guest and the calendar calls it free. Then groups run by their
 * earliest pickup, and rows within a group by pickup, so the booking
 * that needs a car soonest is at the top.
 */
function buildGroups(
  rows: PendingOrderRow[],
  vehicles: PendingVehicleOption[],
  t: Copy,
  underway: Set<string>,
): Group[] {
  const byKey = new Map<string, PendingOrderRow[]>();
  for (const row of rows) {
    const key = `${row.vehicleText}\u0000${row.turoAccount ?? ""}\u0000${row.matchCount}`;
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }

  const pickup = (row: PendingOrderRow) => new Date(row.pickupDatetime).getTime();

  return [...byKey.entries()]
    .map(([key, groupRows]) => {
      const sorted = [...groupRows].sort((a, b) => pickup(a) - pickup(b));
      const first = sorted[0];
      const { options, allDeactivated } = buildOptions(first.candidateVehicleIds, vehicles, t);
      const reason = allDeactivated
        ? t.allDeactivated
        : first.matchCount > 1
          ? t.several(first.matchCount)
          : t.none;
      return {
        key,
        vehicleText: first.vehicleText,
        turoAccount: first.turoAccount,
        rows: sorted,
        options,
        reason,
      };
    })
    .sort((a, b) => {
      const urgent = (group: { rows: PendingOrderRow[] }) =>
        group.rows.some((row) => underway.has(row.id)) ? 0 : 1;
      return urgent(a) - urgent(b) || pickup(a.rows[0]) - pickup(b.rows[0]);
    });
}

/**
 * Bookings Turo told us about that we could not place.
 *
 * These used to be counted and dropped. The trip exists either way,
 * and a calendar missing a real booking is its own kind of wrong — so
 * they are held here until a plate settles it.
 *
 * It sits at the top of the orders page, above the list people actually
 * came for, so it opens folded to one line: how many, which models, and
 * when the soonest one needs a car. Unfolded, each booking is one row
 * with its picker beside it, grouped by model. Folded or not is
 * remembered per browser.
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
  const t = useMemo(() => copy(locale), [locale]);
  const [expanded, setExpanded] = useState(false);

  // Read after mount, not during render: the server has no storage, and
  // a first paint that disagreed with it would be a hydration mismatch.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(EXPANDED_KEY) === "1") setExpanded(true);
    } catch {
      // Private window or blocked storage: folded is a fine default.
    }
  }, []);

  const underway = useMemo(() => {
    const now = Date.now();
    return new Set(rows.filter((row) => isUnderway(row, now)).map((row) => row.id));
  }, [rows]);

  const groups = useMemo(
    () => buildGroups(rows, vehicles, t, underway),
    [rows, vehicles, t, underway],
  );

  const summary = useMemo(() => {
    const byModel = new Map<string, number>();
    for (const row of rows) byModel.set(row.vehicleText, (byModel.get(row.vehicleText) ?? 0) + 1);
    return [...byModel.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const nextPickup = useMemo(() => {
    const now = Date.now();
    const upcoming = rows
      .map((row) => new Date(row.pickupDatetime).getTime())
      .filter((time) => time >= now)
      .sort((a, b) => a - b)[0];
    return upcoming === undefined ? null : formatDateTime(new Date(upcoming), locale);
  }, [rows, locale]);

  if (rows.length === 0) return null;

  function toggle() {
    setExpanded((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(EXPANDED_KEY, next ? "1" : "0");
      } catch {
        // Not remembered, still toggled.
      }
      return next;
    });
  }

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 sm:px-4">
      {/* The toggle keeps the top-right corner; everything else wraps
          beside it. Sharing one wrapping row with the button squeezed
          the model tags into a sliver on a phone, each broken over two
          lines -- taller folded than unfolded. */}
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[10px] uppercase tracking-[0.22em] text-amber-800">{t.kicker}</span>
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ink)]">
            {t.title(rows.length)}
            <InfoHint text={`${t.intro}\n\n${t.resolveHint}`} />
          </h3>
          {underway.size > 0 ? (
            <span
              title={t.underwayHint}
              className="whitespace-nowrap rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-rose-700"
            >
              {t.underway(underway.size)}
            </span>
          ) : null}
          {nextPickup ? (
            <span className="text-[11px] tabular-nums text-amber-800">{t.nextPickup(nextPickup)}</span>
          ) : null}

          {!expanded ? (
            <ul className="flex flex-wrap gap-1.5">
              {summary.map(([model, count]) => (
                <li
                  key={model}
                  className="whitespace-nowrap rounded-full border border-amber-300 bg-white/70 px-2 py-0.5 text-[11px] text-amber-900"
                >
                  {model} <span className="tabular-nums">×{count}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="h-7 shrink-0 rounded-md border border-amber-300 bg-white px-2.5 text-[12px] font-semibold text-amber-900 transition hover:bg-amber-100"
        >
          {expanded ? t.collapse : t.expand}
        </button>
      </div>

      {expanded ? (
        <div className="mt-2 space-y-2.5">
          {groups.map((group) => (
            <div key={group.key}>
              <p className="text-[11px] leading-5 text-amber-900">
                <span className="font-semibold text-[var(--ink)]">{group.vehicleText}</span>
                {` · ${t.countInGroup(group.rows.length)} · ${group.reason}`}
                {group.turoAccount ? ` · ${t.account}: ${group.turoAccount}` : ""}
              </p>

              <ul className="mt-1 divide-y divide-amber-100 rounded-md border border-amber-200 bg-white/85">
                {group.rows.map((row) => {
                  const dates = `${formatDateTime(row.pickupDatetime, locale)} → ${formatDateTime(row.returnDatetime, locale)}`;
                  // The row shows what picking a car needs; the rest is
                  // one hover away rather than a second line per booking.
                  const detail = [
                    row.renterName,
                    dates,
                    `${t.reservation} #${row.externalOrderId}`,
                    row.renterPhone,
                    row.pickupLocation ? `${t.pickupAt}: ${row.pickupLocation}` : null,
                  ]
                    .filter(Boolean)
                    .join("\n");

                  return (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2.5 py-1.5 text-[12px] leading-5"
                    >
                      <div className="min-w-0 flex-1 basis-[16rem] truncate" title={detail}>
                        {underway.has(row.id) ? (
                          <span
                            title={t.underwayHint}
                            className="mr-2 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-px text-[10px] font-semibold text-rose-700"
                          >
                            {t.underwayTag}
                          </span>
                        ) : null}
                        <span className="font-semibold text-[var(--ink)]">{row.renterName}</span>
                        <span className="ml-2 tabular-nums text-[var(--ink-mid)]">{dates}</span>
                        <span className="ml-2 tabular-nums text-[var(--ink-soft)]">#{row.externalOrderId}</span>
                        {row.renterPhone ? (
                          <span className="ml-2 tabular-nums text-[var(--ink-soft)]">{row.renterPhone}</span>
                        ) : null}
                      </div>

                      {/* One wrapper so the three controls wrap together: on a
                          phone the booking takes two lines, not three. */}
                      <div className="flex min-w-0 flex-1 basis-[18rem] items-center gap-2 sm:flex-none sm:basis-auto">
                        <form
                          action={assignPendingOrderAction}
                          className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none"
                        >
                          <input type="hidden" name="pendingId" value={row.id} />
                          <div className="min-w-0 flex-1 sm:w-60 sm:flex-none">
                            <SearchableSelect
                              name="vehicleId"
                              options={group.options}
                              placeholder={t.choose}
                              searchPlaceholder={t.choose}
                              className="h-8 w-full rounded-md border border-[var(--line)] bg-white px-2.5 text-[12px]"
                            />
                          </div>
                          <button type="submit" className="btn-primary h-8 shrink-0 px-3 text-[12px]">
                            {t.assign}
                          </button>
                        </form>

                        <form action={dismissPendingOrderAction} className="shrink-0">
                          <input type="hidden" name="pendingId" value={row.id} />
                          <button
                            type="submit"
                            title={t.dismissHint}
                            className="text-[11px] font-semibold text-[var(--ink-soft)] underline underline-offset-2 transition hover:text-[var(--ink)]"
                          >
                            {t.dismiss}
                          </button>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
