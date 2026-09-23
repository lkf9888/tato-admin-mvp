"use client";

import { useState } from "react";

import { saveBookingLocationsAction } from "@/app/actions";
import { getMessages, type Locale } from "@/lib/i18n";

type LocationRow = {
  id: string | null;
  label: string;
  address: string;
  fee: string;
};

/**
 * The fleet's pickup and return points.
 *
 * A short table rather than a page per location: an operator has two
 * or three of these -- the shop, the airport, maybe downtown -- and
 * managing them one screen at a time would cost more clicks than the
 * list has rows.
 */
export function BookingLocationsEditor({
  locale,
  initialRows,
  defaultIndex,
  saved,
}: {
  locale: Locale;
  initialRows: LocationRow[];
  defaultIndex: number;
  saved: boolean;
}) {
  const copy = getMessages(locale).directBookingPage;
  const [rows, setRows] = useState<LocationRow[]>(
    initialRows.length > 0 ? initialRows : [{ id: null, label: "", address: "", fee: "0" }],
  );
  const [defaultRow, setDefaultRow] = useState(defaultIndex);

  function update(index: number, patch: Partial<LocationRow>) {
    setRows((current) =>
      current.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );
  }

  const field =
    "w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-2.5 py-2 text-[12px] text-[color:var(--ink)]";

  return (
    <form
      action={saveBookingLocationsAction}
      className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--ink-soft)]">
            {copy.locationsKicker}
          </p>
          <h3 className="mt-1 text-[1.05rem] font-semibold text-[color:var(--ink)]">
            {copy.locationsTitle}
          </h3>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[color:var(--ink-soft)]">
            {copy.locationsCopy}
          </p>
        </div>
        {saved ? (
          <span className="rounded-md bg-[var(--ok-bg)] px-2.5 py-1 text-[11px] text-[color:var(--ok-fg)]">
            {copy.locationsSavedNotice}
          </span>
        ) : null}
      </div>

      <input type="hidden" name="defaultLocationIndex" value={defaultRow} />

      <div className="mt-3 space-y-2">
        <div className="hidden gap-2 px-1 text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)] sm:grid sm:grid-cols-[1.1fr_1.6fr_0.7fr_auto]">
          <span>{copy.locationsLabelHeader}</span>
          <span>{copy.locationsAddressHeader}</span>
          <span>{copy.locationsFeeHeader}</span>
          <span>{copy.locationsDefaultHeader}</span>
        </div>

        {rows.map((row, index) => (
          <div
            key={index}
            className="grid gap-2 sm:grid-cols-[1.1fr_1.6fr_0.7fr_auto] sm:items-center"
          >
            <input type="hidden" name="locationId" value={row.id ?? ""} />
            <input
              name="locationLabel"
              value={row.label}
              onChange={(event) => update(index, { label: event.target.value })}
              placeholder={copy.locationsLabelHeader}
              maxLength={80}
              className={field}
            />
            <input
              name="locationAddress"
              value={row.address}
              onChange={(event) => update(index, { address: event.target.value })}
              placeholder={copy.locationsAddressHeader}
              maxLength={200}
              className={field}
            />
            <input
              name="locationFee"
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              value={row.fee}
              onChange={(event) => update(index, { fee: event.target.value })}
              className={`${field} tabular-nums`}
            />
            <label className="flex items-center gap-1.5 px-1 text-[11px] text-[color:var(--ink-soft)]">
              <input
                type="radio"
                name="defaultRowRadio"
                checked={defaultRow === index}
                onChange={() => setDefaultRow(index)}
                className="h-3.5 w-3.5"
              />
              <span className="sm:hidden">{copy.locationsDefaultHeader}</span>
            </label>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-[color:var(--ink-soft)]">
        {rows.some((row) => row.label.trim()) ? copy.locationsRemoveHint : copy.locationsEmptyHint}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-md bg-[var(--ink)] px-4 py-2 text-[12px] font-medium text-white"
          style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
        >
          {copy.locationsSaveAction}
        </button>
        <button
          type="button"
          onClick={() =>
            setRows((current) => [...current, { id: null, label: "", address: "", fee: "0" }])
          }
          className="rounded-md border border-[color:var(--line-strong)] px-3 py-2 text-[12px] text-[color:var(--ink-mid)]"
        >
          {copy.locationsAddRow}
        </button>
      </div>
    </form>
  );
}
