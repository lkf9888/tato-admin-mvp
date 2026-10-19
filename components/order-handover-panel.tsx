"use client";

import { MapPin, Pencil } from "lucide-react";
import { useEffect, useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";

type Spots = { pickupSpot: string | null; returnSpot: string | null; handoverNote: string | null };

/**
 * A trip's handover, in the order panel: the exact pickup spot, the
 * return spot and how to get in. Three short lines that edit together,
 * saved on their own (PUT /api/orders/[id]/handover) rather than through
 * the order's full save, which re-syncs ledgers for what is a parking
 * spot. Staff fill the same fields from their task page.
 */
export function OrderHandoverPanel({
  orderId,
  locale,
  readOnly,
  spots,
  onSaved,
}: {
  orderId: string;
  locale: Locale;
  readOnly?: boolean;
  spots: Spots;
  onSaved: (spots: Spots) => void;
}) {
  const t = getMessages(locale).orderPanel.handover;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(spots);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!editing) setDraft(spots);
  }, [spots, editing]);

  const rows: Array<{ key: keyof Spots; label: string; placeholder: string; multiline?: boolean }> = [
    { key: "pickupSpot", label: t.pickupSpot, placeholder: t.pickupSpotPlaceholder },
    { key: "returnSpot", label: t.returnSpot, placeholder: t.returnSpotPlaceholder },
    { key: "handoverNote", label: t.note, placeholder: t.notePlaceholder, multiline: true },
  ];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/handover`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { spots: Spots };
      onSaved(data.spots);
      setEditing(false);
    } catch {
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "w-full min-w-0 rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1.5 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--accent)]";

  return (
    <section className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
          <MapPin className="h-3 w-3" aria-hidden />
          {t.title}
        </p>
        {!readOnly && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`${t.edit} ${t.title}`}
            title={t.edit}
            className="tap-compact hit-area flex h-6 w-6 items-center justify-center rounded text-[color:var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
          >
            <Pencil className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-1.5 grid gap-2">
          <p className="text-[11px] leading-4 text-[color:var(--ink-soft)]">{t.hint}</p>
          {rows.map((row) => (
            <label key={row.key} className="grid gap-0.5">
              <span className="text-[11px] font-semibold text-[color:var(--ink-soft)]">{row.label}</span>
              {row.multiline ? (
                <textarea
                  value={draft[row.key] ?? ""}
                  onChange={(event) => setDraft({ ...draft, [row.key]: event.target.value })}
                  placeholder={row.placeholder}
                  rows={2}
                  maxLength={1000}
                  className={inputClass}
                />
              ) : (
                <input
                  value={draft[row.key] ?? ""}
                  onChange={(event) => setDraft({ ...draft, [row.key]: event.target.value })}
                  placeholder={row.placeholder}
                  maxLength={200}
                  className={inputClass}
                />
              )}
            </label>
          ))}
          {error ? <p className="text-[12px] text-[var(--bad-fg)]">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(spots);
                setError(null);
              }}
              disabled={busy}
              className="tap-compact h-8 rounded-md px-3 text-[12px] font-semibold text-[color:var(--ink-mid)] hover:bg-[var(--surface-muted)]"
            >
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="tap-compact h-8 rounded-md bg-[var(--accent)] px-3 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {t.save}
            </button>
          </div>
        </div>
      ) : (
        <dl className="mt-1 grid gap-0.5 text-[13px]">
          {rows.map((row) => (
            <div key={row.key} className="flex min-w-0 gap-2">
              <dt className="w-16 shrink-0 text-[12px] text-[color:var(--ink-soft)]">{row.label}</dt>
              <dd className={spots[row.key] ? "min-w-0 whitespace-pre-line text-[color:var(--ink)]" : "text-[color:var(--ink-soft)]"}>
                {spots[row.key] || t.empty}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
