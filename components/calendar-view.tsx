"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { type EditableOrder, OrderDetailModal } from "@/components/order-detail-modal";
import { SearchableSelect } from "@/components/searchable-select";
import { StatusBadge } from "@/components/status-badge";
import { VehicleEditDialog, type VehicleEditDialogVehicle } from "@/components/vehicle-edit-dialog";
import { VehicleOrdersExportButton } from "@/components/vehicle-orders-export-button";
import { getMessages, getStatusLabel, type Locale } from "@/lib/i18n";
import { cn, foldLatinLookalikes, formatCurrencyInputText, formatCurrencyInputValue, formatDate, formatDateInputDisplay, formatTime as formatTime24, formatTimeInputDisplay, parseDateTimeInputParts } from "@/lib/utils";

type CalendarOrder = EditableOrder;

type VehicleTimelineOption = {
  id: string;
  label: string;
  plateNumber?: string | null;
  secondaryLabel?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
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
const MIN_CUSTOM_DAY_WIDTH = 30;
const MAX_CUSTOM_DAY_WIDTH = 104;
const DEFAULT_CUSTOM_DAY_WIDTH = 52;
const LANE_HEIGHT = 32;
const BAR_HEIGHT = 28;
// The same rows about a third shorter. Desktop heights on a phone made
// four vehicles a full screen; at these, it is closer to nine, which
// is the point of a timeline.
const COMPACT_LANE_HEIGHT = 22;
const COMPACT_BAR_HEIGHT = 20;
const COMPACT_MIN_ROW_HEIGHT = 31;
const MIN_ROW_HEIGHT = 44;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const SCRUBBER_DAY_RANGE = 365;

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
) {
  return cn(
    "absolute flex items-center overflow-hidden border-[1.5px] text-left font-semibold leading-tight text-white shadow-[0_18px_36px_-18px_rgba(17,19,24,0.7)] transition hover:-translate-y-0.5 hover:brightness-110 cursor-pointer",
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

function assignTimelineBars(
  orders: CalendarOrder[],
  rangeStart: Date,
  rangeEndExclusive: Date,
  dayColumnWidth: number,
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

    visibleBars.push({
      order,
      lane,
      left: ((visibleStart - rangeStartMs) / DAY_IN_MS) * dayColumnWidth,
      width: Math.max(((visibleEnd - visibleStart) / DAY_IN_MS) * dayColumnWidth, 18),
      clippedStart: actualStart < rangeStartMs,
      clippedEnd: actualEnd > rangeEndMs,
    });
  }

  return {
    bars: visibleBars,
    laneCount: laneEndTimes.length,
  };
}

function formatWeekday(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-CA", {
    weekday: locale === "zh" ? "short" : "short",
  }).format(date);
}

