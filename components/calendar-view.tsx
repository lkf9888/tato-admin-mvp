"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { StatusBadge } from "@/components/status-badge";
import { VehicleOrdersExportButton } from "@/components/vehicle-orders-export-button";
import { getMessages, getStatusLabel, type Locale } from "@/lib/i18n";
import { cn, formatCurrency, formatDate, formatDateTime, getDisplayOrderNote, maskPhone } from "@/lib/utils";

type CalendarOrder = {
  id: string;
  source: "turo" | "offline";
  status: "booked" | "ongoing" | "completed" | "cancelled";
  hasConflict: boolean;
  vehicleId: string;
  vehicleName: string;
  vehiclePlateNumber?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  renterName: string;
  renterPhone?: string | null;
  pickupDatetime: string;
  returnDatetime: string;
  totalPrice?: number | null;
  notes?: string | null;
};

type VehicleTimelineOption = {
  id: string;
  label: string;
  plateNumber?: string | null;
  secondaryLabel?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
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
  pickupDatetime: string;
  returnDatetime: string;
  totalPrice: string;
};

type OrderPopoverState = {
  top: number;
  left: number;
  placement: "top" | "bottom";
};

const DEFAULT_VEHICLE_COLUMN_WIDTH = 188;
const DAY_COLUMN_WIDTHS = {
  week: 92,
  month: 58,
  sixWeeks: 44,
} as const;
const MIN_DAY_COLUMN_WIDTHS = {
  week: 66,
  month: 34,
  sixWeeks: 28,
} as const;
const LANE_HEIGHT = 32;
const BAR_HEIGHT = 28;
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

function getTimelineBarClasses(order: CalendarOrder, clippedStart: boolean, clippedEnd: boolean) {
  return cn(
    "absolute flex items-center overflow-hidden border-[1.5px] px-3.5 text-left text-[13px] font-semibold leading-tight text-white shadow-[0_18px_36px_-18px_rgba(17,19,24,0.7)] transition hover:-translate-y-0.5 hover:brightness-110 cursor-pointer",
    order.hasConflict
      ? "border-[#c61e22] bg-[#e5484d]"
      : order.status === "cancelled"
        ? "border-slate-500 bg-slate-400"
        : order.source === "turo"
          ? "border-[#1f3aa8] bg-[#3456df]"
          : "border-[#1f5b48] bg-[#2f7f67]",
    clippedStart ? "rounded-r-xl rounded-l-md" : "rounded-l-xl",
    clippedEnd ? "rounded-l-xl rounded-r-md" : "rounded-r-xl",
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

function formatDayNumber(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-CA", {
    day: "numeric",
  }).format(date);
}

function formatMonthMarker(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-CA", {
    month: locale === "zh" ? "numeric" : "short",
  }).format(date);
}

function formatMonthTitle(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-CA", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTime(value: Date | string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: locale !== "zh",
  }).format(new Date(value));
}

function padNumber(value: number) {
  return value.toString().padStart(2, "0");
}

function formatDateTimeLocalInput(value: Date | string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}T${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
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
    pickupDatetime: formatDateTimeLocalInput(pickup),
    returnDatetime: formatDateTimeLocalInput(returnDatetime),
    totalPrice: "",
  } satisfies ManualOrderDraft;
}

function buildEditDraft(order: CalendarOrder) {
  return {
    id: order.id,
    vehicleId: order.vehicleId,
    renterName: order.renterName,
    renterPhone: order.renterPhone ?? "",
    pickupDatetime: formatDateTimeLocalInput(order.pickupDatetime),
    returnDatetime: formatDateTimeLocalInput(order.returnDatetime),
    totalPrice: order.totalPrice != null ? String(order.totalPrice) : "",
  } satisfies ManualOrderDraft;
}

function buildOrderPopoverState(anchor: {
  top: number;
  bottom: number;
  left: number;
  width: number;
}): OrderPopoverState {
  const popoverWidth = Math.min(352, window.innerWidth - 24);
  const halfWidth = popoverWidth / 2;
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2, 12 + halfWidth),
    window.innerWidth - 12 - halfWidth,
  );
  const shouldPlaceBelow = anchor.bottom + 360 <= window.innerHeight - 12;

  return {
    left,
    top: shouldPlaceBelow ? anchor.bottom + 12 : anchor.top - 12,
    placement: shouldPlaceBelow ? "bottom" : "top",
  };
}

