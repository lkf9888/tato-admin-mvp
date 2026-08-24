"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Save, Share2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { OrderAttachments } from "@/components/order-attachments";
import { SearchableSelect } from "@/components/searchable-select";
import { StatusBadge } from "@/components/status-badge";
import { getOrderStatusOptions, getStatusLabel, type Locale } from "@/lib/i18n";
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

function labels(locale: Locale) {
  return locale === "zh"
    ? {
        title: "订单详情与编辑",
        subtitle: "日历和订单页使用同一个详情面板",
        close: "关闭",
        edit: "编辑",
        save: "保存",
        saving: "保存中...",
        cancel: "取消",
        delete: "删除订单",
        deleting: "删除中...",
        deleteConfirm: "确认要从日历中删除这条订单吗？照片和文件会保留。",
        saveError: "订单暂时无法保存，请检查必填项后重试。",
        deleteError: "订单暂时无法删除，请稍后再试。",
        validationError: "请填写租客、车辆与正确的取还车时间。",
        vehicle: "车辆",
        status: "状态",
        renter: "租客姓名",
        phone: "电话",
        pickupTime: "取车时间",
        returnTime: "还车时间",
        totalPrice: "订单金额",
        deposit: "押金",
        pickupLocation: "取车地点",
        returnLocation: "还车地点",
        paymentMethod: "付款方式",
        contractNumber: "合同编号",
        notes: "备注",
        owner: "车主",
        source: "来源",
        createdBy: "创建人",
        externalOrderId: "外部订单号",
        attachments: "照片 / 视频 / 合约文件",
        readOnly: "共享视图只读",
        ownerShare: "车主共享",
        ownerShareHelp: "同步后，这条订单会出现在车主共享日历和车主分成流水账中。",
        ownerShareNotAssigned: "车辆还没有绑定车主，暂时无法同步。",
        ownerShareUnsynced: "未同步给车主",
        ownerShareSynced: "已同步给车主",
        ownerShareSync: "同步给车主共享",
        ownerShareResync: "重新同步",
        ownerShareSyncing: "同步中...",
        ownerShareSyncSuccess: "已同步到车主共享。",
        ownerShareSyncError: "同步失败，请稍后再试。",
        ownerShareSyncOwnerRequired: "请先给车辆绑定车主。",
        ownerShareLastSynced: "最后同步",
        accounting: "会计信息",
        feeBreakdown: "费用明细(来自 Turo CSV)",
        cleaningFee: "洗车费",
        cleaningFeeFrom: "生效日",
        cleaningFeeHint:
          "洗车费是车辆的价格,不是这一单的属性。保存后,这台车在生效日当天及以后开始的所有订单都按这个金额计费,之前的订单不受影响。",
        cleaningFeeOnTrip: (amount: string) =>
          `这一单按 ${amount} 计费 —— 它开始于生效日之前,所以用的是当时的价格。上面的金额是这台车现在的洗车费。`,
      }
    : {
        title: "Order details and edits",
        subtitle: "Calendar and Orders open the same detail panel",
        close: "Close",
        edit: "Edit",
        save: "Save",
        saving: "Saving...",
        cancel: "Cancel",
        delete: "Delete order",
        deleting: "Deleting...",
        deleteConfirm: "Delete this order from the calendar? Photos and files will be preserved.",
        saveError: "We could not save this order. Check the required fields and try again.",
        deleteError: "We could not delete this order right now. Please try again.",
        validationError: "Complete renter, vehicle, and a valid pickup/return window.",
        vehicle: "Vehicle",
        status: "Status",
        renter: "Renter name",
        phone: "Phone",
        pickupTime: "Pickup time",
        returnTime: "Return time",
        totalPrice: "Total price",
        deposit: "Deposit",
        pickupLocation: "Pickup location",
        returnLocation: "Return location",
        paymentMethod: "Payment method",
        contractNumber: "Contract number",
        notes: "Notes",
        owner: "Owner",
        source: "Source",
        createdBy: "Created by",
        externalOrderId: "External order ID",
        attachments: "Photos / videos / contract files",
        readOnly: "Shared view is read-only",
        ownerShare: "Owner share",
        ownerShareHelp: "After sync, this order appears in the owner share calendar and owner ledger.",
        ownerShareNotAssigned: "Assign this vehicle to an owner before syncing.",
        ownerShareUnsynced: "Not shared with owner",
        ownerShareSynced: "Shared with owner",
        ownerShareSync: "Sync to owner share",
        ownerShareResync: "Resync",
        ownerShareSyncing: "Syncing...",
        ownerShareSyncSuccess: "Synced to owner share.",
        ownerShareSyncError: "Sync failed. Please try again.",
        ownerShareSyncOwnerRequired: "Assign this vehicle to an owner first.",
        ownerShareLastSynced: "Last synced",
        accounting: "Accounting",
        feeBreakdown: "Charges on this trip (from the Turo CSV)",
        cleaningFee: "Cleaning fee",
        cleaningFeeFrom: "From",
        cleaningFeeHint:
          "The cleaning fee is a price on the car, not a property of this order. Saving it charges this amount on every trip that car starts on or after the chosen date. Earlier trips are untouched.",
        cleaningFeeOnTrip: (amount: string) =>
          `This trip is charged ${amount} — it started before the date above, so it keeps the price from then. The figure above is the car's fee today.`,
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
        "grid min-w-0 gap-0.5 rounded-md border px-3 py-1.5 transition",
        editing
          ? "border-[var(--accent)] bg-white shadow-[0_0_0_3px_rgba(89,60,251,0.1)]"
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
                  className="flex h-5 w-5 items-center justify-center rounded text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-40"
                >
                  <Save className="h-3 w-3" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={saving}
                  title={cancelTitle}
                  aria-label={cancelTitle}
                  className="flex h-5 w-5 items-center justify-center rounded text-[color:var(--ink-soft)] transition hover:bg-[var(--surface-muted)] disabled:opacity-40"
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
                  "flex h-5 w-5 items-center justify-center rounded transition hover:bg-[var(--surface-muted)] disabled:opacity-40",
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
  const t = labels(locale);
  const statusOptions = getOrderStatusOptions(locale);
  const [currentOrder, setCurrentOrder] = useState(order);
  const [draft, setDraft] = useState<OrderDraft>(() => buildDraft(order));
  const [error, setError] = useState<string | null>(null);
  const [ownerSyncMessage, setOwnerSyncMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingOwner, setIsSyncingOwner] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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
  const ownerShareSyncedAt = currentOrder.ownerLedgerSyncedAt ?? null;

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
        | { order?: EditableOrder; error?: string }
        | null;

      if (!response.ok || !payload?.order) {
        setError(
          payload?.error === "INVALID_DATES" || payload?.error === "VALIDATION_ERROR"
            ? t.validationError
            : t.saveError,
        );
        return null;
      }

      setCurrentOrder(payload.order);
      setDraft(buildDraft(payload.order));
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
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--ink)]/35 p-3 backdrop-blur-sm sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[calc(100vh-1.5rem)] w-[min(58rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-[rgba(17,19,24,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,247,247,0.98))] shadow-[0_28px_70px_-28px_rgba(17,19,24,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[rgba(255,255,255,0.94)] px-4 py-3 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--ink-soft)]">
                {t.title}
              </p>
              <h3 className="mt-1 truncate font-serif text-[1.15rem] font-semibold text-[color:var(--ink)] sm:text-[1.35rem]">
                {currentOrder.vehiclePlateNumber
                  ? `${currentOrder.vehiclePlateNumber} · ${currentOrder.vehicleName}`
                  : currentOrder.vehicleName}
              </h3>
              <p className="mt-1 text-[12px] text-[color:var(--ink-soft)]">
                {readOnly ? t.readOnly : t.subtitle}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!readOnly ? (
                <button
                  type="button"
                  onClick={syncOwnerShare}
                  disabled={!selectedOwnerId || isSaving || isSyncingOwner || isDeleting}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-emerald-600 bg-emerald-600 px-3 text-[12px] font-semibold text-white transition hover:-translate-y-0.5 hover:border-emerald-700 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--surface-muted)] disabled:text-[color:var(--ink-soft)]"
                  title={selectedOwnerId ? t.ownerShareHelp : t.ownerShareNotAssigned}
                >
                  <Share2 className="h-3.5 w-3.5" aria-hidden />
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
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <StatusBadge value={currentOrder.source} locale={locale} />
            <StatusBadge value={draft.status} locale={locale} />
            {currentOrder.hasConflict ? <StatusBadge value="conflict" locale={locale} /> : null}
          </div>
        </div>

        <div className="px-4 py-4">
          <div className="grid gap-3 text-[12px] text-[color:var(--ink)] md:grid-cols-4">
            <div className="min-w-0 rounded-md border border-[rgba(17,19,24,0.06)] bg-white/72 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                {t.owner}
              </p>
              <p className="mt-1 truncate font-semibold">{selectedVehicle?.ownerName ?? currentOrder.ownerName ?? "-"}</p>
            </div>
            <div className="min-w-0 rounded-md border border-[rgba(17,19,24,0.06)] bg-white/72 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                {t.source}
              </p>
              <p className="mt-1 truncate font-semibold">{getStatusLabel(currentOrder.source, locale)}</p>
            </div>
            <div className="min-w-0 rounded-md border border-[rgba(17,19,24,0.06)] bg-white/72 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                {t.totalPrice}
              </p>
              <p className="mt-1 truncate font-semibold">{formatCurrency(currentOrder.totalPrice, locale)}</p>
            </div>
            <div className="min-w-0 rounded-md border border-[rgba(17,19,24,0.06)] bg-white/72 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                {t.phone}
              </p>
              <p className="mt-1 truncate font-semibold">{displayPhone}</p>
            </div>
          </div>

          {!readOnly ? (
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] leading-4 text-[color:var(--ink-soft)]">
              <span className="font-semibold text-[color:var(--ink)]">
                {ownerShareSyncedAt
                  ? t.ownerShareSynced
                  : selectedOwnerId
                    ? t.ownerShareUnsynced
                    : t.ownerShareNotAssigned}
              </span>
              {ownerShareSyncedAt ? (
                <span>{`${t.ownerShareLastSynced}: ${formatDateTime(ownerShareSyncedAt, locale)}`}</span>
              ) : null}
              {ownerSyncMessage ? (
                <span className="font-semibold text-emerald-700">{ownerSyncMessage}</span>
              ) : null}
            </p>
          ) : null}

          <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <EditableField labelText={t.vehicle} {...fieldChrome("vehicleId")}>
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

            <EditableField labelText={t.renter} {...fieldChrome("renterName")}>
              <input
                value={editingField === "renterName" ? draft.renterName : currentOrder.renterName}
                onChange={(event) => updateDraft({ renterName: event.target.value })}
                readOnly={editingField !== "renterName"}
                autoFocus={editingField === "renterName"}
                className={inputClass}
              />
            </EditableField>

            <EditableField labelText={t.phone} {...fieldChrome("renterPhone")}>
              <input
                type="tel"
                value={editingField === "renterPhone" ? draft.renterPhone : displayPhone}
                onChange={(event) => updateDraft({ renterPhone: event.target.value })}
                readOnly={editingField !== "renterPhone"}
                autoFocus={editingField === "renterPhone"}
                className={inputClass}
              />
            </EditableField>

            <EditableField
              className="lg:col-span-2"
              labelText={t.pickupTime}
              {...fieldChrome("pickupTime")}
            >
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
                <span className={cn(inputClass, "flex items-center")}>
                  {formatDateTime(currentOrder.pickupDatetime, locale)}
                </span>
              )}
            </EditableField>

            <EditableField
              className="lg:col-span-2"
              labelText={t.returnTime}
              {...fieldChrome("returnTime")}
            >
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
                <span className={cn(inputClass, "flex items-center")}>
                  {formatDateTime(currentOrder.returnDatetime, locale)}
                </span>
              )}
            </EditableField>

            <EditableField labelText={t.pickupLocation} {...fieldChrome("pickupLocation")}>
              <input
                value={editingField === "pickupLocation" ? draft.pickupLocation : currentOrder.pickupLocation ?? ""}
                onChange={(event) => updateDraft({ pickupLocation: event.target.value })}
                readOnly={editingField !== "pickupLocation"}
                autoFocus={editingField === "pickupLocation"}
                className={inputClass}
              />
            </EditableField>

            <EditableField labelText={t.returnLocation} {...fieldChrome("returnLocation")}>
              <input
                value={editingField === "returnLocation" ? draft.returnLocation : currentOrder.returnLocation ?? ""}
                onChange={(event) => updateDraft({ returnLocation: event.target.value })}
                readOnly={editingField !== "returnLocation"}
                autoFocus={editingField === "returnLocation"}
                className={inputClass}
              />
            </EditableField>
          </div>

          {/* Accounting on its own. These four are what a bookkeeper
              reconciles against a bank statement, and they were mixed in
              among renter name and pickup address, which are operations.
              The cleaning fee sits here because it is the one number on
              this panel that is not a property of the order at all --
              it is a price on the car, and saving it prices every trip
              that car runs from the chosen date onward. */}
          <div className="mt-4 rounded-lg border border-[rgba(17,19,24,0.1)] bg-[var(--surface-muted)]/50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
              {t.accounting}
            </p>
            <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <EditableField labelText={t.totalPrice} {...fieldChrome("totalPrice")}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editingField === "totalPrice" ? draft.totalPrice : formatCurrencyInputValue(currentOrder.totalPrice)}
                  onChange={(event) => updateDraft({ totalPrice: event.target.value })}
                  onBlur={(event) => updateDraft({ totalPrice: formatCurrencyInputText(event.target.value) })}
                  readOnly={editingField !== "totalPrice"}
                  autoFocus={editingField === "totalPrice"}
                  className={inputClass}
                />
              </EditableField>

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

              <EditableField labelText={t.paymentMethod} {...fieldChrome("paymentMethod")}>
                <input
                  value={editingField === "paymentMethod" ? draft.paymentMethod : currentOrder.paymentMethod ?? ""}
                  onChange={(event) => updateDraft({ paymentMethod: event.target.value })}
                  readOnly={editingField !== "paymentMethod"}
                  autoFocus={editingField === "paymentMethod"}
                  className={inputClass}
                />
              </EditableField>

              <EditableField labelText={t.contractNumber} {...fieldChrome("contractNumber")}>
                <input
                  value={editingField === "contractNumber" ? draft.contractNumber : currentOrder.contractNumber ?? ""}
                  onChange={(event) => updateDraft({ contractNumber: event.target.value })}
                  readOnly={editingField !== "contractNumber"}
                  autoFocus={editingField === "contractNumber"}
                  className={inputClass}
                />
              </EditableField>

              <EditableField
                className="sm:col-span-2"
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
            </div>
            {/* What the trip was actually made of. Turo bundles a
                dozen possible charges into one earnings figure, and
                until now the panel showed the figure and none of the
                charges -- so "why is this trip $377" had no answer
                anywhere in the product. */}
            {currentOrder.feeLines && currentOrder.feeLines.length > 0 ? (
              <div className="mt-3 rounded-md border border-[rgba(17,19,24,0.1)] bg-white/70 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                  {t.feeBreakdown}
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {currentOrder.feeLines.map((line) => (
                    <li
                      key={line.column}
                      className="flex items-baseline justify-between gap-3 text-[12px] leading-5"
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

          <div className="mt-4 grid min-w-0 gap-2">
            <EditableField labelText={t.notes} {...fieldChrome("notes")}>
              <textarea
                value={editingField === "notes" ? draft.notes : currentOrder.notes ?? ""}
                onChange={(event) => updateDraft({ notes: event.target.value })}
                readOnly={editingField !== "notes"}
                autoFocus={editingField === "notes"}
                rows={4}
                className="w-full min-w-0 max-w-full resize-none border-0 bg-transparent p-0 text-[13px] text-[color:var(--ink)] outline-none"
              />
            </EditableField>
          </div>

          <div className="mt-3 grid gap-2 text-[11px] text-[color:var(--ink-soft)] md:grid-cols-3">
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

          {!readOnly ? (
            <div className="mt-4 rounded-lg border border-[color:var(--line)] bg-white/58 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                {t.attachments}
              </p>
              <OrderAttachments orderId={currentOrder.id} locale={locale} compact />
            </div>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {error}
            </p>
          ) : null}

          {/* Delete is guarded by its own confirm dialog, which is the
              speed bump -- it no longer needs a second one borrowed
              from a global edit mode that does not exist anymore. */}
          {!readOnly ? (
            <div className="mt-4 flex justify-start border-t border-[var(--line)] pt-4">
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
