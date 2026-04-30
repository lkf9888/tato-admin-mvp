"use client";

import { CheckCircle2, MessageSquare, Paperclip, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { APP_VERSION_LABEL } from "@/lib/version";

/**
 * Floating "contact me" button + feedback modal. Lets a logged-in
 * admin user write a message, attach screenshots / videos, and have
 * it land in the operator's inbox via Resend (POST /api/contact).
 *
 * Positioning: bottom-left on every breakpoint. On mobile we lift it
 * above the bottom tab bar (which is `~58px + safe-area`) so the
 * fingertip target never collides with the navigation. On desktop
 * the floating brand pill / version chip lives in the same corner of
 * the page on `/login` and `/share`, so we keep clearance there too.
 */

export type ContactButtonLabels = {
  trigger: string;
  modalTitle: string;
  modalSubtitle: string;
  fromLabel: string;
  messageLabel: string;
  messagePlaceholder: string;
  attachLabel: string;
  attachHint: string;
  filesSelected: (count: number, sizeMb: string) => string;
  removeFile: string;
  sendAction: string;
  sendingAction: string;
  cancelAction: string;
  closeLabel: string;
  successTitle: string;
  successCopy: string;
  errorGeneric: string;
  errorMessageTooShort: string;
  errorTooManyFiles: (max: number) => string;
  errorFileTooLarge: (filename: string, mb: number) => string;
  errorFileType: string;
  errorTotalTooLarge: (mb: number) => string;
  errorNotConfigured: string;
};

const ACCEPT_ATTRIBUTE = "image/*,video/*,application/pdf,text/plain";
const MAX_FILES = 5;
const MAX_BYTES_PER_FILE = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

function formatMb(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export function ContactButton({
  labels,
  currentUserName,
  currentUserEmail,
}: {
  labels: ContactButtonLabels;
  currentUserName: string;
  currentUserEmail: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Close modal on route change so a half-typed report doesn't follow
  // the user across pages. State (`message`, `files`) is preserved
  // intentionally — if they re-open via the button they pick up where
  // they left off, just like Mail.app keeps the draft.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the modal is up. Same pattern used by
  // BottomTabBar's More sheet.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  // ESC closes the modal without losing the draft.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const tooLarge = totalBytes > MAX_TOTAL_BYTES;
  const messageOk = message.trim().length >= 5;
  const canSubmit = messageOk && !tooLarge && !submitting && !submitted;

  function pickFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    setError(null);
    const additions: File[] = [];
    for (const file of Array.from(picked)) {
      if (file.size > MAX_BYTES_PER_FILE) {
        setError(labels.errorFileTooLarge(file.name, MAX_BYTES_PER_FILE / (1024 * 1024)));
        return;
      }
      additions.push(file);
    }
    setFiles((current) => {
      const next = [...current, ...additions].slice(0, MAX_FILES);
      if (current.length + additions.length > MAX_FILES) {
        setError(labels.errorTooManyFiles(MAX_FILES));
      }
      return next;
    });
    // Reset input so the same file can be re-picked after removal.
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, i) => i !== index));
  }

  function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const formData = new FormData();
      formData.append("message", message.trim());
      for (const file of files) {
        formData.append("attachments", file);
      }
      // Lightweight context for triage. Captured client-side because
      // the server doesn't otherwise know which page the user came
      // from.
      formData.append("url", typeof window !== "undefined" ? window.location.href : "");
      formData.append("locale", typeof navigator !== "undefined" ? navigator.language : "");
      formData.append("appVersion", APP_VERSION_LABEL);

      let response: Response;
      try {
        response = await fetch("/api/contact", {
          method: "POST",
          body: formData,
        });
      } catch {
        setError(labels.errorGeneric);
        return;
      }

      if (response.ok) {
        setSubmitted(true);
        // Auto-close after a couple of seconds so the user sees the
        // confirmation but doesn't have to dismiss it manually.
        setTimeout(() => {
          setOpen(false);
          setMessage("");
          setFiles([]);
          setSubmitted(false);
        }, 2200);
        return;
      }

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      switch (data.error) {
        case "MESSAGE_TOO_SHORT":
          setError(labels.errorMessageTooShort);
          break;
        case "TOO_MANY_FILES":
          setError(labels.errorTooManyFiles(MAX_FILES));
          break;
        case "FILE_TOO_LARGE":
          setError(labels.errorFileTooLarge("", MAX_BYTES_PER_FILE / (1024 * 1024)));
          break;
        case "TOTAL_TOO_LARGE":
          setError(labels.errorTotalTooLarge(MAX_TOTAL_BYTES / (1024 * 1024)));
          break;
        case "FILE_TYPE_NOT_ALLOWED":
          setError(labels.errorFileType);
          break;
        case "FEEDBACK_NOT_CONFIGURED":
        case "SMTP_NOT_CONFIGURED":
          setError(labels.errorNotConfigured);
          break;
        default:
          setError(labels.errorGeneric);
      }
    });
  }

  return (
    <>
      {/*
       * Floating trigger. `bottom-[calc(env(safe-area-inset-bottom)+5.5rem)]`
       * on phone-sized viewports lifts the button above the BottomTabBar
       * (which itself sits at `bottom: env(safe-area-inset-bottom)` and
       * is ~58px tall). On `lg:` we drop back to a normal `bottom-3`
       * since the tab bar isn't rendered.
       */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={labels.trigger}
        className="tap-press fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] left-3 z-30 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-[12px] font-medium text-[var(--ink)] shadow-[0_18px_38px_-20px_rgba(17,19,24,0.45)] hover:bg-white lg:bottom-3"
      >
        <MessageSquare className="h-4 w-4" />
        <span className="hidden sm:inline">{labels.trigger}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={labels.modalTitle}
          className="fixed inset-0 z-50"
        >
          <button
            type="button"
            aria-label={labels.closeLabel}
            onClick={() => !submitting && setOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />

          {/*
           * Bottom sheet on phones, centered card on desktop. On
           * mobile we use the same drag-handle treatment as the
           * BottomTabBar More sheet so the design language is
           * consistent.
           */}
          <div className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-[1.4rem] bg-[var(--surface)] pb-safe shadow-[0_-30px_80px_rgba(0,0,0,0.25)] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85vh] sm:w-[min(34rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0">
            <div className="flex justify-center pt-2.5 sm:hidden">
              <span className="h-1 w-10 rounded-full bg-[var(--ink-soft)]/30" />
            </div>

            <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-3 sm:px-6 sm:pt-5">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--ink-soft)]">
                  {labels.modalSubtitle}
                </p>
                <h2 className="mt-1 font-serif text-xl font-semibold text-[var(--ink)] sm:text-2xl">
                  {labels.modalTitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => !submitting && setOpen(false)}
                aria-label={labels.closeLabel}
                disabled={submitting}
                className="tap-press inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--ink)] disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {submitted ? (
              <div className="px-5 pb-6 pt-4 sm:px-6 sm:pb-7">
                <div className="flex flex-col items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-7 text-center text-emerald-900">
                  <CheckCircle2 className="h-10 w-10" />
                  <h3 className="font-semibold">{labels.successTitle}</h3>
                  <p className="text-sm leading-relaxed text-emerald-900/80">
                    {labels.successCopy}
                  </p>
                </div>
              </div>
            ) : (
              <div className="px-5 pb-5 pt-1 sm:px-6 sm:pb-6">
                <div className="space-y-4">
                  {/* From — readonly. Shows the user that the email
                      will be tied to their account, which removes the
                      "wait, who is this from?" cognitive load. */}
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                      {labels.fromLabel}
                    </p>
                    <p className="mt-1 text-[14px] font-medium text-[var(--ink)]">
                      {currentUserName}{" "}
                      <span className="text-[var(--ink-soft)]">
                        &lt;{currentUserEmail}&gt;
                      </span>
                    </p>
                  </div>

                  <label className="block">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                      {labels.messageLabel}
                    </span>
                    <textarea
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder={labels.messagePlaceholder}
                      rows={5}
                      maxLength={5000}
                      className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-white px-3.5 py-3 text-[15px] leading-snug outline-none focus:border-[var(--ink)]"
                    />
                  </label>

                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                      {labels.attachLabel}
                    </p>
                    <p className="mt-1 text-[12px] text-[var(--ink-soft)]">
                      {labels.attachHint}
                    </p>

                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={ACCEPT_ATTRIBUTE}
                      onChange={(event) => pickFiles(event.target.files)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="tap-press mt-2 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2 text-[13px] font-medium text-[var(--ink)] hover:bg-white"
                    >
                      <Paperclip className="h-4 w-4" />
                      {labels.filesSelected(files.length, formatMb(totalBytes))}
                    </button>

                    {files.length > 0 ? (
                      <ul className="mt-3 space-y-1.5">
                        {files.map((file, index) => (
                          <li
                            key={`${file.name}-${index}`}
                            className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-[13px]"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium text-[var(--ink)]">
                                {file.name}
                              </p>
                              <p className="text-[11px] text-[var(--ink-soft)]">
                                {formatMb(file.size)} MB
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeFile(index)}
                              aria-label={labels.removeFile}
                              className="tap-press inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--ink-soft)]"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {tooLarge ? (
                      <p className="mt-2 text-[12px] text-rose-600">
                        {labels.errorTotalTooLarge(MAX_TOTAL_BYTES / (1024 * 1024))}
                      </p>
                    ) : null}
                  </div>

                  {error ? (
                    <p className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
                      {error}
                    </p>
                  ) : null}

                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => !submitting && setOpen(false)}
                      disabled={submitting}
                      className="tap-press rounded-full border border-[var(--line)] bg-white px-5 py-3 text-[14px] font-medium text-[var(--ink-soft)] disabled:opacity-50"
                    >
                      {labels.cancelAction}
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={!canSubmit}
                      className="tap-press rounded-full bg-[var(--ink)] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_16px_34px_rgba(17,19,24,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitting ? labels.sendingAction : labels.sendAction}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
