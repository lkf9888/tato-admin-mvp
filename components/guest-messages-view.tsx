"use client";

import Link from "next/link";
import { Bell, ChevronDown, ChevronLeft, ExternalLink, LayoutTemplate, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { GuestMessageAlertPanel } from "@/components/guest-message-alert-panel";
import { MessageRulesPanel } from "@/components/message-rules-panel";
import {
  MessageTemplatePanel,
  type MessageTemplateContext,
  type MessageTemplateRow,
  type MessageTemplateVehicleOption,
} from "@/components/message-template-panel";
import { InlineSpinner, TypingDots } from "@/components/turo-task-progress";
import { getMessages, type Locale } from "@/lib/i18n";

type ThreadMessage = {
  id: string;
  subject: string;
  guestText: string | null;
  receivedAt: string;
  acknowledgedAt: string | null;
  summary: string | null;
  summaryZh: string | null;
  summaryZhBrief: string | null;
  needsAction: boolean;
  turoLink: string | null;
};

type Thread = {
  key: string;
  guestName: string;
  vehicleId: string | null;
  vehicleLabel: string | null;
  vehiclePlate: string | null;
  avatarUrl: string | null;
  latestSummary: string | null;
  latestSummaryZh: string | null;
  /** Newest first, as `groupIntoThreads` sorts them. */
  messages: ThreadMessage[];
  latestAt: string;
  openCount: number;
  orderId: string | null;
  /** Present only when there is no trip: what specifically stopped the
   *  match, so the operator knows which fix applies. */
  unmatchedReason?:
    | { kind: "noVehicleText" }
    | { kind: "noSuchVehicle"; vehicleText: string; nearest: string[] }
    | { kind: "severalVehicles"; vehicleText: string; count: number }
    | { kind: "noTripInWindow"; vehicleText: string }
    | null;
  turoLink: string | null;
};

type ConversationMessage = {
  id: string;
  direction: "inbound" | "outbound";
  authorName: string | null;
  body: string;
  bodyZh: string | null;
  sentAt: string;
};

type Order = {
  id: string;
  renterName: string;
  renterPhone: string | null;
  externalOrderId: string | null;
  plateNumber: string | null;
  plateUnconfirmed?: boolean;
  pickupDatetime: string;
  returnDatetime: string;
  pickupLocation: string | null;
  returnLocation: string | null;
  status: string;
  netEarning: number | null;
  vehicleLabel: string | null;
  /** turo.com's page for this reservation's messages. A plain https
   *  link, which a phone with the Turo app opens in the app. */
  turoMessagesUrl?: string | null;
  vehicleName?: string | null;
  pickupCode?: string | null;
};

type Copy = ReturnType<typeof getMessages>["guestMessagesPage"];

type DueMessage = {
  ruleId: string;
  ruleName: string;
  orderId: string;
  renterName: string;
  vehicleLabel: string;
  dueAt: string;
  text: string;
  missing: string[];
  turoUrl: string | null;
  overdue: boolean;
};

const pad = (value: number) => String(value).padStart(2, "0");

function formatWhen(iso: string, locale: Locale) {
  const d = new Date(iso);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (locale === "en") {
    return `${d.toLocaleString("en-CA", { month: "short", day: "numeric" })} ${time}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * The list's time column, the way a messaging app writes it: a time for
 * today, "yesterday", a weekday within the week, a date beyond that. A
 * full date on every row made a list of recent messages read as a log.
 */
function formatListTime(iso: string, locale: Locale, t: Copy) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return t.yesterday;
  if (now.getTime() - d.getTime() < 6 * 86_400_000) {
    return d.toLocaleDateString(locale === "en" ? "en-CA" : "zh-CN", { weekday: "short" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return locale === "en"
      ? d.toLocaleDateString("en-CA", { month: "short", day: "numeric" })
      : `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** The divider between days in a conversation. */
function formatDay(iso: string, locale: Locale, t: Copy) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return t.today;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return t.yesterday;
  return d.toLocaleDateString(locale === "en" ? "en-CA" : "zh-CN", {
    month: "short",
    day: "numeric",
    weekday: "short",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

const formatClock = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Hours from now, negative in the past. */
function hoursUntil(iso: string) {
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

/** The matched run, marked. Same treatment the calendar search uses. */
function highlight(value: string, query: string) {
  if (!query) return value;
  const index = value.toLowerCase().indexOf(query);
  if (index === -1) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="rounded bg-[rgba(255,231,122,0.72)] px-0.5 text-inherit">
        {value.slice(index, index + query.length)}
      </mark>
      {value.slice(index + query.length)}
    </>
  );
}

/**
 * Initials, coloured from the name.
 *
 * Turo only puts a guest's photo in the HTML part of a notification,
 * and the archive was ingested keeping the plain text alone -- so most
 * threads have no photo and never will. A lettered disc is stable per
 * guest, so the eye still uses it to tell one row from another.
 */
function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();

  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 360;

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `hsl(${hash} 55% 45%)` }}
    >
      {initials || "?"}
    </span>
  );
}

/** Where a trip stands, for the list row and the thread header. */
function tripStage(trip: Order | null | undefined, t: Copy) {
  if (!trip) return null;
  if (hoursUntil(trip.returnDatetime) < 0) return { label: t.tripEnded, at: null, live: false };
  if (hoursUntil(trip.pickupDatetime) > 0) return { label: t.pickupSoon, at: trip.pickupDatetime, live: true };
  return { label: t.returnSoon, at: trip.returnDatetime, live: true };
}

const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * Guest messages, laid out like a messaging app.
 *
 * On a phone there is one screen at a time: the list, or one
 * conversation. The page opens on the list -- it used to open inside the
 * first thread, so a phone never showed the list at all until someone
 * found the back link -- and opening a thread adds a history entry, so
 * the system back gesture returns to the list instead of leaving the
 * page. On a desktop the two sit side by side and the first thread
 * opens by itself.
 */
export function GuestMessagesView({
  locale,
  canDraft,
  threads,
  orders,
  conversations,
  messageTemplates,
  templateVehicleOptions,
}: {
  locale: Locale;
  canDraft: boolean;
  threads: Thread[];
  orders: Order[];
  /** Full conversations recorded off Turo (the browser reader or an
   *  agent), keyed by reservation. A thread without one falls back to
   *  the email-derived view: what the guest said, none of our replies. */
  conversations: Record<string, ConversationMessage[]>;
  messageTemplates: MessageTemplateRow[];
  templateVehicleOptions: MessageTemplateVehicleOption[];
}) {
  const messages = getMessages(locale);
  const t = messages.guestMessagesPage;
  const router = useRouter();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "scheduled">("all");
  const [rulesOpen, setRulesOpen] = useState(false);
  // Scheduled messages due now; see lib/message-rules. Fetched rather
  // than rendered with the page, because it changes as time passes.
  const [due, setDue] = useState<DueMessage[] | null>(null);
  const [dueBusy, setDueBusy] = useState<string | null>(null);
  async function loadDue() {
    try {
      const response = await fetch("/api/messages/scheduled");
      if (response.ok) setDue(((await response.json()) as { due: DueMessage[] }).due);
    } catch {
      // The queue is a convenience on this page; the threads still work.
    }
  }
  useEffect(() => {
    void loadDue();
  }, []);
  async function markDue(item: DueMessage, status: "sent" | "skipped") {
    setDueBusy(`${item.ruleId}:${item.orderId}`);
    try {
      const response = await fetch("/api/messages/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId: item.ruleId, orderId: item.orderId, status, text: item.text }),
      });
      if (response.ok) setDue(((await response.json()) as { due: DueMessage[] }).due);
    } finally {
      setDueBusy(null);
    }
  }
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [tripOpen, setTripOpen] = useState(false);
  // Whether the open thread put an entry on the history stack, so "back"
  // can pop it rather than stack another.
  const pushedHistory = useRef(false);
  const threadEnd = useRef<HTMLDivElement>(null);

  // Desktop opens the first thread; a phone starts on the list.
  useEffect(() => {
    if (window.matchMedia(DESKTOP_QUERY).matches && threads[0]) setSelectedKey(threads[0].key);
    // Once, on mount: afterwards the selection is the operator's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onPop() {
      if (!pushedHistory.current) return;
      pushedHistory.current = false;
      setSelectedKey(null);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Matched across everything a thread carries -- guest, car, plate,
  // and the text of every message in both languages. A guest who wrote
  // once about a parking spot is remembered by what they said.
  const normalizedSearch = search.trim().toLowerCase();
  const openThreadCount = useMemo(() => threads.filter((thread) => thread.openCount > 0).length, [threads]);
  const visibleThreads = useMemo(() => {
    return threads.filter((thread) => {
      if (filter === "open" && thread.openCount === 0) return false;
      if (!normalizedSearch) return true;
      return [
        thread.guestName,
        thread.vehicleLabel,
        thread.vehiclePlate,
        thread.latestSummary,
        thread.latestSummaryZh,
        ...thread.messages.flatMap((message) => [
          message.subject,
          message.guestText,
          message.summary,
          message.summaryZh,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [threads, normalizedSearch, filter]);
  const [acknowledging, setAcknowledging] = useState(false);

  // Per-message drafts, keyed by message id: switching threads must not
  // hand one guest the reply written for another.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [draftStartedAt, setDraftStartedAt] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [zh, setZh] = useState<Record<string, string>>({});
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  // Threads already asked for, so re-selecting one does not re-request
  // a translation that is already on screen.
  const [translatedKeys, setTranslatedKeys] = useState<Set<string>>(new Set());

  // Word-for-word or the gist. A preference about how someone reads,
  // not about one thread, so it is remembered in this browser.
  const [zhMode, setZhMode] = useState<"literal" | "brief">("literal");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("tato.zhMode");
      if (saved === "literal" || saved === "brief") setZhMode(saved);
    } catch {
      // Blocked storage: the default is fine.
    }
  }, []);
  function pickZhMode(mode: "literal" | "brief") {
    setZhMode(mode);
    try {
      window.localStorage.setItem("tato.zhMode", mode);
    } catch {
      // Not remembered, still switched.
    }
  }

  const ordersById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  const selected = threads.find((thread) => thread.key === selectedKey) ?? null;
  const order = selected?.orderId ? (ordersById.get(selected.orderId) ?? null) : null;
  function conversationFor(thread: Thread) {
    const trip = thread.orderId ? ordersById.get(thread.orderId) : null;
    return trip?.externalOrderId ? (conversations[trip.externalOrderId] ?? []) : [];
  }
  const conversation = selected ? conversationFor(selected) : [];

  // The Turo page for this conversation. The reservation's own messages
  // page when the trip is known -- it opens the Turo app on a phone --
  // and the notification's link otherwise.
  const turoUrl = order?.turoMessagesUrl ?? selected?.turoLink ?? null;

  // Translate on open rather than on request. The operator reads Chinese
  // and the guests write English; a button pressed every single time is
  // a chore, not a choice. Cached rows cost nothing.
  useEffect(() => {
    if (!selected || !canDraft) return;
    if (translatedKeys.has(selected.key)) return;
    const missing =
      selected.messages.some((message) => !zh[message.id] && !message.summaryZh && message.summary) ||
      conversationFor(selected).some((message) => !message.bodyZh && !zh[message.id]);
    if (!missing) return;
    void translateThread(selected);
    // translateThread only reads state through setters, and the key guard
    // stops a re-run loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key, canDraft]);

  // Land on the newest message, as any chat does. On a phone the page is
  // the scroller; on a desktop it is the pane -- scrollIntoView handles
  // both.
  useEffect(() => {
    if (!selected) return;
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [selected?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectThread(key: string) {
    if (!window.matchMedia(DESKTOP_QUERY).matches && !pushedHistory.current) {
      window.history.pushState({ tatoThread: key }, "");
      pushedHistory.current = true;
    }
    setSelectedKey(key);
    setTripOpen(false);
    setDraftError(null);
    setTranslateError(null);
    setCopiedId(null);
  }

  function backToList() {
    if (pushedHistory.current) {
      // popstate clears the selection.
      window.history.back();
      return;
    }
    setSelectedKey(null);
  }

  /** The Chinese reading of an email message, from this session or the cache. */
  function chinese(message: ThreadMessage) {
    // In brief mode the summary is the answer, with no falling back to
    // the literal: swapping one for the other silently would make the
    // toggle look broken rather than empty.
    if (zhMode === "brief") return message.summaryZhBrief;
    return zh[message.id] ?? message.summaryZh ?? null;
  }

  async function translateThread(thread: Thread) {
    if (translating) return;
    setTranslating(true);
    setTranslateError(null);
    try {
      const response = await fetch("/api/messages/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailIds: thread.messages.map((m) => m.id),
          // The recorded conversation as well, which is the only place
          // our own replies exist -- and so the only way they get Chinese.
          conversationIds: conversationFor(thread)
            .filter((message) => !message.bodyZh && !zh[message.id])
            .map((message) => message.id),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        translations?: Record<string, string>;
        error?: string;
        reason?: string;
      };
      if (!response.ok) {
        setTranslateError(
          `${t.translateFailed}${data.reason ? ` (${data.reason})` : data.error ? ` (${data.error})` : ""}`,
        );
        return;
      }
      setZh((current) => ({ ...current, ...(data.translations ?? {}) }));
      setTranslatedKeys((current) => new Set(current).add(thread.key));
    } catch {
      setTranslateError(t.translateFailed);
    } finally {
      setTranslating(false);
    }
  }

  async function draftFor(message: ThreadMessage) {
    if (!selected || draftingId) return;
    setDraftingId(message.id);
    setDraftStartedAt(Date.now());
    setDraftError(null);
    try {
      const response = await fetch("/api/messages/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailIds: selected.messages.map((m) => m.id),
          guestName: selected.guestName,
          vehicleId: selected.vehicleId,
          emailId: message.id,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        draft?: string;
        error?: string;
        reason?: string;
      };
      if (!response.ok || !data.draft) {
        setDraftError(
          `${t.draftFailed}${data.reason ? ` (${data.reason})` : data.error ? ` (${data.error})` : ""}`,
        );
        return;
      }
      setDrafts((current) => ({ ...current, [message.id]: data.draft as string }));
      requestAnimationFrame(() => threadEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" }));
    } catch {
      setDraftError(t.draftFailed);
    } finally {
      setDraftingId(null);
    }
  }

  async function copy(id: string, text: string) {
    await navigator.clipboard.writeText(text).catch(() => null);
    setCopiedId(id);
  }

  async function markHandled() {
    if (!selected || acknowledging) return;
    setAcknowledging(true);
    try {
      await fetch("/api/messages/acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailIds: selected.messages.filter((m) => !m.acknowledgedAt).map((m) => m.id),
        }),
      });
      router.refresh();
    } finally {
      setAcknowledging(false);
    }
  }

  // Opened from a conversation, templates fill in from it and know what
  // was already said in it.
  const templateContext: MessageTemplateContext | null = selected
    ? {
        title: [selected.guestName, selected.vehiclePlate ?? selected.vehicleLabel].filter(Boolean).join(" · "),
        vehicleId: selected.vehicleId,
        values: {
          guest: order?.renterName ?? selected.guestName,
          car: order?.vehicleName ?? selected.vehicleLabel,
          plate: order?.plateNumber ?? selected.vehiclePlate,
          pickup: order?.pickupDatetime ?? null,
          return: order?.returnDatetime ?? null,
          pickupLocation: order?.pickupLocation ?? null,
          returnLocation: order?.returnLocation ?? null,
          reservation: order?.externalOrderId ?? null,
          pickupCode: order?.pickupCode ?? null,
        },
        sentMessages: conversation
          .filter((message) => message.direction === "outbound")
          .map((message) => message.body),
      }
    : null;

  const templatesPanel = (
    <>
      {templatesOpen ? (
        <MessageTemplatePanel
          locale={locale}
          templates={messageTemplates}
          vehicleOptions={templateVehicleOptions}
          onClose={() => setTemplatesOpen(false)}
          context={templateContext}
        />
      ) : null}
      {alertsOpen ? <GuestMessageAlertPanel locale={locale} onClose={() => setAlertsOpen(false)} /> : null}
      {rulesOpen ? (
        <MessageRulesPanel
          locale={locale}
          templates={messageTemplates}
          vehicleOptions={templateVehicleOptions}
          onClose={() => setRulesOpen(false)}
          onChanged={() => void loadDue()}
        />
      ) : null}
    </>
  );

  if (threads.length === 0) {
    return (
      <>
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center">
          <p className="text-[13px] text-[var(--ink-soft)]">{t.empty}</p>
        </section>
        {templatesPanel}
      </>
    );
  }

  // The reply is written to the newest message: that is the one waiting.
  const latestEmail = selected?.messages[0] ?? null;
  const draft = latestEmail ? drafts[latestEmail.id] : undefined;
  const stage = tripStage(order, t);
  const hasComposer = Boolean(
    selected &&
      (draft !== undefined ||
        draftError ||
        (latestEmail && canDraft) ||
        selected.openCount > 0 ||
        !turoUrl ||
        messageTemplates.length > 0),
  );

  // One stream, oldest first. The recorded conversation when there is
  // one -- it has both sides -- and the guest's emailed messages when
  // there is not.
  const stream: {
    id: string;
    at: string;
    outbound: boolean;
    body: string;
    chinese: string | null;
    open: boolean;
  }[] = selected
    ? conversation.length > 0
      ? conversation.map((message) => ({
          id: message.id,
          at: message.sentAt,
          outbound: message.direction === "outbound",
          body: message.body,
          chinese: message.bodyZh ?? zh[message.id] ?? null,
          open: false,
        }))
      : [...selected.messages].reverse().map((message) => ({
          id: message.id,
          at: message.receivedAt,
          outbound: false,
          body: message.guestText ?? message.summary ?? message.subject ?? "",
          chinese: chinese(message),
          open: !message.acknowledgedAt,
        }))
    : [];

  const tripDetails: { label: string; value: ReactNode }[] = order
    ? [
        { label: t.tripVehicle, value: order.vehicleLabel },
        {
          label: t.tripPlate,
          value: order.plateUnconfirmed
            ? `${order.plateNumber ?? t.noValue} · ${t.tripPlateUnconfirmed}`
            : order.plateNumber,
        },
        { label: t.tripStatus, value: order.status },
        {
          label: t.tripPhone,
          value: order.renterPhone ? (
            <a href={`tel:${order.renterPhone}`} className="text-[var(--brand)] underline underline-offset-2">
              {order.renterPhone}
            </a>
          ) : null,
        },
        { label: t.tripReservation, value: order.externalOrderId },
        { label: t.tripPickupAddress, value: order.pickupLocation },
        { label: t.tripReturnAddress, value: order.returnLocation },
      ]
    : [];

  const unmatchedWhy = selected?.unmatchedReason
    ? selected.unmatchedReason.kind === "noVehicleText"
      ? t.tripWhyNoVehicleText
      : selected.unmatchedReason.kind === "noSuchVehicle"
        ? `${t.tripWhyNoSuchVehicle(selected.unmatchedReason.vehicleText)}${
            selected.unmatchedReason.nearest.length > 0
              ? ` ${t.tripWhyNearest(selected.unmatchedReason.nearest.join("、"))}`
              : ""
          }`
        : selected.unmatchedReason.kind === "severalVehicles"
          ? t.tripWhySeveralVehicles(selected.unmatchedReason.vehicleText, selected.unmatchedReason.count)
          : t.tripWhyNoTripInWindow(selected.unmatchedReason.vehicleText)
    : null;

  return (
    <>
      <div className="lg:grid lg:h-[calc(100dvh-2rem)] lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-3">
        {/* ── The list ─────────────────────────────────────────── */}
        <section
          aria-label={messages.shell.nav.guestMessages}
          className={`min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] lg:flex ${
            selected ? "hidden" : "flex"
          }`}
        >
          <div className="grid gap-2 border-b border-[var(--line)] p-2.5">
            <div className="flex items-center gap-2">
              <label className="relative min-w-0 flex-1">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-soft)]"
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t.searchPlaceholder}
                  aria-label={t.searchPlaceholder}
                  className="h-10 w-full rounded-full border border-[var(--line)] bg-[var(--surface-muted)] pl-9 pr-3 text-[14px] outline-none focus:border-[var(--line-strong)] lg:h-9 lg:text-[13px]"
                />
              </label>
              {/* Canned replies live behind their own sheet: reached for
                  now and then, not read continuously. */}
              <button
                type="button"
                onClick={() => setTemplatesOpen(true)}
                title={t.templatesButton}
                aria-label={t.templatesButton}
                className="tap-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)] lg:h-9 lg:w-9"
              >
                <LayoutTemplate className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setAlertsOpen(true)}
                title={t.alertsButton}
                aria-label={t.alertsButton}
                className="tap-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)] lg:h-9 lg:w-9"
              >
                <Bell className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="flex items-center gap-1.5" role="tablist">
              {(["all", "open", "scheduled"] as const).map((value) => {
                const active = filter === value;
                const count =
                  value === "all" ? threads.length : value === "open" ? openThreadCount : (due?.length ?? 0);
                return (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFilter(value)}
                    className={`tap-press rounded-full px-3 py-1 text-[12px] font-semibold tabular-nums transition ${
                      active
                        ? "bg-[var(--ink)] text-white"
                        : "bg-[var(--surface-muted)] text-[var(--ink-mid)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {value === "all" ? t.filterAll : value === "open" ? t.filterOpen : t.filterScheduled} {count}
                  </button>
                );
              })}
              {normalizedSearch ? (
                <span className="ml-auto text-[11px] text-[var(--ink-soft)]">
                  {t.searchCount(visibleThreads.length)}
                </span>
              ) : null}
            </div>
          </div>

          {filter === "scheduled" ? (
            <ScheduledQueue
              due={due}
              busyKey={dueBusy}
              t={t}
              locale={locale}
              onMark={markDue}
              onOpenRules={() => setRulesOpen(true)}
            />
          ) : visibleThreads.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-[var(--ink-soft)]">
              {filter === "open" && !normalizedSearch ? t.noOpen : t.searchCount(0)}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 lg:overflow-y-auto">
              {visibleThreads.map((thread) => {
                const open = thread.openCount > 0;
                const trip = thread.orderId ? ordersById.get(thread.orderId) : null;
                const rowStage = tripStage(trip, t);
                const preview =
                  thread.latestSummaryZh ?? thread.latestSummary ?? thread.messages[0]?.subject ?? "";
                const car = `${thread.vehicleLabel ?? t.noVehicle}${thread.vehiclePlate ? ` · ${thread.vehiclePlate}` : ""}`;
                return (
                  <li key={thread.key} className="border-b border-[var(--line)] last:border-b-0">
                    <button
                      type="button"
                      onClick={() => selectThread(thread.key)}
                      aria-current={thread.key === selectedKey ? "true" : undefined}
                      className={`tap-press flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-[var(--surface-muted)] ${
                        thread.key === selectedKey ? "lg:bg-[var(--surface-muted)]" : ""
                      }`}
                    >
                      <Avatar name={thread.guestName} src={thread.avatarUrl} size={44} />
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={`truncate text-[15px] text-[var(--ink)] lg:text-[14px] ${open ? "font-bold" : "font-semibold"}`}
                          >
                            {highlight(thread.guestName, normalizedSearch)}
                          </span>
                          <span
                            className={`shrink-0 text-[11.5px] tabular-nums ${open ? "font-semibold text-[var(--brand)]" : "text-[var(--ink-soft)]"}`}
                          >
                            {formatListTime(thread.latestAt, locale, t)}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span
                            className={`line-clamp-1 min-w-0 flex-1 text-[13px] leading-5 ${open ? "font-medium text-[var(--ink)]" : "text-[var(--ink-mid)]"}`}
                          >
                            {highlight(preview, normalizedSearch)}
                          </span>
                          {open ? (
                            <span
                              aria-label={`${t.openBadge} ${thread.openCount}`}
                              className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold tabular-nums text-white"
                            >
                              {thread.openCount}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--ink-soft)]">
                          <span className="truncate">{highlight(car, normalizedSearch)}</span>
                          {rowStage?.live ? (
                            <span className="shrink-0 rounded-full bg-[var(--brand-soft)] px-1.5 py-px text-[10.5px] font-semibold text-[var(--brand)]">
                              {rowStage.label}
                              {rowStage.at ? ` ${formatListTime(rowStage.at, locale, t)}` : ""}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── One conversation ─────────────────────────────────── */}
        {selected ? (
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] lg:overflow-y-auto">
            {/* Who, which car, and the trip in one line -- pinned, so the
                facts stay in view while reading. The rest of the trip is
                one tap away instead of a nine-cell grid above the chat. */}
            <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--surface)]/95 backdrop-blur">
              <div className="flex items-center gap-2 px-2 py-2 sm:px-3">
                <button
                  type="button"
                  onClick={backToList}
                  aria-label={messages.shell.nav.guestMessages}
                  className="tap-press -ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink)] hover:bg-[var(--surface-muted)] lg:hidden"
                >
                  <ChevronLeft className="h-6 w-6" aria-hidden />
                </button>
                <Avatar name={selected.guestName} src={selected.avatarUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[15px] font-bold leading-5 text-[var(--ink)]">
                    {selected.guestName}
                  </h2>
                  <p className="truncate text-[12px] leading-4 text-[var(--ink-soft)]">
                    {selected.vehicleLabel ?? t.noVehicle}
                    {selected.vehiclePlate ? ` · ${selected.vehiclePlate}` : ""}
                  </p>
                </div>
                {turoUrl ? (
                  <a
                    href={turoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t.replyOnTuroHint}
                    className="tap-press flex h-9 shrink-0 items-center gap-1 rounded-full bg-[var(--brand)] px-3.5 text-[13px] font-bold text-white transition hover:opacity-90"
                  >
                    {t.replyOnTuroShort}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => setTripOpen((value) => !value)}
                aria-expanded={tripOpen}
                className="tap-press flex w-full items-center gap-2 border-t border-[var(--line)] px-3 py-1.5 text-left text-[12px] text-[var(--ink-mid)] hover:bg-[var(--surface-muted)]"
              >
                {order ? (
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    {stage ? (
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-semibold ${
                          stage.live
                            ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                            : "bg-[var(--surface-muted)] text-[var(--ink-soft)]"
                        }`}
                      >
                        {stage.label}
                      </span>
                    ) : null}
                    <span className="truncate tabular-nums">
                      {formatWhen(order.pickupDatetime, locale)} → {formatWhen(order.returnDatetime, locale)}
                      {order.netEarning != null ? ` · CA$${order.netEarning.toFixed(2)}` : ""}
                    </span>
                  </span>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-amber-800">{t.tripNone}</span>
                )}
                <span className="shrink-0 text-[11.5px] font-semibold text-[var(--ink-soft)]">{t.tripMore}</span>
                <ChevronDown
                  aria-hidden
                  className={`h-4 w-4 shrink-0 text-[var(--ink-soft)] transition ${tripOpen ? "rotate-180" : ""}`}
                />
              </button>

              {tripOpen ? (
                <div className="border-t border-[var(--line)] px-3 py-2.5">
                  {order ? (
                    <>
                      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
                        {tripDetails.map((row) => (
                          <Fragment key={row.label}>
                            <dt className="text-[var(--ink-soft)]">{row.label}</dt>
                            <dd className="min-w-0 break-words font-medium text-[var(--ink)]">
                              {row.value ?? t.noValue}
                            </dd>
                          </Fragment>
                        ))}
                      </dl>
                      <Link
                        href={`/orders/${order.id}`}
                        className="mt-2 inline-flex text-[12.5px] font-bold text-[var(--brand)] underline underline-offset-2"
                      >
                        {t.tripOpen}
                      </Link>
                      {selected.vehicleId ? (
                        <CarNotesEditor key={selected.vehicleId} vehicleId={selected.vehicleId} t={t} />
                      ) : null}
                    </>
                  ) : (
                    <div className="grid gap-2 text-[12px] leading-5">
                      <p className="text-[var(--ink-soft)]">{t.tripNoneCopy}</p>
                      {/* What happened here, specifically: a car missing
                          from the fleet and two cars of one model want
                          opposite fixes. */}
                      {unmatchedWhy ? (
                        <p className="rounded-md bg-[var(--surface-muted)] px-3 py-2 text-[var(--ink)]">{unmatchedWhy}</p>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </header>

            {/* Chinese under each bubble: word for word, or the gist. */}
            <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--ink-soft)]">
                {translating ? <InlineSpinner className="h-3 w-3" /> : null}
                {translating ? t.autoTranslating : t.messageCount(stream.length)}
              </span>
              <span className="inline-flex rounded-full bg-[var(--surface-muted)] p-0.5" title={t.zhModeHint}>
                {(["literal", "brief"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => pickZhMode(mode)}
                    className={`tap-press rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                      zhMode === mode ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm" : "text-[var(--ink-soft)]"
                    }`}
                  >
                    {mode === "literal" ? t.zhModeLiteral : t.zhModeSummary}
                  </button>
                ))}
              </span>
            </div>

            {translateError ? <p className="px-3 pt-2 text-[12px] text-rose-600">{translateError}</p> : null}

            <ol className="grid gap-2 px-3 py-3">
              {stream.map((item, index) => {
                const newDay = index === 0 || !sameDay(new Date(stream[index - 1].at), new Date(item.at));
                return (
                  <Fragment key={item.id}>
                    {newDay ? (
                      <li className="my-1 flex justify-center" aria-hidden>
                        <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-soft)]">
                          {formatDay(item.at, locale, t)}
                        </span>
                      </li>
                    ) : null}
                    <li className={`flex items-end gap-2 ${item.outbound ? "justify-end" : ""}`}>
                      {!item.outbound ? <Avatar name={selected.guestName} src={selected.avatarUrl} size={26} /> : null}
                      <div className={`grid max-w-[82%] gap-0.5 ${item.outbound ? "justify-items-end" : ""}`}>
                        <div
                          className={`rounded-2xl px-3.5 py-2 ${
                            item.outbound
                              ? "rounded-br-md bg-[var(--brand)] text-white"
                              : "rounded-bl-md bg-[var(--surface-muted)] text-[var(--ink)]"
                          }`}
                        >
                          {/* Marked here too: a search can match a thread
                              on words that only exist inside a message. */}
                          <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.45]">
                            {highlight(item.body, normalizedSearch)}
                          </p>
                          {item.chinese ? (
                            <p
                              className={`mt-1.5 border-t pt-1.5 text-[13.5px] leading-[1.45] ${
                                item.outbound ? "border-white/25 text-white/85" : "border-[var(--line)] text-[var(--ink-mid)]"
                              }`}
                            >
                              {highlight(item.chinese, normalizedSearch)}
                            </p>
                          ) : null}
                        </div>
                        <span className="flex items-center gap-1.5 px-1 text-[10.5px] tabular-nums text-[var(--ink-soft)]">
                          {item.open ? (
                            <span className="font-semibold text-rose-600">{t.openBadge}</span>
                          ) : null}
                          {formatClock(item.at)}
                        </span>
                      </div>
                    </li>
                  </Fragment>
                );
              })}
            </ol>

            {/* The reply. Written here, sent on Turo: TATO has no way to
                send a Turo message, so the draft is copied and the Turo
                conversation opened. Left out when there is nothing to do
                here, rather than drawn as an empty bar. */}
            {hasComposer ? (
            <div className="mt-auto grid gap-2 border-t border-[var(--line)] bg-[var(--surface)] px-3 py-3">
              {draft !== undefined && latestEmail ? (
                <div className="flex justify-end">
                  <div className="w-[88%] rounded-2xl rounded-br-md bg-[var(--brand)] px-3.5 py-2">
                    <p className="text-[10.5px] font-semibold text-white/75">{t.draftTitle}</p>
                    <textarea
                      value={draft}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [latestEmail.id]: event.target.value }))
                      }
                      rows={4}
                      aria-label={t.draftTitle}
                      className="mt-1 w-full resize-y bg-transparent text-[14px] leading-[1.45] text-white outline-none"
                    />
                  </div>
                </div>
              ) : null}
              {/* Where the draft will appear, while the model writes it:
                  a reply can take twenty seconds, and a button that only
                  says "drafting" for that long reads as stuck. */}
              {latestEmail && draftingId === latestEmail.id && draft === undefined ? (
                <div className="flex justify-end">
                  <div className="rounded-2xl rounded-br-md bg-[var(--brand)] px-3.5 py-2.5 text-white">
                    <TypingDots startedAt={draftStartedAt} locale={locale === "en" ? "en" : "zh"} />
                  </div>
                </div>
              ) : null}
              {draftError ? <p className="text-[12px] text-rose-600">{draftError}</p> : null}

              <div className="flex flex-wrap items-center gap-2">
                {/* Here as well as above the list: on a phone the list is
                    hidden while a conversation is open, and this is
                    where a template is wanted -- filled for this guest. */}
                {messageTemplates.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTemplatesOpen(true)}
                    className="tap-press flex h-9 items-center gap-1.5 rounded-full border border-[var(--line)] px-3.5 text-[13px] font-semibold text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)]"
                  >
                    <LayoutTemplate className="h-4 w-4" aria-hidden />
                    {t.templatesShort}
                  </button>
                ) : null}
                {draft !== undefined && latestEmail ? (
                  <button
                    type="button"
                    onClick={() => copy(latestEmail.id, draft)}
                    className="tap-press h-9 rounded-full bg-[var(--ink)] px-4 text-[13px] font-bold text-white transition hover:opacity-90"
                  >
                    {copiedId === latestEmail.id ? t.draftCopied : t.draftCopyButton}
                  </button>
                ) : latestEmail && canDraft ? (
                  <button
                    type="button"
                    onClick={() => draftFor(latestEmail)}
                    disabled={draftingId !== null}
                    className="tap-press inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--ink)] px-4 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    {draftingId ? <InlineSpinner /> : null}
                    {draftingId ? t.draftingOne : t.draftOne}
                  </button>
                ) : null}
                {draft !== undefined && latestEmail && canDraft ? (
                  <button
                    type="button"
                    onClick={() => draftFor(latestEmail)}
                    disabled={draftingId !== null}
                    className="tap-press inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--line)] px-3.5 text-[13px] font-semibold text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
                  >
                    {draftingId ? <InlineSpinner /> : null}
                    {draftingId ? t.draftingOne : t.draftAgain}
                  </button>
                ) : null}
                {selected.openCount > 0 ? (
                  <button
                    type="button"
                    onClick={markHandled}
                    disabled={acknowledging}
                    className="tap-press ml-auto h-9 rounded-full border border-[var(--line)] px-3.5 text-[13px] font-semibold text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
                  >
                    {acknowledging ? t.markingHandled : t.markHandled}
                  </button>
                ) : null}
              </div>
              {!turoUrl ? <p className="text-[11.5px] text-[var(--ink-soft)]">{t.noTuroLink}</p> : null}
            </div>
            ) : null}
            <div ref={threadEnd} />
          </section>
        ) : (
          <section className="hidden items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center lg:flex">
            <p className="text-[13px] text-[var(--ink-soft)]">{t.emptyThread}</p>
          </section>
        )}
      </div>
      {templatesPanel}
    </>
  );
}