function buildRangeTitle(rangeMode: "week" | "month" | "sixWeeks", rangeStart: Date, rangeEnd: Date, locale: Locale) {
  if (rangeMode === "month") {
    return formatMonthTitle(rangeStart, locale);
  }

  return `${formatDate(rangeStart, locale)} - ${formatDate(rangeEnd, locale)}`;
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
  const [rangeMode, setRangeMode] = useState<"week" | "month" | "sixWeeks">("week");
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [selectedOrder, setSelectedOrder] = useState<CalendarOrder | null>(null);
  const [orderDialogMode, setOrderDialogMode] = useState<"create" | "edit">("create");
  const [isOrderDialogOpen, setIsOrderDialogOpen] = useState(false);
  const [orderDraft, setOrderDraft] = useState<ManualOrderDraft>(() =>
    buildCreateDraft(new Date(), vehicleOptions[0]?.id),
  );
  const [orderFormError, setOrderFormError] = useState<string | null>(null);
  const [detailActionError, setDetailActionError] = useState<string | null>(null);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [isDeletingOrder, setIsDeletingOrder] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [noteActionError, setNoteActionError] = useState<string | null>(null);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const orderPopoverRef = useRef<HTMLDivElement | null>(null);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState<number | null>(null);
  const [orderPopover, setOrderPopover] = useState<OrderPopoverState | null>(null);

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

    if (!refreshedOrder && selectedOrder.source === "offline") {
      setSelectedOrder(null);
      setDetailActionError(null);
    }
  }, [orders, selectedOrder]);

  useEffect(() => {
    if (!selectedOrder) {
      setOrderPopover(null);
    }
  }, [selectedOrder]);

  useEffect(() => {
    setIsEditingNotes(false);
    setNoteActionError(null);
    setNotesDraft(getDisplayOrderNote(selectedOrder?.notes, selectedOrder?.source) ?? "");
  }, [selectedOrder]);

  useEffect(() => {
    if (!orderPopover) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (orderPopoverRef.current?.contains(target)) return;

      if (
        target instanceof Element &&
        target.closest("[data-calendar-order-bar='true']")
      ) {
        return;
      }

      setOrderPopover(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOrderPopover(null);
      }
    };

    const handleViewportChange = () => {
      setOrderPopover(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [orderPopover]);

  const filteredVehicles = vehicleOptions.filter((vehicle) => {
    if (selectedVehicleId !== "all" && vehicle.id !== selectedVehicleId) return false;
    if (!readOnly && selectedOwnerId !== "all" && vehicle.ownerId !== selectedOwnerId) return false;
    return true;
  });

  const filteredOrders = orders.filter((order) => {
    if (order.status === "cancelled") return false;
    if (selectedVehicleId !== "all" && order.vehicleId !== selectedVehicleId) return false;
    if (selectedSource !== "all" && order.source !== selectedSource) return false;
    if (!readOnly && selectedOwnerId !== "all" && order.ownerId !== selectedOwnerId) return false;
    return true;
  });

  const visibleOrders = filteredOrders.filter((order) =>
    orderIntersectsRange(order, rangeStart, rangeEndExclusive),
  );

  const vehicleColumnWidth = DEFAULT_VEHICLE_COLUMN_WIDTH;
  const fittedTimelineWidth = Math.max((timelineViewportWidth ?? 0) - vehicleColumnWidth, 0);
  const dayColumnWidth = Math.max(
    MIN_DAY_COLUMN_WIDTHS[rangeMode],
    fittedTimelineWidth > 0
      ? Math.floor(fittedTimelineWidth / days.length)
      : DAY_COLUMN_WIDTHS[rangeMode],
  );
  const timelineWidth = days.length * dayColumnWidth;
  const tableWidth = Math.max(vehicleColumnWidth + timelineWidth, timelineViewportWidth ?? 0);
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
    "inline-flex h-9 items-center justify-center rounded-full border border-[var(--line)] bg-white px-3.5 text-[12px] font-semibold text-[var(--ink)] shadow-sm transition hover:border-[rgba(17,19,24,0.22)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50";
  const primaryActionClass =
    "inline-flex h-9 items-center justify-center rounded-full bg-[var(--accent)] px-3.5 text-[12px] font-semibold text-white shadow-[0_8px_22px_-10px_rgba(89,60,251,0.55)] transition hover:bg-[#4830d4] hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50";
  const filterSelectClass =
    "h-9 rounded-full border border-[var(--line)] bg-white px-3 text-[12px] font-medium text-[var(--ink)] outline-none transition focus:border-[rgba(17,19,24,0.3)]";

  const openCreateOrderDialog = () => {
    const fallbackVehicleId =
      selectedVehicleId !== "all"
        ? selectedVehicleId
        : filteredVehicles[0]?.id ?? vehicleOptions[0]?.id ?? "";

    setOrderDialogMode("create");
    setOrderFormError(null);
    setDetailActionError(null);
    setOrderDraft(buildCreateDraft(normalizedFocusDate, fallbackVehicleId));
    setIsOrderDialogOpen(true);
  };

  const openEditOrderDialog = (order: CalendarOrder) => {
    setOrderDialogMode("edit");
    setOrderFormError(null);
    setDetailActionError(null);
    setOrderPopover(null);
    setOrderDraft(buildEditDraft(order));
    setIsOrderDialogOpen(true);
  };

  const closeOrderDialog = () => {
    if (isSavingOrder) return;
    setIsOrderDialogOpen(false);
    setOrderFormError(null);
  };

  const handleSaveOrderNotes = async () => {
    if (!selectedOrder || isSavingNotes) return;

    setIsSavingNotes(true);
    setNoteActionError(null);

    try {
      const response = await fetch("/api/orders/notes", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: selectedOrder.id,
          notes: notesDraft,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { order?: CalendarOrder; error?: string }
        | null;

      if (!response.ok || !payload?.order) {
        setNoteActionError(calendarMessages.noteSaveError);
        return;
      }

      setSelectedOrder(payload.order);
      setNotesDraft(getDisplayOrderNote(payload.order.notes, payload.order.source) ?? "");
      setIsEditingNotes(false);
      router.refresh();
    } catch {
      setNoteActionError(calendarMessages.noteSaveError);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleManualOrderSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const pickupDatetime = new Date(orderDraft.pickupDatetime);
    const returnDatetime = new Date(orderDraft.returnDatetime);

    if (
      !orderDraft.vehicleId ||
      !orderDraft.renterName.trim() ||
      !orderDraft.pickupDatetime ||
      !orderDraft.returnDatetime ||
      Number.isNaN(pickupDatetime.getTime()) ||
      Number.isNaN(returnDatetime.getTime()) ||
      returnDatetime <= pickupDatetime
    ) {
      setOrderFormError(calendarMessages.formValidationError);
      return;
    }

    setIsSavingOrder(true);
    setOrderFormError(null);

    try {
      const response = await fetch("/api/orders/offline", {
        method: orderDialogMode === "create" ? "POST" : "PATCH",
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
      setDetailActionError(null);
      setIsOrderDialogOpen(false);
      router.refresh();
    } catch {
      setOrderFormError(calendarMessages.formSaveError);
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleDeleteSelectedOrder = async () => {
    if (!selectedOrder || selectedOrder.source !== "offline" || isDeletingOrder) return;
    if (!window.confirm(calendarMessages.deleteConfirm)) return;

    setIsDeletingOrder(true);
    setDetailActionError(null);

    try {
      const response = await fetch("/api/orders/offline", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: selectedOrder.id }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { deletedId?: string; error?: string }
        | null;

      if (!response.ok || payload?.deletedId !== selectedOrder.id) {
        setDetailActionError(calendarMessages.deleteError);
        return;
      }

      setOrderPopover(null);
      setSelectedOrder(null);
      router.refresh();
    } catch {
      setDetailActionError(calendarMessages.deleteError);
    } finally {
      setIsDeletingOrder(false);
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
      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.92),rgba(247,247,247,0.96))] p-3 shadow-[0_24px_60px_-42px_rgba(17,19,24,0.45)]">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between xl:gap-3">
          {/* Action row — flat layout instead of a glass pill. The
           * prev/next pair gets its own tiny segment-control wrapper so
           * the relationship reads at a glance; everything else stands
           * on its own with the standard chip look. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex rounded-full border border-[var(--line)] bg-white p-0.5 shadow-sm">
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
                className="rounded-full px-2.5 py-1 text-[14px] font-semibold leading-none text-[var(--ink-soft)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
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
                className="rounded-full px-2.5 py-1 text-[14px] font-semibold leading-none text-[var(--ink-soft)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
              >
                &#8250;
              </button>
            </div>
            <button type="button" onClick={() => setFocusDate(new Date())} className={secondaryActionClass}>
              {calendarMessages.today}
            </button>
            {!readOnly ? (
              <button
                type="button"
                onClick={openCreateOrderDialog}
                disabled={vehicleOptions.length === 0}
                className={primaryActionClass}
              >
                {calendarMessages.manualCreate}
              </button>
            ) : null}
            {!readOnly ? (
              <VehicleOrdersExportButton
                locale={locale}
                vehicleOptions={vehicleOptions}
                preferredVehicleId={selectedVehicleId !== "all" ? selectedVehicleId : filteredVehicles[0]?.id}
                rangeStart={rangeStart.toISOString()}
                rangeEnd={rangeEndInclusive.toISOString()}
              />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedVehicleId}
              onChange={(event) => setSelectedVehicleId(event.target.value)}
              className={filterSelectClass}
            >
              <option value="all">{calendarMessages.allVehicles}</option>
              {vehicleOptions.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.plateNumber ? `${vehicle.plateNumber} · ${vehicle.label}` : vehicle.label}
                </option>
              ))}
            </select>

            {!readOnly ? (
              <select
                value={selectedOwnerId}
                onChange={(event) => setSelectedOwnerId(event.target.value)}
                className={filterSelectClass}
              >
                <option value="all">{calendarMessages.allOwners}</option>
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.label}
                  </option>
                ))}
              </select>
            ) : null}

            <select
              value={selectedSource}
              onChange={(event) => setSelectedSource(event.target.value)}
              className={filterSelectClass}
            >
              <option value="all">{calendarMessages.allSources}</option>
              <option value="turo">{getStatusLabel("turo", locale)}</option>
              <option value="offline">{getStatusLabel("offline", locale)}</option>
            </select>
          </div>

          {/* iOS-style segmented control. Light track + dark "selected"
           * thumb (ink fill, white text) is much higher contrast than
           * the previous accent-purple-on-dark-pill combination. */}
          <div className="inline-flex rounded-full border border-[var(--line)] bg-white p-0.5 shadow-sm">
            {[
              { value: "week" as const, label: calendarMessages.week },
              { value: "month" as const, label: calendarMessages.month },
              { value: "sixWeeks" as const, label: calendarMessages.sixWeeks },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRangeMode(option.value)}
                className={cn(
                  "rounded-full px-3 py-1 text-[12px] font-semibold transition",
                  rangeMode === option.value
                    ? "bg-[var(--ink)] text-white shadow-sm"
                    : "text-[var(--ink-soft)] hover:text-[var(--ink)]",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrubber + range title combined into one compact row. The
         * full date title was redundant when the scrubber thumb +
         * range buttons already convey the same info. */}
        <div className="mt-2.5 rounded-xl border border-[rgba(17,19,24,0.06)] bg-[rgba(255,255,255,0.78)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="flex items-baseline gap-2">
              <h3 className="font-serif text-[1.05rem] font-semibold leading-none text-[color:var(--ink)] md:text-[1.2rem]">
                {buildRangeTitle(rangeMode, rangeStart, rangeEndInclusive, locale)}
              </h3>
              <span className="text-[11px] text-[color:var(--ink-soft)]">
                {calendarMessages.summary(filteredVehicles.length, visibleOrders.length)}
              </span>
            </div>
            <span className="rounded-full bg-[rgba(17,19,24,0.06)] px-2.5 py-0.5 text-[11px] tracking-[0.16em] text-[color:var(--ink)]">
              {formatDate(normalizedFocusDate, locale)}
            </span>
          </div>
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
            className="mt-2 w-full cursor-pointer appearance-none bg-transparent accent-[var(--accent)] [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(90deg,rgba(17,19,24,0.08),rgba(89,60,251,0.18),rgba(17,19,24,0.08))] [&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-[0_8px_20px_-10px_rgba(89,60,251,0.9)] [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[rgba(17,19,24,0.12)] [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[var(--accent)]"
          />
          <div className="mt-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]/80">
            <span>{formatDate(addDays(today, -SCRUBBER_DAY_RANGE), locale)}</span>
            <span>{formatDate(addDays(today, -Math.round(SCRUBBER_DAY_RANGE / 2)), locale)}</span>
            <span className="rounded-full bg-[rgba(89,60,251,0.12)] px-2 py-0.5 text-[color:var(--ink)]">
              {calendarMessages.today}
            </span>
            <span>{formatDate(addDays(today, Math.round(SCRUBBER_DAY_RANGE / 2)), locale)}</span>
            <span>{formatDate(addDays(today, SCRUBBER_DAY_RANGE), locale)}</span>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.74)] p-2.5 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
        {filteredVehicles.length === 0 ? (
          <div className="rounded-lg bg-[rgba(255,255,255,0.72)] px-4 py-10 text-sm text-[color:var(--ink-soft)]">
            {calendarMessages.noVehicles}
          </div>
        ) : (
          <div
            ref={timelineViewportRef}
            className="max-h-[76vh] overflow-auto rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.95)] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
          >
            <div style={{ width: tableWidth, minWidth: vehicleColumnWidth + timelineWidth }}>
              <div
                className="sticky top-0 z-40 grid border-b border-[color:var(--line)] bg-[rgba(255,251,246,0.92)] backdrop-blur"
                style={{
                  gridTemplateColumns: `${vehicleColumnWidth}px repeat(${days.length}, ${dayColumnWidth}px)`,
                }}
              >
                <div className="sticky left-0 z-50 border-r border-[color:var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,247,247,0.98))] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--ink-soft)]">
                    {messages.shell.nav.vehicles}
                  </p>
                  <p className="mt-1.5 text-[12px] font-semibold text-[color:var(--ink)]">
                    {calendarMessages.summary(filteredVehicles.length, visibleOrders.length)}
                  </p>
                </div>
                {days.map((date, index) => {
                  const weekend = [0, 6].includes(date.getDay());
                  const monthChanged = index === 0 || date.getDate() === 1;
                  const todayColumn = isSameDay(date, today);

                  return (
                    <div
                      key={date.toISOString()}
                      className={cn(
                        "border-r border-[color:var(--line)] px-1.5 py-2.5 text-center",
                        weekend ? "bg-[#f3ede4]" : "bg-[rgba(255,251,246,0.9)]",
                        todayColumn ? "bg-[rgba(89,60,251,0.14)]" : "",
                      )}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                        {formatWeekday(date, locale)}
                      </p>
                      <p className="mt-0.5 text-[15px] font-semibold text-[color:var(--ink)]">
                        {formatDayNumber(date, locale)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[color:var(--ink-soft)]/80">
                        {monthChanged ? formatMonthMarker(date, locale) : ""}
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
                const rowHeight = Math.max(44, laneCount * LANE_HEIGHT + 8);
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
                        "sticky left-0 z-20 flex flex-col justify-center overflow-hidden border-r border-[color:var(--line)] px-3 py-1.5 backdrop-blur",
                        alternateRow ? "bg-[#faf4eb]/95" : "bg-[rgba(255,255,255,0.95)]",
                      )}
                      style={{ height: rowHeight }}
                    >
                      <p className="truncate text-[12px] font-semibold leading-tight text-[color:var(--ink)]">
                        {vehicle.plateNumber || vehicle.label}
                      </p>
                      <p className="mt-0.5 truncate text-[10.5px] leading-tight text-[color:var(--ink-soft)]">
                        {vehicle.secondaryLabel || vehicle.label}
                        {" · "}
                        {vehicle.ownerName || calendarMessages.unassignedOwner}
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
                        const startTime = formatTime(bar.order.pickupDatetime, locale);
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
                            onClick={(event) => {
                              setDetailActionError(null);
                              setNoteActionError(null);
                              setSelectedOrder(bar.order);
                              const rect = event.currentTarget.getBoundingClientRect();
                              setOrderPopover(
                                buildOrderPopoverState({
                                  top: rect.top,
                                  bottom: rect.bottom,
                                  left: rect.left,
                                  width: rect.width,
                                }),
                              );
                            }}
                            className={getTimelineBarClasses(
                              bar.order,
                              bar.clippedStart,
                              bar.clippedEnd,
                            )}
                            style={{
                              left: bar.left,
                              top: 6 + bar.lane * LANE_HEIGHT,
                              width: bar.width,
                              height: BAR_HEIGHT,
                            }}
                          >
                            <span className="truncate">{shortLabel || fullLabel}</span>
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
        <div
          ref={orderPopoverRef}
          className="fixed z-[80] w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-[rgba(17,19,24,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,243,234,0.98))] p-4 shadow-[0_28px_60px_-30px_rgba(17,19,24,0.55)] backdrop-blur"
          style={{
            left: orderPopover.left,
            top: orderPopover.top,
            transform:
              orderPopover.placement === "bottom"
                ? "translateX(-50%)"
                : "translate(-50%, -100%)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                {calendarMessages.detailsKicker}
              </p>
              <h3 className="mt-1 text-base font-semibold text-[color:var(--ink)]">
                {selectedOrder.vehiclePlateNumber
                  ? `${selectedOrder.vehiclePlateNumber} · ${selectedOrder.vehicleName}`
                  : selectedOrder.vehicleName}
              </h3>
              <p className="mt-1 text-[12px] text-[color:var(--ink-soft)]">
                {selectedOrder.ownerName ?? calendarMessages.unassignedOwner}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOrderPopover(null)}
              className="rounded-full border border-[rgba(17,19,24,0.08)] bg-white/80 px-2.5 py-1 text-[12px] font-semibold text-[color:var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.2)] hover:text-[color:var(--ink)]"
              aria-label={calendarMessages.cancelAction}
            >
              ×
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <StatusBadge value={selectedOrder.source} locale={locale} />
            <StatusBadge value={selectedOrder.status} locale={locale} />
            {selectedOrder.hasConflict ? <StatusBadge value="conflict" locale={locale} /> : null}
          </div>

          {!readOnly && selectedOrder.source === "offline" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => openEditOrderDialog(selectedOrder)} className={secondaryActionClass}>
                {calendarMessages.manualEdit}
              </button>
              <button
                type="button"
                onClick={handleDeleteSelectedOrder}
                disabled={isDeletingOrder}
                className="inline-flex h-11 items-center justify-center rounded-full border border-rose-200 bg-white/76 px-4 text-[12px] font-semibold text-rose-600 backdrop-blur transition hover:border-rose-400 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeletingOrder ? calendarMessages.deletingAction : calendarMessages.deleteAction}
              </button>
            </div>
          ) : null}

          {!readOnly && !isEditingNotes ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsEditingNotes(true);
                  setNoteActionError(null);
                }}
                className={secondaryActionClass}
              >
                {calendarMessages.editNotes}
              </button>
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 text-[12px] text-[color:var(--ink)] sm:grid-cols-2">
            <div>
              <span className="text-[11px] text-[color:var(--ink-soft)]">{calendarMessages.renter}</span>
              <p className="mt-1 text-[14px] font-semibold text-[color:var(--ink)]">{selectedOrder.renterName}</p>
            </div>
            <div>
              <span className="text-[11px] text-[color:var(--ink-soft)]">{calendarMessages.phone}</span>
              <p className="mt-1 text-[14px] font-semibold text-[color:var(--ink)]">
                {maskSensitive ? maskPhone(selectedOrder.renterPhone) : selectedOrder.renterPhone || "—"}
              </p>
            </div>
            <div>
              <span className="text-[11px] text-[color:var(--ink-soft)]">{calendarMessages.pickup}</span>
              <p className="mt-1 text-[14px] font-semibold text-[color:var(--ink)]">
                {formatDateTime(selectedOrder.pickupDatetime, locale)}
              </p>
            </div>
            <div>
              <span className="text-[11px] text-[color:var(--ink-soft)]">{calendarMessages.return}</span>
              <p className="mt-1 text-[14px] font-semibold text-[color:var(--ink)]">
                {formatDateTime(selectedOrder.returnDatetime, locale)}
              </p>
            </div>
            <div>
              <span className="text-[11px] text-[color:var(--ink-soft)]">{calendarMessages.revenue}</span>
              <p className="mt-1 text-[14px] font-semibold text-[color:var(--ink)]">
                {selectedOrder.totalPrice != null
                  ? formatCurrency(selectedOrder.totalPrice, locale)
                  : "—"}
              </p>
            </div>
            <div className="sm:col-span-2">
              <span className="text-[11px] text-[color:var(--ink-soft)]">{calendarMessages.notes}</span>
              {isEditingNotes && !readOnly ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={notesDraft}
                    onChange={(event) => setNotesDraft(event.target.value)}
                    placeholder={calendarMessages.notesPlaceholder}
                    rows={4}
                    className="w-full rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2 text-[13px] text-[color:var(--ink)] outline-none"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={handleSaveOrderNotes} disabled={isSavingNotes} className={primaryActionClass}>
                      {isSavingNotes ? calendarMessages.savingNotesAction : calendarMessages.saveNotesAction}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingNotes(false);
                        setNoteActionError(null);
                        setNotesDraft(
                          getDisplayOrderNote(selectedOrder.notes, selectedOrder.source) ?? "",
                        );
                      }}
                      className={secondaryActionClass}
                    >
                      {calendarMessages.cancelAction}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-[14px] font-semibold text-[color:var(--ink)]">
                  {getDisplayOrderNote(selectedOrder.notes, selectedOrder.source) ??
                    calendarMessages.noExtraNotes}
                </p>
              )}
            </div>
          </div>

          {noteActionError ? (
            <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {noteActionError}
            </p>
          ) : null}

          {!readOnly && detailActionError ? (
            <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {detailActionError}
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] p-3 shadow-[0_20px_48px_-40px_rgba(17,19,24,0.4)]">
        <p className="text-[11px] uppercase tracking-[0.26em] text-[color:var(--ink-soft)]">
          {calendarMessages.detailsKicker}
        </p>
        {selectedOrder ? (
          <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(17,19,24,0.08)] lg:grid-cols-[0.92fr_1.08fr]">
            <div className="bg-[linear-gradient(180deg,rgba(17,19,24,0.96),rgba(24,30,41,0.96))] px-5 py-5 text-white">
              <h3 className="font-serif text-[2rem] font-semibold leading-tight text-white">
                {selectedOrder.vehiclePlateNumber
                  ? `${selectedOrder.vehiclePlateNumber} · ${selectedOrder.vehicleName}`
                  : selectedOrder.vehicleName}
              </h3>
              <p className="mt-2 text-sm text-white/62">
                {selectedOrder.ownerName ?? calendarMessages.unassignedOwner}
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                <StatusBadge value={selectedOrder.source} locale={locale} className="border-white/10" />
                <StatusBadge value={selectedOrder.status} locale={locale} className="border-white/10" />
                {selectedOrder.hasConflict ? (
                  <StatusBadge value="conflict" locale={locale} className="border-white/10" />
                ) : null}
              </div>
              {!readOnly && selectedOrder.source === "offline" ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openEditOrderDialog(selectedOrder)}
                    className="inline-flex h-11 items-center justify-center rounded-full border border-white/12 bg-white/8 px-4 text-[12px] font-semibold text-white transition hover:bg-white/12"
                  >
                    {calendarMessages.manualEdit}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSelectedOrder}
                    disabled={isDeletingOrder}
                    className="inline-flex h-11 items-center justify-center rounded-full border border-rose-300/28 bg-rose-400/10 px-4 text-[12px] font-semibold text-rose-100 transition hover:bg-rose-400/18 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isDeletingOrder ? calendarMessages.deletingAction : calendarMessages.deleteAction}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,245,237,0.98))] px-5 py-5">
              <div className="grid gap-4 text-[13px] text-[color:var(--ink)] sm:grid-cols-2">
                <div>
                  <span className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                    {calendarMessages.renter}
                  </span>
                  <p className="mt-1 text-base font-semibold text-[color:var(--ink)]">{selectedOrder.renterName}</p>
                </div>
                <div>
                  <span className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                    {calendarMessages.phone}
                  </span>
                  <p className="mt-1 text-base font-semibold text-[color:var(--ink)]">
                    {maskSensitive ? maskPhone(selectedOrder.renterPhone) : selectedOrder.renterPhone || "—"}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                    {calendarMessages.pickup}
                  </span>
                  <p className="mt-1 text-base font-semibold text-[color:var(--ink)]">
                    {formatDateTime(selectedOrder.pickupDatetime, locale)}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                    {calendarMessages.return}
                  </span>
                  <p className="mt-1 text-base font-semibold text-[color:var(--ink)]">
                    {formatDateTime(selectedOrder.returnDatetime, locale)}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                    {calendarMessages.revenue}
                  </span>
                  <p className="mt-1 text-base font-semibold text-[color:var(--ink)]">
                    {selectedOrder.totalPrice != null
                      ? formatCurrency(selectedOrder.totalPrice, locale)
                      : "—"}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                    {calendarMessages.notes}
                  </span>
                  <p className="mt-1 text-base font-semibold text-[color:var(--ink)]">
                    {getDisplayOrderNote(selectedOrder.notes, selectedOrder.source) ??
                      calendarMessages.noExtraNotes}
                  </p>
                </div>
              </div>

              {!readOnly && detailActionError ? (
                <p className="mt-4 rounded-md bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700">
                  {detailActionError}
                </p>
              ) : null}

              {readOnly ? (
                <p className="mt-4 rounded-md bg-[var(--accent-soft)] px-3 py-2 text-[11px] text-[color:var(--ink-soft)]">
                  {calendarMessages.sharedViewNotice}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-lg bg-[rgba(255,255,255,0.72)] px-4 py-6 text-sm text-[color:var(--ink-soft)]">
            {calendarMessages.emptyState}
          </div>
        )}
      </section>

      {!readOnly && isOrderDialogOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-[color:var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,247,247,0.98))] p-5 shadow-[0_28px_70px_-28px_rgba(17,19,24,0.55)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-soft)]">
                  {orderDialogMode === "create"
                    ? calendarMessages.createDialogTitle
                    : calendarMessages.editDialogTitle}
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
                <select
                  value={orderDraft.vehicleId}
                  onChange={(event) =>
                    setOrderDraft((current) => ({ ...current, vehicleId: event.target.value }))
                  }
                  className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2.5 text-[13px] text-[color:var(--ink)] outline-none"
                >
                  {vehicleOptions.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.plateNumber ? `${vehicle.plateNumber} · ${vehicle.label}` : vehicle.label}
                    </option>
                  ))}
                </select>
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
                  className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2.5 text-[13px] text-[color:var(--ink)] outline-none"
                />
              </label>

              <label className="grid gap-1.5 text-[11px] text-[color:var(--ink-soft)]">
                <span>{calendarMessages.pickup}</span>
                <input
                  type="datetime-local"
                  value={orderDraft.pickupDatetime}
                  onChange={(event) =>
                    setOrderDraft((current) => ({ ...current, pickupDatetime: event.target.value }))
                  }
                  className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2.5 text-[13px] text-[color:var(--ink)] outline-none"
                />
              </label>

              <label className="grid gap-1.5 text-[11px] text-[color:var(--ink-soft)]">
                <span>{calendarMessages.return}</span>
                <input
                  type="datetime-local"
                  value={orderDraft.returnDatetime}
                  onChange={(event) =>
                    setOrderDraft((current) => ({ ...current, returnDatetime: event.target.value }))
                  }
                  className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2.5 text-[13px] text-[color:var(--ink)] outline-none"
                />
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
                    : orderDialogMode === "create"
                      ? calendarMessages.createAction
                      : calendarMessages.saveAction}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
