"use client";

import { useState, useTransition } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { saveHiddenCsvColumnsAction } from "@/lib/turo-csv-fields-actions";

export function TuroCsvFieldsView({
  row,
  initialHidden,
  canEdit,
  locale,
}: {
  row: Array<[string, string]>;
  initialHidden: string[];
  canEdit: boolean;
  locale: Locale;
}) {
  const t = getMessages(locale).turoCsvFields;
  // Kept whole, including columns this row does not have: another
  // year's export may name columns this one lacks, and saving must not
  // forget them.
  const [hidden, setHidden] = useState(() => new Set(initialHidden));
  const [editing, setEditing] = useState(false);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState("");

  const shown = row.filter(([column, value]) => value !== "" && !hidden.has(column));
  const hiddenHere = row.filter(([column]) => hidden.has(column)).length;

  function update(next: Set<string>) {
    const previous = hidden;
    setHidden(next);
    setError("");
    startSaving(async () => {
      try {
        await saveHiddenCsvColumnsAction([...next]);
      } catch {
        setHidden(previous);
        setError(t.saveFailed);
      }
    });
  }

  function toggle(column: string) {
    const next = new Set(hidden);
    if (next.has(column)) next.delete(column);
    else next.add(column);
    update(next);
  }

  function showAll() {
    const next = new Set(hidden);
    for (const [column] of row) next.delete(column);
    update(next);
  }

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="t-eyebrow text-[var(--ink-soft)]">
            {t.title}
            {hiddenHere > 0 && !editing ? ` · ${t.hiddenCount(hiddenHere)}` : ""}
          </p>
          {editing ? <p className="mt-1 text-[11.5px] leading-5 text-[var(--ink-soft)]">{t.hint}</p> : null}
        </div>
        {canEdit ? (
          <div className="flex shrink-0 items-center gap-2">
            {editing && hiddenHere > 0 ? (
              <button
                type="button"
                onClick={showAll}
                className="tap-press text-[12px] font-semibold text-[var(--ink-soft)] underline underline-offset-2"
              >
                {t.showAll}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setEditing((value) => !value)}
              className="tap-press rounded-md border border-[var(--line-strong)] px-2.5 py-1 text-[12px] font-semibold text-[var(--ink)]"
            >
              {editing ? t.done : t.edit}
            </button>
          </div>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-[12px] text-[var(--bad-fg)]">{error}</p> : null}

      {editing ? (
        <ul className={`mt-2 grid gap-x-4 sm:grid-cols-2 ${saving ? "opacity-70" : ""}`}>
          {row.map(([column, value]) => (
            <li key={column}>
              <label className="flex min-h-9 cursor-pointer items-center gap-2 border-b border-[var(--line)] py-1.5 text-[12px]">
                <input
                  type="checkbox"
                  checked={!hidden.has(column)}
                  onChange={() => toggle(column)}
                  className="h-4 w-4 shrink-0 rounded border-[var(--line-strong)]"
                />
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--ink)]">{column}</span>
                <span className="max-w-[45%] truncate text-right text-[var(--ink-soft)]">{value || t.emptyHidden}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <dl className="mt-2 grid gap-x-4 sm:grid-cols-2">
          {shown.map(([column, value]) => (
            <div key={column} className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-1.5 text-[12px]">
              <dt className="min-w-0 shrink text-[var(--ink-soft)]">{column}</dt>
              <dd className="min-w-0 break-words text-right font-medium text-[var(--ink)] tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