/**
 * What the AI may tell guests about this car, edited where it is needed:
 * beside a conversation about it. Loaded on first open, one car at a time.
 */
function CarNotesEditor({ vehicleId, t }: { vehicleId: string; t: Copy }) {
  const [content, setContent] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/messages/vehicle-knowledge?vehicleId=${encodeURIComponent(vehicleId)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { content: string }) => {
        if (!alive) return;
        setContent(data.content);
        setSaved(data.content);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [vehicleId]);

  async function save() {
    if (content == null) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/messages/vehicle-knowledge", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId, content }),
      });
      if (!response.ok) throw new Error();
      setSaved(content);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 grid gap-1.5 border-t border-[var(--line)] pt-2.5">
      <label htmlFor={`car-notes-${vehicleId}`} className="text-[12px] font-bold text-[var(--ink)]">
        {t.carNotesTitle}
      </label>
      <p className="text-[11.5px] leading-4 text-[var(--ink-soft)]">{t.carNotesHint}</p>
      <textarea
        id={`car-notes-${vehicleId}`}
        value={content ?? ""}
        disabled={content == null}
        onChange={(event) => setContent(event.target.value)}
        rows={3}
        maxLength={1500}
        placeholder={t.carNotesPlaceholder}
        className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-2 text-[13px] leading-5 outline-none focus:border-[var(--line-strong)]"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || content == null || content === saved}
          className="tap-press h-8 rounded-full bg-[var(--ink)] px-3.5 text-[12px] font-bold text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? t.carNotesSaving : content != null && content === saved && saved ? t.carNotesSaved : t.carNotesSave}
        </button>
        {failed ? <span className="text-[12px] text-rose-600">{t.carNotesFailed}</span> : null}
      </div>
    </div>
  );
}

