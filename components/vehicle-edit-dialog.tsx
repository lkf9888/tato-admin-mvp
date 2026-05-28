"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import { saveVehicleAction } from "@/app/actions";
import { SearchableSelect } from "@/components/searchable-select";
import { VehicleAttachments } from "@/components/vehicle-attachments";
import { getMessages, getVehicleStatusOptions, type Locale } from "@/lib/i18n";

export type VehicleEditDialogVehicle = {
  id: string;
  ownerId?: string | null;
  plateNumber: string;
  nickname: string;
  brand: string;
  model: string;
  year: number;
  vin?: string | null;
  status: string;
  turoListingName?: string | null;
  turoVehicleCode?: string | null;
  purchasePrice?: number | null;
  ownerCommissionRate?: number | null;
  cleaningFee?: number | null;
  pickupPassword?: string | null;
  bookingTaxName?: string | null;
  bookingTaxRate?: number | null;
  notes?: string | null;
};

type OwnerOption = {
  id: string;
  label: string;
};

export function VehicleEditDialog({
  vehicle,
  locale,
  owners,
  trigger,
  triggerClassName,
  open,
  onOpenChange,
}: {
  vehicle: VehicleEditDialogVehicle;
  locale: Locale;
  owners: OwnerOption[];
  trigger?: ReactNode;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const messages = getMessages(locale).vehicles;
  const vehicleStatusOptions = getVehicleStatusOptions(locale);
  const statusLabel = locale === "en" ? "Status" : locale === "zh-Hant" ? "狀態" : "状态";
  const closeLabel = locale === "en" ? "Close" : locale === "zh-Hant" ? "關閉" : "关闭";
  const savingLabel = locale === "en" ? "Saving..." : locale === "zh-Hant" ? "保存中..." : "保存中...";
  const [internalOpen, setInternalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isOpen = open ?? internalOpen;
  const ownerSelectOptions = [
    { value: "", label: messages.placeholders.unassignedOwner },
    ...owners.map((owner) => ({ value: owner.id, label: owner.label })),
  ];
  const vehicleStatusSelectOptions = vehicleStatusOptions.map((option) => ({
    value: option.value,
    label: option.label,
  }));
  const fieldClass = "min-h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5";

  function setOpen(nextOpen: boolean) {
    setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  async function handleSave(formData: FormData) {
    setIsSaving(true);
    try {
      await saveVehicleAction(formData);
      setOpen(false);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  const dialog = isOpen ? (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/40"
        onClick={() => setOpen(false)}
        aria-label={closeLabel}
      />
      <div className="relative max-h-[90vh] w-[min(58rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-950">{messages.editVehicle}</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {vehicle.plateNumber} · {vehicle.nickname}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>

        <form action={handleSave} className="grid gap-3 p-4 text-[12px]">
          <input type="hidden" name="id" value={vehicle.id} />

          <DialogSection title={locale === "en" ? "Vehicle identity" : locale === "zh-Hant" ? "基礎資訊" : "基础信息"}>
            <DialogField label={messages.placeholders.plateNumber}>
              <input name="plateNumber" defaultValue={vehicle.plateNumber} className={fieldClass} />
            </DialogField>
            <DialogField label={messages.placeholders.nickname}>
              <input name="nickname" defaultValue={vehicle.nickname} className={fieldClass} />
            </DialogField>
            <DialogField label={messages.placeholders.brand}>
              <input name="brand" defaultValue={vehicle.brand} className={fieldClass} />
            </DialogField>
            <DialogField label={messages.placeholders.model}>
              <input name="model" defaultValue={vehicle.model} className={fieldClass} />
            </DialogField>
            <DialogField label={messages.placeholders.year}>
              <input name="year" type="number" defaultValue={vehicle.year} className={fieldClass} />
            </DialogField>
            <DialogField label={messages.placeholders.vin}>
              <input name="vin" defaultValue={vehicle.vin ?? ""} className={fieldClass} />
            </DialogField>
            <DialogField label={statusLabel}>
              <SearchableSelect
                name="status"
                defaultValue={vehicle.status}
                options={vehicleStatusSelectOptions}
                placeholder={statusLabel}
                searchPlaceholder={statusLabel}
                className={fieldClass}
              />
            </DialogField>
          </DialogSection>

          <DialogSection title={locale === "en" ? "Owner and costs" : locale === "zh-Hant" ? "車主與費用" : "车主与费用"}>
            <DialogField label={messages.placeholders.unassignedOwner}>
              <SearchableSelect
                name="ownerId"
                defaultValue={vehicle.ownerId ?? ""}
                options={ownerSelectOptions}
                placeholder={messages.placeholders.unassignedOwner}
                searchPlaceholder={messages.placeholders.unassignedOwner}
                className={fieldClass}
              />
            </DialogField>
            <DialogField label={messages.placeholders.purchasePrice}>
              <input
                name="purchasePrice"
                type="number"
                step="0.01"
                defaultValue={vehicle.purchasePrice ?? ""}
                className={fieldClass}
              />
            </DialogField>
            <DialogField label={messages.placeholders.ownerCommissionRate}>
              <input
                name="ownerCommissionRate"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={
                  vehicle.ownerCommissionRate == null
                    ? ""
                    : (vehicle.ownerCommissionRate * 100).toFixed(2)
                }
                className={fieldClass}
              />
            </DialogField>
            <DialogField label={messages.placeholders.cleaningFee}>
              <input
                name="cleaningFee"
                type="number"
                min="0"
                step="0.01"
                defaultValue={vehicle.cleaningFee ?? ""}
                className={fieldClass}
              />
            </DialogField>
          </DialogSection>

          <DialogSection title={locale === "en" ? "Booking settings" : locale === "zh-Hant" ? "預訂設定" : "预订设置"}>
            <DialogField label={messages.placeholders.pickupPassword}>
              <input name="pickupPassword" defaultValue={vehicle.pickupPassword ?? ""} className={fieldClass} />
            </DialogField>
            <DialogField label={messages.placeholders.bookingTaxName}>
              <input name="bookingTaxName" defaultValue={vehicle.bookingTaxName ?? ""} className={fieldClass} />
            </DialogField>
            <DialogField label={messages.placeholders.bookingTaxRate}>
              <input
                name="bookingTaxRate"
                type="number"
                min="0"
                max="100"
                step="0.001"
                defaultValue={vehicle.bookingTaxRate ?? ""}
                className={fieldClass}
              />
            </DialogField>
          </DialogSection>

          <DialogSection title={locale === "en" ? "Turo and notes" : locale === "zh-Hant" ? "Turo 與備註" : "Turo 与备注"}>
            <DialogField label={messages.placeholders.turoListingName}>
              <input name="turoListingName" defaultValue={vehicle.turoListingName ?? ""} className={fieldClass} />
            </DialogField>
            <DialogField label={messages.placeholders.turoVehicleCode}>
              <input name="turoVehicleCode" defaultValue={vehicle.turoVehicleCode ?? ""} className={fieldClass} />
            </DialogField>
            <DialogField label={messages.placeholders.notes}>
              <input name="notes" defaultValue={vehicle.notes ?? ""} className={fieldClass} />
            </DialogField>
          </DialogSection>

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
            <button
              type="button"
              className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              {closeLabel}
            </button>
            <button
              className="inline-flex min-h-9 items-center justify-center rounded-md bg-slate-950 px-3 text-[12px] font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
            >
              {isSaving ? savingLabel : messages.saveChanges}
            </button>
          </div>
        </form>

        <div className="border-t border-slate-200 p-4">
          <VehicleAttachments vehicleId={vehicle.id} locale={locale} compact />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {trigger ? (
        <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
          {trigger}
        </button>
      ) : null}

      {dialog && typeof document !== "undefined" ? createPortal(dialog, document.body) : null}
    </>
  );
}

function DialogField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block truncate text-[10px] font-semibold leading-4 text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function DialogSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="border-t border-slate-200 pt-3 first:border-t-0 first:pt-0">
      <legend className="px-0 text-[11px] font-semibold tracking-[0.08em] text-slate-600">
        {title}
      </legend>
      <div className="mt-2 grid gap-2 md:grid-cols-3">{children}</div>
    </fieldset>
  );
}
