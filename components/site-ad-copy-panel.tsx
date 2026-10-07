"use client";

import { BusyLabel } from "@/components/booking-spinner";
import { useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import type { AdDraft } from "@/lib/site-ad-copy";

/**
 * The drafts for one car, each with copy buttons and an optional AI
 * rewrite. A rewrite that changes a fact comes back refused and the
 * draft stays.
 */
export function SiteAdCopyPanel({ locale, vehicleId, drafts }: { locale: Locale; vehicleId: string; drafts: AdDraft[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {drafts.map((draft) => (
        <AdCard key={draft.platform} locale={locale} vehicleId={vehicleId} draft={draft} />
      ))}
    </div>
  );
}

function AdCard({ locale, vehicleId, draft }: { locale: Locale; vehicleId: string; draft: AdDraft }) {
  const copy = getMessages(locale).directBookingAds;
  const [text, setText] = useState({ title: draft.title, body: draft.body, polished: false });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const blocked = draft.warnings.some((warning) => warning.severity === "blocker");

  async function polish() {
    setBusy(true);
    setNote(null);
    const response = await fetch("/api/direct-booking/ad-copy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vehicleId, platform: draft.platform }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as
      | { ok: true; title: string; body: string }
      | { ok: false; reason: string }
      | null;
    setBusy(false);
    if (result?.ok) {
      setText({ title: result.title, body: result.body, polished: true });
      setNote(copy.polishedNote);
    } else {
      // Only a verification failure means the AI changed something;
      // anything else is the service not answering.
      const reason = result && !result.ok ? result.reason : "";
      setNote(/^(empty|unparseable|title_too_long|link_missing|number_)/.test(reason) ? copy.polishRejected(reason) : copy.polishUnavailable);
    }
  }

  async function copyText(key: string, value: string) {
    await navigator.clipboard.writeText(value).catch(() => undefined);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1500);
  }

  const button = "rounded-md border border-[color:var(--line)] bg-white px-2.5 py-1 text-[11px] font-medium text-[color:var(--ink)]";
  const titleLength = [...text.title].length;

  return (
    <article className="flex min-w-0 flex-col rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[14px] font-semibold text-[color:var(--ink)]">{copy.platformNames[draft.platform]}</h4>
        <button type="button" disabled={busy || blocked} onClick={() => void polish()} className={`${button} disabled:opacity-50`}>
          <BusyLabel busy={busy} idle={copy.polish} working={copy.polishing} />
        </button>
      </div>

      {draft.warnings.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {draft.warnings.map((warning) => (
            <li
              key={warning.code}
              className={`rounded px-2 py-1 text-[11px] leading-4 ${
                warning.severity === "blocker" ? "bg-[var(--bad-bg)] text-[color:var(--bad-fg)]" : "bg-[var(--warn-bg)] text-[color:var(--warn-fg)]"
              }`}
            >
              {copy.warnings[warning.code]}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-[color:var(--ink-soft)]">
          {copy.titleLabel} · {copy.titleCount(titleLength, draft.titleLimit)}
        </span>
        <button type="button" onClick={() => void copyText("title", text.title)} className={button}>
          {copied === "title" ? copy.copied : copy.copy}
        </button>
      </div>
      <p className="mt-1 break-words rounded-md bg-[var(--surface-muted)] px-2 py-1.5 text-[13px] font-medium text-[color:var(--ink)]">{text.title}</p>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-[color:var(--ink-soft)]">{copy.bodyLabel}</span>
        <button type="button" onClick={() => void copyText("body", text.body)} className={button}>
          {copied === "body" ? copy.copied : copy.copy}
        </button>
      </div>
      <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--surface-muted)] px-2 py-1.5 font-sans text-[12px] leading-5 text-[color:var(--ink)]">
        {text.body}
      </pre>

      {note ? <p className="mt-1.5 text-[11px] text-[color:var(--ink-soft)]">{note}</p> : null}
      {text.polished ? (
        <button type="button" onClick={() => { setText({ title: draft.title, body: draft.body, polished: false }); setNote(null); }} className="mt-1 self-start text-[11px] underline text-[color:var(--ink-soft)]">
          {copy.backToDraft}
        </button>
      ) : null}

      {draft.fields.length > 0 ? (
        <dl className="mt-2 border-t border-[color:var(--line)] pt-2 text-[11px]">
          <dt className="text-[color:var(--ink-soft)]">{copy.formFields}</dt>
          {draft.fields.map((field) => (
            <dd key={field.label} className="mt-0.5 text-[color:var(--ink)]">
              {field.label}: {field.value}
            </dd>
          ))}
        </dl>
      ) : null}
    </article>
  );
}
