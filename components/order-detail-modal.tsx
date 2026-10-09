"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ExternalLink, MapPin, Pencil, Phone, Plus, ReceiptText, Save, Share2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { BookingExtraChargePanel } from "@/components/booking-extra-charge-panel";
import { DirectBookingCancelPanel } from "@/components/direct-booking-cancel-panel";
import { DirectBookingHandoverPanel } from "@/components/direct-booking-handover-panel";
import { OrderAttachments } from "@/components/order-attachments";
import { rememberOrder } from "@/components/remember-order";
import { SearchableSelect } from "@/components/searchable-select";
import { StatusBadge } from "@/components/status-badge";
import { getLocaleTag, getMessages, getOrderStatusOptions, getStatusLabel, type Locale } from "@/lib/i18n";
import {
  cn,
  formatCurrency,
  formatCurrencyInputText,
  formatCurrencyInputValue,
  formatDateInputDisplay,
  formatDateTime,
  formatTimeInputDisplay,
  maskPhone,
  parseDateTimeInputParts,
  todayDateInputValue,
  turoReservationUrl,
} from "@/lib/utils";

export type EditableOrder = {
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
  depositAmount?: number | null;
  pickupLocation?: string | null;
  returnLocation?: string | null;
  paymentMethod?: string | null;
  contractNumber?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  externalOrderId?: string | null;
  ownerLedgerSyncedAt?: string | null;
  /** The car's cleaning fee as it stands today. This is the value the
   *  panel edits. */
  cleaningFee?: number | null;
  /** What THIS trip is charged, which is the fee that was in force on
   *  the day it started -- a different number whenever the price has
   *  changed since. Read-only. */
  cleaningFeeOnTrip?: number | null;
  /** Every charge beyond the rent, straight from the CSV row. */
  feeLines?: Array<{ column: string; group: string; amount: number; sign: string }>;
};

export type OrderEditorVehicleOption = {
  id: string;
  label: string;
  plateNumber?: string | null;
  secondaryLabel?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
};

/** Every field this panel can save on its own, one at a time. */
type FieldKey =
  | "vehicleId"
  | "status"
  | "renterName"
  | "renterPhone"
  | "pickupTime"
  | "returnTime"
  | "pickupLocation"
  | "returnLocation"
  /** Pick-up and return place at once, while they are the same. */
  | "locations"
  | "totalPrice"
  | "depositAmount"
  | "paymentMethod"
  | "contractNumber"
  | "cleaningFee"
  | "notes";

type OrderDraft = {
  vehicleId: string;
  status: EditableOrder["status"];
  renterName: string;
  renterPhone: string;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  totalPrice: string;
  depositAmount: string;
  pickupLocation: string;
  returnLocation: string;
  paymentMethod: string;
  contractNumber: string;
  notes: string;
  cleaningFee: string;
  cleaningFeeFrom: string;
};

function buildDraft(order: EditableOrder): OrderDraft {
  return {
    vehicleId: order.vehicleId,
    status: order.status,
    renterName: order.renterName,
    renterPhone: order.renterPhone ?? "",
    pickupDate: formatDateInputDisplay(order.pickupDatetime),
    pickupTime: formatTimeInputDisplay(order.pickupDatetime),
    returnDate: formatDateInputDisplay(order.returnDatetime),
    returnTime: formatTimeInputDisplay(order.returnDatetime),
    totalPrice: formatCurrencyInputValue(order.totalPrice),
    depositAmount: formatCurrencyInputValue(order.depositAmount),
    pickupLocation: order.pickupLocation ?? "",
    returnLocation: order.returnLocation ?? "",
    paymentMethod: order.paymentMethod ?? "",
    contractNumber: order.contractNumber ?? "",
    notes: order.notes ?? "",
    cleaningFee: formatCurrencyInputValue(order.cleaningFee),
    // Defaults to today: the common edit is "from now on it costs
    // this", and back-dating is the deliberate act.
    cleaningFeeFrom: todayDateInputValue(),
  };
}

/**
 * One field's chrome: its label, and a pencil that turns into a save
 * and a cancel once clicked.
 *
 * The panel used to unlock every field at once behind a single header
 * toggle, saved everything through one button at the bottom, and nudged
 * a reader with "remember to save". That is more state than the actual
 * edits need: nearly every visit to this panel changes one field, and
 * the other thirteen sat unlocked as pure risk -- a stray keystroke in
 * a field nobody meant to touch, on a record the owner ledger reads
 * from directly.
 *
 * Per-field editing removes that risk by construction rather than by
 * reminder: everything is read-only until its own pencil is pressed,
 * only the pressed field ever diverges from the saved order, and
 * saving it is the same PATCH the old bottom button sent -- just fired
 * from beside the thing that changed instead of a button that could be
 * a full form-height away.
 */
function EditableField({
  className,
  variant = "box",
  labelText,
  canEdit,
  editing,
  saving,
  justSaved,
  onEdit,
  onSave,
  onCancel,
  onKeyDown,
  editTitle,
  saveTitle,
  cancelTitle,
  children,
}: {
  className?: string;
  /** `bare` drops the box for fields that sit inside a card of their
   *  own (the trip's times and places); the box comes back while editing. */
  variant?: "box" | "bare" | "note";
  labelText: string;
  canEdit: boolean;
  editing: boolean;
  saving: boolean;
  justSaved: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  editTitle: string;
  saveTitle: string;
  cancelTitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        // A field not being edited shows a read-only input. The touch
        // rule's 44px minimum is for things you type into, and on these
        // it made a name or a phone twice the height of its neighbours.
        "grid min-w-0 gap-0 rounded-md border px-2.5 py-1 transition [&_input[readonly]]:min-h-0",
        editing
          ? "border-[var(--accent)] bg-white shadow-[0_0_0_3px_rgba(89,60,251,0.1)]"
          : variant === "bare"
            ? "border-transparent bg-transparent px-1.5 hover:bg-[var(--surface-muted)]/60"
            : variant === "note"
              ? "border-amber-200 bg-amber-50/70"
              : "border-[rgba(17,19,24,0.1)] bg-white/84 focus-within:border-[rgba(17,19,24,0.28)]",
        className,
      )}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] font-medium uppercase tracking-[0.13em] text-[color:var(--ink-soft)]">
          {labelText}
        </span>
        {canEdit ? (
          <span className="flex shrink-0 items-center gap-0.5">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  title={saveTitle}
                  aria-label={saveTitle}
                  className="tap-compact flex h-7 w-7 items-center justify-center rounded text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-40 sm:h-5 sm:w-5"
                >
                  <Save className="h-3 w-3" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={saving}
                  title={cancelTitle}
                  aria-label={cancelTitle}
                  className="tap-compact flex h-7 w-7 items-center justify-center rounded text-[color:var(--ink-soft)] transition hover:bg-[var(--surface-muted)] disabled:opacity-40 sm:h-5 sm:w-5"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onEdit}
                disabled={saving}
                title={editTitle}
                aria-label={editTitle}
                className={cn(
                  // Compact on purpose: at the 44px touch minimum this
                  // pencil made every field a 70px box on a phone.
                  "tap-compact -my-1 flex h-7 w-7 items-center justify-center rounded transition hover:bg-[var(--surface-muted)] disabled:opacity-40 sm:my-0 sm:h-5 sm:w-5",
                  justSaved ? "text-emerald-600" : "text-[color:var(--ink-soft)] hover:text-[var(--ink)]",
                )}
              >
                {justSaved ? <Check className="h-3 w-3" aria-hidden /> : <Pencil className="h-3 w-3" aria-hidden />}
              </button>
            )}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

