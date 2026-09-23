"use client";

import { useRef, useState } from "react";

import { saveDirectBookingEmailTemplateAction } from "@/app/actions";
import {
  DIRECT_BOOKING_EMAIL_DEFAULT_TEMPLATE,
  DIRECT_BOOKING_EMAIL_SAMPLE_VALUES,
  DIRECT_BOOKING_EMAIL_VARIABLES,
  renderDirectBookingEmailSubject,
  renderDirectBookingEmailTemplate,
} from "@/lib/direct-booking-email-template";
import { getMessages, type Locale } from "@/lib/i18n";

const FIELD_CLASS =
  "w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] text-[color:var(--ink)]";
const LABEL_CLASS = "mb-1 block text-[11px] font-medium text-[color:var(--ink)]";

/**
 * The confirmation-email editor.
 *
 * The preview is rendered by the same functions the sender uses, so it
 * is the email rather than a drawing of one -- including the rule that
 * drops a line which reduced to a bare label. An operator who deletes
 * `{depositAmount}` from a line sees the line disappear here, which is
 * the only way that behaviour is discoverable.
 */
export function DirectBookingEmailEditor({
  locale,
  initialEnabled,
  initialSubject,
  initialBody,
  emailConfigured,
  saved,
}: {
  locale: Locale;
  initialEnabled: boolean;
  initialSubject: string;
  initialBody: string;
  emailConfigured: boolean;
  saved: boolean;
}) {
  const copy = getMessages(locale).directBookingPage;
  const [enabled, setEnabled] = useState(initialEnabled);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Which field a variable chip should land in. Tracking the last
  // focused field rather than guessing means inserting `{plateNumber}`
  // into the subject works as readily as into the body.
  const [lastFocused, setLastFocused] = useState<"subject" | "body">("body");

  function insertVariable(name: string) {
    const token = `{${name}}`;
    const element = lastFocused === "subject" ? subjectRef.current : bodyRef.current;
    const value = lastFocused === "subject" ? subject : body;
    const setValue = lastFocused === "subject" ? setSubject : setBody;

    if (!element) {
      setValue(`${value}${token}`);
      return;
    }

    const start = element.selectionStart ?? value.length;
    const end = element.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    setValue(next);

    // Put the caret after what was just inserted, once React has
    // written the new value back into the DOM.
    requestAnimationFrame(() => {
      element.focus();
      const caret = start + token.length;
      element.setSelectionRange(caret, caret);
    });
  }

  const previewSubject = renderDirectBookingEmailSubject(
    subject,
    DIRECT_BOOKING_EMAIL_SAMPLE_VALUES,
  );
  const previewBody = renderDirectBookingEmailTemplate(body, DIRECT_BOOKING_EMAIL_SAMPLE_VALUES);

  return (
    <form
      action={saveDirectBookingEmailTemplateAction}
      className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--ink-soft)]">
            {copy.emailKicker}
          </p>
          <h3 className="mt-1 text-[1.05rem] font-semibold text-[color:var(--ink)]">
            {copy.emailTitle}
          </h3>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[color:var(--ink-soft)]">
            {copy.emailCopy}
          </p>
        </div>
        {saved ? (
          <span className="rounded-md bg-[var(--ok-bg)] px-2.5 py-1 text-[11px] text-[color:var(--ok-fg)]">
            {copy.emailSavedNotice}
          </span>
        ) : null}
      </div>

      {!emailConfigured ? (
        <p className="mt-3 rounded-md border border-[color:var(--warn-fg)]/20 bg-[var(--warn-bg)] px-3 py-2 text-[12px] text-[color:var(--warn-fg)]">
          {copy.emailNotConfigured}
        </p>
      ) : null}

      <label className="mt-3 flex items-center justify-between gap-3 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2">
        <span className="min-w-0">
          <span className="block text-[12px] font-medium text-[color:var(--ink)]">
            {copy.emailEnableLabel}
          </span>
          <span className="mt-0.5 block text-[11px] text-[color:var(--ink-soft)]">
            {copy.emailEnableHint}
          </span>
        </span>
        <input
          type="checkbox"
          name="isEnabled"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-[color:var(--line)]"
        />
      </label>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <label className="block min-w-0">
            <span className={LABEL_CLASS}>{copy.emailSubjectLabel}</span>
            <input
              ref={subjectRef}
              name="subjectTemplate"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              onFocus={() => setLastFocused("subject")}
              maxLength={200}
              className={FIELD_CLASS}
            />
          </label>

          <label className="block min-w-0">
            <span className={LABEL_CLASS}>{copy.emailBodyLabel}</span>
            <textarea
              ref={bodyRef}
              name="bodyTemplate"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onFocus={() => setLastFocused("body")}
              rows={16}
              maxLength={4000}
              className={`${FIELD_CLASS} font-mono text-[12px] leading-5`}
            />
          </label>

          <div>
            <span className="text-[11px] text-[color:var(--ink-soft)]">
              {copy.emailVariablesLabel}
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {DIRECT_BOOKING_EMAIL_VARIABLES.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => insertVariable(name)}
                  className="rounded-[var(--radius-pill)] border border-[color:var(--line-strong)] bg-white px-2 py-1 font-mono text-[11px] text-[color:var(--ink-mid)] hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  {`{${name}}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <span className={LABEL_CLASS}>{copy.emailPreviewLabel}</span>
          <div className="rounded-md border border-[color:var(--line)] bg-white p-3">
            <p className="border-b border-[color:var(--line)] pb-2 text-[13px] font-semibold text-[color:var(--ink)]">
              {previewSubject || "—"}
            </p>
            <p className="mt-2 whitespace-pre-line text-[13px] leading-6 text-[color:var(--ink-mid)]">
              {previewBody || "—"}
            </p>
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-[color:var(--ink-soft)]">
            {copy.emailPreviewHint}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="rounded-md bg-[var(--ink)] px-4 py-2 text-[12px] font-medium text-white"
          style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
        >
          {copy.emailSaveAction}
        </button>
        <button
          type="button"
          onClick={() => {
            setSubject(DIRECT_BOOKING_EMAIL_DEFAULT_TEMPLATE.subjectTemplate);
            setBody(DIRECT_BOOKING_EMAIL_DEFAULT_TEMPLATE.bodyTemplate);
          }}
          className="rounded-md border border-[color:var(--line-strong)] px-3 py-2 text-[12px] text-[color:var(--ink-mid)]"
        >
          {copy.emailResetAction}
        </button>
      </div>
    </form>
  );
}
