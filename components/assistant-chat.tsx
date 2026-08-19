"use client";

import { useEffect, useRef, useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";

type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
};

type SnapshotSummary = {
  vehicles: number;
  activeOrders: number;
  upcomingPickups: number;
  upcomingReturns: number;
  conflicts: number;
  unreadEmails: number;
  openTasks: number;
};

export function AssistantChat({
  locale,
  configured,
  initialMessages,
  initialThreadId,
}: {
  locale: Locale;
  /** False when KIMI_API_KEY is unset — the composer is disabled and we
   *  explain why rather than failing on send. */
  configured: boolean;
  initialMessages: ChatMessage[];
  initialThreadId: string | null;
}) {
  const t = getMessages(locale).assistantPage;

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotSummary | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || sending || !configured) return;

    setError(null);
    setSending(true);
    setDraft("");

    // Optimistic echo so the operator sees their question immediately
    // rather than staring at an empty box for the model round-trip.
    const optimistic: ChatMessage = {
      id: `pending-${Date.now()}`,
      role: "USER",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);

    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message: trimmed }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        threadId?: string;
        message?: ChatMessage;
        snapshot?: SnapshotSummary;
        error?: string;
        reason?: string;
      };

      if (!response.ok || !data.message) {
        // Surface the upstream reason rather than collapsing everything
        // to one sentence. This page is admin-only, and the operator is
        // the person who configures the API key — hiding "invalid api
        // key" or "model not found" from them just turns a 30-second
        // fix into a support round-trip.
        // Fall back to the error code when there is no upstream reason.
        // A VALIDATION_ERROR carries no `reason`, so it used to render
        // as the bare "try again later" sentence -- which reads as a
        // model outage and sent us hunting the wrong bug for hours.
        const detail = data.reason
          ? ` (${data.reason})`
          : data.error
            ? ` (${data.error})`
            : "";
        setError(
          data.error === "RATE_LIMITED"
            ? t.errorRateLimited
            : data.error === "ASSISTANT_NOT_CONFIGURED"
              ? t.errorNotConfigured
              : `${t.errorGeneric}${detail}`,
        );
        // Drop the optimistic echo — the question was not recorded.
        setMessages((current) => current.filter((m) => m.id !== optimistic.id));
        return;
      }

      if (data.threadId) setThreadId(data.threadId);
      if (data.snapshot) setSnapshot(data.snapshot);
      setMessages((current) => [...current, data.message as ChatMessage]);
    } catch {
      setError(t.errorGeneric);
      setMessages((current) => current.filter((m) => m.id !== optimistic.id));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  const suggestions = [t.suggest1, t.suggest2, t.suggest3, t.suggest4];

  return (
    <div className="flex h-[calc(100vh-13rem)] min-h-[26rem] flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4"
      >
        {messages.length === 0 ? (
          <div className="mx-auto max-w-lg py-8 text-center">
            <p className="text-[13px] leading-6 text-[var(--ink-soft)]">{t.emptyState}</p>
            <div className="mt-4 grid gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  disabled={!configured || sending}
                  className="tap-press rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 py-2 text-[12.5px] text-[var(--ink)] transition hover:border-[rgba(17,19,24,0.24)] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === "USER" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                message.role === "USER"
                  ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[var(--ink)] px-3.5 py-2.5 text-[13.5px] leading-6 text-white"
                  : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 py-2.5 text-[13.5px] leading-6 text-[var(--ink)]"
              }
            >
              {message.content}
            </div>
          </div>
        ))}

        {sending ? (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 py-2.5 text-[13px] text-[var(--ink-soft)]">
              {t.thinking}
            </div>
          </div>
        ) : null}
      </div>

      {snapshot ? (
        <div className="border-t border-[var(--line)] bg-[var(--surface-muted)] px-3 py-1.5 text-[11px] text-[var(--ink-soft)] sm:px-4">
          {t.groundedIn(
            snapshot.vehicles,
            snapshot.upcomingPickups + snapshot.upcomingReturns,
            snapshot.conflicts,
            snapshot.unreadEmails,
          )}
        </div>
      ) : null}

      {error ? (
        <div className="border-t border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 sm:px-4">
          {error}
        </div>
      ) : null}

      {!configured ? (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 sm:px-4">
          {t.notConfiguredHint}
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
        className="flex items-end gap-2 border-t border-[var(--line)] px-3 py-2.5 sm:px-4"
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter makes a new line — the
            // convention every chat surface uses.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(draft);
            }
          }}
          rows={1}
          disabled={!configured || sending}
          placeholder={t.inputPlaceholder}
          className="max-h-32 min-h-[2.5rem] flex-1 resize-y rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[14px] leading-6 text-[var(--ink)] outline-none focus:border-[rgba(17,19,24,0.3)] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!configured || sending || draft.trim().length === 0}
          className="tap-press h-10 shrink-0 rounded-full bg-[var(--ink)] px-4 text-[13px] font-semibold text-white transition hover:bg-[#2a2f3a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? t.sending : t.send}
        </button>
      </form>
    </div>
  );
}