type PanelCopy = ReturnType<typeof getMessages>["orderPanel"];

/** A trip's length the way Turo bills it: whole days, then hours. */
function tripLength(fromIso: string, toIso: string) {
  const hours = Math.max(
    0,
    Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000),
  );
  return { days: Math.floor(hours / 24), hours: hours % 24 };
}

/** Days since the epoch for a local calendar day -- only ever subtracted. */
function localDayNumber(value: Date) {
  return Math.round(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000);
}

type TripPhaseTone = "today" | "upcoming" | "ongoing" | "ended" | "cancelled";

const PHASE_TONE_CLASSES: Record<TripPhaseTone, string> = {
  today: "bg-amber-100 text-amber-900",
  upcoming: "bg-sky-50 text-sky-800",
  ongoing: "bg-emerald-50 text-emerald-800",
  ended: "bg-[var(--surface-muted)] text-[color:var(--ink-mid)]",
  cancelled: "bg-rose-50 text-rose-700",
};

/**
 * Where this trip stands relative to now, in the words an operator
 * would use: "pick-up tomorrow 19:00", "on trip, 2 days left". The
 * stored status says booked/ongoing/completed, which is right for the
 * books but only as fresh as the last sync; the clock is always right.
 * A handover today or tomorrow is called out by its time, since that
 * is the thing to act on.
 */
function tripPhase(
  order: Pick<EditableOrder, "status" | "pickupDatetime" | "returnDatetime">,
  now: Date,
  t: PanelCopy,
  locale: Locale,
): { tone: TripPhaseTone; label: string } {
  if (order.status === "cancelled") {
    return { tone: "cancelled", label: getStatusLabel("cancelled", locale) };
  }
  const pickup = new Date(order.pickupDatetime);
  const end = new Date(order.returnDatetime);
  const today = localDayNumber(now);
  if (now < pickup) {
    const days = localDayNumber(pickup) - today;
    if (days === 0) return { tone: "today", label: t.phasePickupToday(formatTimeInputDisplay(pickup)) };
    if (days === 1) return { tone: "upcoming", label: t.phasePickupTomorrow(formatTimeInputDisplay(pickup)) };
    return { tone: "upcoming", label: t.phasePickupIn(days) };
  }
  if (now < end) {
    const days = localDayNumber(end) - today;
    if (days === 0) return { tone: "today", label: t.phaseReturnToday(formatTimeInputDisplay(end)) };
    if (days === 1) return { tone: "ongoing", label: t.phaseReturnTomorrow(formatTimeInputDisplay(end)) };
    const left = tripLength(now.toISOString(), order.returnDatetime);
    return { tone: "ongoing", label: t.phaseOngoing(t.duration(left.days, left.hours)) };
  }
  return { tone: "ended", label: t.phaseEnded(today - localDayNumber(end)) };
}

/** A handover moment: the day on one line, the clock time large under it. */
function TripMoment({ value, locale }: { value: string; locale: Locale }) {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const tag = getLocaleTag(locale);
  // English reads "Thu, Oct 8" in one go; Chinese runs "10/8周四"
  // together, so the weekday is set apart: "10月8日 周四".
  const day =
    locale === "en"
      ? new Intl.DateTimeFormat(tag, {
          ...(sameYear ? {} : { year: "numeric" }),
          month: "short",
          day: "numeric",
          weekday: "short",
        }).format(date)
      : `${new Intl.DateTimeFormat(tag, {
          ...(sameYear ? {} : { year: "numeric" }),
          month: "long",
          day: "numeric",
        }).format(date)} ${new Intl.DateTimeFormat(tag, { weekday: "short" }).format(date)}`;
  return (
    <span className="block min-w-0 pb-0.5">
      <span className="block truncate text-[13px] font-medium leading-5 text-[color:var(--ink-mid)]">{day}</span>
      <span className="block text-[22px] font-semibold leading-7 tabular-nums tracking-[-0.01em] text-[color:var(--ink)]">
        {formatTimeInputDisplay(date)}
      </span>
    </span>
  );
}

function LocationInput({
  value,
  onChange,
  editing,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  editing: boolean;
  className: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <MapPin className="h-3.5 w-3.5 shrink-0 text-[color:var(--ink-soft)]" aria-hidden />
      <input
        value={value}
        title={value || undefined}
        onChange={(event) => onChange(event.target.value)}
        readOnly={!editing}
        autoFocus={editing}
        className={className}
      />
    </span>
  );
}

