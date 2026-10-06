"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";

import type { Locale } from "@/lib/i18n";

type Item = { id: string; content: string };

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        title: "AI 记住的事",
        intro: "说一次就一直生效：每次助理回答、每次起草客人回复都会照这些做。",
        placeholder: "例如：回复客人要简短，不超过两句",
        add: "记住",
        adding: "保存中…",
        empty: "还没有。写下你希望 AI 一直遵守的要求。",
        remove: "忘掉这条",
        tooMany: "最多 30 条，先删掉不用的。",
        failed: "保存失败。",
      }
    : {
        title: "What the AI remembers",
        intro: "Said once, applied every time: every assistant answer and every guest-reply draft follows these.",
        placeholder: "e.g. Keep guest replies to two sentences",
        add: "Remember",
        adding: "Saving…",
        empty: "Nothing yet. Write down anything the AI should always follow.",
        remove: "Forget this",
        tooMany: "Up to 30. Remove one you no longer need first.",
        failed: "Could not save.",
      };
}

/** The operator's standing instructions to the AI. See lib/assistant-memory. */
export function AssistantMemoryPanel({ locale, initialItems }: { locale: Locale; initialItems: Item[] }) {
  const t = useMemo(() => copy(locale), [locale]);
  const [items, setItems] = useState(initialItems);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(init: RequestInit, url = "/api/assistant/memory") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, init);
      const data = (await response.json().catch(() => ({}))) as { items?: Item[]; error?: string };
      if (!response.ok || !data.items) {
        setError(data.error === "TOO_MANY" ? t.tooMany : t.failed);
        return false;
      }
      setItems(data.items);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    const ok = await send({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: draft }),
    });
    if (ok) setDraft("");
  }

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
      <h2 className="text-[13px] font-bold text-[var(--ink)]">{t.title}</h2>
      <p className="mt-0.5 text-[11.5px] leading-4 text-[var(--ink-soft)]">{t.intro}</p>

      {items.length === 0 ? (
        <p className="mt-2 text-[12px] text-[var(--ink-soft)]">{t.empty}</p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-2 rounded-md bg-[var(--surface-muted)] px-2.5 py-1.5 text-[12.5px] leading-5 text-[var(--ink)]"
            >
              <span className="min-w-0 flex-1 break-words">{item.content}</span>
              <button
                type="button"
                onClick={() => send({ method: "DELETE" }, `/api/assistant/memory?id=${encodeURIComponent(item.id)}`)}
                disabled={busy}
                title={t.remove}
                aria-label={t.remove}
                className="tap-compact flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface)] hover:text-rose-600 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-2 flex gap-2">
        <input
          id="assistant-memory-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t.placeholder}
          maxLength={300}
          className="h-9 min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-[13px] outline-none focus:border-[var(--line-strong)]"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="h-9 shrink-0 rounded-md bg-[var(--ink)] px-3 text-[12px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t.adding : t.add}
        </button>
      </form>
      {error ? <p className="mt-1.5 text-[12px] text-rose-600">{error}</p> : null}
    </section>
  );
}
