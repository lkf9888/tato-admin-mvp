"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { X } from "lucide-react";

import { getMessages, type Locale } from "@/lib/i18n";
import { isExpired, entryLocationMatches, matchScore, type KnowledgeEntry, type TripStage } from "@/lib/message-knowledge";
import { renderTemplate, templateAlreadySent, type PlaceholderContext } from "@/lib/message-placeholders";
import { SEARCH_FIELD_PROPS } from "@/lib/search-field-props";

/** A template as the scheduled-message rules list it. */
export type MessageTemplateRow = {
  id: string;
  label: string;
  content: string;
  vehicleId: string | null;
  vehicleLabel: string | null;
};

export type MessageTemplateVehicleOption = { id: string; label: string; searchText: string };

export type MessageTemplateContext = {
  /** Who the reply is to, for the header. */
  title: string;
  vehicleId: string | null;
  stage: TripStage | null;
  pickupLocation: string | null;
  returnLocation: string | null;
  /** Fills placeholders, pickup code included: this is the operator's
   *  own browser, not the AI. */
  values: PlaceholderContext;
  /** What was already sent in this conversation, so a template that
   *  went out sinks to the bottom. */
  sentMessages: string[];
  /** The guest's latest message, which orders the suggestions. */
  question: string;
};

/**
 * The templates that fit a conversation, for the composer: this car's
 * and the fleet's, for this moment of the trip and this pickup place --
 * the same tests the AI's library applies -- best match first and
 * already-sent last. Rules are not offered -- they are guidance for the
 * AI, never words for a guest.
 */
export function suggestTemplates(entries: KnowledgeEntry[], context: MessageTemplateContext) {
  const fits = (entry: KnowledgeEntry) =>
    entry.kind !== "rule" &&
    !isExpired(entry) &&
    (!entry.vehicleIds || (context.vehicleId !== null && entry.vehicleIds.includes(context.vehicleId))) &&
    (!entry.stages || (context.stage !== null && entry.stages.includes(context.stage))) &&
    entryLocationMatches(entry, context);
  return entries
    .filter(fits)
    .map((entry) => ({
      entry,
      score: matchScore(entry, context.question),
      sent: templateAlreadySent(entry.content, context.sentMessages),
    }))
    .sort(
      (a, b) =>
        Number(a.sent) - Number(b.sent) ||
        b.score - a.score ||
        Number(Boolean(b.entry.vehicleIds)) - Number(Boolean(a.entry.vehicleIds)) ||
        Number(b.entry.kind === "reply") - Number(a.entry.kind === "reply"),
    );
}

/**
 * Pick a saved template into the reply box. Editing lives on the AI
 * message library page; this is only for using them.
 */
export function MessageTemplatePanel({
  locale,
  entries,
  vehicleLabels,
  context,
  onInsert,
  onClose,
}: {
  locale: Locale;
  entries: KnowledgeEntry[];
  vehicleLabels: Record<string, string>;
  context: MessageTemplateContext;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const t = getMessages(locale).messageLibrary;
  const page = getMessages(locale).guestMessagesPage;
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();

  const suggested = useMemo(() => suggestTemplates(entries, context), [entries, context]);
  const suggestedIds = new Set(suggested.map((item) => item.entry.id));
  const others = entries.filter((entry) => entry.kind !== "rule" && !suggestedIds.has(entry.id));
  const matches = (entry: KnowledgeEntry) =>
    !query || [entry.label, entry.content, ...entry.triggers].join("\n").toLowerCase().includes(query);

  function row(entry: KnowledgeEntry, sent = false) {
    const { text, missing } = renderTemplate(entry.content, context.values);
    return (
      <li key={entry.id} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[var(--ink)]">
              {entry.label}
              {sent ? <span className="ml-1.5 text-[11px] font-normal text-[var(--ink-soft)]">· {t.sentTag}</span> : null}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
              {t.kinds[entry.kind]} ·{" "}
              {entry.vehicleIds ? entry.vehicleIds.map((id) => vehicleLabels[id]?.split(" · ")[0] ?? "?").join("、") : t.allCars}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onInsert(text);
              onClose();
            }}
            className="tap-press shrink-0 rounded-full bg-[var(--ink)] px-3 py-1 text-[12px] font-bold text-[var(--surface)]"
          >
            {t.placeholderInsert}
          </button>
        </div>
        <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-[12px] leading-5 text-[var(--ink-mid)]">{text}</p>
        {missing.length > 0 ? (
          <p className="mt-1 text-[11px] text-[var(--warn-fg)]">{page.missingPlaceholders(missing.map((key) => `{{${key}}}`).join("、"))}</p>
        ) : null}
      </li>
    );
  }

  const shownSuggested = suggested.filter((item) => matches(item.entry));
  const shownOthers = others.filter(matches);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-xl flex-col rounded-t-2xl border border-[var(--line)] bg-[var(--surface)] shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-[var(--ink)]">{page.toolTemplates}</h3>
            <p className="mt-0.5 truncate text-[11.5px] text-[var(--ink-soft)]">{context.title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.cancel} className="tap-press text-[var(--ink-soft)]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="border-b border-[var(--line)] px-4 py-2">
          <input
            type="search"
            {...SEARCH_FIELD_PROPS}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t.searchPlaceholder}
            className="h-9 w-full rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 text-[13px] outline-none focus:border-[var(--line-strong)]"
          />
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-3">
          {shownSuggested.length === 0 && shownOthers.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-[var(--ink-soft)]">{entries.length === 0 ? t.empty : t.emptyFiltered}</p>
          ) : null}
          {shownSuggested.length > 0 ? <ul className="space-y-2">{shownSuggested.map((item) => row(item.entry, item.sent))}</ul> : null}
          {shownOthers.length > 0 ? (
            <details open={Boolean(query) || shownSuggested.length === 0}>
              <summary className="tap-press cursor-pointer text-[12px] font-semibold text-[var(--ink-soft)]">
                {t.filterAllCars} · {t.count(shownOthers.length)}
              </summary>
              <ul className="mt-2 space-y-2">{shownOthers.map((entry) => row(entry))}</ul>
            </details>
          ) : null}
        </div>
        <div className="border-t border-[var(--line)] px-4 py-2.5 text-right">
          <Link href="/messages/ai-templates" className="text-[12px] font-semibold text-[var(--brand)] underline underline-offset-2">
            {page.tabLibrary} →
          </Link>
        </div>
      </div>
    </div>
  );
}
