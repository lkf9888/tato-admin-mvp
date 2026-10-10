"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Ticket, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";

import { CalendarPricePanel } from "@/components/calendar-price-panel";
import { type EditableOrder, OrderDetailModal } from "@/components/order-detail-modal";
import { SearchableSelect } from "@/components/searchable-select";
import { StatusBadge } from "@/components/status-badge";
import { VehicleEditDialog, type VehicleEditDialogVehicle } from "@/components/vehicle-edit-dialog";
import { CalendarFeedDialog } from "@/components/calendar-feed-dialog";
import { RecurringOrderDialog } from "@/components/recurring-order-dialog";
import { type ServiceRecord, ServiceRecordDialog } from "@/components/service-record-dialog";
import { VehicleMonthCalendar } from "@/components/vehicle-month-calendar";
import { VehicleOrdersExportButton } from "@/components/vehicle-orders-export-button";
import {
  CANVAS_FUTURE_DAYS,
  CANVAS_PAST_DAYS,
  chunkIndexesForRange,
  chunkRange,
  columnPosition,
  DAY_IN_MS as CHUNK_DAY_IN_MS,
  PREFETCH_LEAD_DAYS,
  toDayParam,
} from "@/lib/calendar-window";
import { getLocaleTag, getMessages, getStatusLabel, type Locale } from "@/lib/i18n";
import {
  applyRateSeasonality,
  type RateSeasonality,
} from "@/lib/rental-estimate/rate-seasonality";
import { cn, foldLatinLookalikes, formatCurrencyInputText, formatCurrencyInputValue, formatDate, formatDateInputDisplay, formatTime as formatTime24, formatTimeInputDisplay, parseDateTimeInputParts } from "@/lib/utils";
import { SEARCH_FIELD_PROPS } from "@/lib/search-field-props";

type CalendarOrder = EditableOrder;

/** A note pinned to one vehicle over an inclusive run of days. */
type CalendarNote = {
  id: string;
  vehicleId: string;
  startDate: string;
  endDate: string;
  text: string;
};

type VehicleTimelineOption = {
  id: string;
  label: string;
  plateNumber?: string | null;
  secondaryLabel?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  /** Whether this car is actually listed on Turo. Not "has a Turo
   *  order" -- a car can be sold through Turo and have no trips yet,
   *  and a car can have historical Turo trips after being delisted. */
  turoLinked?: boolean;
  /** Listed on the operator's own rental site (direct booking). */
  directBooking?: boolean;
  /** Archived (归档, which 停用 merged into): no new trips, history kept.
   *  Drawn last and dimmed rather than hidden, so its past trips stay on
   *  the calendar where they happened. */
  archived?: boolean;
  editVehicle?: VehicleEditDialogVehicle;
};

type TimelineBar = {
  order: CalendarOrder;
  lane: number;
  left: number;
  width: number;
  clippedStart: boolean;
  clippedEnd: boolean;
};

type ManualOrderDraft = {
  id?: string;
  vehicleId: string;
  renterName: string;
  renterPhone: string;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  totalPrice: string;
};

type OrderPopoverState = {
  isOpen: true;
};

type TuroSyncNotice = {
  kind: "success" | "warning" | "error";
  message: string;
};

type TuroSyncResponse = {
  successRows?: number;
  failedRows?: number;
  createdVehicles?: number;
  updatedVehicles?: number;
  error?: string;
  code?: string;
};

type SearchableFilterOption = {
  value: string;
  label: string;
  searchText?: string;
};

type SearchableFilterDropdownProps = {
  value: string;
  query: string;
  allLabel: string;
  searchPlaceholder: string;
  options: SearchableFilterOption[];
  onValueChange: (value: string) => void;
  onQueryChange: (value: string) => void;
};

const DEFAULT_VEHICLE_COLUMN_WIDTH = 188;
// A 188px sticky column eats half of a 375px phone, leaving barely two
// day columns visible -- the timeline is technically present and
// useless. Narrow it when the viewport is narrow; the row still shows
// the nickname, just with less room around it.
const COMPACT_VEHICLE_COLUMN_WIDTH = 88;
const COMPACT_VIEWPORT_WIDTH = 640;
// What a phone should be able to see at once without scrolling: this
// week and the few days after it. Everything else about the compact
// timeline -- the column width, the row height, the type -- falls out
// of making seven columns fit.
const COMPACT_VISIBLE_DAYS = 7;
const COMPACT_MIN_DAY_COLUMN_WIDTH = 30;
const DAY_COLUMN_WIDTHS = {
  week: 92,
  month: 52,
  sixWeeks: 44,
} as const;
const MIN_DAY_COLUMN_WIDTHS = {
  week: 66,
  month: 34,
  sixWeeks: 28,
} as const;
const DAY_WIDTH_STORAGE_KEY = "tato:calendar-day-width";
const SORT_STORAGE_KEY = "tato:calendar-sort";

/** How the rows are ordered. Plate first because that is how an
 *  operator names a car out loud; by owner when the question is
 *  "what does this owner have out". */
const ROW_SORTS = ["plate", "plateDesc", "owner"] as const;
type RowSort = (typeof ROW_SORTS)[number];

/** "9900-2" before "9900-10". A plain string compare puts the ten
 *  first, which looks like the list is not sorted at all. */
const naturalCompare = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
}).compare;
const MIN_CUSTOM_DAY_WIDTH = 30;
const MAX_CUSTOM_DAY_WIDTH = 104;
const DEFAULT_CUSTOM_DAY_WIDTH = 52;
// Tall enough for two lines: the pickup and return times in the top
// corners, the guest's name centred under them.
const LANE_HEIGHT = 38;
const BAR_HEIGHT = 34;
// The same rows about a third shorter. Desktop heights on a phone made
// four vehicles a full screen; at these, it is closer to nine, which
// is the point of a timeline.
const COMPACT_LANE_HEIGHT = 30;
const COMPACT_BAR_HEIGHT = 27;
const COMPACT_MIN_ROW_HEIGHT = 36;
const MIN_ROW_HEIGHT = 44;
const DAY_IN_MS = CHUNK_DAY_IN_MS;
const SCRUBBER_DAY_RANGE = 365;

/**
 * The canvas is one long strip of dates, not a page of them.
 *
 * It used to be exactly 42 days starting on the Monday of whatever
 * week you had focused, and prev/next swapped one 42-day block for
 * another. That makes "is this car free the week after next" a
 * navigation problem: you cannot see across the seam, and a trip that
 * straddles it is drawn twice, clipped, in two different views.
 *
 * Now every date the calendar can show exists at once and you scroll
 * to it. Which costs nothing in DOM, because of two decisions below:
 * the day cells inside a row are painted as a repeating gradient
 * rather than one element per day (123 cars x 580 days is 71,000
 * divs, and that is what made a long canvas impossible before), and
 * the header cells and booking bars are rendered only for the dates
 * near the viewport.
 */
const CANVAS_START_OFFSET_DAYS = CANVAS_PAST_DAYS;
const CANVAS_TOTAL_DAYS = CANVAS_PAST_DAYS + CANVAS_FUTURE_DAYS;

/** Columns drawn either side of the viewport, so a fast drag does not
 *  outrun the render. */
const COLUMN_OVERSCAN = 10;

/** The note band's own height, and the room a row reserves for it. */
const NOTE_BAND_HEIGHT = 16;

/** Shorter than a note: a cancelled trip is history, not something to
 *  read. It is there so a cancellation can be seen and checked at all
 *  -- the calendar used to drop them server-side, which made "this
 *  trip was cancelled" and "this trip never existed" identical. */
const CANCELLED_BAND_HEIGHT = 12;

/** A repair or service: a yellow label of its own at the foot of the row,
 *  and a pale yellow wash over its days that the trips draw on top of --
 *  so a car in the shop during a booking shows both, neither hidden. */
const SERVICE_BAND_HEIGHT = 15;
/** A gap this short between two trips on one car gets a marker. */
const TURNAROUND_ALERT_MS = 6 * 60 * 60 * 1000;