export function OrderDetailModal({
  order,
  vehicleOptions,
  locale,
  readOnly = false,
  maskSensitive = false,
  onClose,
  onSaved,
  onDeleted,
}: {
  order: EditableOrder;
  vehicleOptions: OrderEditorVehicleOption[];
  locale: Locale;
  readOnly?: boolean;
  maskSensitive?: boolean;
  onClose: () => void;
  onSaved?: (order: EditableOrder) => void;
  onDeleted?: (orderId: string) => void;
}) {
  const router = useRouter();
  const t = getMessages(locale).orderPanel;
  const statusOptions = getOrderStatusOptions(locale);
  const [currentOrder, setCurrentOrder] = useState(order);
  const [draft, setDraft] = useState<OrderDraft>(() => buildDraft(order));
  const [error, setError] = useState<string | null>(null);
  /** Where a refused cancel sends the operator. */
  const cancelPanelRef = useRef<HTMLDivElement | null>(null);
  const pointToRefundPanel = () => {
    setError(t.paidDirectBooking);
    cancelPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const [ownerSyncMessage, setOwnerSyncMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingOwner, setIsSyncingOwner] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Trips already on this car over the dates just saved. Reported,
   *  never refused -- see the API note; the point is to name what the
   *  red bar is about instead of leaving the operator to hunt. */
  const [conflicts, setConflicts] = useState<
    Array<{ id: string; renterName: string; pickupDatetime: string; returnDatetime: string }>
  >([]);
  const [payments, setPayments] = useState<
    Array<{ amount: string; paidAt: string; payer: string; method: string }>
  >([]);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const [isSavingPayments, setIsSavingPayments] = useState(false);

  // Which single field is unlocked right now, if any -- only one at a
  // time, so `draft` never holds more than one field's worth of
  // unsaved change and a save can never carry along an edit the reader
  // has not asked to commit yet.
  const [editingField, setEditingField] = useState<FieldKey | null>(null);
  // Which field just saved, so its pencil can flash a checkmark for a
  // moment instead of the panel staying silent about what happened.
  const [justSavedField, setJustSavedField] = useState<FieldKey | null>(null);
  const justSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCurrentOrder(order);
    setDraft(buildDraft(order));
    setError(null);
    setOwnerSyncMessage(null);
    setEditingField(null);
    setJustSavedField(null);
  }, [order]);

  useEffect(() => {
    return () => {
      if (justSavedTimer.current) clearTimeout(justSavedTimer.current);
    };
  }, []);

  const fieldLabelClass =
    "text-[10px] font-medium uppercase tracking-[0.13em] text-[color:var(--ink-soft)]";

  const inputClass =
    "h-6 w-full min-w-0 max-w-full truncate border-0 bg-transparent p-0 text-[13px] text-[color:var(--ink)] outline-none placeholder:text-[color:var(--ink-soft)]/70";
  // Kept for the SearchableSelect, which draws its own trigger.
  const selectInputClass =
    "h-7 w-full min-w-0 max-w-full truncate border-0 bg-transparent px-0 text-[13px] text-[color:var(--ink)] outline-none";

  const selectedVehicle = vehicleOptions.find((vehicle) => vehicle.id === draft.vehicleId);
  const displayPhone = maskSensitive ? maskPhone(currentOrder.renterPhone) : currentOrder.renterPhone || "-";
  const selectedOwnerId = selectedVehicle?.ownerId ?? currentOrder.ownerId ?? null;
  const turoTripUrl = turoReservationUrl({ source: currentOrder.source, externalOrderId: currentOrder.externalOrderId ?? null });
  const turoReceiptUrl = turoReservationUrl({ source: currentOrder.source, externalOrderId: currentOrder.externalOrderId ?? null }, "receipt");
  const ownerShareSyncedAt = currentOrder.ownerLedgerSyncedAt ?? null;
  const ownerName = selectedVehicle?.ownerName ?? currentOrder.ownerName ?? null;
  const phase = tripPhase(currentOrder, new Date(), t, locale);
  const length = tripLength(currentOrder.pickupDatetime, currentOrder.returnDatetime);
  const editingTime = editingField === "pickupTime" || editingField === "returnTime";

  const pickupLocation = currentOrder.pickupLocation?.trim() ?? "";
  const returnLocation = currentOrder.returnLocation?.trim() ?? "";
  const editingOneLocation = editingField === "pickupLocation" || editingField === "returnLocation";
  const showCombinedLocation =
    editingField === "locations" ||
    (!editingOneLocation && pickupLocation !== "" && pickupLocation === returnLocation);
  const showPickupLocation = pickupLocation !== "" || editingOneLocation;
  const showReturnLocation = returnLocation !== "" || editingOneLocation;

  /** Optional fields take a box only when they hold something. */
  const filled: Partial<Record<FieldKey, boolean>> = {
    renterPhone: Boolean(currentOrder.renterPhone?.trim()),
    depositAmount: currentOrder.depositAmount != null,
    paymentMethod: Boolean(currentOrder.paymentMethod?.trim()),
    contractNumber: Boolean(currentOrder.contractNumber?.trim()),
    cleaningFee: (currentOrder.cleaningFee ?? 0) > 0,
    notes: Boolean(currentOrder.notes?.trim()),
  };
  const showField = (field: FieldKey) => filled[field] !== false || editingField === field;
  const addChips: Array<[FieldKey, string]> = [
    ...(pickupLocation === "" && returnLocation === "" && editingField !== "locations"
      ? ([["locations", t.sameLocation]] as Array<[FieldKey, string]>)
      : []),
    // Same place both ways shows one line; a different return is added here.
    ...(showCombinedLocation && editingField !== "locations"
      ? ([["returnLocation", t.differentReturn]] as Array<[FieldKey, string]>)
      : []),
    ...(
      [
        ["renterPhone", t.phone],
        ["notes", t.notes],
        ["depositAmount", t.deposit],
        ["paymentMethod", t.paymentMethod],
        ["contractNumber", t.contractNumber],
        ["cleaningFee", t.cleaningFee],
      ] as Array<[FieldKey, string]>
    ).filter(([field]) => !showField(field)),
  ];

  const updateDraft = (patch: Partial<OrderDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const flashSaved = (field: FieldKey) => {
    if (justSavedTimer.current) clearTimeout(justSavedTimer.current);
    setJustSavedField(field);
    justSavedTimer.current = setTimeout(() => setJustSavedField(null), 1800);
  };

  const persistOrder = async () => {
    if (readOnly || isSaving) return null;

    const pickupDatetime = parseDateTimeInputParts(draft.pickupDate, draft.pickupTime);
    const returnDatetime = parseDateTimeInputParts(draft.returnDate, draft.returnTime);
    if (
      !draft.vehicleId ||
      !draft.renterName.trim() ||
      !pickupDatetime ||
      !returnDatetime ||
      returnDatetime <= pickupDatetime
    ) {
      setError(t.validationError);
      return null;
    }

    setIsSaving(true);
    setError(null);
    setOwnerSyncMessage(null);

    try {
      const response = await fetch(`/api/orders/${currentOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: draft.vehicleId,
          status: draft.status,
          renterName: draft.renterName.trim(),
          renterPhone: draft.renterPhone,
          pickupDatetime: pickupDatetime.toISOString(),
          returnDatetime: returnDatetime.toISOString(),
          totalPrice: draft.totalPrice,
          depositAmount: draft.depositAmount,
          pickupLocation: draft.pickupLocation,
          returnLocation: draft.returnLocation,
          paymentMethod: draft.paymentMethod,
          contractNumber: draft.contractNumber,
          notes: draft.notes,
          // Only sent when it was actually touched, so opening and
          // saving an order does not stamp a redundant rule on the car.
          ...(draft.cleaningFee !== formatCurrencyInputValue(currentOrder.cleaningFee)
            ? {
                cleaningFee: draft.cleaningFee === "" ? 0 : Number(draft.cleaningFee),
                cleaningFeeFrom: draft.cleaningFeeFrom,
              }
            : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            order?: EditableOrder;
            error?: string;
            conflicts?: Array<{
              id: string;
              renterName: string;
              pickupDatetime: string;
              returnDatetime: string;
            }>;
          }
        | null;

      if (!response.ok || !payload?.order) {
        if (payload?.error === "PAID_DIRECT_BOOKING") {
          pointToRefundPanel();
          return null;
        }
        setError(
          payload?.error === "INVALID_DATES" || payload?.error === "VALIDATION_ERROR"
            ? t.validationError
            : t.saveError,
        );
        return null;
      }

      setCurrentOrder(payload.order);
      setDraft(buildDraft(payload.order));
      // What the saved dates now collide with. The save succeeded --
      // overlaps are allowed and the grid paints both red -- so this
      // is a statement, not an error.
      setConflicts(payload.conflicts ?? []);
      onSaved?.(payload.order);
      router.refresh();
      return payload.order;
    } catch {
      setError(t.saveError);
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  // Opening a field discards whatever was left unsaved in whichever
  // field was open before it -- there is never more than one live
  // edit, so there is nothing a second field's save could accidentally
  // carry along.
  const openField = (field: FieldKey) => {
    if (readOnly || isSaving) return;
    setDraft(buildDraft(currentOrder));
    setError(null);
    setEditingField(field);
  };

  const cancelField = () => {
    setDraft(buildDraft(currentOrder));
    setEditingField(null);
    setError(null);
  };

  const saveField = async (field: FieldKey) => {
    if (isSaving) return;
    const saved = await persistOrder();
    if (saved) {
      setEditingField(null);
      flashSaved(field);
    }
  };

  const handleFieldKeyDown = (field: FieldKey) => (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelField();
      return;
    }
    const isTextarea = (event.target as HTMLElement).tagName === "TEXTAREA";
    // A textarea's Enter is a newline; only Cmd/Ctrl+Enter saves it.
    // Every single-line field saves on a plain Enter.
    if (event.key === "Enter" && (!isTextarea || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void saveField(field);
    }
  };

  const fieldChrome = (field: FieldKey) => ({
    canEdit: !readOnly,
    editing: editingField === field,
    saving: isSaving && editingField === field,
    justSaved: justSavedField === field,
    onEdit: () => openField(field),
    onSave: () => void saveField(field),
    onCancel: cancelField,
    onKeyDown: handleFieldKeyDown(field),
    editTitle: t.edit,
    saveTitle: t.save,
    cancelTitle: t.cancel,
  });

  const syncOwnerShare = async () => {
    if (readOnly || isSaving || isSyncingOwner) return;
    if (!selectedOwnerId) {
      setError(t.ownerShareSyncOwnerRequired);
      return;
    }

    setIsSyncingOwner(true);
    setOwnerSyncMessage(null);

    const savedOrder = await persistOrder();
    if (!savedOrder) {
      setIsSyncingOwner(false);
      return;
    }
    // Whatever field was open just got saved as part of flushing the
    // order before sync -- it should re-lock like any other save.
    setEditingField(null);

    try {
      const response = await fetch(`/api/orders/${savedOrder.id}/owner-sync`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { ownerLedgerSyncedAt?: string; error?: string }
        | null;

      if (!response.ok || !payload?.ownerLedgerSyncedAt) {
        setError(payload?.error === "VEHICLE_OWNER_REQUIRED" ? t.ownerShareSyncOwnerRequired : t.ownerShareSyncError);
        return;
      }

      const updatedOrder = {
        ...savedOrder,
        ownerLedgerSyncedAt: payload.ownerLedgerSyncedAt,
      };
      setCurrentOrder(updatedOrder);
      onSaved?.(updatedOrder);
      setOwnerSyncMessage(t.ownerShareSyncSuccess);
      router.refresh();
    } catch {
      setError(t.ownerShareSyncError);
    } finally {
      setIsSyncingOwner(false);
    }
  };

  // Instalments load once, when the panel opens on an order. Not with
  // the order itself: most trips are a single payment and would pay
  // for a join they never use.
  useEffect(() => {
    if (readOnly || !currentOrder.id) return;
    let cancelled = false;
    setPaymentsLoaded(false);
    const load = async () => {
      try {
        const response = await fetch(`/api/orders/${currentOrder.id}/payments`);
        if (!response.ok) return;
        const data = (await response.json()) as {
          payments?: Array<{
            amount: number;
            paidAt: string | null;
            payer: string;
            method: string;
          }>;
        };
        if (cancelled) return;
        setPayments(
          (data.payments ?? []).map((payment) => ({
            amount: String(payment.amount),
            paidAt: payment.paidAt ?? "",
            payer: payment.payer,
            method: payment.method,
          })),
        );
      } finally {
        if (!cancelled) setPaymentsLoaded(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentOrder.id, readOnly]);

  // Opening an order here counts as viewing it, for the dashboard's
  // "recently viewed". Not in the read-only views shown to owners.
  useEffect(() => {
    if (!readOnly && currentOrder.id) rememberOrder(currentOrder.id);
  }, [currentOrder.id, readOnly]);

  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(min-width: 640px)").matches) setAttachmentsOpen(true);
  }, []);

  const paidTotal = payments.reduce(
    (sum, payment) => (payment.paidAt ? sum + (Number(payment.amount) || 0) : sum),
    0,
  );
  const scheduledTotal = payments.reduce(
    (sum, payment) => sum + (Number(payment.amount) || 0),
    0,
  );
  // Against the trip's own price when it has one, because that is the
  // number the operator is trying to collect -- not the sum of the
  // rows, which would always show zero outstanding.
  const owedAgainst = currentOrder.totalPrice ?? scheduledTotal;
  const outstanding = Math.max(owedAgainst - paidTotal, 0);

  const savePayments = async () => {
    if (isSavingPayments) return;
    setIsSavingPayments(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${currentOrder.id}/payments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payments: payments
            // A blank row is somebody who clicked Add and changed
            // their mind; dropping it is kinder than an error.
            .filter((payment) => payment.amount.trim() !== "")
            .map((payment) => ({
              amount: Number(payment.amount),
              paidAt: payment.paidAt || null,
              payer: payment.payer,
              method: payment.method,
            })),
        }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setNotice(t.paymentsSaved);
    } catch {
      setError(t.paymentsFailed);
    } finally {
      setIsSavingPayments(false);
    }
  };

  const duplicateOrder = async () => {
    if (isDuplicating) return;
    setIsDuplicating(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/orders/${currentOrder.id}/duplicate`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as {
        conflicts?: Array<{
          id: string;
          renterName: string;
          pickupDatetime: string;
          returnDatetime: string;
        }>;
      };
      setConflicts(data.conflicts ?? []);
      setNotice(t.duplicated);
      router.refresh();
    } catch {
      setError(t.duplicateFailed);
    } finally {
      setIsDuplicating(false);
    }
  };

  const deleteOrder = async () => {
    if (readOnly || isDeleting) return;
    if (!window.confirm(t.deleteConfirm)) return;

    setIsDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${currentOrder.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as
        | { deletedId?: string; error?: string }
        | null;

      if (payload?.error === "PAID_DIRECT_BOOKING") {
        pointToRefundPanel();
        return;
      }
      if (!response.ok || payload?.deletedId !== currentOrder.id) {
        setError(t.deleteError);
        return;
      }

      onDeleted?.(currentOrder.id);
      router.refresh();
      onClose();
    } catch {
      setError(t.deleteError);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      /* A bottom sheet on a phone, a centred dialog on a desktop.
         
         This panel is tall -- fourteen editable fields, a fee
         breakdown, attachments and now a payment schedule -- and as a
         centred box on a 375px screen it was a small window into a
         long document, floating with dead space above and below it.
         Anchoring it to the bottom gives it the full height and puts
         its top edge where a thumb can reach. */
      className="fixed inset-0 z-[90] flex items-end justify-center bg-[var(--ink)]/35 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-label={t.title}
      aria-modal="true"
    >
      <div
        className={cn(
          "overflow-y-auto border border-[rgba(17,19,24,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,247,247,0.98))] shadow-[0_28px_70px_-28px_rgba(17,19,24,0.55)]",
          // Phone: full width, rounded top only, up to 92vh, with room
          // under it for the home indicator.
          "max-h-[92vh] w-full rounded-t-2xl pb-[env(safe-area-inset-bottom)]",
          // Desktop: unchanged.
          "sm:max-h-[calc(100vh-1.5rem)] sm:w-[min(58rem,calc(100vw-1.5rem))] sm:rounded-lg sm:pb-0",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {/* One compact header: what car, and a line of chips that says
            where this trip stands -- when it starts or ends relative to
            now, whether it clashes, and whether its owner has it. Those
            were a status word ("Booked"), an owner line reading "-", and
            a bold sentence under them; the chips say the same in a
            glance, and the sentence read like an error on every trip of
            a car with no owner. */}
        <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[rgba(255,255,255,0.94)] px-3 py-2 backdrop-blur sm:px-4 sm:py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold text-[color:var(--ink)] sm:text-[1.15rem]">
                {currentOrder.vehiclePlateNumber
                  ? `${currentOrder.vehiclePlateNumber} · ${currentOrder.vehicleName}`
                  : currentOrder.vehicleName}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <StatusBadge value={currentOrder.source} locale={locale} />
                <span
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.02em]",
                    PHASE_TONE_CLASSES[phase.tone],
                  )}
                >
                  {phase.label}
                </span>
                {currentOrder.hasConflict ? (
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold", PHASE_TONE_CLASSES.cancelled)}>
                    {t.conflict}
                  </span>
                ) : null}
                {ownerName ? (
                  <span
                    title={ownerShareSyncedAt ? `${t.ownerShareLastSynced} ${formatDateTime(ownerShareSyncedAt, locale)}` : undefined}
                    className={cn(
                      "inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                      !readOnly && ownerShareSyncedAt
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-[var(--surface-muted)] text-[color:var(--ink-mid)]",
                    )}
                  >
                    {!readOnly && ownerShareSyncedAt ? <Check className="h-3 w-3 shrink-0" aria-hidden /> : null}
                    <span className="truncate">
                      {t.ownerChip(ownerName)}
                      {readOnly ? "" : ` · ${ownerShareSyncedAt ? t.ownerShareSynced : t.ownerShareUnsynced}`}
                    </span>
                  </span>
                ) : (
                  <span
                    title={readOnly ? undefined : t.ownerShareNotAssigned}
                    className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-900"
                  >
                    {t.noOwner}
                  </span>
                )}
                {ownerSyncMessage ? (
                  <span className="text-[11px] font-semibold text-emerald-700">{ownerSyncMessage}</span>
                ) : null}
              </div>
              {/* Only the read-only notice: the caption for editors
                  ("Calendar and Orders open the same detail panel")
                  said nothing an operator acts on. */}
              {readOnly ? (
                <p className="mt-1 text-[12px] text-[color:var(--ink-soft)]">{t.readOnly}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {turoReceiptUrl ? (
                <a
                  href={turoReceiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t.viewTuroReceipt}
                  aria-label={t.viewTuroReceipt}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-2.5 text-[12px] font-semibold text-[var(--ink)] transition hover:border-[var(--ink)]"
                >
                  <ReceiptText className="h-3.5 w-3.5" aria-hidden />
                  <span className="hidden sm:inline">{t.viewTuroReceipt}</span>
                </a>
              ) : null}
              {turoTripUrl ? (
                <a
                  href={turoTripUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t.viewOnTuro}
                  aria-label={t.viewOnTuro}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-2.5 text-[12px] font-semibold text-[var(--ink)] transition hover:border-[var(--ink)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  <span className="hidden sm:inline">{t.viewOnTuro}</span>
                </a>
              ) : null}
              {!readOnly ? (
                <button
                  type="button"
                  onClick={syncOwnerShare}
                  disabled={!selectedOwnerId || isSaving || isSyncingOwner || isDeleting}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-emerald-600 bg-emerald-600 px-2.5 text-[12px] font-semibold text-white transition hover:border-emerald-700 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--surface-muted)] disabled:text-[color:var(--ink-soft)]"
                  title={selectedOwnerId ? t.ownerShareHelp : t.ownerShareNotAssigned}
                  aria-label={t.ownerShareSync}
                >
                  <Share2 className={cn("h-3.5 w-3.5", isSyncingOwner && "motion-safe:animate-pulse")} aria-hidden />
                  <span className="hidden sm:inline">
                    {isSyncingOwner
                      ? t.ownerShareSyncing
                      : ownerShareSyncedAt
                        ? t.ownerShareResync
                        : t.ownerShareSync}
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                aria-label={t.close}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>

        <div className="px-3 py-3 sm:px-4">
          {/* The trip itself, as one card: when the car goes out, how
              long, when it comes back, and where. These were four equal
              boxes among twelve, so the two facts every visit to this
              panel is about -- the handover times -- read no louder than
              the contract number. The times are the largest type here;
              each part still edits in place. While a time is being
              edited the card stacks, because a date and a clock field do
              not fit in half a phone. */}
          <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1.5 sm:p-2">
            <div
              className={cn(
                "grid min-w-0 items-stretch gap-1",
                editingTime ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-2",
              )}
            >
              <EditableField variant="bare" labelText={t.pickupShort} {...fieldChrome("pickupTime")}>
                {editingField === "pickupTime" ? (
                  /* One field, two parts. The date and the clock time are
                     a single fact -- when the car changes hands -- and two
                     separate boxes made it read as two. Divided by a rule
                     rather than a border so it stays one control. */
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-2">
                    <input
                      value={draft.pickupDate}
                      onChange={(event) => updateDraft({ pickupDate: event.target.value })}
                      inputMode="numeric"
                      placeholder="yyyy/mm/dd"
                      autoFocus
                      className={inputClass}
                    />
                    <span aria-hidden className="h-4 w-px bg-[rgba(17,19,24,0.12)]" />
                    <input
                      value={draft.pickupTime}
                      onChange={(event) => updateDraft({ pickupTime: event.target.value })}
                      inputMode="numeric"
                      placeholder="HH:mm"
                      className={inputClass}
                    />
                  </div>
                ) : (
                  <TripMoment value={currentOrder.pickupDatetime} locale={locale} />
                )}
              </EditableField>

              {!editingTime ? (
                <div className="flex flex-col items-center justify-center gap-0.5 pt-3">
                  <span className="whitespace-nowrap rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[color:var(--ink)]">
                    {t.duration(length.days, length.hours)}
                  </span>
                  <ArrowRight className="h-4 w-4 text-[color:var(--ink-soft)]" aria-hidden />
                </div>
              ) : null}

              <EditableField variant="bare" labelText={t.returnShort} {...fieldChrome("returnTime")}>
                {editingField === "returnTime" ? (
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-2">
                    <input
                      value={draft.returnDate}
                      onChange={(event) => updateDraft({ returnDate: event.target.value })}
                      inputMode="numeric"
                      placeholder="yyyy/mm/dd"
                      autoFocus
                      className={inputClass}
                    />
                    <span aria-hidden className="h-4 w-px bg-[rgba(17,19,24,0.12)]" />
                    <input
                      value={draft.returnTime}
                      onChange={(event) => updateDraft({ returnTime: event.target.value })}
                      inputMode="numeric"
                      placeholder="HH:mm"
                      className={inputClass}
                    />
                  </div>
                ) : (
                  <TripMoment value={currentOrder.returnDatetime} locale={locale} />
                )}
              </EditableField>
            </div>

            {/* Where. One line when the car comes back to where it left,
                which is most trips -- the same airport twice was a whole
                row of repetition. Editing that line moves both. */}
            {showCombinedLocation ? (
              <div className="mt-1 border-t border-[var(--line)] pt-1">
                <EditableField variant="bare" labelText={t.sameLocation} {...fieldChrome("locations")}>
                  <LocationInput
                    value={editingField === "locations" ? draft.pickupLocation : pickupLocation}
                    onChange={(value) => updateDraft({ pickupLocation: value, returnLocation: value })}
                    editing={editingField === "locations"}
                    className={inputClass}
                  />
                </EditableField>
              </div>
            ) : showPickupLocation || showReturnLocation ? (
              <div className="mt-1 grid min-w-0 grid-cols-2 gap-1 border-t border-[var(--line)] pt-1 sm:gap-2">
                {showPickupLocation ? (
                  <EditableField
                    variant="bare"
                    className={cn(!showReturnLocation && "col-span-2")}
                    labelText={t.pickupLocation}
                    {...fieldChrome("pickupLocation")}
                  >
                    <LocationInput
                      value={editingField === "pickupLocation" ? draft.pickupLocation : pickupLocation}
                      onChange={(value) => updateDraft({ pickupLocation: value })}
                      editing={editingField === "pickupLocation"}
                      className={inputClass}
                    />
                  </EditableField>
                ) : null}
                {showReturnLocation ? (
                  <EditableField
                    variant="bare"
                    className={cn(!showPickupLocation && "col-span-2")}
                    labelText={t.returnLocation}
                    {...fieldChrome("returnLocation")}
                  >
                    <LocationInput
                      value={editingField === "returnLocation" ? draft.returnLocation : returnLocation}
                      onChange={(value) => updateDraft({ returnLocation: value })}
                      editing={editingField === "returnLocation"}
                      className={inputClass}
                    />
                  </EditableField>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* A note is an instruction for the handover ("child seat",
              "late return approved"), so it sits right under the trip
              rather than below the accounting where it was easy to miss. */}
          {showField("notes") ? (
            <div className="mt-2">
              <EditableField variant="note" labelText={t.notes} {...fieldChrome("notes")}>
                <textarea
                  value={editingField === "notes" ? draft.notes : currentOrder.notes ?? ""}
                  onChange={(event) => updateDraft({ notes: event.target.value })}
                  readOnly={editingField !== "notes"}
                  autoFocus={editingField === "notes"}
                  rows={editingField === "notes" ? 4 : Math.min(4, Math.max(1, (currentOrder.notes ?? "").split("\n").length))}
                  className="w-full min-w-0 max-w-full resize-none border-0 bg-transparent p-0 text-[13px] text-[color:var(--ink)] outline-none"
                />
              </EditableField>
            </div>
          ) : null}

          {/* Who, and the two fields that change what the trip is: its
              status and its car. Two columns from the narrowest phone
              up; the phone is only here when there is one. */}
          <div className="mt-2 grid min-w-0 grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-4">
            <EditableField labelText={t.renter} {...fieldChrome("renterName")}>
              <input
                value={editingField === "renterName" ? draft.renterName : currentOrder.renterName}
                onChange={(event) => updateDraft({ renterName: event.target.value })}
                readOnly={editingField !== "renterName"}
                autoFocus={editingField === "renterName"}
                className={inputClass}
              />
            </EditableField>

            {showField("renterPhone") ? (
              <EditableField labelText={t.phone} {...fieldChrome("renterPhone")}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <input
                    type="tel"
                    value={editingField === "renterPhone" ? draft.renterPhone : displayPhone}
                    onChange={(event) => updateDraft({ renterPhone: event.target.value })}
                    readOnly={editingField !== "renterPhone"}
                    autoFocus={editingField === "renterPhone"}
                    className={inputClass}
                  />
                  {editingField !== "renterPhone" && !maskSensitive && currentOrder.renterPhone ? (
                    <a
                      href={`tel:${currentOrder.renterPhone.replace(/[^\d+]/g, "")}`}
                      title={t.call}
                      aria-label={t.call}
                      className="tap-compact inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--accent)] transition hover:bg-[var(--surface-muted)]"
                    >
                      <Phone className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  ) : null}
                </span>
              </EditableField>
            ) : null}

            <EditableField labelText={t.status} {...fieldChrome("status")}>
              {editingField === "status" ? (
                <SearchableSelect
                  value={draft.status}
                  onChange={(value) => updateDraft({ status: value as EditableOrder["status"] })}
                  options={statusOptions.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  placeholder={t.status}
                  searchPlaceholder={t.status}
                  className={selectInputClass}
                />
              ) : (
                <span className={cn(inputClass, "flex items-center")}>{getStatusLabel(currentOrder.status, locale)}</span>
              )}
            </EditableField>

            <EditableField
              className={cn(!showField("renterPhone") && "col-span-2 lg:col-span-2", editingField === "vehicleId" && "col-span-2")}
              labelText={t.vehicle}
              {...fieldChrome("vehicleId")}
            >
              {editingField === "vehicleId" ? (
                <SearchableSelect
                  value={draft.vehicleId}
                  onChange={(value) => updateDraft({ vehicleId: value })}
                  options={vehicleOptions.map((vehicle) => ({
                    value: vehicle.id,
                    label: vehicle.plateNumber ? `${vehicle.plateNumber} · ${vehicle.label}` : vehicle.label,
                    searchText: [vehicle.plateNumber, vehicle.label, vehicle.secondaryLabel, vehicle.ownerName]
                      .filter(Boolean)
                      .join(" "),
                  }))}
                  placeholder={t.vehicle}
                  searchPlaceholder={t.vehicle}
                  className={selectInputClass}
                />
              ) : (
                <span className={cn(inputClass, "flex items-center")}>
                  {currentOrder.vehiclePlateNumber
                    ? `${currentOrder.vehiclePlateNumber} · ${currentOrder.vehicleName}`
                    : currentOrder.vehicleName}
                </span>
              )}
            </EditableField>

            {/* Billing for days the booking did not pay for, right under
                the times that decide them: move the return, see what is
                owed, charge it. Direct bookings only -- the panel renders
                nothing for any other order, and Turo trips are billed by
                Turo, so they skip the fetch. Keyed on the saved times, not
                the draft, so it re-prices once a new time is saved and
                never while one is half typed. */}
            {currentOrder.source !== "turo" ? (
              <div className="col-span-2 empty:hidden lg:col-span-4">
                <BookingExtraChargePanel
                  key={`${currentOrder.id}:${currentOrder.pickupDatetime}:${currentOrder.returnDatetime}`}
                  locale={locale}
                  orderId={currentOrder.id}
                />
              </div>
            ) : null}

            {/* Cancelling a paid online booking, with its refund decided
                first. The status field and delete refuse to do it for such
                a booking and scroll here instead. Renders nothing for any
                other order. Done closes the dialog: the order it showed is
                now cancelled, and possibly in the trash. */}
            {currentOrder.source !== "turo" ? (
              <div ref={cancelPanelRef} className="col-span-2 empty:hidden lg:col-span-4">
                <DirectBookingCancelPanel
                  key={`${currentOrder.id}:${currentOrder.status}`}
                  locale={locale}
                  orderId={currentOrder.id}
                  onDone={() => {
                    router.refresh();
                    onClose();
                  }}
                />
              </div>
            ) : null}

            {/* Pick-up and return photos and the odometer. Full width: two
                photo grids side by side. Renders nothing for an order that
                is not a direct booking. */}
            {currentOrder.source !== "turo" ? (
              <div className="col-span-2 empty:hidden lg:col-span-4">
                <DirectBookingHandoverPanel locale={locale} orderId={currentOrder.id} />
              </div>
            ) : null}
          </div>

          {/* Accounting on its own. These are what a bookkeeper
              reconciles against a bank statement. A Turo trip's figure is
              its earnings after Turo's cut, which arrive with the CSV --
              until then the box says so instead of standing empty. The
              cleaning fee sits here because it is the one number on
              this panel that is not a property of the order at all --
              it is a price on the car, and saving it prices every trip
              that car runs from the chosen date onward. Deposit, payment
              method, contract number and cleaning fee only take a box
              once they hold something; empty, they are an Add chip
              below. */}
          <div className="mt-2.5 rounded-lg border border-[rgba(17,19,24,0.1)] bg-[var(--surface-muted)]/50 p-2 sm:p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
              {t.accounting}
            </p>
            <div className="mt-1.5 grid min-w-0 grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-4">
              <EditableField
                labelText={currentOrder.source === "turo" ? t.earnings : t.totalPrice}
                {...fieldChrome("totalPrice")}
              >
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editingField === "totalPrice" ? draft.totalPrice : formatCurrencyInputValue(currentOrder.totalPrice)}
                  placeholder={currentOrder.source === "turo" && editingField !== "totalPrice" ? t.earningsPending : undefined}
                  onChange={(event) => updateDraft({ totalPrice: event.target.value })}
                  onBlur={(event) => updateDraft({ totalPrice: formatCurrencyInputText(event.target.value) })}
                  readOnly={editingField !== "totalPrice"}
                  autoFocus={editingField === "totalPrice"}
                  className={cn(inputClass, "font-semibold tabular-nums")}
                />
              </EditableField>

              {showField("depositAmount") ? (
                <EditableField labelText={t.deposit} {...fieldChrome("depositAmount")}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={
                      editingField === "depositAmount"
                        ? draft.depositAmount
                        : formatCurrencyInputValue(currentOrder.depositAmount)
                    }
                    onChange={(event) => updateDraft({ depositAmount: event.target.value })}
                    onBlur={(event) => updateDraft({ depositAmount: formatCurrencyInputText(event.target.value) })}
                    readOnly={editingField !== "depositAmount"}
                    autoFocus={editingField === "depositAmount"}
                    className={inputClass}
                  />
                </EditableField>
              ) : null}

              {showField("paymentMethod") ? (
                <EditableField labelText={t.paymentMethod} {...fieldChrome("paymentMethod")}>
                  <input
                    value={editingField === "paymentMethod" ? draft.paymentMethod : currentOrder.paymentMethod ?? ""}
                    onChange={(event) => updateDraft({ paymentMethod: event.target.value })}
                    readOnly={editingField !== "paymentMethod"}
                    autoFocus={editingField === "paymentMethod"}
                    className={inputClass}
                  />
                </EditableField>
              ) : null}

              {showField("contractNumber") ? (
                <EditableField labelText={t.contractNumber} {...fieldChrome("contractNumber")}>
                  <input
                    value={editingField === "contractNumber" ? draft.contractNumber : currentOrder.contractNumber ?? ""}
                    onChange={(event) => updateDraft({ contractNumber: event.target.value })}
                    readOnly={editingField !== "contractNumber"}
                    autoFocus={editingField === "contractNumber"}
                    className={inputClass}
                  />
                </EditableField>
              ) : null}

              {showField("cleaningFee") ? (
                <EditableField
                  className="col-span-2"
                  labelText={t.cleaningFee}
                  {...fieldChrome("cleaningFee")}
                >
                  <div className="grid min-w-0 grid-cols-[minmax(0,7rem)_auto_minmax(0,1fr)] items-center gap-2">
                    <input
                      value={
                        editingField === "cleaningFee"
                          ? draft.cleaningFee
                          : formatCurrencyInputValue(currentOrder.cleaningFee)
                      }
                      onChange={(event) => updateDraft({ cleaningFee: event.target.value })}
                      readOnly={editingField !== "cleaningFee"}
                      autoFocus={editingField === "cleaningFee"}
                      type="number"
                      step="0.01"
                      min="0"
                      className={inputClass}
                    />
                    {editingField === "cleaningFee" ? (
                      <>
                        <span aria-hidden className="h-4 w-px bg-[rgba(17,19,24,0.12)]" />
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 text-[10px] uppercase tracking-[0.13em] text-[color:var(--ink-soft)]">
                            {t.cleaningFeeFrom}
                          </span>
                          <input
                            value={draft.cleaningFeeFrom}
                            onChange={(event) => updateDraft({ cleaningFeeFrom: event.target.value })}
                            type="date"
                            className={inputClass}
                          />
                        </span>
                      </>
                    ) : (
                      <span />
                    )}
                  </div>
                  {editingField === "cleaningFee" ? (
                    <p className="mt-1.5 text-[11px] leading-4 text-[color:var(--ink-soft)]">
                      {t.cleaningFeeHint}
                    </p>
                  ) : null}
                </EditableField>
              ) : null}
            </div>
            {/* What the trip was actually made of. Turo bundles a
                dozen possible charges into one earnings figure, and
                until now the panel showed the figure and none of the
                charges -- so "why is this trip $377" had no answer
                anywhere in the product. */}
            {currentOrder.feeLines && currentOrder.feeLines.length > 0 ? (
              <div className="mt-2 rounded-md border border-[rgba(17,19,24,0.1)] bg-white/70 px-2.5 py-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                  {t.feeBreakdown}
                </p>
                <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
                  {currentOrder.feeLines.map((line) => (
                    <li
                      key={line.column}
                      className="flex items-baseline justify-between gap-3 text-[11.5px] leading-[1.15rem]"
                    >
                      <span className="min-w-0 truncate text-[color:var(--ink-soft)]">
                        {line.column}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 tabular-nums",
                          line.sign === "debit" ? "text-rose-600" : "text-[color:var(--ink)]",
                        )}
                      >
                        {line.sign === "debit" ? "−" : ""}
                        {formatCurrency(Math.abs(line.amount), locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* What this particular trip is charged, when that is not
                the car's current fee. Without it, editing an old trip
                looks like the fee failed to save -- the box holds the
                car's price and the statement holds the trip's. */}
            {currentOrder.cleaningFeeOnTrip != null &&
            Math.abs((currentOrder.cleaningFeeOnTrip ?? 0) - (currentOrder.cleaningFee ?? 0)) >=
              0.005 ? (
              <p className="mt-2 text-[11px] leading-4 text-amber-700">
                {t.cleaningFeeOnTrip(formatCurrency(currentOrder.cleaningFeeOnTrip, locale))}
              </p>
            ) : null}
          </div>

          {/* Every field that is empty, as one row of chips. Pressing one
              opens that field for editing in its usual place. Before, a
              Turo trip showed four blank boxes -- deposit, payment
              method, contract, notes -- that Turo never fills. */}
          {!readOnly && addChips.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 px-0.5">
              <span className="text-[11px] text-[color:var(--ink-soft)]">{t.addField}</span>
              {addChips.map(([field, label]) => (
                <button
                  key={field}
                  type="button"
                  onClick={() => openField(field)}
                  disabled={isSaving}
                  className="tap-compact inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-[var(--line-strong)] px-2.5 text-[12px] text-[color:var(--ink-mid)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 px-1 text-[11px] text-[color:var(--ink-soft)]">
            {currentOrder.createdBy ? (
              <p>
                {t.createdBy}: <span className="font-semibold text-[color:var(--ink)]">{currentOrder.createdBy}</span>
              </p>
            ) : null}
            {currentOrder.externalOrderId ? (
              <p>
                {t.externalOrderId}:{" "}
                <span className="font-semibold text-[color:var(--ink)]">{currentOrder.externalOrderId}</span>
              </p>
            ) : null}
          </div>

          {/* Folded on a phone, where its upload buttons and grids were
              the tallest thing in the panel; open on a wider screen. */}
          {!readOnly ? (
            <details
              open={attachmentsOpen}
              onToggle={(event) => setAttachmentsOpen((event.currentTarget as HTMLDetailsElement).open)}
              className="group/files mt-2.5 rounded-lg border border-[color:var(--line)] bg-white/58 p-2 sm:p-2.5"
            >
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-soft)] [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="inline-block transition group-open/files:rotate-90">›</span>
                {t.attachments}
              </summary>
              <div className="mt-1.5">
                <OrderAttachments orderId={currentOrder.id} locale={locale} compact />
              </div>
            </details>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
              {notice}
            </p>
          ) : null}

          {/* Names what the red bar is about. Without it, "Conflict"
              sends the operator back to the calendar to find a trip
              the server had already identified. */}
          {conflicts.length > 0 ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              <p className="font-semibold">{t.conflictHeading}</p>
              <ul className="mt-1 space-y-0.5">
                {conflicts.map((conflict) => (
                  <li key={conflict.id}>
                    {t.conflictRow(
                      conflict.renterName,
                      `${formatDateTime(conflict.pickupDatetime, locale)} → ${formatDateTime(
                        conflict.returnDatetime,
                        locale,
                      )}`,
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* A long rental is not one payment, and a single totalPrice
              cannot answer the only question anybody asks midway
              through it: how much is still owed. */}
          {/* Turo collects for its own trips, so a Turo trip shows the
              schedule only once someone has written a row into it. */}
          {!readOnly && paymentsLoaded && (currentOrder.source !== "turo" || payments.length > 0) ? (
            <section className="mt-2.5 rounded-md border border-[var(--line)] bg-white/70 p-2 sm:p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[12px] font-semibold text-[var(--ink)]">{t.payments}</h3>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    outstanding <= 0.005
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-900",
                  )}
                >
                  {outstanding <= 0.005
                    ? t.paymentsSettled
                    : `${t.paymentsRemaining} ${formatCurrency(outstanding, locale)}`}
                  {" · "}
                  {t.paymentsTotalPaid} {formatCurrency(paidTotal, locale)}
                </span>
              </div>

              {payments.length > 0 ? (
                <div className="mt-2 grid gap-1.5">
                  {payments.map((payment, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-2 gap-1.5 sm:grid-cols-[7rem_9rem_1fr_1fr_auto]"
                    >
                      <input
                        value={payment.amount}
                        inputMode="decimal"
                        placeholder={t.paymentsAmount}
                        aria-label={t.paymentsAmount}
                        onChange={(event) =>
                          setPayments((rows) =>
                            rows.map((row, position) =>
                              position === index ? { ...row, amount: event.target.value } : row,
                            ),
                          )
                        }
                        className="h-8 rounded-md border border-[var(--line)] bg-white px-2 text-[12px] tabular-nums outline-none focus:border-[var(--accent)]"
                      />
                      <input
                        type="date"
                        value={payment.paidAt}
                        aria-label={t.paymentsPaidAt}
                        onChange={(event) =>
                          setPayments((rows) =>
                            rows.map((row, position) =>
                              position === index ? { ...row, paidAt: event.target.value } : row,
                            ),
                          )
                        }
                        className="h-8 rounded-md border border-[var(--line)] bg-white px-2 text-[12px] outline-none focus:border-[var(--accent)]"
                      />
                      <input
                        value={payment.payer}
                        placeholder={t.paymentsPayer}
                        aria-label={t.paymentsPayer}
                        onChange={(event) =>
                          setPayments((rows) =>
                            rows.map((row, position) =>
                              position === index ? { ...row, payer: event.target.value } : row,
                            ),
                          )
                        }
                        className="h-8 rounded-md border border-[var(--line)] bg-white px-2 text-[12px] outline-none focus:border-[var(--accent)]"
                      />
                      <input
                        value={payment.method}
                        placeholder={t.paymentsMethod}
                        aria-label={t.paymentsMethod}
                        onChange={(event) =>
                          setPayments((rows) =>
                            rows.map((row, position) =>
                              position === index ? { ...row, method: event.target.value } : row,
                            ),
                          )
                        }
                        className="h-8 rounded-md border border-[var(--line)] bg-white px-2 text-[12px] outline-none focus:border-[var(--accent)]"
                      />
                      <button
                        type="button"
                        aria-label={t.paymentsRemove}
                        onClick={() =>
                          setPayments((rows) => rows.filter((_, position) => position !== index))
                        }
                        className="h-8 rounded-md border border-[var(--line)] bg-white px-2 text-[12px] text-[color:var(--ink-soft)] transition hover:border-rose-300 hover:text-rose-600"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPayments((rows) => [
                      ...rows,
                      { amount: "", paidAt: "", payer: "", method: "" },
                    ])
                  }
                  className="inline-flex h-8 items-center rounded-md border border-[var(--line)] bg-white px-2.5 text-[12px] font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  {t.paymentsAdd}
                </button>
                <button
                  type="button"
                  onClick={() => void savePayments()}
                  disabled={isSavingPayments}
                  className="inline-flex h-8 items-center rounded-md border border-[var(--line)] bg-white px-2.5 text-[12px] font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                >
                  {isSavingPayments ? t.paymentsSaving : t.paymentsSave}
                </button>
              </div>
            </section>
          ) : null}

          {/* Delete is guarded by its own confirm dialog, which is the
              speed bump -- it no longer needs a second one borrowed
              from a global edit mode that does not exist anymore. */}
          {!readOnly ? (
            <div className="mt-3 flex flex-wrap justify-start gap-2 border-t border-[var(--line)] pt-3">
              <button
                type="button"
                onClick={() => void duplicateOrder()}
                disabled={isDuplicating || isSaving}
                title={t.duplicateHint}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-3.5 text-[12px] font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDuplicating ? t.duplicating : t.duplicate}
              </button>
              <button
                type="button"
                onClick={deleteOrder}
                disabled={isDeleting || isSaving}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-white px-3.5 text-[12px] font-semibold text-rose-600 transition hover:border-rose-400 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {isDeleting ? t.deleting : t.delete}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
