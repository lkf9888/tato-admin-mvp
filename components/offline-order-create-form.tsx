"use client";

import { useState } from "react";

import { saveOfflineOrderAction } from "@/app/actions";
import { DateTimeField } from "@/components/date-time-field";
import { SearchableSelect } from "@/components/searchable-select";
import { getMessages, type Locale } from "@/lib/i18n";
import { cn, formatCurrency } from "@/lib/utils";

type Option = { value: string; label: string; searchText?: string };

type Prefill = {
  vehicleId: string;
  renterName: string;
  renterPhone: string;
  pickupDatetime: string;
  returnDatetime: string;
  totalPrice: string;
  depositAmount: string;
  pickupLocation: string;
  returnLocation: string;
  paymentMethod: string;
  notes: string;
};

type ParseResult = {
  fields: {
    renterName: string | null;
    renterPhone: string | null;
    vehicleText: string | null;
    pickupDate: string | null;
    pickupTime: string | null;
    returnDate: string | null;
    returnTime: string | null;
    totalPrice: number | null;
    depositAmount: number | null;
    pickupLocation: string | null;
    returnLocation: string | null;
    paymentMethod: string | null;
    notes: string | null;
  };
  vehicleId: string | null;
  candidates: string[];
};

const at = (day: string | null, time: string | null) => (day ? `${day}T${time ?? "10:00"}` : "");

/**
 * The "create offline order" form, with a box above it that reads a
 * pasted WeChat or SMS message into the fields.
 *
 * Reading only fills the form -- it is remounted with the read values as
 * its defaults, so every field, the car picker and the date fields
 * included, starts from them -- and saving is still the person pressing
 * Create. Nothing the model says reaches the database unchecked.
 */