function startOfDay(value: Date | string) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfWeek(value: Date | string) {
  const date = startOfDay(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function startOfMonth(value: Date | string) {
  const date = startOfDay(value);
  date.setDate(1);
  return date;
}

function addDays(value: Date | string, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function addMonths(value: Date | string, amount: number) {
  const date = new Date(value);
  date.setMonth(date.getMonth() + amount, 1);
  return date;
}

function getDaysInMonth(value: Date | string) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function enumerateDates(start: Date, count: number) {
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

function isSameDay(a: Date | string, b: Date | string) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function orderIntersectsRange(order: CalendarOrder, rangeStart: Date, rangeEndExclusive: Date) {
  return (
    new Date(order.pickupDatetime).getTime() < rangeEndExclusive.getTime() &&
    new Date(order.returnDatetime).getTime() > rangeStart.getTime()
  );
}

function getTimelineBarClasses(
  order: CalendarOrder,
  clippedStart: boolean,
  clippedEnd: boolean,
  compact = false,
  dimmed = false,
  picked = false,
  past = false,
) {
  return cn(
    "absolute flex items-center overflow-hidden border-[1.5px] text-left font-semibold leading-tight text-white shadow-[0_6px_14px_-10px_rgba(17,19,24,0.6)] transition hover:-translate-y-0.5 hover:brightness-110 cursor-pointer",
    // A trip that is over steps back, so the eye lands on what is out
    // now and what goes out next. Still its own colour -- the money
    // state of an old trip is exactly what a month-end check looks for.
    past && !dimmed ? "opacity-55 saturate-[0.6] hover:opacity-100 hover:saturate-100" : "",
    // Search dims rather than hides, so the matches stand out without
    // the rest of the week disappearing.
    dimmed ? "opacity-15 hover:opacity-40" : "",
    // Picked in bulk mode: a ring rather than a colour, so the bar
    // keeps saying what it said about the money.
    picked ? "ring-2 ring-offset-1 ring-[var(--accent)] z-30" : "",
    // 14px of padding either side is most of a 34px column, so a
    // single-day booking would be all padding and no name.
    //
    // `tap-compact` opts out of the 44px touch floor. A bar is a grid
    // cell that happens to be clickable; at the floor's height four
    // vehicles fill a phone screen, which defeats the view. It stays a
    // comfortable target because it is wide.
    compact ? "tap-compact px-1.5 text-[10px]" : "px-3.5 text-[13px]",
    // Conflict and cancellation are the two states that need to stay
    // findable regardless of anything else about the trip, so they
    // still win outright. Below that, green now means "this trip's
    // money is where it belongs" rather than "this trip is offline" --
    // an owner-bound order goes green the moment it is synced to that
    // owner's ledger, on the same reasoning offline orders were
    // already green for: nothing about them is still owed to Turo's
    // own accounting. A synced Turo order and an offline order are
    // the same color on purpose; the source is still one tap away, on
    // the badge inside the order itself, and blue is now specifically
    // "there is money on this trip that has not reached an owner yet"
    // -- the thing a fleet operator actually needs to spot at a glance.
    order.hasConflict
      ? "border-[#c61e22] bg-[#e5484d]"
      : order.status === "cancelled"
        ? "border-slate-500 bg-[var(--ink-soft)]"
        : order.ownerId && order.ownerLedgerSyncedAt
          ? "border-[#1f5b48] bg-[#2f7f67]"
          : order.source === "turo"
            ? "border-[#1f3aa8] bg-[#3456df]"
            : "border-[#1f5b48] bg-[#2f7f67]",
    clippedStart ? "rounded-r-md rounded-l-md" : "rounded-l-md",
    clippedEnd ? "rounded-l-md rounded-r-md" : "rounded-r-md",
  );
}

/**
 * Pack a row's trips into lanes, and say which of them to draw.
 *
 * The packing runs over every loaded trip on the row, not just the
 * ones on screen. Lane assignment is greedy and order-dependent, so
 * packing only the visible subset gives a trip a different lane
 * depending on what else happens to be in view -- which reads as bars
 * jumping between rows, and rows changing height, while you scroll.
 * `renderFrom`/`renderTo` narrow the result afterwards instead.
 */
function assignTimelineBars(
  orders: CalendarOrder[],
  rangeStart: Date,
  rangeEndExclusive: Date,
  dayColumnWidth: number,
  renderFrom: Date,
  renderToExclusive: Date,
) {
  const laneEndTimes: number[] = [];
  const visibleBars: TimelineBar[] = [];
  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = rangeEndExclusive.getTime();

  const sortedOrders = [...orders].sort(
    (left, right) =>
      new Date(left.pickupDatetime).getTime() - new Date(right.pickupDatetime).getTime(),
  );

  for (const order of sortedOrders) {
    const actualStart = new Date(order.pickupDatetime).getTime();
    const actualEnd = new Date(order.returnDatetime).getTime();

    const visibleStart = Math.max(actualStart, rangeStartMs);
    const visibleEnd = Math.min(actualEnd, rangeEndMs);
    if (visibleEnd <= visibleStart) continue;

    let lane = laneEndTimes.findIndex((laneEnd) => visibleStart >= laneEnd);
    if (lane === -1) {
      lane = laneEndTimes.length;
      laneEndTimes.push(visibleEnd);
    } else {
      laneEndTimes[lane] = visibleEnd;
    }

    if (actualEnd <= renderFrom.getTime() || actualStart >= renderToExclusive.getTime()) {
      // Packed into a lane above, so the row keeps its height and every
      // other bar keeps its place -- just not drawn.
      continue;
    }

    visibleBars.push({
      order,
      lane,
      left: columnPosition(visibleStart, rangeStartMs) * dayColumnWidth,
      width: Math.max(
        (columnPosition(visibleEnd, rangeStartMs) - columnPosition(visibleStart, rangeStartMs)) *
          dayColumnWidth,
        18,
      ),
      clippedStart: actualStart < rangeStartMs,
      clippedEnd: actualEnd > rangeEndMs,
    });
  }

  return {
    bars: visibleBars,
    laneCount: laneEndTimes.length,
  };
}

type ToolbarMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  /** A toggle: shows a check when on, and the menu stays open. */
  checked?: boolean;
  disabled?: boolean;
};

const TOOLBAR_MENU_TRIGGER =
  "inline-flex h-9 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-3 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

/**
 * One toolbar button that opens a short list.
 *
 * The calendar's toolbar had grown to eleven buttons in two rows, plus a
 * filter row and a slider row. Related actions now share a menu. On a
 * phone the list spans the screen under its button, so a menu on the
 * right of the row never opens off-screen.
 */
function ToolbarMenu({
  label,
  items = [],
  children,
  primary = false,
  badge,
  align = "left",
}: {
  label: string;
  items?: ToolbarMenuItem[];
  children?: React.ReactNode;
  primary?: boolean;
  badge?: number;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [phoneTop, setPhoneTop] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    if (!open && buttonRef.current && window.innerWidth < 640) {
      setPhoneTop(buttonRef.current.getBoundingClientRect().bottom + 4);
    } else {
      setPhoneTop(null);
    }
    setOpen((value) => !value);
  };

  return (
    <div ref={rootRef} className="relative" data-calendar-menu-open={open ? "" : undefined}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className={cn(
          TOOLBAR_MENU_TRIGGER,
          primary
            ? "border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[#4830d4]"
            : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[rgba(17,19,24,0.22)] hover:bg-[var(--surface-muted)]",
          open && !primary ? "border-[rgba(17,19,24,0.3)]" : "",
        )}
      >
        {label}
        {badge ? (
          <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-bold leading-[16px] text-white">
            {badge}
          </span>
        ) : null}
        <span aria-hidden className="text-[9px] opacity-70">
          {"\u25be"}
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className={cn(
            "z-[70] min-w-[13rem] rounded-lg border border-[var(--line)] bg-white p-1 shadow-[0_18px_44px_-18px_rgba(17,19,24,0.45)]",
            phoneTop === null
              ? cn("absolute top-full mt-1", align === "right" ? "right-0" : "left-0")
              : "fixed inset-x-3",
          )}
          style={phoneTop === null ? undefined : { top: phoneTop }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                if (item.checked === undefined) setOpen(false);
              }}
              className="tap-compact flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span>{item.label}</span>
              {item.checked !== undefined ? (
                <span
                  aria-hidden
                  className={cn("text-[13px] font-bold text-[var(--accent)]", item.checked ? "" : "invisible")}
                >
                  {"\u2713"}
                </span>
              ) : null}
            </button>
          ))}
          {children ? (
            <div className={cn("px-1.5 py-1.5", items.length > 0 && "mt-1 border-t border-[var(--line)] pt-2")}>
              {children}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatWeekday(date: Date, locale: Locale, compact = false) {
  // A phone's day column is about 34px: "MON" plus its letter spacing
  // did not fit and read as "M…". Two letters in English and the bare
  // numeral in Chinese (一, 二) stay distinct -- one letter would make
  // Tuesday and Thursday the same "T".
  // Both Chinese locales: zh-Hant read "Mon" and "October 2026".
  if (compact) {
    if (locale !== "en") {
      return new Intl.DateTimeFormat(getLocaleTag(locale), { weekday: "narrow" }).format(date);
    }
    return new Intl.DateTimeFormat("en-CA", { weekday: "short" }).format(date).slice(0, 2);
  }
  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    weekday: "short",
  }).format(date);
}

function formatTimelineDateLabel(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatMonthTitle(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTime(value: Date | string) {
  return formatTime24(value);
}

function buildCreateDraft(baseDate: Date, vehicleId?: string, lastDay?: Date) {
  const pickup = new Date(baseDate);
  pickup.setHours(10, 0, 0, 0);

  // The return is the morning after the last day picked, which is what
  // "I want the car on these days" means -- picking the 3rd to the 5th
  // and getting it back on the 5th would be two days, not three.
  const returnDatetime = addDays(lastDay ? new Date(lastDay) : pickup, 1);
  returnDatetime.setHours(10, 0, 0, 0);

  return {
    vehicleId: vehicleId ?? "",
    renterName: "",
    renterPhone: "",
    pickupDate: formatDateInputDisplay(pickup),
    pickupTime: formatTimeInputDisplay(pickup),
    returnDate: formatDateInputDisplay(returnDatetime),
    returnTime: formatTimeInputDisplay(returnDatetime),
    totalPrice: "",
  } satisfies ManualOrderDraft;
}

function normalizeFilterText(value: string) {
  // Both sides go through the same fold, so a plate pasted from Turo
  // and one typed by hand are the same search.
  return foldLatinLookalikes(value.trim()).toLowerCase();
}

function includesFilterText(searchText: string, query: string) {
  const normalizedQuery = normalizeFilterText(query);
  return !normalizedQuery || normalizeFilterText(searchText).includes(normalizedQuery);
}

function highlightText(value: string, query: string) {
  const normalizedQuery = normalizeFilterText(query);
  if (!normalizedQuery) return value;

  const lowerValue = value.toLowerCase();
  const matchIndex = lowerValue.indexOf(normalizedQuery);
  if (matchIndex === -1) return value;

  const before = value.slice(0, matchIndex);
  const match = value.slice(matchIndex, matchIndex + normalizedQuery.length);
  const after = value.slice(matchIndex + normalizedQuery.length);

  return (
    <>
      {before}
      <mark className="rounded bg-[rgba(255,231,122,0.72)] px-0.5 text-inherit">{match}</mark>
      {after}
    </>
  );
}

function buildVehicleTimelineSearchText(vehicle: VehicleTimelineOption) {
  return [
    vehicle.label,
    vehicle.plateNumber,
    vehicle.secondaryLabel,
    vehicle.ownerName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildOrderTimelineSearchText(order: CalendarOrder, locale: Locale) {
  return [
    order.renterName,
    order.renterPhone,
    order.vehicleName,
    order.vehiclePlateNumber,
    order.ownerName,
    order.notes,
    order.source,
    getStatusLabel(order.source, locale),
    getStatusLabel(order.status, locale),
    formatCurrencyInputValue(order.totalPrice),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function SearchableFilterDropdown({
  value,
  query,
  allLabel,
  searchPlaceholder,
  options,
  onValueChange,
  onQueryChange,
}: SearchableFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const normalizedQuery = normalizeFilterText(query);
  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions = options.filter((option) =>
    includesFilterText(`${option.label} ${option.searchText ?? ""}`, query),
  );
  const buttonLabel =
    value !== "all" && selectedOption
      ? selectedOption.label
      : normalizedQuery
        ? `${allLabel}: ${query.trim()}`
        : allLabel;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={dropdownRef} className="relative min-w-0 flex-1 sm:flex-none">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-left text-[12px] font-medium text-[var(--ink)] outline-none transition hover:border-[rgba(17,19,24,0.22)] focus:border-[rgba(17,19,24,0.3)] sm:w-44 lg:w-48"
      >
        <span className="truncate">{highlightText(buttonLabel, query)}</span>
        <span className="text-[10px] text-[var(--ink-soft)]">⌄</span>
      </button>

      {open ? (
        <div className="absolute left-0 top-10 z-[70] w-full min-w-[16rem] rounded-lg border border-[var(--line)] bg-white p-2 shadow-[0_22px_52px_-28px_rgba(17,19,24,0.55)]">
          <input
            type="search"
            {...SEARCH_FIELD_PROPS}
            value={query}
            onChange={(event) => {
              onValueChange("all");
              onQueryChange(event.target.value);
            }}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-[12px] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--line)]"
            autoFocus
          />
          <div className="mt-2 max-h-56 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onValueChange("all");
                onQueryChange("");
                setOpen(false);
              }}
              className="w-full rounded-md px-2.5 py-2 text-left text-[12px] font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
            >
              {allLabel}
            </button>
            {filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onValueChange(option.value);
                  onQueryChange("");
                  setOpen(false);
                }}
                className={cn(
                  "w-full rounded-md px-2.5 py-2 text-left text-[12px] text-[var(--ink-mid)] hover:bg-[var(--surface-muted)]",
                  value === option.value ? "bg-[var(--surface-muted)] font-semibold text-[var(--ink)]" : "",
                )}
              >
                {highlightText(option.label, query)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CalendarView({
  locale,
  orders: serverOrders,
  loadedChunkIndexes,
  vehicleOptions,
  ownerOptions,
  pricing,
  readOnly = false,
  maskSensitive = false,
  limitedToVehicles = false,
}: {
  locale: Locale;
  /**
   * A member who sees only some cars. The server refuses them the
   * fleet-wide tools -- search across all trips, notes, recurring
   * orders, calendar feeds, bulk sync, adding a car -- so those are not
   * offered; before, each was a button that always failed.
   */
  limitedToVehicles?: boolean;
  /** The chunks the server already rendered, so the grid opens with
   *  bars on it rather than fetching its own first screen. */
  orders: CalendarOrder[];
  /** Which chunks those orders cover. Without it the grid would not
   *  know what it already has and would re-fetch its own first paint. */
  loadedChunkIndexes?: number[];
  vehicleOptions: VehicleTimelineOption[];
  ownerOptions: Array<{ id: string; label: string }>;
  /**
   * What each day costs, in the three pieces the grid needs to resolve
   * it itself: one base rate per car, the days priced by hand, and the
   * seasonal curve -- nineteen numbers, so working out a day in the
   * browser costs nothing and runs the same function the server bills
   * from. Absent on the read-only share view, which has no business
   * showing prices.
   */
  pricing?: {
    seasonality: RateSeasonality;
    overrides: Record<string, Record<string, number>>;
    /** Per car, the days whose price dynamic pricing set. */
    dynamicDays?: Record<string, string[]>;
    rates: Record<string, { baseRate: number; source: "manual" | "suggested"; bookable?: boolean }>;
  };
  readOnly?: boolean;
  maskSensitive?: boolean;
}) {
  const router = useRouter();
  const messages = getMessages(locale);
  const calendarMessages = messages.calendar;
  const [selectedVehicleId, setSelectedVehicleId] = useState("all");
  const [selectedOwnerId, setSelectedOwnerId] = useState("all");
  const [selectedSource, setSelectedSource] = useState("all");
  const [calendarSearchQuery, setCalendarSearchQuery] = useState("");
  const [vehicleFilterQuery, setVehicleFilterQuery] = useState("");
  const [ownerFilterQuery, setOwnerFilterQuery] = useState("");
  const [sourceFilterQuery, setSourceFilterQuery] = useState("");
  const [customDayWidth, setCustomDayWidth] = useState(DEFAULT_CUSTOM_DAY_WIDTH);
  const [rowSort, setRowSort] = useState<RowSort>("plate");
  const [isAddVehicleOpen, setIsAddVehicleOpen] = useState(false);
  const [monthCalendarFor, setMonthCalendarFor] = useState<string | null>(null);
  const [isRecurringOpen, setIsRecurringOpen] = useState(false);
  const [isFeedOpen, setIsFeedOpen] = useState(false);
  // --- Searching every trip, not just the loaded ones -----------------
  const [searchHits, setSearchHits] = useState<CalendarOrder[]>([]);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchListOpen, setSearchListOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<CalendarOrder | null>(null);
  const [isOrderDialogOpen, setIsOrderDialogOpen] = useState(false);
  const [orderDraft, setOrderDraft] = useState<ManualOrderDraft>(() =>
    buildCreateDraft(new Date(), vehicleOptions[0]?.id),
  );
  const [orderFormError, setOrderFormError] = useState<string | null>(null);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  // Every control the timeline has, stacked on a 375px screen, comes
  // to well over a screen's worth of chrome before the first bar --
  // the timeline was reachable only by scrolling past all of it. Below
  // `lg` the search, the filters, the secondary actions and the two
  // scrubbers fold away behind one button, leaving prev / next /
  // today, which is what moving around a calendar actually needs.
  /** Bumped to open the export dialog from the Tools menu. */
  const [exportSignal, setExportSignal] = useState(0);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  // Drag-to-pan state. Refs rather than state on purpose: this runs on
  // every pointer move, and re-rendering a grid of several hundred bars
  // at pointer rate is how a smooth drag becomes a stuttering one.
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    lastX: number;
    lastT: number;
    velocity: number;
    moved: boolean;
  } | null>(null);
  const momentumRef = useRef<number | null>(null);
  // The "back N days" readout during a drag. A ref and direct DOM
  // writes, not state: the whole reason the drag handler works on refs
  // is that re-rendering several hundred bars at pointer rate turns a
  // smooth drag into a stuttering one, and routing a label through
  // React would undo exactly that.
  const panPillRef = useRef<HTMLDivElement | null>(null);
  const panPillLabelRef = useRef<(days: number) => string>(() => "");
  const dayColumnWidthRef = useRef(DEFAULT_CUSTOM_DAY_WIDTH);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState<number | null>(null);
  const [orderPopover, setOrderPopover] = useState<OrderPopoverState | null>(null);
  const [isTuroSyncing, setIsTuroSyncing] = useState(false);
  const [turoSyncNotice, setTuroSyncNotice] = useState<TuroSyncNotice | null>(null);

  // --- Orders that arrive as you scroll -------------------------------
  //
  // Two stores, because they are filled at different times. The
  // server's chunks are built during render -- effects do not run on
  // the server, so seeding them in one would ship a grid with no bars
  // on it and fill them in only after hydration. Chunks fetched here
  // live in a ref, written from async callbacks that must not race
  // each other; `chunkTick` is what asks React to paint once one lands.
  //
  // Per chunk rather than one flat list so a refetch can replace a
  // stretch of calendar wholesale. A flat merge cannot express
  // deletion: an order removed on the server would stay on screen
  // forever, because "not in the new response" is indistinguishable
  // from "not in this response's date range".
  //
  // Without `loadedChunkIndexes` -- the owner's share page, whose
  // visitor has no session to fetch with -- the orders handed in are
  // the whole story: each is filed under every chunk it touches and
  // nothing is fetched. That page used to fall through to a default
  // `[]`, a new array every render: every order was dropped as "not in
  // a covered chunk", and the memo, the reset effect below and the
  // render chased each other in a loop of failing fetches. Owners saw
  // an empty calendar.
  const fetchesChunks = loadedChunkIndexes !== undefined;
  const serverChunks = useMemo(() => {
    const store = new Map<number, CalendarOrder[]>();
    for (const index of loadedChunkIndexes ?? []) store.set(index, []);
    for (const order of serverOrders) {
      for (const index of chunkIndexesForRange(
        new Date(order.pickupDatetime),
        new Date(order.returnDatetime),
      )) {
        // Only into chunks the server actually covered. A long rental
        // reaching past the server's window must not mark the chunk it
        // reaches into as loaded -- that chunk holds other orders the
        // server never sent.
        if (!loadedChunkIndexes && !store.has(index)) store.set(index, []);
        store.get(index)?.push(order);
      }
    }
    return store;
  }, [serverOrders, loadedChunkIndexes]);

  const fetchedChunksRef = useRef(new Map<number, CalendarOrder[]>());
  const inFlightChunksRef = useRef(new Set<number>());
  // Two counters, because they answer different questions. `chunkTick`
  // means "a chunk landed, repaint". `storeVersion` means "everything
  // you hold may be stale, fetch it again" -- only a fresh render of
  // the page sets that, and the fetcher watches it.
  const [chunkTick, setChunkTick] = useState(0);
  const [storeVersion, setStoreVersion] = useState(0);
  const [isLoadingChunks, setIsLoadingChunks] = useState(false);
  const [chunkError, setChunkError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // --- Picking days, and picking trips -------------------------------
  //
  // Two selections, and they are mutually exclusive on purpose. Days
  // are picked on the empty grid to say "do something to this stretch
  // of this car's calendar"; trips are picked on the bars to say "do
  // something to these bookings". A click cannot mean both, so turning
  // one on clears the other.
  //
  // The day selection is a *set*, not a range: click a day to pick it
  // and make it the anchor, click a second to fill everything between,
  // click a picked day to drop it again. That allows holes, which
  // matters for a note ("servicing, Mondays") and is exactly why
  // creating an order from it insists on an unbroken run instead.
  const [daySelection, setDaySelection] = useState<{
    vehicleId: string;
    days: string[];
    anchor: string | null;
  } | null>(null);
  // Prices ride on the same gesture as everything else here: pick a
  // stretch of a car's row, then act on it. The toggle only decides
  // whether the numbers are drawn; they are on by default, and only
  // for cars open for direct booking, on the days they are free.
  const [showPrices, setShowPrices] = useState(true);
  const [pricePanel, setPricePanel] = useState<{ vehicleIds: string[]; days: string[] } | null>(
    null,
  );
  const [priceOverrides, setPriceOverrides] = useState(pricing?.overrides ?? {});
  useEffect(() => {
    setPriceOverrides(pricing?.overrides ?? {});
  }, [pricing?.overrides]);
  const [dynamicDays, setDynamicDays] = useState(
    () => new Set(Object.entries(pricing?.dynamicDays ?? {}).flatMap(([id, days]) => days.map((day) => `${id}:${day}`))),
  );
  useEffect(() => {
    setDynamicDays(
      new Set(Object.entries(pricing?.dynamicDays ?? {}).flatMap(([id, days]) => days.map((day) => `${id}:${day}`))),
    );
  }, [pricing?.dynamicDays]);

  /**
   * What a day costs, resolved exactly as the server does: a price set
   * on that day, then the model's price for that day, then the car's
   * flat rate. A car nobody has priced returns null and draws nothing.
   */
  // Day prices in the cells: the currency's narrow symbol ("$", not
  // "CA$") and whole dollars, so "$147" still fits a 34px phone column.
  const dayPriceFormat = useMemo(
    () =>
      new Intl.NumberFormat(getLocaleTag(locale), {
        style: "currency",
        currency: "CAD",
        currencyDisplay: "narrowSymbol",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
    [locale],
  );

  const resolveDayPrice = useMemo(() => {
    const seasonality = pricing?.seasonality;
    const rates = pricing?.rates ?? {};
    return (
      vehicleId: string,
      dayKey: string,
    ): { price: number; fixed: boolean; dynamic?: boolean } | null => {
      const override = priceOverrides[vehicleId]?.[dayKey];
      if (typeof override === "number" && override > 0) {
        return { price: override, fixed: true, dynamic: dynamicDays.has(`${vehicleId}:${dayKey}`) };
      }

      const rate = rates[vehicleId];
      if (!rate || rate.baseRate <= 0) return null;
      if (rate.source !== "suggested" || !seasonality || seasonality.sampleSize === 0) {
        return { price: rate.baseRate, fixed: false };
      }
      return {
        price: applyRateSeasonality(
          rate.baseRate,
          new Date(`${dayKey}T12:00:00.000Z`),
          seasonality,
        ),
        fixed: false,
      };
    };
  }, [pricing?.seasonality, pricing?.rates, priceOverrides, dynamicDays]);

  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [notes, setNotes] = useState<CalendarNote[]>([]);
  const [serviceRecords, setServiceRecords] = useState<ServiceRecord[]>([]);
  const [serviceDialog, setServiceDialog] = useState<
    { record: ServiceRecord } | { seed: { vehicleId: string; startDate: string; endDate: string } } | null
  >(null);

  // Horizontal scroll position, sampled once per frame. Three things
  // read it: which header cells to render, which bars to render, and
  // which chunks to fetch next.
  const [scrollLeft, setScrollLeft] = useState(0);

  // A fresh render of the page -- which is what `router.refresh()`
  // produces after any edit -- makes everything fetched here possibly
  // stale, so it is dropped and the prefetch effect reloads whatever
  // is on screen.
  useEffect(() => {
    // New objects rather than cleared ones: a request still in flight
    // holds the old pair and lands in them, out of the way.
    fetchedChunksRef.current = new Map();
    inFlightChunksRef.current = new Set();
    setChunkError(false);
    setStoreVersion((version) => version + 1);
  }, [serverChunks]);

  // Everything held, from both stores, de-duplicated. An order that
  // straddles a chunk boundary is filed under both, so the map is what
  // keeps it from being drawn twice.
  const orders = useMemo(() => {
    const byId = new Map<string, CalendarOrder>();
    for (const bucket of serverChunks.values()) {
      for (const order of bucket) byId.set(order.id, order);
    }
    for (const bucket of fetchedChunksRef.current.values()) {
      for (const order of bucket) byId.set(order.id, order);
    }
    return Array.from(byId.values());
    // chunkTick is the signal that the fetched store changed; it is a
    // ref precisely so a landing chunk does not re-render twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverChunks, chunkTick, storeVersion]);

  // Grab the timeline and throw it.
  //
  // The wheel scrolls vertically and the horizontal scrollbar is a
  // 4px target at the bottom of a tall pane, so moving through weeks
  // meant either shift-scrolling or hunting for the bar. Dragging the
  // surface is what the gesture wants to be.
  //
  // Three details make it feel right rather than technically working:
  // a small threshold before the drag starts, so a click on a bar is
  // still a click; pointer capture, so leaving the element mid-drag
  // does not strand it; and momentum on release, because a timeline
  // that stops dead the instant you let go feels stuck to the finger.
  useEffect(() => {
    const node = timelineViewportRef.current;
    if (!node) return;

    const stopMomentum = () => {
      if (momentumRef.current !== null) {
        cancelAnimationFrame(momentumRef.current);
        momentumRef.current = null;
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      // Touch drags the timeline too, and `touch-action: pan-y` on the
      // viewport is what makes that safe: the browser keeps vertical
      // panning for itself and hands us the horizontal component as
      // ordinary pointer events. Nothing moves twice and nothing has
      // to preventDefault its way past native scrolling.
      //
      // Leaving both axes to the browser was the earlier call, on the
      // reasoning that native panning does it better. It does -- when
      // it runs. This pane is a 5,000px vertical scroller with 123
      // cars in it, so the platform's axis lock reads almost every
      // swipe as vertical and drops the sideways component. The
      // timeline stays put, which is exactly what "dragging sideways
      // does nothing" looks like from the outside.
      //
      // Middle and right buttons still belong to the OS.
      if (event.button !== 0) return;

      // Only text controls are excluded, and that is the fix.
      //
      // This used to bail on `button, a, [role=button]` too, on the
      // reasoning that anything clickable should keep its click. The
      // timeline is almost entirely buttons -- every booking bar is
      // one, and so is every plate in the sticky column -- so the
      // places a person naturally grabs were exactly the places where
      // dragging did nothing. Which is what "dragging does not work"
      // looks like from the outside.
      //
      // Nothing is lost by allowing it: the 4px threshold below still
      // treats a press-and-release as a click, and a real drag
      // swallows the click that follows it. A bar can be both a thing
      // you press and a thing you drag from.
      if ((event.target as HTMLElement).closest("input, select, textarea, [contenteditable]")) {
        return;
      }
      stopMomentum();
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: node.scrollLeft,
        lastX: event.clientX,
        lastT: event.timeStamp,
        velocity: 0,
        moved: false,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const dx = event.clientX - drag.startX;
      // Below the threshold this is still a click, not a drag.
      if (!drag.moved) {
        if (Math.abs(dx) < 4) return;
        // A finger scrolling down the vehicle list wanders sideways by
        // a few pixels on the way, and taking the gesture on that would
        // drag the dates along under the thumb. The browser settles the
        // same question for its own panning by whichever axis leads, so
        // this waits for the same answer before claiming the gesture.
        if (
          event.pointerType === "touch" &&
          Math.abs(dx) <= Math.abs(event.clientY - drag.startY)
        ) {
          return;
        }
        drag.moved = true;
        // Capture is an optimisation -- it keeps the drag alive when
        // the cursor leaves the element -- and it was written as a
        // precondition. `setPointerCapture` throws whenever the
        // browser does not consider that pointer capturable, and the
        // throw aborted the handler before the line below, so the
        // whole drag silently did nothing. Scrolling must not depend
        // on it succeeding.
        try {
          node.setPointerCapture(event.pointerId);
        } catch {
          // Without capture the drag still works; it just ends early
          // if the cursor leaves the timeline.
        }
        node.style.cursor = "grabbing";
        node.style.userSelect = "none";
        if (panPillRef.current) panPillRef.current.style.opacity = "1";
      }

      node.scrollLeft = drag.startScrollLeft - dx;

      if (panPillRef.current) {
        const movedDays = Math.round(-dx / Math.max(dayColumnWidthRef.current, 1));
        panPillRef.current.textContent = panPillLabelRef.current(movedDays);
      }

      const dt = event.timeStamp - drag.lastT;
      if (dt > 0) {
        // Smoothed, so one jittery sample near release does not fling
        // the view across a month.
        const instant = (event.clientX - drag.lastX) / dt;
        drag.velocity = drag.velocity * 0.7 + instant * 0.3;
        drag.lastX = event.clientX;
        drag.lastT = event.timeStamp;
      }
    };

    const endDrag = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      node.style.cursor = "";
      node.style.userSelect = "";
      if (panPillRef.current) panPillRef.current.style.opacity = "0";
      try {
        if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      } catch {
        // Same reasoning as the capture above.
      }
      if (!drag.moved) return;

      // A drag that ends in a click would open whatever bar is under
      // the cursor. Swallow exactly one click, in the capture phase so
      // it never reaches the bar's own handler.
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      node.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => node.removeEventListener("click", swallow, { capture: true }), 0);

      // Clamped, then decayed harder than before.
      //
      // Total glide is roughly velocity * 16 / (1 - decay), so at 0.94
      // every 1px/ms of release speed bought 267px of travel -- a
      // 300px drag measured 1,212px of scroll, four weeks past where
      // it was let go. At 0.88 that is 133px, and the clamp stops a
      // fast flick from launching regardless.
      const MAX_VELOCITY = 1.6; // px per ms
      let velocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, drag.velocity));
      if (Math.abs(velocity) < 0.05) return;

      const step = () => {
        velocity *= 0.88;
        node.scrollLeft -= velocity * 16;
        if (Math.abs(velocity) < 0.02) {
          momentumRef.current = null;
          return;
        }
        momentumRef.current = requestAnimationFrame(step);
      };
      momentumRef.current = requestAnimationFrame(step);
    };

    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("pointermove", onPointerMove);
    node.addEventListener("pointerup", endDrag);
    node.addEventListener("pointercancel", endDrag);
    // A fresh drag or a wheel should cut momentum short rather than
    // compete with it.
    node.addEventListener("wheel", stopMomentum, { passive: true });

    return () => {
      stopMomentum();
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", endDrag);
      node.removeEventListener("pointercancel", endDrag);
      node.removeEventListener("wheel", stopMomentum);
    };
  }, []);

  // Layout effect, so the first width is known before the first paint
  // after hydration: measured afterwards, a phone painted the desktop
  // layout -- 188px plate column, "MON" headers -- and then jumped.
  useLayoutEffect(() => {
    const node = timelineViewportRef.current;
    if (!node) return;

    // Zero is "hidden" (the phone's List tab sets display:none), not a
    // width. Taking it made the grid re-derive its focus date from the
    // desktop column width, and the address bar jumped two months back.
    const syncWidth = () => {
      if (node.clientWidth > 0) setTimelineViewportWidth(node.clientWidth);
    };

    syncWidth();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const width = Math.round(entry?.contentRect.width ?? node.clientWidth);
      if (width > 0) setTimelineViewportWidth(width);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Horizontal scroll position, sampled once per frame.
  //
  // `scroll` fires far faster than React can usefully re-render a grid
  // this size, and every sample that is not painted is wasted work on
  // the exact gesture that most needs the frame budget. One rAF per
  // burst, and only when the value actually moved a whole pixel.
  useEffect(() => {
    const node = timelineViewportRef.current;
    if (!node) return;
    let frame: number | null = null;

    const sample = () => {
      frame = null;
      setScrollLeft((previous) =>
        Math.abs(previous - node.scrollLeft) < 1 ? previous : node.scrollLeft,
      );
    };

    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(sample);
    };

    sample();
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      node.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Which `orders` the open panel was last synced against. The swap
  // below is for when the data changes under an open panel -- not for
  // when the panel hands back the order it just saved: then `orders`
  // still holds the pre-save copy until the refresh lands, and swapping
  // that back in reset the panel to the old values for a moment.
  const syncedOrdersRef = useRef<CalendarOrder[] | null>(null);
  useEffect(() => {
    if (!selectedOrder) return;
    const ordersChanged = syncedOrdersRef.current !== orders;
    syncedOrdersRef.current = orders;

    const refreshedOrder = orders.find((order) => order.id === selectedOrder.id);
    if (refreshedOrder && refreshedOrder !== selectedOrder) {
      if (ordersChanged) setSelectedOrder(refreshedOrder);
      return;
    }

    if (!refreshedOrder) {
      // Absent from the loaded data means "deleted" only if we would
      // have loaded it. A trip found by searching all history sits
      // outside the fetched chunks by definition, and closing its
      // panel the instant it opened made every out-of-window search
      // result look like a dead link.
      const chunks = chunkIndexesForRange(
        new Date(selectedOrder.pickupDatetime),
        new Date(selectedOrder.returnDatetime),
      );
      const wouldHaveLoaded = chunks.some(
        (index) => serverChunks.has(index) || fetchedChunksRef.current.has(index),
      );
      if (wouldHaveLoaded) setSelectedOrder(null);
    }
  }, [orders, selectedOrder, serverChunks]);

  useEffect(() => {
    if (!selectedOrder) {
      setOrderPopover(null);
    }
  }, [selectedOrder]);

  // Escape drops whichever selection is active. It already closes the
  // order panel; a selection is the same kind of "I am in the middle
  // of something" state and should come off the same way.
  useEffect(() => {
    if (!daySelection && !bulkMode) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The order panel is in front; let it have the key first.
      if (orderPopover) return;
      // So are a dialog and a toolbar menu. Escape closing one of those
      // also threw away bulk mode and every trip picked in it.
      if (
        event.defaultPrevented ||
        monthCalendarFor ||
        isFeedOpen ||
        isRecurringOpen ||
        isAddVehicleOpen ||
        serviceDialog ||
        pricePanel ||
        document.querySelector("[data-calendar-menu-open]")
      ) {
        return;
      }
      if (daySelection) {
        clearDaySelection();
        return;
      }
      setBulkMode(false);
      setBulkSelection(new Set());
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    daySelection,
    bulkMode,
    orderPopover,
    monthCalendarFor,
    isFeedOpen,
    isRecurringOpen,
    isAddVehicleOpen,
    serviceDialog,
    pricePanel,
  ]);

  useEffect(() => {
    if (!orderPopover) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // A field being edited takes Escape as "cancel this edit" and
      // marks it handled; closing the whole panel on the same key threw
      // the operator out of the order they were in the middle of.
      if (event.key === "Escape" && !event.defaultPrevented) {
        setOrderPopover(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [orderPopover]);

  const vehicleFilterOptions = useMemo(
    () =>
      vehicleOptions.map((vehicle) => ({
        value: vehicle.id,
        label: vehicle.plateNumber ? `${vehicle.plateNumber} · ${vehicle.label}` : vehicle.label,
        searchText: buildVehicleTimelineSearchText(vehicle),
      })),
    [vehicleOptions],
  );
  const ownerFilterOptions = useMemo(
    () =>
      ownerOptions.map((owner) => ({
        value: owner.id,
        label: owner.label,
        searchText: owner.label,
      })),
    [ownerOptions],
  );
  const sourceFilterOptions = useMemo(
    () => [
      {
        value: "turo",
        label: getStatusLabel("turo", locale),
        searchText: `turo ${getStatusLabel("turo", locale)}`,
      },
      {
        value: "offline",
        label: getStatusLabel("offline", locale),
        searchText: `offline ${getStatusLabel("offline", locale)}`,
      },
    ],
    [locale],
  );
  // Fixed for the session rather than recomputed each render. Every
  // date on the canvas is positioned relative to it, so a value that
  // moved would shift the whole strip under the viewport.
  const today = useMemo(() => startOfDay(new Date()), []);
  // The clock, for what does move: the now line, which column says
  // "today", and which trips count as over. Ticks once a minute -- a
  // tab left open overnight kept yesterday highlighted. Null until
  // mounted, so the server's render and the browser's first one agree.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  // Keyed on the local date. `toDayParam` is the UTC date, which in
  // Vancouver turns over at 17:00 -- the column would have stayed on
  // yesterday all morning.
  const nowDayKey = now ? `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nowDay = useMemo(() => (now ? startOfDay(now) : today), [nowDayKey, today]);
  // Anchored to a Monday. The weekend shading below is a repeating
  // gradient, which only works if the phase of the week is known from
  // the canvas origin.
  const canvasStart = useMemo(
    () => startOfWeek(addDays(today, -CANVAS_START_OFFSET_DAYS)),
    [today],
  );
  const visibleDayCount = CANVAS_TOTAL_DAYS;
  const days = useMemo(
    () => enumerateDates(canvasStart, visibleDayCount),
    [canvasStart, visibleDayCount],
  );
  const rangeStart = canvasStart;
  // Memoised, and it has to be: `addDays` returns a new Date, so an
  // effect listing this in its deps re-runs on every single render.
  // The notes fetch did, and its setState fed the next render -- an
  // endless request loop that also starved the click handlers.
  const rangeEndExclusive = useMemo(
    () => addDays(rangeStart, visibleDayCount),
    [rangeStart, visibleDayCount],
  );

  const normalizedVehicleFilterQuery = normalizeFilterText(vehicleFilterQuery);
  const normalizedOwnerFilterQuery = normalizeFilterText(ownerFilterQuery);
  const normalizedSourceFilterQuery = normalizeFilterText(sourceFilterQuery);
  const normalizedCalendarSearchQuery = normalizeFilterText(calendarSearchQuery);

  const filteredVehicles = vehicleOptions.filter((vehicle) => {
    if (selectedVehicleId !== "all" && vehicle.id !== selectedVehicleId) return false;
    if (
      selectedVehicleId === "all" &&
      normalizedVehicleFilterQuery &&
      !buildVehicleTimelineSearchText(vehicle).includes(normalizedVehicleFilterQuery)
    ) {
      return false;
    }
    if (!readOnly && selectedOwnerId !== "all" && vehicle.ownerId !== selectedOwnerId) return false;
    if (
      !readOnly &&
      selectedOwnerId === "all" &&
      normalizedOwnerFilterQuery &&
      !(vehicle.ownerName ?? calendarMessages.unassignedOwner)
        .toLowerCase()
        .includes(normalizedOwnerFilterQuery)
    ) {
      return false;
    }
    if (
      normalizedCalendarSearchQuery &&
      !buildVehicleTimelineSearchText(vehicle).includes(normalizedCalendarSearchQuery) &&
      !orders.some(
        (order) =>
          order.vehicleId === vehicle.id &&
          buildOrderTimelineSearchText(order, locale).includes(normalizedCalendarSearchQuery),
      )
    ) {
      return false;
    }
    return true;
  });

  const filteredOrders = orders.filter((order) => {
    // Cancelled trips are handled separately, below: they are drawn as
    // a strip rather than a bar, and they must not take a lane or the
    // row would grow for a trip that is not happening.
    if (order.status === "cancelled") return false;
    if (selectedVehicleId !== "all" && order.vehicleId !== selectedVehicleId) return false;
    if (
      selectedVehicleId === "all" &&
      normalizedVehicleFilterQuery &&
      ![
        order.vehiclePlateNumber,
        order.vehicleName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedVehicleFilterQuery)
    ) {
      return false;
    }
    if (selectedSource !== "all" && order.source !== selectedSource) return false;
    if (
      selectedSource === "all" &&
      normalizedSourceFilterQuery &&
      !`${order.source} ${getStatusLabel(order.source, locale)}`
        .toLowerCase()
        .includes(normalizedSourceFilterQuery)
    ) {
      return false;
    }
    if (!readOnly && selectedOwnerId !== "all" && order.ownerId !== selectedOwnerId) return false;
    if (
      !readOnly &&
      selectedOwnerId === "all" &&
      normalizedOwnerFilterQuery &&
      !(order.ownerName ?? calendarMessages.unassignedOwner)
        .toLowerCase()
        .includes(normalizedOwnerFilterQuery)
    ) {
      return false;
    }
    // Deliberately not filtered by the free-text search. A row that
    // survives the search keeps all of its trips, and the ones that do
    // not match are dimmed instead -- dropping them leaves gaps that
    // read as "this car is free then", which is the one thing the
    // calendar must never say wrongly.
    return true;
  });

  // Sorted after filtering, not before: the server hands rows over in
  // plate order, and re-sorting a filtered list is cheap while sorting
  // the whole fleet on every keystroke is not.
  const sortedVehicles = useMemo(() => {
    const rows = [...filteredVehicles];
    const plateOf = (vehicle: VehicleTimelineOption) => vehicle.plateNumber || vehicle.label;
    if (rowSort === "plateDesc") {
      rows.sort((left, right) => naturalCompare(plateOf(right), plateOf(left)));
    } else if (rowSort === "owner") {
      // Cars with no owner go last rather than sorting as an empty
      // string, which would put them first -- the opposite of what
      // "group by owner" is for.
      rows.sort((left, right) => {
        const leftOwner = left.ownerName ?? "";
        const rightOwner = right.ownerName ?? "";
        if (!leftOwner !== !rightOwner) return leftOwner ? -1 : 1;
        const byOwner = naturalCompare(leftOwner, rightOwner);
        return byOwner !== 0 ? byOwner : naturalCompare(plateOf(left), plateOf(right));
      });
    } else {
      rows.sort((left, right) => naturalCompare(plateOf(left), plateOf(right)));
    }
    // Archived cars after the fleet in use, whatever the sort. A stable
    // sort, so each group keeps the order chosen above.
    rows.sort((left, right) => Number(Boolean(left.archived)) - Number(Boolean(right.archived)));
    return rows;
  }, [filteredVehicles, rowSort]);

  // The same filters, for the trips that were called off. Kept apart
  // from `filteredOrders` so they never take a lane, never count as
  // "bookings in view", and never make a row taller.
  const cancelledOrders = orders.filter((order) => {
    if (order.status !== "cancelled") return false;
    if (selectedVehicleId !== "all" && order.vehicleId !== selectedVehicleId) return false;
    if (selectedSource !== "all" && order.source !== selectedSource) return false;
    if (!readOnly && selectedOwnerId !== "all" && order.ownerId !== selectedOwnerId) return false;
    return true;
  });

  const orderMatchesSearch = (order: CalendarOrder) =>
    !normalizedCalendarSearchQuery ||
    buildOrderTimelineSearchText(order, locale).includes(normalizedCalendarSearchQuery);


  const compact =
    timelineViewportWidth !== null && timelineViewportWidth < COMPACT_VIEWPORT_WIDTH;
  const vehicleColumnWidth = compact
    ? COMPACT_VEHICLE_COLUMN_WIDTH
    : DEFAULT_VEHICLE_COLUMN_WIDTH;
  const laneHeight = compact ? COMPACT_LANE_HEIGHT : LANE_HEIGHT;
  const barHeight = compact ? COMPACT_BAR_HEIGHT : BAR_HEIGHT;
  const barTopOffset = compact ? 4 : 6;
  const minRowHeight = compact ? COMPACT_MIN_ROW_HEIGHT : MIN_ROW_HEIGHT;
  const fittedTimelineWidth = Math.max((timelineViewportWidth ?? 0) - vehicleColumnWidth, 0);
  // A phone divides the width it has by seven and takes that, rather
  // than reading the day-width slider. The slider is a desktop control
  // -- it lives inside the collapsed filter panel here -- and a value
  // set on a 1400px screen means nothing on a 375px one.
  const dayColumnWidth =
    compact && fittedTimelineWidth > 0
      ? Math.max(
          COMPACT_MIN_DAY_COLUMN_WIDTH,
          Math.floor(fittedTimelineWidth / COMPACT_VISIBLE_DAYS),
        )
      : Math.max(MIN_CUSTOM_DAY_WIDTH, customDayWidth || DEFAULT_CUSTOM_DAY_WIDTH);
  const timelineWidth = days.length * dayColumnWidth;
  const tableWidth = Math.max(vehicleColumnWidth + timelineWidth, timelineViewportWidth ?? 0);

  // --- What is actually on screen ------------------------------------
  //
  // One derivation, three consumers: the header renders these columns,
  // the rows render the bars that fall inside them, and the fetcher
  // loads the chunks they touch. Everything else on the 580-day canvas
  // is real, positioned and scrollable -- it simply is not in the DOM
  // until you scroll to it.
  const viewportDays = Math.max(
    1,
    Math.ceil(Math.max(fittedTimelineWidth, 1) / Math.max(dayColumnWidth, 1)),
  );
  const firstVisibleDayIndex = Math.max(
    0,
    Math.floor(scrollLeft / Math.max(dayColumnWidth, 1)) - COLUMN_OVERSCAN,
  );
  const lastVisibleDayIndex = Math.min(
    days.length - 1,
    firstVisibleDayIndex + viewportDays + COLUMN_OVERSCAN * 2,
  );
  const visibleDays = useMemo(
    () =>
      days
        .slice(firstVisibleDayIndex, lastVisibleDayIndex + 1)
        .map((date, offset) => ({ date, index: firstVisibleDayIndex + offset })),
    [days, firstVisibleDayIndex, lastVisibleDayIndex],
  );
  const visibleRangeStart = days[firstVisibleDayIndex] ?? rangeStart;
  const visibleRangeEndInclusive = days[lastVisibleDayIndex] ?? rangeStart;
  // A screenful, minus a couple of days of overlap so the edge you were
  // reading is still on screen after the jump.
  const pageStrideDays = Math.max(1, viewportDays - 2);

  // Where the calendar currently is, as a date. Read from the scroll
  // position rather than held as its own state: the two were the same
  // thing, and keeping both meant the scrubber showed where you had
  // last pressed a button rather than where you had since scrolled to.
  const leadingDayIndex = Math.max(
    0,
    Math.min(days.length - 1, Math.round(scrollLeft / Math.max(dayColumnWidth, 1))),
  );
  const normalizedFocusDate = days[leadingDayIndex] ?? today;

  // Bars are drawn a screen either side of the viewport, so a fling
  // does not outrun the render and leave blank rows behind it.
  const barWindowStart = addDays(visibleRangeStart, -viewportDays);
  const barWindowEndExclusive = addDays(visibleRangeEndInclusive, viewportDays + 1);

  // What the corner count and the search summary are about: the trips
  // actually on screen. Everything ever scrolled past stays loaded, so
  // counting the loaded set would answer a question nobody asked.
  //
  // Three things it used to get wrong. It counted the ten overscan
  // columns either side as "in view"; it counted trips on cars the
  // filters had taken off the grid; and while searching it counted every
  // trip on the remaining rows rather than the ones that matched -- so a
  // search for one renter still said "210 bookings".
  const onScreenStart = days[leadingDayIndex] ?? rangeStart;
  const onScreenEndExclusive = addDays(onScreenStart, viewportDays);
  const shownVehicleIds = new Set(sortedVehicles.map((vehicle) => vehicle.id));
  const visibleOrders = filteredOrders.filter(
    (order) =>
      shownVehicleIds.has(order.vehicleId) &&
      orderIntersectsRange(order, onScreenStart, onScreenEndExclusive) &&
      orderMatchesSearch(order),
  );

  // The row background: a hairline at every day boundary, and a warm
  // band over Saturday and Sunday. Both repeat on a seven-day cycle,
  // which is only in phase because the canvas starts on a Monday.
  const weekWidth = dayColumnWidth * 7;
  const dayGridBackground = [
    `repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${dayColumnWidth}px)`,
    `repeating-linear-gradient(to right, transparent 0 ${dayColumnWidth * 5}px, var(--calendar-weekend) ${
      dayColumnWidth * 5
    }px ${weekWidth}px)`,
  ].join(", ");
  dayColumnWidthRef.current = dayColumnWidth;
  panPillLabelRef.current = calendarMessages.panByDrag;
  const todayOffsetDays = Math.round((nowDay.getTime() - canvasStart.getTime()) / DAY_IN_MS);
  const todayColumnOffset =
    todayOffsetDays >= 0 && todayOffsetDays < days.length
      ? todayOffsetDays * dayColumnWidth
      : null;
  // Where this minute falls on the strip.
  const nowOffset =
    now && now.getTime() >= canvasStart.getTime() && now.getTime() < rangeEndExclusive.getTime()
      ? columnPosition(now.getTime(), canvasStart.getTime()) * dayColumnWidth
      : null;
  const nowMs = now?.getTime() ?? null;

  // --- Fetching the chunks you are scrolling toward -------------------
  //
  // Keyed on the chunk indexes rather than on the scroll position, so
  // it runs when the set of needed chunks changes and not on every
  // frame of a drag. Reaching a chunk's dates and *then* asking for
  // them would show empty rows for the length of a round-trip, which
  // is indistinguishable from "this car has nothing booked" -- hence
  // the lead: the fetch starts while the dates are still off-screen.
  const neededChunkIndexes = useMemo(
    () =>
      chunkIndexesForRange(
        addDays(visibleRangeStart, -PREFETCH_LEAD_DAYS),
        addDays(visibleRangeEndInclusive, PREFETCH_LEAD_DAYS),
      ),
    [visibleRangeStart, visibleRangeEndInclusive],
  );
  const neededChunkKey = neededChunkIndexes.join(",");

  useEffect(() => {
    if (!fetchesChunks) return;
    // The store and in-flight set this pass belongs to. A refresh swaps
    // both for new ones; a response from before it then lands in the
    // old store, where nothing reads it -- instead of overwriting the
    // fresh copy with the dates as they were before the edit.
    const store = fetchedChunksRef.current;
    const inFlight = inFlightChunksRef.current;
    const missing = neededChunkIndexes.filter(
      (index) => !serverChunks.has(index) && !store.has(index) && !inFlight.has(index),
    );
    if (missing.length === 0) return;

    let cancelled = false;
    for (const index of missing) inFlight.add(index);
    setIsLoadingChunks(true);

    const load = async () => {
      // One request per chunk, deliberately: a chunk that fails leaves
      // its neighbours loaded, and a chunk that lands paints without
      // waiting for the rest. Batching them into one range would make
      // the whole window all-or-nothing.
      await Promise.all(
        missing.map(async (index) => {
          const { start, end } = chunkRange(index);
          try {
            const response = await fetch(
              `/api/calendar/orders?from=${toDayParam(start)}&to=${toDayParam(
                new Date(end.getTime() - DAY_IN_MS),
              )}`,
              { headers: { Accept: "application/json" } },
            );
            if (!response.ok) throw new Error(String(response.status));
            const data = (await response.json()) as { orders?: CalendarOrder[] };
            // Kept even if this effect pass was superseded mid-flight by
            // a scroll. The bytes are already here and the store is a
            // ref, so throwing them away only guarantees fetching them
            // again.
            store.set(index, data.orders ?? []);
          } catch {
            // Left out of the store on purpose, so scrolling back over
            // these dates retries instead of trusting a gap.
            if (!cancelled) setChunkError(true);
          } finally {
            inFlight.delete(index);
          }
        }),
      );
      // Outside the cancelled guard: a superseded pass still has to put
      // the spinner down, or it spins for the rest of the session.
      setIsLoadingChunks(inFlightChunksRef.current.size > 0);
      // Repaint whenever this pass's store is still the live one, even
      // if a scroll superseded the pass: the next pass skipped these
      // chunks as in flight, so nobody else will ask for the paint.
      if (store === fetchedChunksRef.current) setChunkTick((tick) => tick + 1);
    };

    void load();
    return () => {
      // The requests keep running and stay marked in flight; dropping
      // the marks here made every scroll re-request chunks already on
      // their way.
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededChunkKey, storeVersion, serverChunks, fetchesChunks]);

  // The grid's own search filters what it has loaded, which is the
  // dates near where you have scrolled. That narrows the view; it does
  // not find things. This asks the server about every trip in the
  // workspace, so a renter from last winter is reachable.
  //
  // Debounced, because it is a database query per keystroke otherwise,
  // and skipped entirely below two characters where every query
  // matches half the table.
  useEffect(() => {
    const query = calendarSearchQuery.trim();
    // The grid's own search over the loaded dates still works for a
    // member limited to some cars; the all-history one is refused them.
    if (readOnly || limitedToVehicles || query.length < 2) {
      setSearchHits([]);
      setSearchTruncated(false);
      setSearchFailed(false);
      setSearchBusy(false);
      return;
    }

    let cancelled = false;
    setSearchBusy(true);
    const handle = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/calendar/search?q=${encodeURIComponent(query)}`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as {
          orders?: CalendarOrder[];
          truncated?: boolean;
        };
        if (cancelled) return;
        setSearchHits(data.orders ?? []);
        setSearchTruncated(Boolean(data.truncated));
        setSearchFailed(false);
      } catch {
        if (!cancelled) setSearchFailed(true);
      } finally {
        if (!cancelled) setSearchBusy(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [calendarSearchQuery, readOnly]);

  /** Take the calendar to a trip, wherever it is. */
  function openSearchHit(order: CalendarOrder) {
    // The hit carries its whole record, so the panel can open even for
    // dates the grid has never fetched -- no second round-trip, and no
    // empty panel while one is in flight.
    setSelectedOrder(order);
    setOrderPopover({ isOpen: true });

    // Only move the grid if the trip is somewhere the grid can go. The
    // canvas is 180 days back and 400 forward; a trip from two years
    // ago is off it entirely, and scrolling to the clamped edge would
    // claim to have found it a place on screen that it does not have.
    // The panel still opens, which is what searching for a trip is for.
    const pickup = startOfDay(new Date(order.pickupDatetime));
    if (pickup >= canvasStart && pickup < rangeEndExclusive) {
      scrollToDate(addDays(pickup, -2), "auto");
    }
  }

  // Notes for the whole canvas, fetched once. There are a handful per
  // account, not one per day, so windowing them would cost more in
  // requests than it saves in rows.
  useEffect(() => {
    if (readOnly || limitedToVehicles) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/calendar/notes?from=${toDayParam(rangeStart)}&to=${toDayParam(rangeEndExclusive)}`,
          { headers: { Accept: "application/json" } },
        );
        if (!response.ok) return;
        const data = (await response.json()) as { notes?: CalendarNote[] };
        if (!cancelled) setNotes(data.notes ?? []);
      } catch {
        // A missing note band is not worth a banner: the grid is still
        // correct about every booking on it.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // Keyed on the strings the request is built from rather than on the
    // Date objects, so an identity change alone can never re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, toDayParam(rangeStart), toDayParam(rangeEndExclusive), storeVersion]);

  // Repairs and services for the whole canvas, like notes: a few per car,
  // not one per day.
  useEffect(() => {
    if (readOnly) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/calendar/service-records?from=${toDayParam(rangeStart)}&to=${toDayParam(rangeEndExclusive)}`,
          { headers: { Accept: "application/json" } },
        );
        if (!response.ok) return;
        const data = (await response.json()) as { records?: ServiceRecord[] };
        if (!cancelled) setServiceRecords(data.records ?? []);
      } catch {
        // Like notes: the bookings on the grid are still right without them.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, toDayParam(rangeStart), toDayParam(rangeEndExclusive), storeVersion]);

  const openServiceDialog = () => {
    const vehicleId =
      selectedVehicleId !== "all" ? selectedVehicleId : filteredVehicles[0]?.id ?? vehicleOptions[0]?.id ?? "";
    const day = toDayParam(normalizedFocusDate);
    setServiceDialog({ seed: { vehicleId, startDate: day, endDate: day } });
  };

  const openServiceFromSelection = () => {
    if (!daySelection) return;
    const sorted = [...daySelection.days].sort();
    setServiceDialog({
      seed: { vehicleId: daySelection.vehicleId, startDate: sorted[0], endDate: sorted[sorted.length - 1] },
    });
    clearDaySelection();
  };

  async function saveNote() {
    if (!daySelection || !noteDraft.trim() || isSavingNote) return;
    setIsSavingNote(true);
    try {
      const sorted = [...daySelection.days].sort();
      const response = await fetch("/api/calendar/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: daySelection.vehicleId,
          // A gappy selection becomes one band from the first day to
          // the last. A note is about a stretch of calendar, not three
          // separate remarks that happen to share wording.
          startDate: sorted[0],
          endDate: sorted[sorted.length - 1],
          text: noteDraft.trim(),
        }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { note: CalendarNote };
      setNotes((current) => [...current, data.note]);
      setNoteDraft("");
      clearDaySelection();
    } catch {
      setBulkNotice(calendarMessages.noteSaveFailed);
    } finally {
      setIsSavingNote(false);
    }
  }

  async function deleteNote(note: CalendarNote) {
    if (!window.confirm(calendarMessages.noteDeleteConfirm)) return;
    const previous = notes;
    setNotes((current) => current.filter((item) => item.id !== note.id));
    try {
      const response = await fetch(`/api/calendar/notes/${note.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      setNotes(previous);
      setBulkNotice(calendarMessages.noteSaveFailed);
    }
  }

  async function bulkSyncToOwners() {
    if (bulkSelection.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkNotice(null);
    try {
      const response = await fetch("/api/orders/bulk-owner-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(bulkSelection) }),
      });
      const data = (await response.json()) as {
        synced?: number;
        skipped?: Array<{ id: string; reason: string }>;
      };
      if (!response.ok) throw new Error(String(response.status));
      setBulkNotice(
        calendarMessages.bulkSyncResult(data.synced ?? 0, data.skipped?.length ?? 0),
      );
      setBulkSelection(new Set());
      router.refresh();
    } catch {
      setBulkNotice(calendarMessages.bulkSyncFailed);
    } finally {
      setBulkBusy(false);
    }
  }

  // --- Day picking ----------------------------------------------------

  /** `YYYY-MM-DD` in local time, which is how a day column is named. */
  const dayKey = (date: Date) => {
    const local = startOfDay(date);
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(
      local.getDate(),
    ).padStart(2, "0")}`;
  };

  const sortedSelectedDays = daySelection ? [...daySelection.days].sort() : [];
  const selectionIsRun =
    sortedSelectedDays.length > 0 &&
    sortedSelectedDays.every((key, index) => {
      if (index === 0) return true;
      const previous = new Date(`${sortedSelectedDays[index - 1]}T00:00:00`);
      return dayKey(addDays(previous, 1)) === key;
    });

  function toggleDay(vehicleId: string, date: Date) {
    const key = dayKey(date);
    setBulkNotice(null);
    setDaySelection((current) => {
      // A different car starts over. A selection spanning two rows
      // would have no single answer to "which car is this note about".
      if (!current || current.vehicleId !== vehicleId) {
        return { vehicleId, days: [key], anchor: key };
      }
      if (current.days.includes(key)) {
        const days = current.days.filter((day) => day !== key);
        if (days.length === 0) return null;
        return { ...current, days, anchor: current.anchor === key ? null : current.anchor };
      }
      // With an anchor set, the second click fills the span between --
      // that is the whole gesture: click the first day, click the last.
      if (current.anchor) {
        const [from, to] = [current.anchor, key].sort();
        const filled = new Set(current.days);
        for (
          let cursor = new Date(`${from}T00:00:00`);
          dayKey(cursor) <= to;
          cursor = addDays(cursor, 1)
        ) {
          filled.add(dayKey(cursor));
        }
        return { vehicleId, days: Array.from(filled), anchor: null };
      }
      return { vehicleId, days: [...current.days, key], anchor: key };
    });
  }

  function clearDaySelection() {
    setDaySelection(null);
    setNoteDraft("");
  }

  /** Scroll the canvas so `date` sits a little in from the left edge. */
  const scrollToDate = (date: Date, behavior: ScrollBehavior = "smooth") => {
    const node = timelineViewportRef.current;
    if (!node) return;
    const offsetDays = Math.round(
      (startOfDay(date).getTime() - canvasStart.getTime()) / DAY_IN_MS,
    );
    const maxScroll = Math.max(0, days.length * dayColumnWidth - node.clientWidth);
    const target = Math.max(0, Math.min(offsetDays * dayColumnWidth, maxScroll));
    node.scrollTo({ left: target, behavior });
  };

  /**
   * Reload the orders, and nothing else.
   *
   * `router.refresh()` alone re-renders the page, which reseeds the
   * server chunks -- but everything the grid fetched for itself would
   * survive as cached chunks and stay stale. Clearing the store first
   * makes the prefetch effect re-request whatever is on screen, so
   * "refresh" means the same thing wherever you have scrolled to.
   *
   * Zoom, scroll position, filters and search are all untouched: they
   * live in this component, and nothing here unmounts it.
   */
  const handleRefresh = () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setChunkError(false);
    fetchedChunksRef.current = new Map();
    inFlightChunksRef.current = new Set();
    setStoreVersion((version) => version + 1);
    router.refresh();
    window.setTimeout(() => setIsRefreshing(false), 800);
  };

  const panByDays = (amount: number) => {
    const node = timelineViewportRef.current;
    if (!node) return;
    node.scrollTo({
      left: Math.max(
        0,
        Math.min(
          node.scrollLeft + amount * dayColumnWidth,
          Math.max(0, days.length * dayColumnWidth - node.clientWidth),
        ),
      ),
      behavior: "smooth",
    });
  };

  // Where the canvas opens.
  //
  // Scroll position zero is 180 days before today, so without this the
  // calendar would open on last winter. `?start=` wins when present --
  // that is what makes a calendar link land on the date it names.
  //
  // Runs once, and only once the column width is settled: scrolling to
  // a date before the width is known lands on the wrong one, and
  // re-running it on every width change would yank the view back to
  // today each time the zoom slider moved.
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    const node = timelineViewportRef.current;
    // Zero width means the pane is not laid out -- on a phone the
    // List/Timeline switch hides it with `display: none`, and the
    // scroll would land on 0 and then never be retried, because this
    // runs once. Wait for the resize observer to report a real width.
    if (!node || !timelineViewportWidth) return;

    const requested = new URLSearchParams(window.location.search).get("start");
    const parsed = requested ? new Date(`${requested}T00:00:00`) : null;
    const target =
      parsed && !Number.isNaN(parsed.getTime()) ? startOfDay(parsed) : addDays(today, -2);

    // Retried, not fired once.
    //
    // `scrollTo` is clamped by the browser to the element's *current*
    // scrollWidth, and on the first frames after mount the 30,000px
    // strip inside has not been laid out yet -- so a perfectly correct
    // target silently becomes 0, and the calendar opens six months
    // before the date it was asked for. Whether that happens depends
    // on how the frame falls, which is why it looked intermittent.
    // Keep asking until it takes.
    didInitialScrollRef.current = true;
    const offsetDays = Math.round((target.getTime() - canvasStart.getTime()) / DAY_IN_MS);
    const wanted = Math.max(0, offsetDays * dayColumnWidth);
    let attempts = 0;
    const settle = () => {
      if (!timelineViewportRef.current) return;
      const current = timelineViewportRef.current;
      current.scrollLeft = wanted;
      attempts += 1;
      if (Math.abs(current.scrollLeft - wanted) > 1) {
        // Frames first, then a timer: a phone that paints the page
        // late, or a tab in the background, can go longer than thirty
        // frames before the strip is laid out -- and then the calendar
        // opened six months back, on columns nobody asked for.
        if (attempts < 30) requestAnimationFrame(settle);
        else if (attempts < 60) window.setTimeout(settle, 100);
        return;
      }
      // The visible columns are chosen from this state. Set it here
      // rather than waiting for the scroll event, so the first paint
      // after the jump draws the right days.
      setScrollLeft(current.scrollLeft);
    };
    settle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineViewportWidth, dayColumnWidth]);

  // Keeps the date in place when the columns change width.
  //
  // The scroll position is pixels, and a date is pixels divided by the
  // column width -- so widening the columns with the zoom slider,
  // turning a phone sideways (its columns are a seventh of the screen),
  // or crossing from the desktop layout to the phone one all kept the
  // pixel and moved the date: going 1440px to 375px jumped from early
  // October to January. Rescaling by the ratio holds the leading day.
  const anchoredDayWidthRef = useRef(dayColumnWidth);
  useLayoutEffect(() => {
    const previous = anchoredDayWidthRef.current;
    anchoredDayWidthRef.current = dayColumnWidth;
    const node = timelineViewportRef.current;
    if (!node || !didInitialScrollRef.current || previous === dayColumnWidth || previous <= 0) return;
    node.scrollLeft = (node.scrollLeft / previous) * dayColumnWidth;
    setScrollLeft(node.scrollLeft);
  }, [dayColumnWidth]);

  // The address bar follows the calendar, so a refresh, a bookmark or
  // a link pasted to a colleague all land where you were rather than
  // back on today.
  //
  // `history.replaceState`, not the router: this page reads none of
  // these on the server, so going through Next would cost an RSC
  // round-trip per keystroke to change a string the server ignores.
  useEffect(() => {
    if (!didInitialScrollRef.current) return;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      params.set("start", toDayParam(normalizedFocusDate));
      const setOrDelete = (key: string, value: string) => {
        if (value && value !== "all") params.set(key, value);
        else params.delete(key);
      };
      setOrDelete("vehicle", selectedVehicleId);
      setOrDelete("owner", selectedOwnerId);
      setOrDelete("source", selectedSource);
      setOrDelete("q", calendarSearchQuery.trim());
      window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [
    normalizedFocusDate,
    selectedVehicleId,
    selectedOwnerId,
    selectedSource,
    calendarSearchQuery,
  ]);

  // Filters restored from the address bar, once, on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const vehicle = params.get("vehicle");
    const owner = params.get("owner");
    const source = params.get("source");
    const query = params.get("q");
    if (vehicle) setSelectedVehicleId(vehicle);
    if (owner) setSelectedOwnerId(owner);
    if (source) setSelectedSource(source);
    if (query) setCalendarSearchQuery(query);
  }, []);
  // v0.19.3 visual refresh: dropped the heavy dark glass-pill container
  // language entirely. The previous styles relied on placing
  // `bg-rgba(255,255,255,0.76)` buttons on top of an
  // `bg-rgba(17,19,24,0.92)` outer pill — the resulting dark-on-darker
  // gray buttons were low-contrast and didn't match the white/cream
  // surface used on every other admin page. The new look matches the
  // login/dashboard chip style: solid white surface, hairline
  // `var(--line)` border, ink-on-white text. Primary action keeps the
  // accent purple but flips text to white (the previous `text-ink`
  // on `bg-accent` was dark-on-dark) and drops the bizarre orange
  // `#ff7b67` hover that looked like a different brand.
  const secondaryActionClass =
    "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-[var(--line)] bg-white px-3.5 text-[12px] font-semibold text-[var(--ink)] transition hover:border-[rgba(17,19,24,0.22)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50";
  const primaryActionClass =
    "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md bg-[var(--accent)] px-3.5 text-[12px] font-semibold text-white shadow-[0_8px_22px_-10px_rgba(89,60,251,0.55)] transition hover:bg-[#4830d4] hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50";

  const toggleBulkMode = () => {
    setBulkMode((on) => !on);
    setBulkSelection(new Set());
    setBulkNotice(null);
    // The two selections are mutually exclusive: a click cannot mean
    // both "pick this day" and "pick this trip".
    clearDaySelection();
  };

  const openCreateOrderDialog = () => {
    const fallbackVehicleId =
      selectedVehicleId !== "all"
        ? selectedVehicleId
        : filteredVehicles[0]?.id ?? vehicleOptions[0]?.id ?? "";

    setOrderFormError(null);
    setOrderDraft(buildCreateDraft(normalizedFocusDate, fallbackVehicleId));
    setIsOrderDialogOpen(true);
  };

  /** Open the create dialog seeded from the picked days. */
  const openCreateOrderFromSelection = () => {
    if (!daySelection || !selectionIsRun) return;
    const sorted = [...daySelection.days].sort();
    setOrderFormError(null);
    setOrderDraft(
      buildCreateDraft(
        new Date(`${sorted[0]}T00:00:00`),
        daySelection.vehicleId,
        new Date(`${sorted[sorted.length - 1]}T00:00:00`),
      ),
    );
    setIsOrderDialogOpen(true);
  };

  const closeOrderDialog = () => {
    if (isSavingOrder) return;
    setIsOrderDialogOpen(false);
    setOrderFormError(null);
  };

  const handleManualOrderSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const pickupDatetime = parseDateTimeInputParts(orderDraft.pickupDate, orderDraft.pickupTime);
    const returnDatetime = parseDateTimeInputParts(orderDraft.returnDate, orderDraft.returnTime);

    if (
      !orderDraft.vehicleId ||
      !orderDraft.renterName.trim() ||
      !pickupDatetime ||
      !returnDatetime ||
      returnDatetime <= pickupDatetime
    ) {
      setOrderFormError(calendarMessages.formValidationError);
      return;
    }

    setIsSavingOrder(true);
    setOrderFormError(null);

    try {
      const response = await fetch("/api/orders/offline", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: orderDraft.id,
          vehicleId: orderDraft.vehicleId,
          renterName: orderDraft.renterName.trim(),
          renterPhone: orderDraft.renterPhone.trim(),
          pickupDatetime: pickupDatetime.toISOString(),
          returnDatetime: returnDatetime.toISOString(),
          totalPrice: orderDraft.totalPrice.trim(),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { order?: CalendarOrder; error?: string }
        | null;

      if (!response.ok || !payload?.order) {
        setOrderFormError(
          payload?.error === "INVALID_DATES" || payload?.error === "VALIDATION_ERROR"
            ? calendarMessages.formValidationError
            : calendarMessages.formSaveError,
        );
        return;
      }

      setSelectedOrder(payload.order);
      setIsOrderDialogOpen(false);
      router.refresh();
    } catch {
      setOrderFormError(calendarMessages.formSaveError);
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleTuroSync = async () => {
    setIsTuroSyncing(true);
    setTuroSyncNotice(null);

    try {
      const response = await fetch("/api/turo-sync", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as TuroSyncResponse | null;

      if (!response.ok) {
        setTuroSyncNotice({
          kind: "error",
          message:
            payload?.code === "TURO_SYNC_CONFIG_MISSING"
              ? calendarMessages.turoSyncConfigError
              : payload?.error || calendarMessages.turoSyncError,
        });
        return;
      }

      const successRows = payload?.successRows ?? 0;
      const failedRows = payload?.failedRows ?? 0;
      const createdVehicles = payload?.createdVehicles ?? 0;
      const updatedVehicles = payload?.updatedVehicles ?? 0;

      setTuroSyncNotice({
        kind: failedRows > 0 ? "warning" : "success",
        message:
          failedRows > 0
            ? calendarMessages.turoSyncPartial(successRows, failedRows)
            : calendarMessages.turoSyncSuccess(successRows, createdVehicles, updatedVehicles),
      });
      router.refresh();
    } catch {
      setTuroSyncNotice({
        kind: "error",
        message: calendarMessages.turoSyncError,
      });
    } finally {
      setIsTuroSyncing(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* v0.19.1 density pass: control bar was using p-4 + gap-4 + a
       * 2.2rem center title that ate ~250px of vertical space before
       * the timeline started rendering. Reframed as a single tight
       * row on xl: prev/next + today + actions on the left, range
       * mode on the right, with the date title moved INTO the
       * scrubber row so it doesn't double up. Kicker / legend / hint
       * badges removed — the timeline itself is self-explanatory and
       * those badges were just decorative noise. */}
      {/* Not overflow-hidden: the toolbar's menus open below it. */}
      <section className="relative z-20 rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.92),rgba(247,247,247,0.96))] p-2.5 shadow-[0_24px_60px_-42px_rgba(17,19,24,0.45)]">
        <div className="grid gap-2 2xl:grid-cols-[auto_minmax(42rem,1fr)] 2xl:items-center">
          {/* One row of grouped menus. It was eleven buttons in two
              rows, then a filter row; related actions share a menu now,
              and only the moves made every minute stay loose. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex rounded-md border border-[var(--line)] bg-white p-0.5">
              <button
                type="button"
                aria-label={calendarMessages.panEarlier(pageStrideDays)}
                title={calendarMessages.panEarlier(pageStrideDays)}
                onClick={() => panByDays(-pageStrideDays)}
                className="rounded-md px-2.5 py-1 text-[14px] font-semibold leading-none text-[var(--ink-soft)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
              >
                &#8249;
              </button>
              <button
                type="button"
                aria-label={calendarMessages.panLater(pageStrideDays)}
                title={calendarMessages.panLater(pageStrideDays)}
                onClick={() => panByDays(pageStrideDays)}
                className="rounded-md px-2.5 py-1 text-[14px] font-semibold leading-none text-[var(--ink-soft)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
              >
                &#8250;
              </button>
            </div>
            <button type="button" onClick={() => scrollToDate(nowDay)} className={secondaryActionClass}>
              {calendarMessages.today}
            </button>

            {!readOnly ? (
              <ToolbarMenu
                primary
                label={calendarMessages.menuNew}
                items={[
                  {
                    key: "order",
                    label: calendarMessages.manualCreate,
                    onSelect: openCreateOrderDialog,
                    disabled: vehicleOptions.length === 0,
                  },
                  ...(limitedToVehicles
                    ? []
                    : [
                        {
                          key: "recurring",
                          label: calendarMessages.recurringAction,
                          onSelect: () => setIsRecurringOpen(true),
                          disabled: vehicleOptions.length === 0,
                        },
                        {
                          key: "vehicle",
                          label: calendarMessages.addVehicleAction.replace(/^\+\s*/, ""),
                          onSelect: () => setIsAddVehicleOpen(true),
                        },
                      ]),
                ]}
              />
            ) : null}
            {!readOnly ? (
              <button
                type="button"
                onClick={openServiceDialog}
                disabled={vehicleOptions.length === 0}
                className={cn(secondaryActionClass, "gap-1.5 border-amber-300 bg-amber-50 text-amber-950 hover:border-amber-400 hover:bg-amber-100")}
              >
                <Wrench className="h-3.5 w-3.5" aria-hidden />
                <span className="sm:hidden">{calendarMessages.service.newActionShort}</span>
                <span className="hidden sm:inline">{calendarMessages.service.newAction}</span>
              </button>
            ) : null}

            {/* The price layer's two controls, together. Their behaviour
                is the rental-site session's; only their place moved. */}
            {pricing ? (
              <ToolbarMenu
                label={calendarMessages.menuPrices}
                items={[
                  {
                    key: "show",
                    label: calendarMessages.pricesToggle,
                    checked: showPrices,
                    onSelect: () => setShowPrices((on) => !on),
                  },
                  ...(!readOnly
                    ? [
                        {
                          key: "adjust",
                          label: messages.calendarPricePanel.openAction,
                          onSelect: () => setPricePanel({ vehicleIds: [], days: [] }),
                        },
                      ]
                    : []),
                ]}
              />
            ) : null}

            {/* Fetching from Turo and reloading the page's own data were
                two buttons that read as the same thing. */}
            {!readOnly ? (
              <ToolbarMenu
                label={
                  isTuroSyncing || isRefreshing || isLoadingChunks
                    ? calendarMessages.refreshingAction
                    : calendarMessages.menuSync
                }
                items={[
                  {
                    key: "turo",
                    label: isTuroSyncing ? calendarMessages.turoSyncingAction : calendarMessages.turoSyncAction,
                    onSelect: () => void handleTuroSync(),
                    disabled: isTuroSyncing,
                  },
                  {
                    key: "refresh",
                    label: calendarMessages.refreshAction,
                    onSelect: handleRefresh,
                    disabled: isRefreshing,
                  },
                ]}
              />
            ) : (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                title={calendarMessages.refreshHint}
                className={secondaryActionClass}
              >
                {isRefreshing || isLoadingChunks
                  ? calendarMessages.refreshingAction
                  : calendarMessages.refreshAction}
              </button>
            )}

            <ToolbarMenu
              label={calendarMessages.menuFilters}
              badge={
                [selectedVehicleId, readOnly ? "all" : selectedOwnerId, selectedSource].filter(
                  (value) => value !== "all",
                ).length || undefined
              }
            >
              <div className="grid w-full gap-1.5 sm:w-72">
                {/* On a phone the search lives here; a laptop shows it
                    in the row. */}
                <label className="relative min-w-0 lg:hidden">
                  <span className="sr-only">{calendarMessages.timelineSearch}</span>
                  <input
                    type="search"
                    {...SEARCH_FIELD_PROPS}
                    value={calendarSearchQuery}
                    onChange={(event) => setCalendarSearchQuery(event.target.value)}
                    placeholder={calendarMessages.timelineSearchPlaceholder}
                    className="h-9 w-full rounded-md border border-[var(--line)] bg-white px-3 text-[12px] text-[var(--ink)] outline-none focus:border-[rgba(17,19,24,0.3)]"
                  />
                </label>
                <SearchableFilterDropdown
                  value={selectedVehicleId}
                  query={vehicleFilterQuery}
                  allLabel={calendarMessages.allVehicles}
                  searchPlaceholder={calendarMessages.searchVehiclesPlaceholder}
                  options={vehicleFilterOptions}
                  onValueChange={setSelectedVehicleId}
                  onQueryChange={setVehicleFilterQuery}
                />
                {!readOnly ? (
                  <SearchableFilterDropdown
                    value={selectedOwnerId}
                    query={ownerFilterQuery}
                    allLabel={calendarMessages.allOwners}
                    searchPlaceholder={calendarMessages.searchOwnersPlaceholder}
                    options={ownerFilterOptions}
                    onValueChange={setSelectedOwnerId}
                    onQueryChange={setOwnerFilterQuery}
                  />
                ) : null}
                <SearchableFilterDropdown
                  value={selectedSource}
                  query={sourceFilterQuery}
                  allLabel={calendarMessages.allSources}
                  searchPlaceholder={calendarMessages.searchSourcesPlaceholder}
                  options={sourceFilterOptions}
                  onValueChange={setSelectedSource}
                  onQueryChange={setSourceFilterQuery}
                />
              </div>
            </ToolbarMenu>

            {!readOnly ? (
              <ToolbarMenu
                label={calendarMessages.menuTools}
                align="right"
                items={[
                  ...(limitedToVehicles
                    ? []
                    : [
                        {
                          key: "bulk",
                          label: calendarMessages.bulkModeEnter,
                          checked: bulkMode,
                          onSelect: toggleBulkMode,
                        },
                        {
                          key: "feed",
                          label: calendarMessages.feedAction,
                          onSelect: () => setIsFeedOpen(true),
                        },
                      ]),
                  {
                    key: "export",
                    label: calendarMessages.downloadOrders,
                    onSelect: () => setExportSignal((value) => value + 1),
                    disabled: vehicleOptions.length === 0,
                  },
                ]}
              >
                {/* A phone fits seven days to its width and never reads
                    this, so there it is not offered. */}
                {!compact ? (
                  <label className="flex items-center gap-2 text-[12px] text-[color:var(--ink-soft)]">
                    <span className="shrink-0">{calendarMessages.dayWidthMenuLabel}</span>
                    <input
                      type="range"
                      min={MIN_CUSTOM_DAY_WIDTH}
                      max={MAX_CUSTOM_DAY_WIDTH}
                      step={2}
                      value={customDayWidth}
                      onChange={(event) => setCustomDayWidth(Number(event.target.value))}
                      className="min-w-0 flex-1 cursor-pointer accent-[var(--accent)]"
                    />
                    <span className="w-10 text-right tabular-nums">{customDayWidth}px</span>
                  </label>
                ) : null}
              </ToolbarMenu>
            ) : null}

            {/* Bulk mode needs a way out that is not hidden in a menu. */}
            {bulkMode ? (
              <button
                type="button"
                onClick={toggleBulkMode}
                className={cn(secondaryActionClass, "border-[var(--accent)] text-[var(--accent)]")}
              >
                {calendarMessages.bulkModeExit}
              </button>
            ) : null}

            <label className="relative ml-auto hidden min-w-0 lg:block lg:w-72">
              <span className="sr-only">{calendarMessages.timelineSearch}</span>
              <input
                type="search"
                {...SEARCH_FIELD_PROPS}
                value={calendarSearchQuery}
                onChange={(event) => setCalendarSearchQuery(event.target.value)}
                placeholder={calendarMessages.timelineSearchPlaceholder}
                className="h-9 w-full rounded-full border border-[var(--line)] bg-white px-3 text-[12px] font-medium text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-soft)]/70 hover:border-[rgba(17,19,24,0.22)] focus:border-[rgba(17,19,24,0.3)] focus:ring-2 focus:ring-[rgba(89,60,251,0.12)]"
              />
            </label>
          </div>

          {/* Opened from the menus above; neither has a button of its own. */}
          {!readOnly ? (
            <VehicleEditDialog
              locale={locale}
              owners={ownerOptions}
              open={isAddVehicleOpen}
              onOpenChange={setIsAddVehicleOpen}
              // An empty id is what tells the save action to create
              // rather than update.
              vehicle={{
                id: "",
                ownerId: null,
                plateNumber: "",
                nickname: "",
                brand: "",
                model: "",
                year: new Date().getFullYear(),
                status: "available",
              }}
            />
          ) : null}
          {!readOnly ? (
            <VehicleOrdersExportButton
              hideTrigger
              openSignal={exportSignal}
              locale={locale}
              vehicleOptions={vehicleOptions}
              preferredVehicleId={selectedVehicleId !== "all" ? selectedVehicleId : filteredVehicles[0]?.id}
              rangeStart={visibleRangeStart.toISOString()}
              rangeEnd={visibleRangeEndInclusive.toISOString()}
            />
          ) : null}
        </div>

        {turoSyncNotice ? (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "mt-2 rounded-md border px-3 py-2 text-[12px] font-medium",
              turoSyncNotice.kind === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : turoSyncNotice.kind === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-rose-200 bg-rose-50 text-rose-800",
            )}
          >
            {turoSyncNotice.message}
          </div>
        ) : null}

        {/* What the search found everywhere, as opposed to what it
            filtered on screen. The two are different answers and the
            panel keeps them apart. */}
        {!readOnly && calendarSearchQuery.trim().length >= 2 ? (
          <div className="mt-2 rounded-md border border-[rgba(17,19,24,0.08)] bg-[rgba(255,255,255,0.8)] px-3 py-2 text-[12px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[color:var(--ink-soft)]">
                {searchBusy
                  ? calendarMessages.searchAllLoading
                  : searchFailed
                    ? calendarMessages.searchAllFailed
                    : searchHits.length === 0
                      ? calendarMessages.searchAllNone
                      : calendarMessages.searchAllResults(searchHits.length)}
              </span>
              {searchHits.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSearchListOpen((open) => !open)}
                  className="text-[11px] font-semibold text-[var(--accent)] underline underline-offset-2"
                >
                  {searchListOpen
                    ? calendarMessages.searchHideResults
                    : calendarMessages.searchShowResults(searchHits.length)}
                </button>
              ) : null}
            </div>

            {/* The vehicles behind the hits, first and always visible.
                On a phone this is the answer people actually want --
                "which car was that" -- and each one opens its month. */}
            {searchHits.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                <span className="text-[10px] uppercase tracking-wide text-[color:var(--ink-soft)]/80">
                  {calendarMessages.searchVehicles}
                </span>
                {Array.from(
                  new Map(
                    searchHits.map((order) => [
                      order.vehicleId,
                      order.vehiclePlateNumber || order.vehicleName,
                    ]),
                  ),
                ).map(([vehicleId, label]) => (
                  <button
                    key={vehicleId}
                    type="button"
                    onClick={() => setMonthCalendarFor(vehicleId)}
                    className="rounded-full border border-[var(--line)] bg-white px-2 py-0.5 text-[11px] font-medium text-[color:var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    {highlightText(String(label ?? ""), calendarSearchQuery)}
                  </button>
                ))}
              </div>
            ) : null}

            {searchListOpen && searchHits.length > 0 ? (
              // Capped and scrolled inside itself: twelve cards are
              // taller than a phone screen, and growing without limit
              // would push the calendar off the page.
              <div className="mt-2 grid max-h-[40vh] gap-1 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                {searchHits.slice(0, 12).map((order) => {
                  const pickup = new Date(order.pickupDatetime);
                  const outsideView = !orderIntersectsRange(
                    order,
                    visibleRangeStart,
                    addDays(visibleRangeEndInclusive, 1),
                  );
                  return (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => openSearchHit(order)}
                      className="rounded-md border border-[var(--line)] bg-white px-2 py-1.5 text-left transition hover:border-[var(--accent)]"
                    >
                      <span className="block truncate text-[12px] font-semibold text-[color:var(--ink)]">
                        {highlightText(order.renterName, calendarSearchQuery)}
                      </span>
                      <span className="mt-0.5 block truncate text-[10.5px] text-[color:var(--ink-soft)]">
                        {order.vehiclePlateNumber || order.vehicleName} ·{" "}
                        {formatDate(pickup, locale)}
                        {outsideView ? ` · ${calendarMessages.searchOutsideWindow}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {searchListOpen && searchHits.length > 12 ? (
              <p className="mt-1 text-[10.5px] text-[color:var(--ink-soft)]">
                {calendarMessages.searchMoreResults(
                  searchHits.length - 12 + (searchTruncated ? 1 : 0),
                )}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* A gap in the data has to say so. An empty row is otherwise
            indistinguishable from a car with nothing booked, and the
            second is a thing operators act on. */}
        {chunkError ? (
          <div
            role="status"
            className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
          >
            {calendarMessages.ordersLoadFailed}
          </div>
        ) : null}

        {/* Scrubber + range title combined into one compact row. The
         * full date title was redundant when the scrubber thumb +
         * range buttons already convey the same info. */}
        <div
          className={cn(
            "mt-2 rounded-lg border border-[rgba(17,19,24,0.06)] bg-[rgba(255,255,255,0.78)] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]",
            // A phone pages with ‹ › and Today; the two-year slider is a
            // desktop control.
            "max-lg:hidden",
          )}
        >
          <div className="grid gap-x-3 gap-y-1.5 xl:grid-cols-[minmax(18rem,auto)_minmax(24rem,1fr)_minmax(14rem,auto)] xl:items-center">
            {/* The range title and the vehicle/booking count are both
                gone. Every column below is labelled with its own date,
                so the range restated the header of the thing directly
                underneath it, and the counts are repeated in the
                timeline's own corner cell. */}

            <div className="flex min-w-0 items-center gap-2">
              <input
                type="range"
                min={-SCRUBBER_DAY_RANGE}
                max={SCRUBBER_DAY_RANGE}
                step={1}
                value={Math.max(
                  -SCRUBBER_DAY_RANGE,
                  Math.min(
                    SCRUBBER_DAY_RANGE,
                    Math.round((normalizedFocusDate.getTime() - today.getTime()) / DAY_IN_MS),
                  ),
                )}
                onChange={(event) => {
                  scrollToDate(addDays(today, Number(event.target.value)), "auto");
                }}
                aria-label={calendarMessages.scrubberLabel}
                className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent accent-[var(--accent)] [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(90deg,rgba(17,19,24,0.08),rgba(89,60,251,0.18),rgba(17,19,24,0.08))] [&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-[0_8px_20px_-10px_rgba(89,60,251,0.9)] [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[rgba(17,19,24,0.12)] [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[var(--accent)]"
              />
              <span className="shrink-0 rounded-full bg-[rgba(17,19,24,0.06)] px-2.5 py-0.5 text-[11px] tracking-[0.16em] text-[color:var(--ink)]">
                {formatDate(normalizedFocusDate, locale)}
              </span>
            </div>

            <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 xl:justify-end">
              {/* What the colours mean. Learnt once, but until then a
                  blue bar and a green one were two shades of "a trip". */}
              <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[color:var(--ink-soft)]">
                {(
                  [
                    ["unsynced", "h-2.5 w-4 rounded-sm bg-[#3456df]"],
                    ["synced", "h-2.5 w-4 rounded-sm bg-[#2f7f67]"],
                    ["conflict", "h-2.5 w-4 rounded-sm bg-[#e5484d]"],
                    ["service", "h-2.5 w-4 rounded-sm border border-amber-500 bg-amber-300"],
                    ["cancelled", "h-2 w-4 rounded-sm border border-dashed border-[rgba(17,19,24,0.35)] bg-[rgba(17,19,24,0.10)]"],
                    ["now", "h-3 w-[2px] bg-[var(--accent)]"],
                    ["turnaround", "h-2.5 w-2.5 rounded-full border border-amber-400 bg-amber-100"],
                  ] as const
                ).map(([key, swatch]) => (
                  <li key={key} className="flex items-center gap-1.5 whitespace-nowrap">
                    <span aria-hidden className={cn("inline-block shrink-0", swatch)} />
                    {calendarMessages.barLegend[key]}
                  </li>
                ))}
              </ul>
              {normalizedCalendarSearchQuery ? (
                <span className="rounded-full bg-[rgba(255,231,122,0.58)] px-2.5 py-0.5 text-[11px] font-semibold text-[color:var(--ink)]">
                  {calendarMessages.summary(sortedVehicles.length, visibleOrders.length)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* The hint is always here while it is relevant, never toggled by
          whether something is selected.
          
          It used to disappear on the first click, which took its line
          of height with it and pulled the whole grid up -- so the
          second click of "click the first day, click the last" landed
          on the row above the one you were aiming at. A hint that
          breaks the gesture it is explaining is worse than no hint. */}
      {/* Only bulk mode explains itself now. The day-picking line sat
          under the toolbar permanently, one more row of text above the
          grid; picking a day shows its own bar with what to do next. */}
      {!readOnly && bulkMode ? (
        <p className="mt-2 rounded-md border border-[rgba(89,60,251,0.25)] bg-[rgba(89,60,251,0.06)] px-3 py-1.5 text-[12px] text-[color:var(--ink-soft)]">
          {calendarMessages.bulkModeHint}
        </p>
      ) : null}

      {isFeedOpen ? (
        <CalendarFeedDialog
          labels={calendarMessages.feed}
          vehicleOptions={vehicleOptions}
          onClose={() => setIsFeedOpen(false)}
        />
      ) : null}

      {isRecurringOpen ? (
        <RecurringOrderDialog
          locale={locale}
          labels={calendarMessages.recurring}
          vehicleOptions={vehicleOptions}
          defaultVehicleId={
            selectedVehicleId !== "all" ? selectedVehicleId : sortedVehicles[0]?.id
          }
          onClose={() => setIsRecurringOpen(false)}
        />
      ) : null}

      {monthCalendarFor ? (
        <VehicleMonthCalendar
          locale={locale}
          vehicleId={monthCalendarFor}
          vehicleLabel={
            (() => {
              const vehicle = vehicleOptions.find((item) => item.id === monthCalendarFor);
              return [vehicle?.plateNumber || vehicle?.label, vehicle?.secondaryLabel]
                .filter(Boolean)
                .join(" \u00b7 ");
            })()
          }
          onClose={() => setMonthCalendarFor(null)}
          onSelectOrder={(order) => {
            // The grid's copy when it has one. A trip months away is
            // not loaded here, and clicking it used to do nothing; the
            // month view fetched it from the same route the grid uses,
            // so its record is already the full shape.
            const full =
              orders.find((item) => item.id === order.id) ?? (order as unknown as CalendarOrder);
            setMonthCalendarFor(null);
            setSelectedOrder(full);
            setOrderPopover({ isOpen: true });
          }}
        />
      ) : null}

      {pricePanel && pricing ? (
        <CalendarPricePanel
          locale={locale}
          cars={vehicleOptions
            .filter((vehicle) => pricing.rates[vehicle.id]?.bookable)
            .map((vehicle) => ({
              id: vehicle.id,
              label: vehicle.secondaryLabel || vehicle.label,
              plateNumber: vehicle.plateNumber || vehicle.label,
            }))}
          initialVehicleIds={pricePanel.vehicleIds}
          initialDays={pricePanel.days}
          resolveDayPrice={resolveDayPrice}
          onClose={() => setPricePanel(null)}
          onSaved={(changes) => {
            // Patched in place rather than reloaded: the grid's scroll
            // position and loaded chunks are the expensive part of this
            // page, and a price change has no bearing on either.
            setPriceOverrides((current) => {
              const next = { ...current };
              for (const change of changes) {
                const forVehicle = { ...(next[change.vehicleId] ?? {}) };
                if (change.price == null) delete forVehicle[change.date];
                else forVehicle[change.date] = change.price;
                next[change.vehicleId] = forVehicle;
              }
              return next;
            });
            // A price set here is a person's, whatever set the day before.
            setDynamicDays((current) => {
              const next = new Set(current);
              for (const change of changes) next.delete(`${change.vehicleId}:${change.date}`);
              return next;
            });
            setShowPrices(true);
            setPricePanel(null);
            setDaySelection(null);
          }}
        />
      ) : null}

      {/* One bar, two selections. It is fixed rather than in flow so it
          cannot shove the grid down under the cursor mid-gesture. */}
      {!readOnly && (daySelection || (bulkMode && bulkSelection.size > 0) || bulkNotice) ? (
        // On a phone it sits on top of the tab bar, not over it: at
        // bottom-0 it covered Home and Calendar, the way out of this
        // screen.
        <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-[color:var(--line)] bg-[rgba(255,255,255,0.97)] px-3 py-2 shadow-[0_-18px_40px_-28px_rgba(17,19,24,0.5)] backdrop-blur pb-[calc(0.5rem+env(safe-area-inset-bottom))] max-lg:bottom-[calc(env(safe-area-inset-bottom)+56px)] max-lg:pb-2">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 text-[12px]">
            {daySelection ? (
              <>
                <span className="font-semibold text-[color:var(--ink)]">
                  {calendarMessages.selectionCount(daySelection.days.length)}
                </span>
                <span className="text-[color:var(--ink-soft)]">
                  {vehicleOptions.find((vehicle) => vehicle.id === daySelection.vehicleId)
                    ?.plateNumber ?? ""}
                  {" \u00b7 "}
                  {sortedSelectedDays.length <= 3
                    ? sortedSelectedDays.join(", ")
                    : `${sortedSelectedDays[0]} \u2026 ${sortedSelectedDays[sortedSelectedDays.length - 1]}`}
                </span>

                <button
                  type="button"
                  onClick={openCreateOrderFromSelection}
                  disabled={!selectionIsRun}
                  title={selectionIsRun ? undefined : calendarMessages.selectionNeedsRun}
                  className={cn(primaryActionClass, "h-8")}
                >
                  {calendarMessages.selectionCreateOrder}
                </button>

                <button
                  type="button"
                  onClick={openServiceFromSelection}
                  className={cn(secondaryActionClass, "h-8 gap-1.5 border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100")}
                >
                  <Wrench className="h-3.5 w-3.5" aria-hidden />
                  {calendarMessages.service.newAction}
                </button>

                {pricing ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPricePanel({
                        vehicleIds: [daySelection.vehicleId],
                        days: sortedSelectedDays,
                      })
                    }
                    className={cn(secondaryActionClass, "h-8")}
                  >
                    {messages.calendarPricePanel.openAction}
                  </button>
                ) : null}

                {/* Its own row on a phone. Sharing one with four buttons
                    left the field three letters wide. */}
                {!limitedToVehicles ? (
                <>
                <label className="flex min-w-0 flex-1 items-center gap-1.5 max-sm:basis-full">
                  <span className="whitespace-nowrap text-[color:var(--ink-soft)]">
                    {calendarMessages.noteLabel}
                  </span>
                  <input
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveNote();
                      }
                    }}
                    maxLength={500}
                    placeholder={calendarMessages.notePlaceholder}
                    className="h-8 min-w-0 flex-1 rounded-md border border-[var(--line)] bg-white px-2 text-[12px] text-[color:var(--ink)] outline-none focus:border-[var(--accent)]"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void saveNote()}
                  disabled={!noteDraft.trim() || isSavingNote}
                  className={cn(secondaryActionClass, "h-8")}
                >
                  {isSavingNote
                    ? calendarMessages.noteSavingAction
                    : calendarMessages.noteSaveAction}
                </button>
                </>
                ) : null}
                <button
                  type="button"
                  onClick={clearDaySelection}
                  className={cn(secondaryActionClass, "h-8")}
                >
                  {calendarMessages.selectionClear}
                </button>
              </>
            ) : null}

            {bulkMode && bulkSelection.size > 0 ? (
              <>
                <span className="font-semibold text-[color:var(--ink)]">
                  {calendarMessages.bulkSelectedCount(bulkSelection.size)}
                </span>
                <button
                  type="button"
                  onClick={() => void bulkSyncToOwners()}
                  disabled={bulkBusy}
                  className={cn(primaryActionClass, "h-8")}
                >
                  {bulkBusy ? calendarMessages.bulkSyncing : calendarMessages.bulkSyncAction}
                </button>
                <button
                  type="button"
                  onClick={() => setBulkSelection(new Set())}
                  className={cn(secondaryActionClass, "h-8")}
                >
                  {calendarMessages.selectionClear}
                </button>
              </>
            ) : null}

            {bulkNotice ? (
              <span className="text-[color:var(--ink-soft)]">{bulkNotice}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* `isolate` keeps the grid's sticky header (z-40/50) stacking
          inside this card, so the toolbar's menus open over it. */}
      <section className="calendar-dense isolate overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.74)] p-2.5 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
        {sortedVehicles.length === 0 ? (
          <div className="rounded-lg bg-[rgba(255,255,255,0.72)] px-4 py-10 text-sm text-[color:var(--ink-soft)]">
            {calendarMessages.noVehicles}
          </div>
        ) : (
          <div className="relative">
          {/* Says how far the drag has gone, while it is going. Fades
              rather than unmounts, so it never reflows the grid. */}
          <div
            ref={panPillRef}
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded-full bg-[rgba(17,19,24,0.82)] px-3 py-1 text-[11px] font-semibold text-white opacity-0 transition-opacity duration-150"
          />
          <div
            ref={timelineViewportRef}
            /* Two of these classes are the sideways gesture working at
               all. `touch-pan-y` reserves the vertical axis for the
               browser and leaves the horizontal one to the drag
               handler above. `overscroll-x-contain` keeps the gesture
               inside the timeline: left at `auto`, reaching either end
               passes it up to the browser, and on macOS and iOS that
               is the back/forward swipe -- so a hard scroll towards
               next month stops the calendar and navigates the app
               away instead. */
            className={cn(
              "max-h-[76vh] cursor-grab touch-pan-y overflow-auto overscroll-x-contain rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.95)] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]",
              // The server cannot know the screen, so its markup is the
              // desktop layout. Hidden until measured, so a phone never
              // shows that frame before its own.
              timelineViewportWidth === null && "invisible",
            )}
          >
            <div style={{ width: tableWidth, minWidth: vehicleColumnWidth + timelineWidth }}>
              <div
                className="sticky top-0 z-40 grid border-b border-[color:var(--line)] bg-[rgba(255,251,246,0.92)] backdrop-blur"
                style={{
                  gridTemplateColumns: `${vehicleColumnWidth}px ${timelineWidth}px`,
                }}
              >
                <div className="sticky left-0 z-50 border-r border-[color:var(--line)] bg-[linear-gradient(180deg,#ffffff,#f7f7f7)] px-3 py-3 max-lg:px-2 max-lg:py-2">
                  <div className="flex items-center justify-between gap-1">
                    {/* 88px on a phone: the word and the sort button
                        overlapped. The column needs no caption there. */}
                    <p className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--ink-soft)] max-sm:sr-only">
                      {messages.shell.nav.vehicles}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setRowSort(
                          (current) =>
                            ROW_SORTS[(ROW_SORTS.indexOf(current) + 1) % ROW_SORTS.length],
                        )
                      }
                      title={calendarMessages.sortHint(rowSort)}
                      aria-label={calendarMessages.sortHint(rowSort)}
                      className="tap-compact shrink-0 rounded border border-[var(--line)] bg-white px-1 text-[10px] font-semibold leading-[16px] text-[color:var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.22)] hover:text-[var(--ink)]"
                    >
                      {rowSort === "plate" ? "\u2193A" : rowSort === "plateDesc" ? "\u2191A" : "\u2691"}
                    </button>
                  </div>
                  {/* The count wraps to three lines in a 104px column
                      and pushes every bar down by roughly a row for
                      information the page states again below. Desktop
                      keeps it; the phone gets the bars sooner. */}
                  <p className="mt-1.5 hidden text-[12px] font-semibold text-[color:var(--ink)] lg:block">
                    {calendarMessages.summary(sortedVehicles.length, visibleOrders.length)}
                  </p>
                </div>
                {/* Only the columns near the viewport exist. The strip
                    is the full canvas width, so the scrollbar and every
                    bar position below stay honest. */}
                <div className="relative" style={{ width: timelineWidth }}>
                {visibleDays.map(({ date, index }) => {
                  const weekend = [0, 6].includes(date.getDay());
                  const todayColumn = isSameDay(date, nowDay);

                  return (
                    <div
                      key={index}
                      className={cn(
                        "absolute inset-y-0 border-r border-[color:var(--line)] px-1 py-1.5 text-center",
                        // One background each: two bg classes on one
                        // element let the stylesheet's order pick, and a
                        // weekend today came out as a plain weekend.
                        todayColumn
                          ? "bg-[rgba(89,60,251,0.14)]"
                          : weekend
                            ? "bg-[#f3ede4]"
                            : "bg-[rgba(255,251,246,0.9)]",
                      )}
                      style={{ left: index * dayColumnWidth, width: dayColumnWidth }}
                    >
                      {/* Bigger. This row is the calendar's own axis --
                          every bar below is read against it -- and it
                          was set two steps smaller than the body text
                          it labels. Today's column says so in words, in
                          the accent, so it is found without counting. */}
                      <p
                        className={cn(
                          "truncate text-[11px] font-semibold uppercase tracking-[0.04em] max-lg:text-[9px] max-lg:tracking-normal",
                          todayColumn ? "text-[var(--accent)]" : "text-[color:var(--ink-soft)]",
                        )}
                      >
                        {todayColumn && !compact ? calendarMessages.today : formatWeekday(date, locale, compact)}
                      </p>
                      <p
                        className={cn(
                          "mt-0.5 whitespace-nowrap text-[14px] font-bold leading-tight tabular-nums max-lg:text-[11px]",
                          todayColumn ? "text-[var(--accent)]" : "text-[color:var(--ink)]",
                        )}
                      >
                        {formatTimelineDateLabel(date)}
                      </p>
                    </div>
                  );
                })}
                {/* Now, as a notch at the foot of the date row; the line
                    itself runs down every row below. */}
                {nowOffset !== null ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute bottom-0 h-1.5 w-1.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-[var(--accent)]"
                    style={{ left: nowOffset }}
                  />
                ) : null}
                </div>
              </div>

              {sortedVehicles.map((vehicle, index) => {
                const vehicleOrders = filteredOrders.filter(
                  (order) => order.vehicleId === vehicle.id,
                );
                const { bars, laneCount } = assignTimelineBars(
                  vehicleOrders,
                  rangeStart,
                  rangeEndExclusive,
                  dayColumnWidth,
                  barWindowStart,
                  barWindowEndExclusive,
                );
                const rowNotes = notes.filter((note) => note.vehicleId === vehicle.id);
                const rowServices = serviceRecords.filter((record) => record.vehicleId === vehicle.id);
                const rowCancelled = cancelledOrders.filter(
                  (order) =>
                    order.vehicleId === vehicle.id &&
                    orderIntersectsRange(order, barWindowStart, barWindowEndExclusive),
                );
                const rowHeight =
                  Math.max(minRowHeight, laneCount * laneHeight + 8) +
                  (rowNotes.length > 0 ? NOTE_BAND_HEIGHT + 2 : 0) +
                  (rowCancelled.length > 0 ? CANCELLED_BAND_HEIGHT + 2 : 0) +
                  (rowServices.length > 0 ? SERVICE_BAND_HEIGHT + 2 : 0);
                // The strips along the foot of the row, stacked.
                const bandsHeight =
                  (rowNotes.length > 0 ? NOTE_BAND_HEIGHT + 3 : 0) +
                  (rowCancelled.length > 0 ? CANCELLED_BAND_HEIGHT + 3 : 0) +
                  (rowServices.length > 0 ? SERVICE_BAND_HEIGHT + 3 : 0);
                // Back-to-back trips on this car with only hours between
                // them: the car has to be turned around -- cleaned,
                // charged, checked -- in that gap. Overlaps are already
                // red; this is the tight-but-legal case.
                const turnarounds: Array<{ key: string; left: number; top: number; hours: number }> = [];
                // Not while searching: the bars dim, and a bright marker
                // between two dimmed trips pointed at nothing.
                if (!compact && !normalizedCalendarSearchQuery) {
                  const ordered = [...bars].sort(
                    (a, b) =>
                      new Date(a.order.pickupDatetime).getTime() -
                      new Date(b.order.pickupDatetime).getTime(),
                  );
                  // Against the latest return so far, not just the trip
                  // before: when two trips overlap, the next one out
                  // waits for whichever comes back last.
                  let latest = ordered[0];
                  for (let position = 1; position < ordered.length; position += 1) {
                    const next = ordered[position];
                    const latestReturn = new Date(latest.order.returnDatetime).getTime();
                    const gapMs = new Date(next.order.pickupDatetime).getTime() - latestReturn;
                    if (gapMs >= 0 && gapMs <= TURNAROUND_ALERT_MS) {
                      turnarounds.push({
                        key: `${latest.order.id}:${next.order.id}`,
                        left: next.left,
                        top: barTopOffset + Math.max(latest.lane, next.lane) * laneHeight + barHeight - 6,
                        hours: gapMs / 3_600_000,
                      });
                    }
                    if (new Date(next.order.returnDatetime).getTime() > latestReturn) latest = next;
                  }
                }
                const alternateRow = index % 2 === 1;
                const rowSelection =
                  daySelection?.vehicleId === vehicle.id ? daySelection.days : null;

                return (
                  <div
                    key={vehicle.id}
                    className="group/row grid border-b border-[color:var(--line)] last:border-b-0"
                    style={{
                      gridTemplateColumns: `${vehicleColumnWidth}px ${timelineWidth}px`,
                    }}
                  >
                    <div
                      className={cn(
                        "sticky left-0 z-20 flex flex-col justify-center overflow-hidden border-r border-[color:var(--line)] px-3 py-1.5 backdrop-blur max-lg:px-2 max-lg:py-1",
                        // The detail the second line used to carry.
                        "cursor-default",
                        // Opaque, not 95%. The column stands still
                        // while a month of days slides underneath it,
                        // and five percent of that was enough to read
                        // as ghost text through the plate numbers.
                        alternateRow ? "bg-[#faf4eb]" : "bg-white",
                        // The row under the pointer lights its plate, so
                        // a bar far to the right is read against the
                        // right car without tracing the line back.
                        "transition-colors group-hover/row:bg-[var(--accent-soft-strong)]",
                      )}
                      style={{ height: rowHeight }}
                      title={[vehicle.plateNumber, vehicle.secondaryLabel, vehicle.ownerName]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {/* On a phone the two badges drop under the plate
                          rather than squeezing it to "DJ…". */}
                      <span
                        className={cn(
                          "flex min-w-0 items-center gap-1 max-sm:flex-wrap max-sm:gap-y-0.5",
                          vehicle.archived && "opacity-60",
                        )}
                      >
                      {!readOnly && vehicle.editVehicle ? (
                        <VehicleEditDialog
                          locale={locale}
                          vehicle={vehicle.editVehicle}
                          owners={ownerOptions}
                          trigger={
                            <span className="truncate">
                              {highlightText(vehicle.plateNumber || vehicle.label, vehicleFilterQuery)}
                            </span>
                          }
                          triggerClassName="tap-compact inline-flex max-w-full items-center rounded px-0 text-left text-[12px] font-semibold leading-tight text-[color:var(--ink)] underline-offset-2 transition hover:text-[var(--accent)] hover:underline max-lg:text-[11px]"
                        />
                      ) : (
                        <p className="truncate text-[12px] font-semibold leading-tight text-[color:var(--ink)] max-lg:text-[11px]">
                          {highlightText(vehicle.plateNumber || vehicle.label, vehicleFilterQuery)}
                        </p>
                      )}
                      {/* Says the car is on Turo, which the presence of
                          Turo orders does not: a car can be listed with
                          no trips yet, and can keep old Turo trips long
                          after being delisted. */}
                      {!readOnly ? (
                        <button
                          type="button"
                          onClick={() => setMonthCalendarFor(vehicle.id)}
                          title={calendarMessages.monthViewAction}
                          aria-label={`${vehicle.plateNumber || vehicle.label} \u2014 ${calendarMessages.monthViewAction}`}
                          className="tap-compact shrink-0 rounded border border-[var(--line)] bg-white px-1 text-[10px] leading-[14px] text-[color:var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.22)] hover:text-[var(--ink)]"
                        >
                          {"\u25a6"}
                        </button>
                      ) : null}
                      {vehicle.turoLinked ? (
                        <span
                          title={calendarMessages.turoLinkedHint}
                          className="shrink-0 rounded-[3px] bg-[rgba(52,86,223,0.12)] px-1 text-[9px] font-bold leading-[14px] text-[#3456df]"
                        >
                          T
                        </span>
                      ) : null}
                      {/* Bookable on the operator's own site, the badge
                          next to Turo's "T": where else this car sells. */}
                      {vehicle.directBooking && !vehicle.archived ? (
                        <span
                          title={calendarMessages.directBookingHint}
                          aria-label={calendarMessages.directBookingHint}
                          className="inline-flex shrink-0 items-center rounded-[3px] bg-[rgba(89,60,251,0.12)] px-0.5 leading-[14px] text-[var(--accent)]"
                        >
                          <Ticket className="h-[11px] w-[11px]" aria-hidden />
                        </span>
                      ) : null}
                      {vehicle.archived ? (
                        <span className="shrink-0 rounded-[3px] bg-[var(--surface-muted)] px-1 text-[9px] font-semibold leading-[14px] text-[color:var(--ink-soft)]">
                          {calendarMessages.archivedBadge}
                        </span>
                      ) : null}
                      </span>
                      {/* The plate is the column, on every size now.
                          Model and owner were a second line under it,
                          and in a grid whose job is "which car is free
                          when" they are the part nobody reads -- the
                          plate identifies the car and the row already
                          opens a dialog with everything else. Kept in
                          the tooltip so the detail is a hover away
                          rather than gone. */}
                      <p className="mt-0.5 hidden truncate text-[10.5px] leading-tight text-[color:var(--ink-soft)]">
                        {highlightText(vehicle.secondaryLabel || vehicle.label, vehicleFilterQuery)}
                        {" · "}
                        {highlightText(vehicle.ownerName || calendarMessages.unassignedOwner, ownerFilterQuery)}
                      </p>
                    </div>

                    <div
                      className={cn(
                        "relative",
                        alternateRow ? "bg-[#fcf7f1]" : "bg-[rgba(255,255,255,0.72)]",
                        !readOnly && !bulkMode ? "cursor-pointer" : "",
                      )}
                      style={{ height: rowHeight }}
                      onClick={(event) => {
                        if (readOnly || bulkMode) return;
                        // Bars and note bands are their own targets.
                        const target = event.target as HTMLElement;
                        if (target.closest("[data-calendar-order-bar],[data-calendar-note],[data-calendar-service],[data-calendar-cancelled]")) return;
                        // Fires on click, not pointer-down, so a pan
                        // that merely starts on a day does not pick it
                        // -- and a pan that ends on one is swallowed by
                        // the same guard the drag handler already uses.
                        const bounds = event.currentTarget.getBoundingClientRect();
                        const offsetX = event.clientX - bounds.left;
                        const dayIndex = Math.floor(offsetX / Math.max(dayColumnWidth, 1));
                        const date = days[dayIndex];
                        if (date) toggleDay(vehicle.id, date);
                      }}
                    >
                      {/* Day columns and weekend shading are painted,
                          not built. One div per day per car is 71,000
                          elements on this canvas; two gradients cost
                          nothing and look identical. The weekend band
                          is only correct because the canvas starts on
                          a Monday -- see CANVAS_START_OFFSET_DAYS. */}
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0"
                        style={{ backgroundImage: dayGridBackground, backgroundRepeat: "repeat" }}
                      />
                      {/* Picked days. Only this row can have any, so
                          there is no per-row check to do here. */}
                      {rowSelection?.map((key) => {
                        const offset = Math.round(
                          (new Date(`${key}T00:00:00`).getTime() - canvasStart.getTime()) /
                            DAY_IN_MS,
                        );
                        if (offset < 0 || offset >= days.length) return null;
                        return (
                          <div
                            key={key}
                            aria-hidden
                            className="pointer-events-none absolute inset-y-0 bg-[rgba(245,158,11,0.22)] ring-1 ring-inset ring-[rgba(217,119,6,0.55)]"
                            style={{ left: offset * dayColumnWidth, width: dayColumnWidth }}
                          />
                        );
                      })}

                      {/* One label per visible day, not per day on
                          the canvas -- 580 columns times a fleet is the
                          count this grid was rebuilt to avoid. The
                          window is the same one the headers use. */}
                      {showPrices && pricing?.rates[vehicle.id]?.bookable
                        ? visibleDays.map(({ date, index }) => {
                            const key = toDayParam(date);
                            const resolved = resolveDayPrice(vehicle.id, key);
                            if (!resolved) return null;
                            // A price only means something on a day a
                            // renter could still book: the car is out
                            // at noon, so the day is taken.
                            const noon = date.getTime() + 12 * 60 * 60 * 1000;
                            const taken = orders.some(
                              (order) =>
                                order.vehicleId === vehicle.id &&
                                order.status !== "cancelled" &&
                                new Date(order.pickupDatetime).getTime() <= noon &&
                                new Date(order.returnDatetime).getTime() >= noon,
                            );
                            if (taken) return null;
                            return (
                              <span
                                key={`price-${key}`}
                                aria-hidden
                                className={cn(
                                  "pointer-events-none absolute text-center text-[9px] leading-none tabular-nums",
                                  resolved.dynamic
                                    ? "font-bold text-[color:var(--brand)]"
                                    : resolved.fixed
                                      ? "font-bold text-[color:var(--ink)]"
                                      : "text-[color:var(--ink-soft)]",
                                )}
                                // Above the note, cancelled and service
                                // bands: at the foot of the row they ran
                                // underneath them, "$64" through a
                                // struck-out renter's name.
                                style={{ left: index * dayColumnWidth, width: dayColumnWidth, bottom: bandsHeight + 2 }}
                              >
                                {dayPriceFormat.formatToParts(resolved.price).map((part, partIndex) =>
                                  part.type === "currency" ? (
                                    <span key={partIndex} className="text-[7px]">
                                      {part.value}
                                    </span>
                                  ) : (
                                    part.value
                                  ),
                                )}
                              </span>
                            );
                          })
                        : null}

                      {/* Today is one column, so it stays an element. */}
                      {todayColumnOffset !== null ? (
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 bg-[rgba(89,60,251,0.08)]"
                          style={{ left: todayColumnOffset, width: dayColumnWidth }}
                        />
                      ) : null}
                      {/* Now, to the minute. Which trips are out, which
                          have just come back and which go next is read
                          off which side of this line a bar is on. Over
                          the bars, under the bands and anything clickable
                          on them. */}
                      {nowOffset !== null ? (
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 z-[5] w-[2px] -translate-x-1/2 bg-[var(--accent)]/70"
                          style={{ left: nowOffset }}
                        />
                      ) : null}

                      {rowServices.map((record) => {
                        const from = Math.max(
                          Math.round((new Date(`${record.startDate}T00:00:00`).getTime() - canvasStart.getTime()) / DAY_IN_MS),
                          0,
                        );
                        const to = Math.min(
                          Math.round((new Date(`${record.endDate}T00:00:00`).getTime() - canvasStart.getTime()) / DAY_IN_MS),
                          days.length - 1,
                        );
                        if (to < from) return null;
                        const left = from * dayColumnWidth;
                        const width = (to - from + 1) * dayColumnWidth;
                        const kindLabel = calendarMessages.service.kinds[record.kind] ?? record.kind;
                        const label = [
                          kindLabel,
                          record.mileage != null ? calendarMessages.service.km(record.mileage.toLocaleString(getLocaleTag(locale))) : null,
                          record.description || null,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <div key={`service-${record.id}`}>
                            {/* The wash: under the trips, over the day grid. */}
                            <div
                              aria-hidden
                              className="pointer-events-none absolute inset-y-0 border-x-2 border-amber-400/80 bg-[repeating-linear-gradient(135deg,rgba(251,191,36,0.42)_0_6px,rgba(251,191,36,0.20)_6px_12px)]"
                              style={{ left, width }}
                            />
                            <button
                              type="button"
                              data-calendar-service="true"
                              title={label}
                              onClick={() => {
                                if (bulkMode) return;
                                setServiceDialog({ record });
                              }}
                              className="tap-compact absolute z-10 flex items-center gap-1 overflow-hidden rounded-sm border border-amber-500 bg-amber-300 px-1 text-left text-[10px] font-semibold leading-none text-amber-950 shadow-[0_4px_10px_-6px_rgba(120,53,15,0.7)] transition hover:bg-amber-400"
                              style={{
                                left: left + 1,
                                width: Math.max(width - 2, 18),
                                bottom:
                                  (rowNotes.length > 0 ? NOTE_BAND_HEIGHT + 3 : 0) +
                                  (rowCancelled.length > 0 ? CANCELLED_BAND_HEIGHT + 3 : 0) +
                                  1,
                                height: SERVICE_BAND_HEIGHT,
                              }}
                            >
                              <Wrench className="h-2.5 w-2.5 shrink-0" aria-hidden />
                              <span className="truncate">{label}</span>
                            </button>
                          </div>
                        );
                      })}

                      {rowCancelled.map((order) => {
                        const start = new Date(order.pickupDatetime).getTime();
                        const end = new Date(order.returnDatetime).getTime();
                        const from = Math.max(start, canvasStart.getTime());
                        const to = Math.min(end, rangeEndExclusive.getTime());
                        if (to <= from) return null;
                        const left = columnPosition(from, canvasStart.getTime()) * dayColumnWidth;
                        const width = Math.max(
                          (columnPosition(to, canvasStart.getTime()) - columnPosition(from, canvasStart.getTime())) *
                            dayColumnWidth,
                          14,
                        );
                        return (
                          <button
                            key={order.id}
                            type="button"
                            data-calendar-cancelled="true"
                            title={`${order.renterName} \u00b7 ${getStatusLabel("cancelled", locale)}`}
                            onClick={() => {
                              if (bulkMode) return;
                              setSelectedOrder(order);
                              setOrderPopover({ isOpen: true });
                            }}
                            className={cn(
                              "tap-compact absolute z-10 flex items-center overflow-hidden rounded-sm border border-dashed px-1 text-left text-[9px] leading-none line-through",
                              "border-[rgba(17,19,24,0.28)] bg-[rgba(17,19,24,0.10)] text-[color:var(--ink-soft)] transition hover:bg-[rgba(17,19,24,0.18)]",
                              !orderMatchesSearch(order) ? "opacity-15" : "",
                            )}
                            style={{
                              left,
                              width,
                              // Above the note band when there is one, so
                              // the two never sit on top of each other.
                              bottom: (rowNotes.length > 0 ? NOTE_BAND_HEIGHT + 3 : 0) + 1,
                              height: CANCELLED_BAND_HEIGHT,
                            }}
                          >
                            <span className="truncate">{order.renterName}</span>
                          </button>
                        );
                      })}

                      {rowNotes.map((note) => {
                        const from = Math.round(
                          (new Date(`${note.startDate}T00:00:00`).getTime() -
                            canvasStart.getTime()) /
                            DAY_IN_MS,
                        );
                        const to = Math.round(
                          (new Date(`${note.endDate}T00:00:00`).getTime() - canvasStart.getTime()) /
                            DAY_IN_MS,
                        );
                        const clampedFrom = Math.max(from, 0);
                        const clampedTo = Math.min(to, days.length - 1);
                        if (clampedTo < clampedFrom) return null;
                        return (
                          <button
                            key={note.id}
                            type="button"
                            data-calendar-note="true"
                            title={`${note.text} \u00b7 ${calendarMessages.noteDeleteHint}`}
                            onClick={() => deleteNote(note)}
                            className="tap-compact absolute z-10 flex items-center overflow-hidden rounded-sm border border-[rgba(17,19,24,0.12)] bg-[rgba(17,19,24,0.07)] px-1.5 text-left text-[10px] font-medium leading-none text-[color:var(--ink)] transition hover:bg-[rgba(17,19,24,0.14)]"
                            style={{
                              left: clampedFrom * dayColumnWidth + 1,
                              width: Math.max((clampedTo - clampedFrom + 1) * dayColumnWidth - 2, 16),
                              bottom: 1,
                              height: NOTE_BAND_HEIGHT,
                            }}
                          >
                            <span className="truncate">{note.text}</span>
                          </button>
                        );
                      })}

                      {/* Anchored to what is on screen. It used to sit at the
                          canvas's left edge -- six months back -- so it showed
                          only there, and there it ran across the price in
                          each cell. With prices on, the prices already say
                          the car is free. */}
                      {bars.length === 0 && !showPrices ? (
                        <div
                          className="pointer-events-none absolute inset-y-0 flex items-center text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]/70"
                          style={{ left: scrollLeft + 12 }}
                        >
                          {calendarMessages.emptyRow}
                        </div>
                      ) : null}

                      {bars.map((bar) => {
                        const startTime = formatTime(bar.order.pickupDatetime);
                        const endTime = formatTime(bar.order.returnDatetime);
                        // What of the bar is on screen. A trip that began
                        // before the visible days, or runs past them, keeps
                        // its name and times at the visible edges instead of
                        // off-screen -- a month-long stay otherwise read as
                        // a bare coloured strip.
                        const visibleTimelineWidth = Math.max(
                          (timelineViewportWidth ?? 0) - vehicleColumnWidth,
                          0,
                        );
                        const labelInset = Math.max(
                          0,
                          Math.min(scrollLeft - bar.left, bar.width - 56),
                        );
                        const rightInset = Math.max(
                          0,
                          Math.min(
                            bar.left + bar.width - (scrollLeft + visibleTimelineWidth),
                            bar.width - labelInset - 56,
                          ),
                        );
                        const visibleBarWidth = bar.width - labelInset - rightInset;
                        // Too narrow for anything readable: a bare block
                        // says "something is here"; tap and tooltip say
                        // what. Times need room for both corners.
                        const showName = visibleBarWidth >= 32;
                        const showTimes = visibleBarWidth >= (compact ? 64 : 84);

                        return (
                          <button
                            key={bar.order.id}
                            type="button"
                            data-calendar-order-bar="true"
                            title={`${startTime} → ${endTime} · ${bar.order.vehicleName} · ${bar.order.renterName}`}
                            onClick={() => {
                              if (bulkMode) {
                                // In bulk mode a bar is a checkbox, not
                                // a door. Opening one here would lose
                                // the selection behind a modal.
                                setBulkSelection((current) => {
                                  const next = new Set(current);
                                  if (next.has(bar.order.id)) next.delete(bar.order.id);
                                  else next.add(bar.order.id);
                                  return next;
                                });
                                return;
                              }
                              setSelectedOrder(bar.order);
                              setOrderPopover({ isOpen: true });
                            }}
                            className={getTimelineBarClasses(
                              bar.order,
                              bar.clippedStart,
                              bar.clippedEnd,
                              compact,
                              !orderMatchesSearch(bar.order),
                              bulkSelection.has(bar.order.id),
                              nowMs !== null && new Date(bar.order.returnDatetime).getTime() < nowMs,
                            )}
                            style={{
                              left: bar.left,
                              top: barTopOffset + bar.lane * laneHeight,
                              width: bar.width,
                              height: barHeight,
                            }}
                          >
                            {showTimes ? (
                              <>
                                <span
                                  className={cn(
                                    "pointer-events-none absolute top-[1px] font-medium tabular-nums leading-none opacity-85",
                                    compact ? "text-[8px]" : "text-[9.5px]",
                                  )}
                                  style={{ left: (compact ? 4 : 7) + labelInset }}
                                >
                                  {startTime}
                                </span>
                                <span
                                  className={cn(
                                    "pointer-events-none absolute top-[1px] font-medium tabular-nums leading-none opacity-85",
                                    compact ? "text-[8px]" : "text-[9.5px]",
                                  )}
                                  style={{ right: (compact ? 4 : 7) + rightInset }}
                                >
                                  {endTime}
                                </span>
                              </>
                            ) : null}
                            {showName ? (
                              <span
                                className={cn(
                                  "block w-full truncate text-center",
                                  showTimes ? (compact ? "pt-[9px]" : "pt-[10px]") : "",
                                )}
                                style={{ paddingLeft: labelInset, paddingRight: rightInset }}
                              >
                                {highlightText(bar.order.renterName, calendarSearchQuery)}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}

                      {turnarounds.map((turnaround) => (
                        <span
                          key={turnaround.key}
                          aria-hidden
                          className="pointer-events-none absolute z-[6] -translate-x-1/2 whitespace-nowrap rounded-full border border-amber-400 bg-amber-100 px-1 text-[9px] font-bold leading-[12px] text-amber-900 tabular-nums"
                          style={{ left: turnaround.left, top: turnaround.top }}
                        >
                          {calendarMessages.turnaroundLabel(turnaround.hours)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          </div>
        )}
      </section>

      {selectedOrder && orderPopover ? (
        <OrderDetailModal
          order={selectedOrder}
          vehicleOptions={vehicleOptions}
          locale={locale}
          readOnly={readOnly}
          maskSensitive={maskSensitive}
          onClose={() => setOrderPopover(null)}
          onSaved={(updatedOrder) => setSelectedOrder(updatedOrder)}
          onDeleted={() => {
            setOrderPopover(null);
            setSelectedOrder(null);
          }}
        />
      ) : null}

      {!readOnly && serviceDialog ? (
        <ServiceRecordDialog
          locale={locale}
          vehicles={vehicleOptions}
          record={"record" in serviceDialog ? serviceDialog.record : null}
          seed={"seed" in serviceDialog ? serviceDialog.seed : undefined}
          onClose={() => setServiceDialog(null)}
          onSaved={(saved) => {
            setServiceRecords((current) => [...current.filter((item) => item.id !== saved.id), saved]);
            setServiceDialog(null);
          }}
          onDeleted={(id) => {
            setServiceRecords((current) => current.filter((item) => item.id !== id));
            setServiceDialog(null);
          }}
        />
      ) : null}

      {!readOnly && isOrderDialogOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={calendarMessages.createDialogTitle}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--ink)]/35 p-4"
        >
          <div className="w-full max-w-2xl rounded-lg border border-[color:var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,247,247,0.98))] p-5 shadow-[0_28px_70px_-28px_rgba(17,19,24,0.55)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-soft)]">
                  {calendarMessages.createDialogTitle}
                </p>
                <p className="mt-2 max-w-xl text-[13px] leading-5 text-[color:var(--ink-soft)]">
                  {calendarMessages.dialogCopy}
                </p>
              </div>
              <button type="button" onClick={closeOrderDialog} className={secondaryActionClass}>
                {calendarMessages.cancelAction}
              </button>
            </div>

            <form onSubmit={handleManualOrderSubmit} className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-[11px] text-[color:var(--ink-soft)]">
                <span>{calendarMessages.vehicleField}</span>
                <SearchableSelect
                  value={orderDraft.vehicleId}
                  onChange={(value) => setOrderDraft((current) => ({ ...current, vehicleId: value }))}
                  options={vehicleOptions.map((vehicle) => ({
                    value: vehicle.id,
                    label: vehicle.plateNumber ? `${vehicle.plateNumber} · ${vehicle.label}` : vehicle.label,
                    searchText: [vehicle.plateNumber, vehicle.label, vehicle.secondaryLabel, vehicle.ownerName]
                      .filter(Boolean)
                      .join(" "),
                  }))}
                  placeholder={calendarMessages.vehicleField}
                  searchPlaceholder={calendarMessages.searchVehiclesPlaceholder}
                  className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2.5 text-[13px] text-[color:var(--ink)] outline-none"
                />
              </label>

              <label className="grid gap-1.5 text-[11px] text-[color:var(--ink-soft)]">
                <span>{calendarMessages.renter}</span>
                <input
                  value={orderDraft.renterName}
                  onChange={(event) =>
                    setOrderDraft((current) => ({ ...current, renterName: event.target.value }))
                  }
                  className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2.5 text-[13px] text-[color:var(--ink)] outline-none"
                />
              </label>

              <label className="grid gap-1.5 text-[11px] text-[color:var(--ink-soft)]">
                <span>{calendarMessages.phone}</span>
                <input
                  type="tel"
                  value={orderDraft.renterPhone}
                  onChange={(event) =>
                    setOrderDraft((current) => ({ ...current, renterPhone: event.target.value }))
                  }
                  className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2.5 text-[13px] text-[color:var(--ink)] outline-none"
                />
              </label>

              <label className="grid gap-1.5 text-[11px] text-[color:var(--ink-soft)]">
                <span>{calendarMessages.totalPriceField}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={orderDraft.totalPrice}
                  onChange={(event) =>
                    setOrderDraft((current) => ({ ...current, totalPrice: event.target.value }))
                  }
                  onBlur={(event) =>
                    setOrderDraft((current) => ({
                      ...current,
                      totalPrice: formatCurrencyInputText(event.target.value),
                    }))
                  }
                  className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2.5 text-[13px] text-[color:var(--ink)] outline-none"
                />
              </label>

              <label className="grid gap-1.5 text-[11px] text-[color:var(--ink-soft)]">
                <span>{calendarMessages.pickup}</span>
                <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]">
                  <input
                    value={orderDraft.pickupDate}
                    onChange={(event) =>
                      setOrderDraft((current) => ({ ...current, pickupDate: event.target.value }))
                    }
                    inputMode="numeric"
                    placeholder="yyyy/mm/dd"
                    className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2.5 text-[13px] text-[color:var(--ink)] outline-none"
                  />
                  <input
                    value={orderDraft.pickupTime}
                    onChange={(event) =>
                      setOrderDraft((current) => ({ ...current, pickupTime: event.target.value }))
                    }
                    inputMode="numeric"
                    placeholder="HH:mm"
                    className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2.5 text-[13px] text-[color:var(--ink)] outline-none"
                  />
                </div>
              </label>

              <label className="grid gap-1.5 text-[11px] text-[color:var(--ink-soft)]">
                <span>{calendarMessages.return}</span>
                <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]">
                  <input
                    value={orderDraft.returnDate}
                    onChange={(event) =>
                      setOrderDraft((current) => ({ ...current, returnDate: event.target.value }))
                    }
                    inputMode="numeric"
                    placeholder="yyyy/mm/dd"
                    className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2.5 text-[13px] text-[color:var(--ink)] outline-none"
                  />
                  <input
                    value={orderDraft.returnTime}
                    onChange={(event) =>
                      setOrderDraft((current) => ({ ...current, returnTime: event.target.value }))
                    }
                    inputMode="numeric"
                    placeholder="HH:mm"
                    className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2.5 text-[13px] text-[color:var(--ink)] outline-none"
                  />
                </div>
              </label>

              <div className="rounded-md bg-[rgba(255,255,255,0.72)] px-3 py-3 text-[11px] leading-5 text-[color:var(--ink-soft)] sm:col-span-2">
                {calendarMessages.conflictNotice}
              </div>

              {orderFormError ? (
                <div className="rounded-md bg-rose-50 px-3 py-3 text-[11px] text-rose-700 sm:col-span-2">
                  {orderFormError}
                </div>
              ) : null}

              <div className="flex justify-end gap-2 sm:col-span-2">
                <button type="button" onClick={closeOrderDialog} className={secondaryActionClass}>
                  {calendarMessages.cancelAction}
                </button>
                <button type="submit" disabled={isSavingOrder} className={primaryActionClass}>
                  {isSavingOrder
                    ? calendarMessages.savingAction
                    : calendarMessages.createAction}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
