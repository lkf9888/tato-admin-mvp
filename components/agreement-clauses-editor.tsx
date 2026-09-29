"use client";

import { useState } from "react";

import { StickySaveBar } from "@/components/sticky-save-bar";
import { getMessages, type Locale } from "@/lib/i18n";
import { resetAgreementClausesAction, saveAgreementClausesAction } from "@/lib/direct-booking-actions";

type Clause = { heading: string; body: string };
type Row = Clause & { key: number };

const FIELD_CLASS =
  "w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] text-[color:var(--ink)]";

/**
 * The rental agreement's clauses, edited for every car at once.
 *
 * Rows post in display order as parallel `clauseHeading` / `clauseBody`
 * lists, so moving a row is just moving it here. English only: the
 * agreement a renter signs has always been in English.
 */
export function AgreementClausesEditor({
  locale,
  clauses,
  isCustom,
  updatedLabel,
  saved,
  error,
}: {
  locale: Locale;
  clauses: Clause[];
  isCustom: boolean;
  updatedLabel: string | null;
  saved: boolean;
  error: string | null;
}) {
  const copy = getMessages(locale).directBookingAgreement;
  const [rows, setRows] = useState<Row[]>(() =>
    clauses.map((clause, index) => ({ ...clause, key: index })),
  );
  const [nextKey, setNextKey] = useState(clauses.length);

  function update(key: number, patch: Partial<Clause>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function move(index: number, step: -1 | 1) {
    setRows((current) => {
      const target = index + step;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function add() {
    setRows((current) => [...current, { key: nextKey, heading: "", body: "" }]);
    setNextKey((key) => key + 1);
  }

  return (
    <section className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--ink-soft)]">{copy.kicker}</p>
          <h3 className="mt-1 text-[1.05rem] font-semibold text-[color:var(--ink)]">{copy.title}</h3>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[color:var(--ink-soft)]">{copy.copy}</p>
          <p className="mt-1 text-[11px] text-[color:var(--ink-soft)]">
            {isCustom ? copy.customState(updatedLabel ?? "") : copy.defaultState}
          </p>
        </div>
        {isCustom ? (
          <form
            action={resetAgreementClausesAction}
            onSubmit={(event) => {
              if (!window.confirm(copy.restoreConfirm)) event.preventDefault();
            }}
          >
            <button
              type="submit"
              className="rounded-md border border-[color:var(--line)] bg-white px-3 py-1.5 text-[12px] text-[color:var(--ink)] hover:bg-[var(--surface-muted)]"
            >
              {copy.restoreDefault}
            </button>
          </form>
        ) : null}
      </div>

      {saved ? (
        <p className="mt-2 rounded-md bg-[var(--ok-bg)] px-2.5 py-1 text-[11px] text-[color:var(--ok-fg)]">
          {copy.savedNotice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-md bg-[var(--bad-bg)] px-2.5 py-1 text-[11px] text-[color:var(--bad-fg)]">
          {copy.emptyError}
        </p>
      ) : null}

      <form action={saveAgreementClausesAction} className="mt-3 space-y-2">
        {rows.map((row, index) => (
          <div
            key={row.key}
            className="rounded-md border border-[color:var(--line)] bg-white px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-[12px] tabular-nums text-[color:var(--ink-soft)]">
                {index + 1}.
              </span>
              <input
                name="clauseHeading"
                value={row.heading}
                onChange={(event) => update(row.key, { heading: event.target.value })}
                placeholder={copy.headingPlaceholder}
                maxLength={120}
                aria-label={copy.headingLabel}
                className={`${FIELD_CLASS} font-semibold`}
              />
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={copy.moveUp}
                  className="rounded border border-[color:var(--line)] px-2 py-1 text-[12px] disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === rows.length - 1}
                  aria-label={copy.moveDown}
                  className="rounded border border-[color:var(--line)] px-2 py-1 text-[12px] disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                  className="rounded px-2 py-1 text-[12px] text-[color:var(--bad-fg)] hover:bg-[var(--bad-bg)]"
                >
                  {copy.remove}
                </button>
              </div>
            </div>
            <textarea
              name="clauseBody"
              value={row.body}
              onChange={(event) => update(row.key, { body: event.target.value })}
              rows={Math.min(10, Math.max(3, Math.ceil(row.body.length / 110)))}
              maxLength={5000}
              aria-label={copy.bodyLabel}
              className={`${FIELD_CLASS} mt-2 leading-5`}
            />
          </div>
        ))}

        <button
          type="button"
          onClick={add}
          className="rounded-md border border-dashed border-[color:var(--line-strong)] px-3 py-2 text-[12px] text-[color:var(--ink)] hover:bg-[var(--surface-muted)]"
        >
          + {copy.addClause}
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