/**
 * Scheduled messages that have fallen due, each filled in for its trip:
 * copy, send on Turo, mark sent -- or skip. Marking is what takes one
 * off the list and keeps the record.
 */
function ScheduledQueue({
  due,
  busyKey,
  t,
  locale,
  onMark,
  onOpenRules,
}: {
  due: DueMessage[] | null;
  busyKey: string | null;
  t: Copy;
  locale: Locale;
  onMark: (item: DueMessage, status: "sent" | "skipped") => void;
  onOpenRules: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="min-h-0 flex-1 lg:overflow-y-auto">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="text-[12px] text-[var(--ink-soft)]">{t.scheduledIntro}</p>
        <button
          type="button"
          onClick={onOpenRules}
          className="tap-press shrink-0 rounded-full border border-[var(--line)] px-3 py-1 text-[12px] font-semibold text-[var(--ink-mid)] hover:bg-[var(--surface-muted)]"
        >
          {t.scheduledRules}
        </button>
      </div>
      {due == null ? null : due.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-[var(--ink-soft)]">{t.scheduledEmpty}</p>
      ) : (
        <ul className="grid gap-2 px-3 pb-3">
          {due.map((item) => {
            const key = `${item.ruleId}:${item.orderId}`;
            return (
              <li key={key} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <p className="text-[13.5px] font-semibold text-[var(--ink)]">
                    {item.renterName} <span className="font-normal text-[var(--ink-soft)]">· {item.vehicleLabel}</span>
                  </p>
                  <span className={`text-[11.5px] tabular-nums ${item.overdue ? "font-semibold text-rose-600" : "text-[var(--ink-soft)]"}`}>
                    {item.ruleName} · {formatWhen(item.dueAt, locale)}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap break-words rounded-md bg-[var(--surface-muted)] px-2.5 py-2 text-[13px] leading-5 text-[var(--ink)]">
                  {item.text}
                </p>
                {item.missing.length > 0 ? (
                  <p className="mt-1 text-[11.5px] text-amber-700">
                    {t.scheduledMissing(item.missing.map((key) => `{{${key}}}`).join("、"))}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(item.text).catch(() => null);
                      setCopied(key);
                    }}
                    className="tap-press h-8 rounded-full bg-[var(--ink)] px-3.5 text-[12px] font-bold text-white hover:opacity-90"
                  >
                    {copied === key ? t.draftCopied : t.draftCopyButton}
                  </button>
                  {item.turoUrl ? (
                    <a
                      href={item.turoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tap-press flex h-8 items-center gap-1 rounded-full bg-[var(--brand)] px-3.5 text-[12px] font-bold text-white hover:opacity-90"
                    >
                      Turo <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onMark(item, "sent")}
                    disabled={busyKey === key}
                    className="tap-press ml-auto h-8 rounded-full border border-[var(--line)] px-3.5 text-[12px] font-semibold text-[var(--ink)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                  >
                    {t.scheduledSent}
                  </button>
                  <button
                    type="button"
                    onClick={() => onMark(item, "skipped")}
                    disabled={busyKey === key}
                    className="tap-press h-8 rounded-full px-2.5 text-[12px] font-semibold text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50"
                  >
                    {t.scheduledSkip}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