export function OfflineOrderCreateForm({
  locale,
  vehicleOptions,
  statusOptions,
  defaultVehicleId,
  inputClass,
  primaryButtonClass,
}: {
  locale: Locale;
  vehicleOptions: Option[];
  statusOptions: Option[];
  defaultVehicleId: string;
  inputClass: string;
  primaryButtonClass: string;
}) {
  const orderMessages = getMessages(locale).orders;
  const t = orderMessages.noteParser;
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [formKey, setFormKey] = useState(0);
  const money = (value: number | null) => (value == null ? "—" : formatCurrency(value, locale));
  const vehicleLabel = (id: string) => vehicleOptions.find((option) => option.value === id)?.label ?? id;

  async function read() {
    setReading(true);
    setMessage(null);
    setResult(null);
    const response = await fetch("/api/orders/parse-note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => ({})) : {};
    setReading(false);
    if (!response?.ok) {
      setMessage(payload.error === "AI_NOT_CONFIGURED" ? t.notConfigured : t.failed);
      return;
    }
    setResult(payload as ParseResult);
  }

  function apply() {
    if (!result) return;
    const fields = result.fields;
    setPrefill({
      vehicleId: result.vehicleId ?? "",
      renterName: fields.renterName ?? "",
      renterPhone: fields.renterPhone ?? "",
      pickupDatetime: at(fields.pickupDate, fields.pickupTime),
      returnDatetime: at(fields.returnDate, fields.returnTime),
      totalPrice: fields.totalPrice != null ? String(fields.totalPrice) : "",
      depositAmount: fields.depositAmount != null ? String(fields.depositAmount) : "",
      pickupLocation: fields.pickupLocation ?? "",
      returnLocation: fields.returnLocation ?? "",
      paymentMethod: fields.paymentMethod ?? "",
      notes: fields.notes ?? "",
    });
    setFormKey((key) => key + 1);
    setMessage(t.filled);
  }

  const fields = result?.fields;
  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-md border border-dashed border-[var(--line)] bg-white/70 p-3">
        <p className="text-[12px] font-semibold text-[color:var(--ink)]">{t.title}</p>
        <p className="text-[11px] text-[color:var(--ink-soft)]">{t.hint}</p>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          placeholder={t.placeholder}
          className="mt-2 w-full rounded-md border border-[rgba(17,19,24,0.08)] bg-white px-3 py-2 text-[12px]"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={primaryButtonClass} onClick={() => void read()} disabled={reading || text.trim().length < 5}>
            {reading ? t.reading : t.read}
          </button>
          {message ? <span className="text-[11px] text-[color:var(--ink-mid)]">{message}</span> : null}
        </div>

        {fields ? (
          <div className="mt-3 rounded-md bg-[var(--surface-muted)] p-3 text-[12px]">
            <p className="mb-1.5 text-[11px] text-[color:var(--ink-soft)]">{t.found}</p>
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
              <div>
                <dt className="inline text-[color:var(--ink-soft)]">{t.vehicle}: </dt>
                <dd className={cn("inline", result?.vehicleId ? "" : "text-amber-700")}>
                  {result?.vehicleId ? vehicleLabel(result.vehicleId) : `${fields.vehicleText ?? "—"} · ${t.vehicleUnsure(result?.candidates.length ?? 0)}`}
                </dd>
              </div>
              <div><dt className="inline text-[color:var(--ink-soft)]">{t.renter}: </dt><dd className="inline">{fields.renterName ?? "—"}</dd></div>
              <div><dt className="inline text-[color:var(--ink-soft)]">{t.phone}: </dt><dd className="inline">{fields.renterPhone ?? "—"}</dd></div>
              <div>
                <dt className="inline text-[color:var(--ink-soft)]">{t.pickup}: </dt>
                <dd className="inline">{[fields.pickupDate, fields.pickupTime].filter(Boolean).join(" ") || "—"}</dd>
              </div>
              <div>
                <dt className="inline text-[color:var(--ink-soft)]">{t.return}: </dt>
                <dd className="inline">{[fields.returnDate, fields.returnTime].filter(Boolean).join(" ") || "—"}</dd>
              </div>
              <div><dt className="inline text-[color:var(--ink-soft)]">{t.price}: </dt><dd className="inline">{money(fields.totalPrice)}</dd></div>
              <div><dt className="inline text-[color:var(--ink-soft)]">{t.deposit}: </dt><dd className="inline">{money(fields.depositAmount)}</dd></div>
              <div><dt className="inline text-[color:var(--ink-soft)]">{t.payment}: </dt><dd className="inline">{fields.paymentMethod ?? "—"}</dd></div>
              {fields.pickupLocation || fields.returnLocation ? (
                <div className="sm:col-span-2">
                  <dt className="inline text-[color:var(--ink-soft)]">{t.places}: </dt>
                  <dd className="inline">{[fields.pickupLocation, fields.returnLocation].filter(Boolean).join(" → ")}</dd>
                </div>
              ) : null}
              {fields.notes ? (
                <div className="sm:col-span-2"><dt className="inline text-[color:var(--ink-soft)]">{t.notes}: </dt><dd className="inline">{fields.notes}</dd></div>
              ) : null}
            </dl>
            <button type="button" className={cn(primaryButtonClass, "mt-2")} onClick={apply}>
              {t.apply}
            </button>
          </div>
        ) : null}
      </div>

      <form key={formKey} action={saveOfflineOrderAction} className="grid gap-2 sm:gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        <SearchableSelect
          name="vehicleId"
          defaultValue={prefill ? prefill.vehicleId : defaultVehicleId}
          options={vehicleOptions}
          placeholder={orderMessages.filters.vehicleLabel}
          searchPlaceholder={orderMessages.filters.vehicleLabel}
          className={inputClass}
        />
        <input name="renterName" defaultValue={prefill?.renterName} placeholder={orderMessages.placeholders.renterName} className={inputClass} />
        <input name="renterPhone" defaultValue={prefill?.renterPhone} placeholder={orderMessages.placeholders.phone} className={inputClass} />
        <SearchableSelect
          name="status"
          defaultValue="booked"
          options={statusOptions}
          placeholder={orderMessages.filters.statusLabel}
          searchPlaceholder={orderMessages.filters.statusLabel}
          className={inputClass}
        />
        <DateTimeField name="pickupDatetime" defaultValue={prefill?.pickupDatetime || undefined} className="min-w-0 xl:col-span-2" />
        <DateTimeField name="returnDatetime" defaultValue={prefill?.returnDatetime || undefined} className="min-w-0 xl:col-span-2" />
        <input name="totalPrice" type="number" step="0.01" defaultValue={prefill?.totalPrice} placeholder={orderMessages.placeholders.totalPrice} className={inputClass} />
        <input name="depositAmount" type="number" step="0.01" defaultValue={prefill?.depositAmount} placeholder={orderMessages.placeholders.deposit} className={inputClass} />
        <input name="pickupLocation" defaultValue={prefill?.pickupLocation} placeholder={orderMessages.placeholders.pickupLocation} className={inputClass} />
        <input name="returnLocation" defaultValue={prefill?.returnLocation} placeholder={orderMessages.placeholders.returnLocation} className={inputClass} />
        <input name="paymentMethod" defaultValue={prefill?.paymentMethod} placeholder={orderMessages.placeholders.paymentMethod} className={inputClass} />
        <input name="contractNumber" placeholder={orderMessages.placeholders.contractNumber} className={inputClass} />
        <input name="notes" defaultValue={prefill?.notes} placeholder={orderMessages.placeholders.notes} className={cn(inputClass, "xl:col-span-4")} />
        <div className="flex items-center xl:col-span-4">
          <button className={primaryButtonClass}>{orderMessages.createOfflineOrder}</button>
        </div>
      </form>
    </div>
  );
}
