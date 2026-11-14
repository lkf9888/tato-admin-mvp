"use client";

import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { PLACEHOLDER_LABELS, type PlaceholderKey } from "@/lib/message-placeholders";
import { cn, formatDateTime } from "@/lib/utils";

type Info = {
  templateId: string | null;
  templateLabel: string | null;
  lockboxCode: string | null;
  message: string | null;
  missing: string[];
  tooLong: boolean;
  status: "none" | "draft" | "ready";
  changedSinceReady: boolean;
  readyAt: string | null;
  readyBy: string | null;
  messageHash: string | null;
  sentAt: string | null;
  sentLicense: string | null;
  sentDiffers: boolean;
};

type Template = { id: string; label: string; usesCode: boolean };

const MAX = 2000;

/**
 * A trip's pickup information, under its handover in the order panel:
 * which template, this trip's lockbox code, the text the guest will get,
 * and whether it is ready for the phone assistant to send
 * (lib/order-pickup-info.ts). The text is rebuilt on the server from the
 * trip each time, so what shows here is what would go out.
 *
 * `refreshKey` changes when anything the text is filled from changes in
 * the panel -- the handover above, times, places, guest, car.
 *
 * Ready is given to the preview on screen: a changed template or code is
 * saved and previewed first, and the hash of that preview goes with the
 * click, so the server refuses if the text has moved on since.
 */