function formatTimelineDateLabel(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatMonthTitle(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-CA", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTime(value: Date | string) {
  return formatTime24(value);
}

function buildCreateDraft(baseDate: Date, vehicleId?: string) {
  const pickup = new Date(baseDate);
  pickup.setHours(10, 0, 0, 0);

  const returnDatetime = addDays(pickup, 1);
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
  orders,
  vehicleOptions,
  ownerOptions,
  readOnly = false,
  maskSensitive = false,
}: {
  locale: Locale;
  orders: CalendarOrder[];
  vehicleOptions: VehicleTimelineOption[];
  ownerOptions: Array<{ id: string; label: string }>;
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
  // v0.22.1: removed the Week / Month / 6-week segmented pill from the
  // toolbar. It was redundant with the day-width slider, which already
  // covers "show more dates at once" (slimmer columns) vs. "show fewer
  // dates at higher detail" (wider columns). We pin the underlying
  // range to `sixWeeks` so the timeline always covers ~42 days of
  // context — wide enough that scrubbing through a season feels
  // natural, while the slider lets the user fit anywhere from a
  // couple of weeks (wider columns) to all 42 days (narrower columns)
  // inside the viewport.
  //
  // Held in `useState` (no setter destructured) instead of a plain
  // `const`. TypeScript's strict-equality control-flow narrowing
  // folds `const x: Union = "sixWeeks"` back to the literal type
  // `"sixWeeks"` at every usage site, which makes each
  // `rangeMode === "week"` / `=== "month"` branch — prev/next stride,
  // range start/end derivation, day-column width floor — fail to
  // compile with "comparison appears unintentional, the types have
  // no overlap" (Railway's v0.22.1 build flagged exactly this).
  // `useState`'s generic argument anchors the declared type as the
  // full union so those branches type-check; they're dead at runtime,
  // which is the intent — the slider replaces the segmented pill.
  const [rangeMode] = useState<"week" | "month" | "sixWeeks">("sixWeeks");
  const [focusDate, setFocusDate] = useState(() => new Date());
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
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
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
  const [timelineViewportWidth, setTimelineViewportWidth] = useState<number | null>(null);
  const [orderPopover, setOrderPopover] = useState<OrderPopoverState | null>(null);
  const [isTuroSyncing, setIsTuroSyncing] = useState(false);
  const [turoSyncNotice, setTuroSyncNotice] = useState<TuroSyncNotice | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(DAY_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    if (Number.isFinite(parsed)) {
      setCustomDayWidth(Math.min(MAX_CUSTOM_DAY_WIDTH, Math.max(MIN_CUSTOM_DAY_WIDTH, parsed)));
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DAY_WIDTH_STORAGE_KEY, String(customDayWidth));
  }, [customDayWidth]);

  const normalizedFocusDate = startOfDay(focusDate);
  const rangeStart =
    rangeMode === "week"
      ? startOfWeek(normalizedFocusDate)
      : rangeMode === "month"
        ? startOfMonth(normalizedFocusDate)
        : startOfWeek(normalizedFocusDate);
  const visibleDayCount =
    rangeMode === "week"
      ? 7
      : rangeMode === "month"
        ? getDaysInMonth(normalizedFocusDate)
        : 42;
  const days = enumerateDates(rangeStart, visibleDayCount);
  const rangeEndExclusive = addDays(rangeStart, visibleDayCount);
  const rangeEndInclusive = addDays(rangeEndExclusive, -1);
  const today = startOfDay(new Date());

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
      }

      node.scrollLeft = drag.startScrollLeft - dx;

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

  useEffect(() => {
    const node = timelineViewportRef.current;
    if (!node) return;

    const syncWidth = () => {
      setTimelineViewportWidth(node.clientWidth);
    };

    syncWidth();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setTimelineViewportWidth(Math.round(entry?.contentRect.width ?? node.clientWidth));
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedOrder) return;

    const refreshedOrder = orders.find((order) => order.id === selectedOrder.id);
    if (refreshedOrder && refreshedOrder !== selectedOrder) {
      setSelectedOrder(refreshedOrder);
      return;
    }

    if (!refreshedOrder) {
      setSelectedOrder(null);
    }
  }, [orders, selectedOrder]);

  useEffect(() => {
    if (!selectedOrder) {
      setOrderPopover(null);
    }
  }, [selectedOrder]);

  useEffect(() => {
    if (!orderPopover) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
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
    if (
      normalizedCalendarSearchQuery &&
      !buildOrderTimelineSearchText(order, locale).includes(normalizedCalendarSearchQuery)
    ) {
      return false;
    }
    return true;
  });

  const visibleOrders = filteredOrders.filter((order) =>
    orderIntersectsRange(order, rangeStart, rangeEndExclusive),
  );

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
      : Math.max(
          MIN_DAY_COLUMN_WIDTHS[rangeMode],
          rangeMode === "week" && fittedTimelineWidth > 0
            ? Math.max(Math.floor(fittedTimelineWidth / days.length), customDayWidth)
            : customDayWidth || DAY_COLUMN_WIDTHS[rangeMode],
        );
  const timelineWidth = days.length * dayColumnWidth;
  const tableWidth = Math.max(vehicleColumnWidth + timelineWidth, timelineViewportWidth ?? 0);

  // Seven columns fit, so which seven matters. A six-week range starts
  // on the Monday of the focused week, which on a Friday leaves four of
  // the seven already spent -- so the viewport is scrolled to put the
  // focused day at the left edge and the week ahead beside it.
  //
  // Keyed on the focused day rather than on mount, so prev / next /
  // today land where the operator asked to be. Their own sideways
  // scrolling changes none of these, so this never fights it.
  useEffect(() => {
    const node = timelineViewportRef.current;
    if (!node || !compact) return;

    const offsetDays = Math.round(
      (normalizedFocusDate.getTime() - rangeStart.getTime()) / DAY_IN_MS,
    );
    if (offsetDays < 0) return;

    node.scrollTo({ left: offsetDays * dayColumnWidth, behavior: "auto" });
  }, [compact, normalizedFocusDate, rangeStart, dayColumnWidth]);
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

  const openCreateOrderDialog = () => {
    const fallbackVehicleId =
      selectedVehicleId !== "all"
        ? selectedVehicleId
        : filteredVehicles[0]?.id ?? vehicleOptions[0]?.id ?? "";

    setOrderFormError(null);
    setOrderDraft(buildCreateDraft(normalizedFocusDate, fallbackVehicleId));
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
      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.92),rgba(247,247,247,0.96))] p-2.5 shadow-[0_24px_60px_-42px_rgba(17,19,24,0.45)]">
        <div className="grid gap-2 2xl:grid-cols-[auto_minmax(42rem,1fr)] 2xl:items-center">
          {/* Action row — flat layout instead of a glass pill. The
           * prev/next pair gets its own tiny segment-control wrapper so
           * the relationship reads at a glance; everything else stands
           * on its own with the standard chip look. */}
          <div className="flex flex-wrap items-center gap-1.5 2xl:flex-nowrap">
            <div className="inline-flex rounded-md border border-[var(--line)] bg-white p-0.5">
              <button
                type="button"
                aria-label="Previous range"
                onClick={() => {
                  setFocusDate((current) =>
                    rangeMode === "month"
                      ? addMonths(current, -1)
                      : addDays(current, rangeMode === "week" ? -7 : -42),
                  );
                }}
                className="rounded-md px-2.5 py-1 text-[14px] font-semibold leading-none text-[var(--ink-soft)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
              >
                &#8249;
              </button>
              <button
                type="button"
                aria-label="Next range"
                onClick={() => {
                  setFocusDate((current) =>
                    rangeMode === "month"
                      ? addMonths(current, 1)
                      : addDays(current, rangeMode === "week" ? 7 : 42),
                  );
                }}
                className="rounded-md px-2.5 py-1 text-[14px] font-semibold leading-none text-[var(--ink-soft)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
              >
                &#8250;
              </button>
            </div>
            <button type="button" onClick={() => setFocusDate(new Date())} className={secondaryActionClass}>
              {calendarMessages.today}
            </button>
            <button
              type="button"
              onClick={() => setMobileControlsOpen((open) => !open)}
              className={cn(secondaryActionClass, "lg:hidden")}
              aria-expanded={mobileControlsOpen}
            >
              {mobileControlsOpen ? calendarMessages.hideControls : calendarMessages.showControls}
            </button>
            {!readOnly ? (
              <button
                type="button"
                onClick={handleTuroSync}
                disabled={isTuroSyncing}
                className={cn(secondaryActionClass, mobileControlsOpen ? "" : "max-lg:hidden")}
              >
                {isTuroSyncing ? calendarMessages.turoSyncingAction : calendarMessages.turoSyncAction}
              </button>
            ) : null}
            {!readOnly ? (
              <button
                type="button"
                onClick={openCreateOrderDialog}
                disabled={vehicleOptions.length === 0}
                className={cn(primaryActionClass, mobileControlsOpen ? "" : "max-lg:hidden")}
              >
                {calendarMessages.manualCreate}
              </button>
            ) : null}
            {!readOnly ? (
              <VehicleOrdersExportButton
                className={mobileControlsOpen ? undefined : "max-lg:hidden"}
                locale={locale}
                vehicleOptions={vehicleOptions}
                preferredVehicleId={selectedVehicleId !== "all" ? selectedVehicleId : filteredVehicles[0]?.id}
                rangeStart={rangeStart.toISOString()}
                rangeEnd={rangeEndInclusive.toISOString()}
              />
            ) : null}
          </div>

          <div
            className={cn(
              "grid min-w-0 gap-1.5 sm:grid-cols-2 xl:grid-cols-[minmax(17rem,1.45fr)_minmax(9.5rem,1fr)_minmax(9.5rem,1fr)_minmax(9.5rem,1fr)]",
              mobileControlsOpen ? "" : "max-lg:hidden",
            )}
          >
            <label className="relative min-w-0">
              <span className="sr-only">{calendarMessages.timelineSearch}</span>
              <input
                type="search"
                value={calendarSearchQuery}
                onChange={(event) => setCalendarSearchQuery(event.target.value)}
                placeholder={calendarMessages.timelineSearchPlaceholder}
                className="h-9 w-full rounded-full border border-[var(--line)] bg-white px-3 text-[12px] font-medium text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-soft)]/70 hover:border-[rgba(17,19,24,0.22)] focus:border-[rgba(17,19,24,0.3)] focus:ring-2 focus:ring-[rgba(89,60,251,0.12)]"
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

          {/* The Week / Month / 6-week segmented pill that used to live
           * here was removed in v0.22.1 — it overlapped 1-for-1 with
           * the day-width slider just below the toolbar. The toolbar
           * keeps the prev/next/today actions, the filter selects, and
           * the create + export buttons; range zoom now happens
           * exclusively through the slider. */}
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

        {/* Scrubber + range title combined into one compact row. The
         * full date title was redundant when the scrubber thumb +
         * range buttons already convey the same info. */}
        <div
          className={cn(
            "mt-2 rounded-lg border border-[rgba(17,19,24,0.06)] bg-[rgba(255,255,255,0.78)] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]",
            mobileControlsOpen ? "" : "max-lg:hidden",
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
                  setFocusDate(addDays(today, Number(event.target.value)));
                }}
                aria-label={calendarMessages.scrubberLabel}
                className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent accent-[var(--accent)] [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(90deg,rgba(17,19,24,0.08),rgba(89,60,251,0.18),rgba(17,19,24,0.08))] [&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-[0_8px_20px_-10px_rgba(89,60,251,0.9)] [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[rgba(17,19,24,0.12)] [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[var(--accent)]"
              />
              <span className="shrink-0 rounded-full bg-[rgba(17,19,24,0.06)] px-2.5 py-0.5 text-[11px] tracking-[0.16em] text-[color:var(--ink)]">
                {formatDate(normalizedFocusDate, locale)}
              </span>
            </div>

            <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 xl:justify-end">
              <label className="flex min-w-0 items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]/80">
                <span>{calendarMessages.dayWidthLabel}</span>
                <input
                  type="range"
                  min={MIN_CUSTOM_DAY_WIDTH}
                  max={MAX_CUSTOM_DAY_WIDTH}
                  step={2}
                  value={customDayWidth}
                  onChange={(event) => setCustomDayWidth(Number(event.target.value))}
                  className="w-28 cursor-pointer accent-[var(--accent)]"
                />
                <span className="tabular-nums">{customDayWidth}px</span>
              </label>
              {normalizedCalendarSearchQuery ? (
                <span className="rounded-full bg-[rgba(255,231,122,0.58)] px-2.5 py-0.5 text-[11px] font-semibold text-[color:var(--ink)]">
                  {calendarMessages.summary(filteredVehicles.length, visibleOrders.length)}
                </span>
              ) : null}
            </div>
          </div>
          {/* Only TODAY survives from the tick row. The four dates
              around it labelled the ends of a two-year scrubber -- a
              bound nobody navigates to, printed permanently above a
              calendar that already shows where it is. */}
          <div className="mt-1.5 flex items-center justify-center">
            <span className="rounded-full bg-[rgba(89,60,251,0.12)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink)]">
              {calendarMessages.today}
            </span>
          </div>
        </div>
      </section>

      <section className="calendar-dense overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.74)] p-2.5 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
        {filteredVehicles.length === 0 ? (
          <div className="rounded-lg bg-[rgba(255,255,255,0.72)] px-4 py-10 text-sm text-[color:var(--ink-soft)]">
            {calendarMessages.noVehicles}
          </div>
        ) : (
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
            className="max-h-[76vh] cursor-grab touch-pan-y overflow-auto overscroll-x-contain rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.95)] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
          >
            <div style={{ width: tableWidth, minWidth: vehicleColumnWidth + timelineWidth }}>
              <div
                className="sticky top-0 z-40 grid border-b border-[color:var(--line)] bg-[rgba(255,251,246,0.92)] backdrop-blur"
                style={{
                  gridTemplateColumns: `${vehicleColumnWidth}px repeat(${days.length}, ${dayColumnWidth}px)`,
                }}
              >
                <div className="sticky left-0 z-50 border-r border-[color:var(--line)] bg-[linear-gradient(180deg,#ffffff,#f7f7f7)] px-3 py-3 max-lg:px-2 max-lg:py-2">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--ink-soft)]">
                    {messages.shell.nav.vehicles}
                  </p>
                  {/* The count wraps to three lines in a 104px column
                      and pushes every bar down by roughly a row for
                      information the page states again below. Desktop
                      keeps it; the phone gets the bars sooner. */}
                  <p className="mt-1.5 hidden text-[12px] font-semibold text-[color:var(--ink)] lg:block">
                    {calendarMessages.summary(filteredVehicles.length, visibleOrders.length)}
                  </p>
                </div>
                {days.map((date, index) => {
                  const weekend = [0, 6].includes(date.getDay());
                  const todayColumn = isSameDay(date, today);

                  return (
                    <div
                      key={date.toISOString()}
                      className={cn(
                        "border-r border-[color:var(--line)] px-1 py-1.5 text-center",
                        weekend ? "bg-[#f3ede4]" : "bg-[rgba(255,251,246,0.9)]",
                        todayColumn ? "bg-[rgba(89,60,251,0.14)]" : "",
                      )}
                    >
                      {/* Bigger. This row is the calendar's own axis --
                          every bar below is read against it -- and it
                          was set two steps smaller than the body text
                          it labels. */}
                      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.04em] text-[color:var(--ink-soft)] max-lg:text-[9px]">
                        {formatWeekday(date, locale)}
                      </p>
                      <p className="mt-0.5 whitespace-nowrap text-[14px] font-bold leading-tight text-[color:var(--ink)] tabular-nums max-lg:text-[11px]">
                        {formatTimelineDateLabel(date)}
                      </p>
                    </div>
                  );
                })}
              </div>

              {filteredVehicles.map((vehicle, index) => {
                const vehicleOrders = visibleOrders.filter((order) => order.vehicleId === vehicle.id);
                const { bars, laneCount } = assignTimelineBars(
                  vehicleOrders,
                  rangeStart,
                  rangeEndExclusive,
                  dayColumnWidth,
                );
                const rowHeight = Math.max(minRowHeight, laneCount * laneHeight + 8);
                const alternateRow = index % 2 === 1;

                return (
                  <div
                    key={vehicle.id}
                    className="grid border-b border-[color:var(--line)] last:border-b-0"
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
                      )}
                      style={{ height: rowHeight }}
                      title={[vehicle.plateNumber, vehicle.secondaryLabel, vehicle.ownerName]
                        .filter(Boolean)
                        .join(" · ")}
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
                      )}
                      style={{ height: rowHeight }}
                    >
                      {days.map((date, dayIndex) => {
                        const weekend = [0, 6].includes(date.getDay());
                        const todayColumn = isSameDay(date, today);

                        return (
                          <div
                            key={date.toISOString()}
                            className={cn(
                              "absolute inset-y-0 border-r border-[color:var(--line)]",
                              weekend ? "bg-[#f5eee5]/78" : "bg-transparent",
                              todayColumn ? "bg-[rgba(89,60,251,0.08)]" : "",
                            )}
                            style={{
                              left: dayIndex * dayColumnWidth,
                              width: dayColumnWidth,
                            }}
                          />
                        );
                      })}

                      {bars.length === 0 ? (
                        <div className="absolute inset-y-0 left-3 flex items-center text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]/70">
                          {calendarMessages.emptyRow}
                        </div>
                      ) : null}

                      {bars.map((bar) => {
                        const startTime = formatTime(bar.order.pickupDatetime);
                        const shortLabel =
                          bar.width < 96
                            ? startTime
                            : `${startTime} ${bar.order.renterName}`;
                        const fullLabel = `${startTime} ${bar.order.renterName}`;

                        return (
                          <button
                            key={bar.order.id}
                            type="button"
                            data-calendar-order-bar="true"
                            title={`${bar.order.vehicleName} · ${bar.order.renterName}`}
                            onClick={() => {
                              setSelectedOrder(bar.order);
                              setOrderPopover({ isOpen: true });
                            }}
                            className={getTimelineBarClasses(
                              bar.order,
                              bar.clippedStart,
                              bar.clippedEnd,
                              compact,
                            )}
                            style={{
                              left: bar.left,
                              top: barTopOffset + bar.lane * laneHeight,
                              width: bar.width,
                              height: barHeight,
                            }}
                          >
                            <span className="truncate">{highlightText(shortLabel || fullLabel, calendarSearchQuery)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
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

      {!readOnly && isOrderDialogOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--ink)]/35 p-4">
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
