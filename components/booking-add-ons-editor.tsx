"use client";

import { useState } from "react";

import { StickySaveBar } from "@/components/sticky-save-bar";
import { ADD_ON_NAME_MAX, type AddOnUnit } from "@/lib/booking-add-ons";
import { saveBookingAddOnsAction } from "@/lib/direct-booking-actions";
import { getMessages, type Locale } from "@/lib/i18n";

type Row = {
  key: number;
  id: string | null;
  name: string;
  description: string;
  price: string;
  unit: AddOnUnit;
  taxable: boolean;
};

/** Adding or removing a row is an edit too; tell the save bar. */
function markFormDirty(element: HTMLElement) {
  element.closest("form")?.dispatchEvent(new Event("input", { bubbles: true }));
}

const FIELD =
  "w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-2.5 py-2 text-[12px] text-[color:var(--ink)]";

/**
 * The extras a renter can tick at booking. A short table, like the
 * locations: an operator has a handful of these, not a catalogue.
 * The taxed flag posts as a hidden "1"/"0" per row so the parallel
 * lists stay aligned -- an unticked checkbox would post nothing.
 */
export function BookingAddOnsEditor({
  locale,
  initialRows,
  saved,
}: {
  locale: Locale;
  initialRows: Omit<Row, "key">[];
  saved: boolean;
}) {
  const copy = getMessages(locale).directBookingAddOns;
  const [rows, setRows] = useState<Row[]>(() => initialRows.map((row, index) => ({ ...row, key: index })));
  const [nextKey, setNextKey] = useState(initialRows.length);

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function add() {
    setRows((current) => [
      ...current,
      { key: nextKey, id: null, name: "", description: "", price: "0", unit: "booking", taxable: true },
    ]);
    setNextKey((key) => key + 1);
  }

  return (
    <section
      id="add-ons"
      className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--ink-soft)]">{copy.kicker}</p>
          <h3 className="mt-1 text-[1.05rem] font-semibold text-[color:var(--ink)]">{copy.title}</h3>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[color:var(--ink-soft)]">{copy.copy}</p>
        </div>
        {saved ? (
          <span className="rounded-md bg-[var(--ok-bg)] px-2.5 py-1 text-[11px] text-[color:var(--ok-fg)]">
            {copy.savedNotice}
          </span>
        ) : null}
      </div>

      <form action={saveBookingAddOnsAction} className="mt-3">
        <div className="space-y-2">
          {rows.length > 0 ? (
            <div className="hidden gap-2 px-1 text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)] sm:grid sm:grid-cols-[1.1fr_1.5fr_0.6fr_0.7fr_auto_auto]">
              <span>{copy.nameHeader}</span>
              <span>{copy.descriptionHeader}</span>
              <span>{copy.priceHeader}</span>
              <span>{copy.unitHeader}</span>
              <span>{copy.taxableHeader}</span>
              <span />
            </div>
          ) : null}
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-2 gap-2 rounded-md border border-[color:var(--line)] bg-white p-2 sm:grid-cols-[1.1fr_1.5fr_0.6fr_0.7fr_auto_auto] sm:items-center sm:border-0 sm:bg-transparent sm:p-0"
            >
              <input type="hidden" name="addOnId" value={row.id ?? ""} />
              <input type="hidden" name="addOnTaxable" value={row.taxable ? "1" : "0"} />
              <input
                name="addOnName"
                value={row.name}
                onChange={(event) => update(row.key, { name: event.target.value })}
                placeholder={copy.namePlaceholder}
                maxLength={ADD_ON_NAME_MAX}
                aria-label={copy.nameHeader}
                className={`${FIELD} col-span-2 font-medium sm:col-span-1`}
              />
              <input
                name="addOnDescription"
                value={row.description}
                onChange={(event) => update(row.key, { description: event.target.value })}
                placeholder={copy.descriptionPlaceholder}
                maxLength={160}
                aria-label={copy.descriptionHeader}
                className={`${FIELD} col-span-2 sm:col-span-1`}
              />
              <input
                name="addOnPrice"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={row.price}
                onChange={(event) => update(row.key, { price: event.target.value })}
                aria-label={copy.priceHeader}
                className={`${FIELD} tabular-nums`}
              />
              <select
                name="addOnUnit"
                value={row.unit}
                onChange={(event) => update(row.key, { unit: event.target.value as AddOnUnit })}
                aria-label={copy.unitHeader}
                className={FIELD}
              >
                <option value="day">{copy.unitDay}</option>
                <option value="booking">{copy.unitBooking}</option>
              </select>
              <label className="flex items-center gap-1.5 px-1 text-[11px] text-[color:var(--ink-soft)]">
                <input
                  type="checkbox"
                  checked={row.taxable}
                  onChange={(event) => update(row.key, { taxable: event.target.checked })}
                  className="h-3.5 w-3.5"
                />
                <span className="sm:hidden">{copy.taxableHeader}</span>
              </label>
              <button
                type="button"
                onClick={(event) => {
                  markFormDirty(event.currentTarget);
                  setRows((current) => current.filter((item) => item.key !== row.key));
                }}
                className="justify-self-end rounded px-2 py-1 text-[12px] text-[color:var(--bad-fg)] hover:bg-[var(--bad-bg)]"
              >
                {copy.remove}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-2 text-[11px] text-[color:var(--ink-soft)]">
          {rows.length > 0 ? copy.removeHint : copy.emptyHint}
        </p>
        <button
          type="button"
          onClick={(event) => {
            markFormDirty(event.currentTarget);
            add();
          }}
          className="mt-2 rounded-md border border-dashed border-[color:var(--line-strong)] px-3 py-2 text-[12px] text-[color:var(--ink)] hover:bg-[var(--surface-muted)]"
        >
          {copy.addRow}
        </button>

        <StickySaveBar
          className="mt-3"
          saveLabel={copy.save}
          savingLabel={copy.saving}
          dirtyLabel={copy.dirty}
          cleanLabel={copy.clean}
        />
      </form>
    </section>
  );
}
