"use client";

import { useEffect, useState } from "react";
import { Save, Share2, Trash2, X } from "lucide-react";
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

  const inputClass =
    "h-10 w-full min-w-0 max-w-full truncate rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 text-[13px] text-[color:var(--ink)] outline-none focus:border-[rgba(17,19,24,0.22)]";
  const labelClass = "grid min-w-0 gap-1.5 text-[11px] font-medium uppercase tracking-[0.13em] text-[color:var(--ink-soft)]";
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
    if (readOnly || isSaving) return;

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
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              aria-label={t.close}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
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

          {!readOnly ? (
            <div className="mt-3 rounded-md border border-[rgba(17,19,24,0.08)] bg-white/72 px-3 py-3 text-[12px] text-[color:var(--ink)]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                    {t.ownerShare}
                  </p>
                  <p className="mt-1 font-semibold">
                    {ownerShareSyncedAt ? t.ownerShareSynced : selectedOwnerId ? t.ownerShareUnsynced : t.ownerShareNotAssigned}
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-[color:var(--ink-soft)]">
                    {ownerShareSyncedAt
                      ? `${t.ownerShareLastSynced}: ${formatDateTime(ownerShareSyncedAt, locale)}`
                      : t.ownerShareHelp}
                  </p>
                  {ownerSyncMessage ? (
                    <p className="mt-1 text-[11px] font-semibold text-emerald-700">{ownerSyncMessage}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={syncOwnerShare}
                  disabled={!selectedOwnerId || isSaving || isSyncingOwner || isDeleting}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[var(--ink)] bg-[var(--ink)] px-3.5 text-[12px] font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--surface-muted)] disabled:text-[color:var(--ink-soft)]"
                >
                  <Share2 className="h-3.5 w-3.5" aria-hidden />
                  {isSyncingOwner
                    ? t.ownerShareSyncing
                    : ownerShareSyncedAt
                      ? t.ownerShareResync
                      : t.ownerShareSync}
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className={labelClass}>
              <span>{t.vehicle}</span>
              {readOnly ? (
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
                  className={inputClass}
                />
              )}
            </label>

            <label className={labelClass}>
              <span>{t.status}</span>
              {readOnly ? (
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
                  className={inputClass}
                />
              )}
            </label>

            <label className={labelClass}>
              <span>{t.renter}</span>
              <input
                value={readOnly ? currentOrder.renterName : draft.renterName}
                onChange={(event) => updateDraft({ renterName: event.target.value })}
                readOnly={readOnly}
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              <span>{t.phone}</span>
              <input
                type="tel"
                value={readOnly ? displayPhone : draft.renterPhone}
                onChange={(event) => updateDraft({ renterPhone: event.target.value })}
                readOnly={readOnly}
                className={inputClass}
              />
            </label>

            <label className={cn(labelClass, "lg:col-span-2")}>
              <span>{t.pickupTime}</span>
              {readOnly ? (
                <span className={cn(inputClass, "flex items-center")}>
                  {formatDateTime(currentOrder.pickupDatetime, locale)}
                </span>
              ) : (
                <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_6rem]">
                  <input
                    value={draft.pickupDate}
                    onChange={(event) => updateDraft({ pickupDate: event.target.value })}
                    inputMode="numeric"
                    placeholder="yyyy/mm/dd"
                    className={inputClass}
                  />
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
              <span>{t.returnTime}</span>
              {readOnly ? (
                <span className={cn(inputClass, "flex items-center")}>
                  {formatDateTime(currentOrder.returnDatetime, locale)}
                </span>
              ) : (
                <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_6rem]">
                  <input
                    value={draft.returnDate}
                    onChange={(event) => updateDraft({ returnDate: event.target.value })}
                    inputMode="numeric"
                    placeholder="yyyy/mm/dd"
                    className={inputClass}
                  />
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
              <span>{t.totalPrice}</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={readOnly ? formatCurrencyInputValue(currentOrder.totalPrice) : draft.totalPrice}
                onChange={(event) => updateDraft({ totalPrice: event.target.value })}
                onBlur={(event) => updateDraft({ totalPrice: formatCurrencyInputText(event.target.value) })}
                readOnly={readOnly}
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              <span>{t.deposit}</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={readOnly ? formatCurrencyInputValue(currentOrder.depositAmount) : draft.depositAmount}
                onChange={(event) => updateDraft({ depositAmount: event.target.value })}
                onBlur={(event) => updateDraft({ depositAmount: formatCurrencyInputText(event.target.value) })}
                readOnly={readOnly}
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              <span>{t.pickupLocation}</span>
              <input
                value={readOnly ? currentOrder.pickupLocation ?? "" : draft.pickupLocation}
                onChange={(event) => updateDraft({ pickupLocation: event.target.value })}
                readOnly={readOnly}
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              <span>{t.returnLocation}</span>
              <input
                value={readOnly ? currentOrder.returnLocation ?? "" : draft.returnLocation}
                onChange={(event) => updateDraft({ returnLocation: event.target.value })}
                readOnly={readOnly}
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              <span>{t.paymentMethod}</span>
              <input
                value={readOnly ? currentOrder.paymentMethod ?? "" : draft.paymentMethod}
                onChange={(event) => updateDraft({ paymentMethod: event.target.value })}
                readOnly={readOnly}
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              <span>{t.contractNumber}</span>
              <input
                value={readOnly ? currentOrder.contractNumber ?? "" : draft.contractNumber}
                onChange={(event) => updateDraft({ contractNumber: event.target.value })}
                readOnly={readOnly}
                className={inputClass}
              />
            </label>

            <label className={cn(labelClass, "sm:col-span-2 lg:col-span-4")}>
              <span>{t.notes}</span>
              <textarea
                value={readOnly ? currentOrder.notes ?? "" : draft.notes}
                onChange={(event) => updateDraft({ notes: event.target.value })}
                readOnly={readOnly}
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

          {!readOnly ? (
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