export function OrderPickupInfoCard({
  orderId,
  locale,
  readOnly,
  refreshKey,
}: {
  orderId: string;
  locale: Locale;
  readOnly?: boolean;
  refreshKey: string;
}) {
  const t = getMessages(locale).orderPanel.pickupInfo;
  const [info, setInfo] = useState<Info | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Typed but not saved: a refresh from outside (the handover saved
  // above) keeps it rather than putting the stored values back.
  const dirtyRef = useRef(false);

  const apply = useCallback((next: Info, keepInputs = false) => {
    setInfo(next);
    if (keepInputs) return;
    setTemplateId(next.templateId ?? "");
    setCode(next.lockboxCode ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(`/api/orders/${orderId}/pickup-info`, { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { info: Info; templates: Template[] } | null) => {
        if (cancelled || !data) return;
        apply(data.info, dirtyRef.current);
        setTemplates([...data.templates].sort((a, b) => Number(b.usesCode) - Number(a.usesCode)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orderId, refreshKey, apply]);

  const save = async (ready?: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/pickup-info`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Ready and back-to-draft act on what is saved; only a plain save
        // sends the template and code.
        body: JSON.stringify(
          ready === undefined
            ? { templateId: templateId || null, lockboxCode: code }
            : ready
              ? { ready: true, previewHash: info?.messageHash ?? "" }
              : { ready: false },
        ),
      });
      const data = (await response.json().catch(() => null)) as { info?: Info | null; error?: string } | null;
      if (data?.info) apply(data.info);
      if (!response.ok) {
        setError(
          data?.error === "NOT_READY" ? t.notReady : data?.error === "PREVIEW_CHANGED" ? t.previewChanged : t.failed,
        );
      }
    } catch {
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  };

  if (!info) return null;

  const dirty = (info.templateId ?? "") !== templateId || (info.lockboxCode ?? "") !== code;
  dirtyRef.current = dirty;
  const label = (name: string) =>
    PLACEHOLDER_LABELS[name as PlaceholderKey]?.[locale === "en" ? "en" : "zh"] ?? `{{${name}}}`;
  const complete = Boolean(info.message) && info.missing.length === 0 && !info.tooLong;
  const chip = info.sentAt
    ? { text: t.statusSent(formatDateTime(info.sentAt, locale)), tone: "bg-[var(--surface-muted)] text-[var(--ink-mid)]" }
    : info.status === "ready"
      ? { text: t.statusReady, tone: "bg-emerald-100 text-emerald-800" }
      : info.status === "draft"
        ? { text: t.statusDraft, tone: "bg-amber-100 text-amber-800" }
        : { text: t.statusNone, tone: "bg-[var(--surface-muted)] text-[var(--ink-soft)]" };
  const inputClass =
    "w-full min-w-0 rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1.5 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--accent)] disabled:opacity-60";

  return (
    <section className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
          <KeyRound className="h-3 w-3" aria-hidden />
          {t.title}
        </p>
        <span className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-semibold", chip.tone)}>{chip.text}</span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-[color:var(--ink-soft)]">{t.hint}</p>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="grid min-w-0 gap-0.5">
          <span className="text-[11px] font-semibold text-[color:var(--ink-soft)]">{t.template}</span>
          {templates.length === 0 ? (
            <span className="text-[12px] text-[color:var(--ink-soft)]">{t.noTemplates}</span>
          ) : (
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              disabled={readOnly || busy || Boolean(info.sentAt)}
              className={inputClass}
            >
              <option value="">{t.chooseTemplate}</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                  {template.usesCode ? ` · ${t.usesCode}` : ""}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="grid min-w-0 gap-0.5">
          <span className="text-[11px] font-semibold text-[color:var(--ink-soft)]">{t.code}</span>
          <span className="flex min-w-0 gap-1">
            <input
              type={showCode ? "text" : "password"}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={t.codePlaceholder}
              autoComplete="off"
              maxLength={64}
              disabled={readOnly || busy || Boolean(info.sentAt)}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setShowCode((value) => !value)}
              aria-label={showCode ? t.hide : t.show}
              title={showCode ? t.hide : t.show}
              className="tap-compact flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--line-strong)] text-[color:var(--ink-soft)] hover:text-[var(--ink)]"
            >
              {showCode ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
            </button>
          </span>
        </label>
      </div>

      {info.message ? (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-[color:var(--ink-soft)]">{t.preview}</p>
          <p className="mt-0.5 whitespace-pre-line rounded-md bg-[var(--surface-muted)] px-2.5 py-2 text-[12.5px] leading-[1.45] text-[var(--ink)]">
            {/* The code is in the text; hidden here unless asked for. */}
            {showCode || !info.lockboxCode ? info.message : info.message.split(info.lockboxCode).join("••••")}
          </p>
        </div>
      ) : null}

      {dirty ? (
        <p className="mt-1.5 text-[11.5px] text-[color:var(--ink-soft)]">{t.saveToPreview}</p>
      ) : info.missing.length > 0 ? (
        <p className="mt-1.5 text-[11.5px] text-[var(--warn-fg)]">{t.missing(info.missing.map(label).join("、"))}</p>
      ) : info.tooLong ? (
        <p className="mt-1.5 text-[11.5px] text-[var(--warn-fg)]">{t.tooLong(MAX)}</p>
      ) : null}
      {info.changedSinceReady && !info.sentAt ? (
        <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11.5px] text-amber-900">{t.changed}</p>
      ) : null}
      {info.status === "ready" && info.readyBy && info.readyAt && !info.sentAt ? (
        <p className="mt-1.5 text-[11px] text-[color:var(--ink-soft)]">{t.readyBy(info.readyBy, formatDateTime(info.readyAt, locale))}</p>
      ) : null}
      {info.sentDiffers ? (
        <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11.5px] text-amber-900">{t.sentDiffers}</p>
      ) : null}
      {info.sentAt && info.sentLicense === "uploaded" ? (
        <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11.5px] text-amber-900">{t.licenseUnchecked}</p>
      ) : null}
      {error ? <p className="mt-1.5 text-[12px] text-[var(--bad-fg)]">{error}</p> : null}

      {!readOnly && !info.sentAt ? (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {info.status === "ready" && !dirty ? (
            <button
              type="button"
              onClick={() => void save(false)}
              disabled={busy}
              className="tap-compact h-8 rounded-md px-3 text-[12px] font-semibold text-[color:var(--ink-mid)] hover:bg-[var(--surface-muted)]"
            >
              {t.backToDraft}
            </button>
          ) : null}
          {dirty ? (
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="tap-compact h-8 rounded-md border border-[var(--line-strong)] px-3 text-[12px] font-semibold text-[var(--ink)] disabled:opacity-50"
            >
              {t.save}
            </button>
          ) : null}
          {/* Ready only for the preview on screen: with unsaved changes the
              preview is not yet the text, so save first. */}
          {info.status !== "ready" && !dirty ? (
            <button
              type="button"
              onClick={() => void save(true)}
              disabled={busy || !complete || !info.messageHash}
              className="tap-compact h-8 rounded-md bg-[var(--accent)] px-3 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {t.markReady}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
