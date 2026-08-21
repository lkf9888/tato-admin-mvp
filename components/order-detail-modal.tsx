"use client";

import { useEffect, useState } from "react";
import { Lock, Pencil, Save, Share2, Trash2, X } from "lucide-react";
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
};

export type OrderEditorVehicleOption = {
  id: string;
  label: string;
  plateNumber?: string | null;
  secondaryLabel?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
};

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
    cleaningFeeFrom: new Date().toISOString().slice(0, 10),
  };
}

function labels(locale: Locale) {
  return locale === "zh"
    ? {
        title: "订单详情与编辑",
        subtitle: "日历和订单页使用同一个详情面板",
        close: "关闭",
        save: "保存修改",
        saving: "保存中...",
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
        lockFields: "结束编辑",
        unlockFields: "编辑",
        lockedHint: "字段已锁定,点右上角「编辑」才能修改",
        editingHint: "编辑中 —— 改完记得保存",
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
        save: "Save changes",
        saving: "Saving...",
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
        lockFields: "Done editing",
        unlockFields: "Edit",
        lockedHint: "Fields are locked — press Edit to change them",
        editingHint: "Editing — remember to save",
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
        cleaningFee: "Cleaning fee",
        cleaningFeeFrom: "From",
        cleaningFeeHint:
          "The cleaning fee is a price on the car, not a property of this order. Saving it charges this amount on every trip that car starts on or after the chosen date. Earlier trips are untouched.",
        cleaningFeeOnTrip: (amount: string) =>
          `This trip is charged ${amount} — it started before the date above, so it keeps the price from then. The figure above is the car's fee today.`,
      };
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

  useEffect(() => {
    setCurrentOrder(order);
    setDraft(buildDraft(order));
    setError(null);
    setOwnerSyncMessage(null);
  }, [order]);

  // The label sits inside the field rather than above it. A caption and
  // its box read as one control that way, and it buys back a line of
  // height per field -- on a phone that is the difference between the
  // form being scrollable and being a scroll.
  const fieldClass =
    "grid min-w-0 gap-0.5 rounded-md border border-[rgba(17,19,24,0.1)] bg-white/84 px-3 py-1.5 transition focus-within:border-[rgba(17,19,24,0.28)]";
  const fieldLabelClass =
    "text-[10px] font-medium uppercase tracking-[0.13em] text-[color:var(--ink-soft)]";
  // Fields are locked until someone asks to edit them.
  //
  // This panel opens from a calendar bar and from the orders list, and
  // the reason to open it is nearly always to read it -- who has the
  // car, when it comes back, what it earned. Every one of those live
  // in a text box, so reading meant hovering a cursor over editable
  // fields on a record that feeds the owner's statement. One stray
  // keystroke in the price and the ledger follows it.
  //
  // `readOnly` stays what it always was: a shared view that can never
  // edit. `locked` is the everyday state that a button lifts.
  const [isEditing, setIsEditing] = useState(false);
  const locked = readOnly || !isEditing;

  const inputClass =
    "h-6 w-full min-w-0 max-w-full truncate border-0 bg-transparent p-0 text-[13px] text-[color:var(--ink)] outline-none placeholder:text-[color:var(--ink-soft)]/70";
  // Kept for the SearchableSelect, which draws its own trigger.
  const selectInputClass =
    "h-7 w-full min-w-0 max-w-full truncate border-0 bg-transparent px-0 text-[13px] text-[color:var(--ink)] outline-none";
  const labelClass = fieldClass;
  const primaryButtonClass =
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3.5 text-[12px] font-semibold text-white shadow-[0_8px_22px_-10px_rgba(89,60,251,0.55)] transition hover:bg-[#4830d4] disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryButtonClass =
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-3.5 text-[12px] font-semibold text-[var(--ink)] transition hover:border-[rgba(17,19,24,0.22)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50";

  const selectedVehicle = vehicleOptions.find((vehicle) => vehicle.id === draft.vehicleId);
  const displayPhone = maskSensitive ? maskPhone(currentOrder.renterPhone) : currentOrder.renterPhone || "-";
  const selectedOwnerId = selectedVehicle?.ownerId ?? currentOrder.ownerId ?? null;
  const ownerShareSyncedAt = currentOrder.ownerLedgerSyncedAt ?? null;

  const updateDraft = (patch: Partial<OrderDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const persistOrder = async () => {
    if (locked || isSaving) return;

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

  const saveOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await persistOrder();
  };

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
    if (locked || isDeleting) return;
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
                {readOnly ? t.readOnly : locked ? t.lockedHint : t.editingHint}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Beside the title, where the thing it acts on is named.
                  It used to sit inside a status panel below the summary
                  tiles -- the one action on this panel that reaches
                  outside the order, three scrolls from its own heading. */}
              {!readOnly ? (
                <button
                  type="button"
                  onClick={() => {
                    // Leaving edit mode throws away anything typed and
                    // not saved. Reverting to the stored order is the
                    // honest reading of "stop editing", and it keeps
                    // the lock from preserving a half-made change that
                    // the next person would not know was there.
                    if (isEditing) setDraft(buildDraft(currentOrder));
                    setIsEditing((value) => !value);
                    setError(null);
                  }}
                  disabled={isSaving || isDeleting}
                  className={
                    isEditing
                      ? "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--ink)] bg-white px-3 text-[12px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                      : "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-3 text-[12px] font-semibold text-[color:var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.22)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
                  }
                >
                  {isEditing ? (
                    <Lock className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  )}
                  <span className="hidden sm:inline">
                    {isEditing ? t.lockFields : t.unlockFields}
                  </span>
                </button>
              ) : null}
              {!readOnly ? (
                <button
                  type="button"
                  onClick={syncOwnerShare}
                  disabled={!selectedOwnerId || isSaving || isSyncingOwner || isDeleting}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--ink)] bg-[var(--ink)] px-3 text-[12px] font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--surface-muted)] disabled:text-[color:var(--ink-soft)]"
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

        <form onSubmit={saveOrder} className="px-4 py-4">
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

          {/* One line now, not a panel. The button moved to the header,
              and what is left is a status plus the timestamp -- which is
              a caption, not a section. */}
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
            <label className={labelClass}>
              <span className={fieldLabelClass}>{t.vehicle}</span>
              {locked ? (
                <span className={cn(inputClass, "flex items-center")}>
                  {currentOrder.vehiclePlateNumber
                    ? `${currentOrder.vehiclePlateNumber} · ${currentOrder.vehicleName}`
                    : currentOrder.vehicleName}
                </span>
              ) : (
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
              )}
            </label>

            <label className={labelClass}>
              <span className={fieldLabelClass}>{t.status}</span>
              {locked ? (
                <span className={cn(inputClass, "flex items-center")}>{getStatusLabel(currentOrder.status, locale)}</span>
              ) : (
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
              )}
            </label>

            <label className={labelClass}>
              <span className={fieldLabelClass}>{t.renter}</span>
              <input
                value={locked ? currentOrder.renterName : draft.renterName}
                onChange={(event) => updateDraft({ renterName: event.target.value })}
                readOnly={locked}
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              <span className={fieldLabelClass}>{t.phone}</span>
              <input
                type="tel"
                value={locked ? displayPhone : draft.renterPhone}
                onChange={(event) => updateDraft({ renterPhone: event.target.value })}
                readOnly={locked}
                className={inputClass}
              />
            </label>

            <label className={cn(labelClass, "lg:col-span-2")}>
              <span className={fieldLabelClass}>{t.pickupTime}</span>
              {locked ? (
                <span className={cn(inputClass, "flex items-center")}>
                  {formatDateTime(currentOrder.pickupDatetime, locale)}
                </span>
              ) : (
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
              )}
            </label>

            <label className={cn(labelClass, "lg:col-span-2")}>
              <span className={fieldLabelClass}>{t.returnTime}</span>
              {locked ? (
                <span className={cn(inputClass, "flex items-center")}>
                  {formatDateTime(currentOrder.returnDatetime, locale)}
                </span>
              ) : (
                /* One field, two parts. The date and the clock time are
                   a single fact -- when the car changes hands -- and two
                   separate boxes made it read as two. Divided by a rule
                   rather than a border so it stays one control. */
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-2">
                  <input
                    value={draft.returnDate}
                    onChange={(event) => updateDraft({ returnDate: event.target.value })}
                    inputMode="numeric"
                    placeholder="yyyy/mm/dd"
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
              )}
            </label>



            <label className={labelClass}>
              <span className={fieldLabelClass}>{t.pickupLocation}</span>
              <input
                value={locked ? currentOrder.pickupLocation ?? "" : draft.pickupLocation}
                onChange={(event) => updateDraft({ pickupLocation: event.target.value })}
                readOnly={locked}
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              <span className={fieldLabelClass}>{t.returnLocation}</span>
              <input
                value={locked ? currentOrder.returnLocation ?? "" : draft.returnLocation}
                onChange={(event) => updateDraft({ returnLocation: event.target.value })}
                readOnly={locked}
                className={inputClass}
              />
            </label>

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

              <label className={labelClass}>
                <span className={fieldLabelClass}>{t.totalPrice}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={locked ? formatCurrencyInputValue(currentOrder.totalPrice) : draft.totalPrice}
                  onChange={(event) => updateDraft({ totalPrice: event.target.value })}
                  onBlur={(event) => updateDraft({ totalPrice: formatCurrencyInputText(event.target.value) })}
                  readOnly={locked}
                  className={inputClass}
                />
              </label>

              <label className={labelClass}>
                <span className={fieldLabelClass}>{t.deposit}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={locked ? formatCurrencyInputValue(currentOrder.depositAmount) : draft.depositAmount}
                  onChange={(event) => updateDraft({ depositAmount: event.target.value })}
                  onBlur={(event) => updateDraft({ depositAmount: formatCurrencyInputText(event.target.value) })}
                  readOnly={locked}
                  className={inputClass}
                />
              </label>

              <label className={labelClass}>
                <span className={fieldLabelClass}>{t.paymentMethod}</span>
                <input
                  value={locked ? currentOrder.paymentMethod ?? "" : draft.paymentMethod}
                  onChange={(event) => updateDraft({ paymentMethod: event.target.value })}
                  readOnly={locked}
                  className={inputClass}
                />
              </label>

              <label className={labelClass}>
                <span className={fieldLabelClass}>{t.contractNumber}</span>
                <input
                  value={locked ? currentOrder.contractNumber ?? "" : draft.contractNumber}
                  onChange={(event) => updateDraft({ contractNumber: event.target.value })}
                  readOnly={locked}
                  className={inputClass}
                />
              </label>

              <label className={cn(fieldClass, "sm:col-span-2")}>
                <span className={fieldLabelClass}>{t.cleaningFee}</span>
                <div className="grid min-w-0 grid-cols-[minmax(0,7rem)_auto_minmax(0,1fr)] items-center gap-2">
                  <input
                    value={locked ? formatCurrencyInputValue(currentOrder.cleaningFee) : draft.cleaningFee}
                    onChange={(event) => updateDraft({ cleaningFee: event.target.value })}
                    readOnly={locked}
                    type="number"
                    step="0.01"
                    min="0"
                    className={inputClass}
                  />
                  <span aria-hidden className="h-4 w-px bg-[rgba(17,19,24,0.12)]" />
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-[10px] uppercase tracking-[0.13em] text-[color:var(--ink-soft)]">
                      {t.cleaningFeeFrom}
                    </span>
                    {/* `readOnly` is not honoured on a date input --
                        the calendar picker still writes to it -- so the
                        lock has to be `disabled` here to mean anything. */}
                    <input
                      value={draft.cleaningFeeFrom}
                      onChange={(event) => updateDraft({ cleaningFeeFrom: event.target.value })}
                      readOnly={locked}
                      disabled={locked}
                      type="date"
                      className={cn(inputClass, "disabled:opacity-60")}
                    />
                  </span>
                </div>
              </label>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-[color:var(--ink-soft)]">
              {t.cleaningFeeHint}
            </p>
            {/* What this particular trip is charged, when that is not
                the car's current fee. Without it, editing an old trip
                looks like the fee failed to save -- the box holds the
                car's price and the statement holds the trip's. */}
            {currentOrder.cleaningFeeOnTrip != null &&
            Math.abs((currentOrder.cleaningFeeOnTrip ?? 0) - (currentOrder.cleaningFee ?? 0)) >=
              0.005 ? (
              <p className="mt-1 text-[11px] leading-4 text-amber-700">
                {t.cleaningFeeOnTrip(formatCurrency(currentOrder.cleaningFeeOnTrip, locale))}
              </p>
            ) : null}
          </div>

          <div className="mt-4 grid min-w-0 gap-2">
            <label className={cn(labelClass)}>
              <span className={fieldLabelClass}>{t.notes}</span>
              <textarea
                value={locked ? currentOrder.notes ?? "" : draft.notes}
                onChange={(event) => updateDraft({ notes: event.target.value })}
                readOnly={locked}
                rows={4}
                className="w-full min-w-0 max-w-full rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 py-2.5 text-[13px] text-[color:var(--ink)] outline-none focus:border-[rgba(17,19,24,0.22)]"
              />
            </label>
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

          {/* Delete and Save appear only once the panel is unlocked.
              A destructive button sitting under a record you opened to
              read is an invitation to a mistake. */}
          {!readOnly && !locked ? (
            <div className="mt-4 flex flex-col gap-2 border-t border-[var(--line)] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={deleteOrder}
                disabled={isDeleting || isSaving}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-white px-3.5 text-[12px] font-semibold text-rose-600 transition hover:border-rose-400 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {isDeleting ? t.deleting : t.delete}
              </button>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className={secondaryButtonClass}>
                  <X className="h-3.5 w-3.5" aria-hidden />
                  {t.close}
                </button>
                <button type="submit" disabled={isSaving || isDeleting} className={primaryButtonClass}>
                  <Save className="h-3.5 w-3.5" aria-hidden />
                  {isSaving ? t.saving : t.save}
                </button>
              </div>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
