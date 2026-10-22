"use client";

import Link from "next/link";
import {
  Bell,
  BookText,
  Check,
  ChevronDown,
  ChevronLeft,
  Copy as CopyIcon,
  ExternalLink,
  Languages,
  LayoutTemplate,
  MoreHorizontal,
  PenLine,
  Search,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { MobileIconButton, MobilePageHeader } from "@/components/mobile-chrome";
import { MessageRulesPanel } from "@/components/message-rules-panel";
import {
  MessageTemplatePanel,
  suggestTemplates,
  type MessageTemplateContext,
  type MessageTemplateRow,
  type MessageTemplateVehicleOption,
} from "@/components/message-template-panel";
import { InlineSpinner, TypingDots } from "@/components/turo-task-progress";
import { getMessages, type Locale } from "@/lib/i18n";
import { mergeGuestConversation } from "@/lib/guest-conversation";
import { tripStageAt, type KnowledgeEntry } from "@/lib/message-knowledge";
import { renderTemplate } from "@/lib/message-placeholders";
import { SEARCH_FIELD_PROPS } from "@/lib/search-field-props";

type ThreadMessage = {
  id: string;
  subject: string;
  guestText: string | null;
  receivedAt: string;
  acknowledgedAt: string | null;
  readAt?: string | null;
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
  unreadCount: number;
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
  /** Recorded by staff per trip: exact spot, and how to get in. */
  pickupSpot?: string | null;
  returnSpot?: string | null;
  handoverNote?: string | null;
  status: string;
  netEarning: number | null;
  vehicleLabel: string | null;
  /** turo.com's page for this reservation's messages. A plain https
   *  link, which a phone with the Turo app opens in the app. */
  turoMessagesUrl?: string | null;
  vehicleName?: string | null;
  pickupCode?: string | null;
};

/** One page of conversations, as the page renders and /api/messages/threads returns. */
type Page = {
  threads: Thread[];
  orders: Order[];
  /** Full conversations recorded off Turo (the browser reader or an
   *  agent), keyed by reservation. A thread without one falls back to
   *  the email-derived view: what the guest said, none of our replies. */
  conversations: Record<string, ConversationMessage[]>;
  /** Where the next page starts; null on the last one. */
  nextCursor: string | null;
};

/**
 * Pages joined into one list, newest page first.
 *
 * A conversation that spans a page boundary arrives in parts and is put
 * back together by its key. The newest page's copy of a thread wins --
 * it is the fresher read, and the one that knows which threads are
 * already answered -- and older pages only add messages it does not
 * have.
 */
function mergePages(pages: Page[]) {
  const byKey = new Map<string, Thread>();
  const orders = new Map<string, Order>();
  const conversations: Record<string, ConversationMessage[]> = {};

  for (const page of pages) {
    for (const thread of page.threads) {
      const have = byKey.get(thread.key);
      if (!have) {
        byKey.set(thread.key, thread);
        continue;
      }
      const ids = new Set(have.messages.map((message) => message.id));
      const extra = thread.messages.filter((message) => !ids.has(message.id));
      if (extra.length === 0) continue;
      const orderId = have.orderId ?? thread.orderId;
      byKey.set(thread.key, {
        ...have,
        messages: [...have.messages, ...extra].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
        openCount: have.openCount + extra.filter((message) => !message.acknowledgedAt).length,
        unreadCount: have.unreadCount + extra.filter((message) => !message.acknowledgedAt && !message.readAt).length,
        vehicleLabel: have.vehicleLabel ?? thread.vehicleLabel,
        vehiclePlate: have.vehiclePlate ?? thread.vehiclePlate,
        avatarUrl: have.avatarUrl ?? thread.avatarUrl,
        turoLink: have.turoLink ?? thread.turoLink,
        orderId,
        unmatchedReason: orderId ? null : have.unmatchedReason,
      });
    }
    for (const order of page.orders) if (!orders.has(order.id)) orders.set(order.id, order);
    for (const [reservationId, list] of Object.entries(page.conversations)) {
      const have = conversations[reservationId];
      if (!have) {
        conversations[reservationId] = list;
        continue;
      }
      const ids = new Set(have.map((message) => message.id));
      conversations[reservationId] = [...have, ...list.filter((message) => !ids.has(message.id))].sort((a, b) =>
        a.sentAt.localeCompare(b.sentAt),
      );
    }
  }

  // The order `groupIntoThreads` uses: anything open first, then newest.
  const threads = [...byKey.values()].sort((a, b) => {
    if ((a.openCount > 0) !== (b.openCount > 0)) return a.openCount > 0 ? -1 : 1;
    return b.latestAt.localeCompare(a.latestAt);
  });
  return { threads, orders: [...orders.values()], conversations };
}

type Copy = ReturnType<typeof getMessages>["guestMessagesPage"];

/**
 * Put text on the clipboard. The Clipboard API is refused in some
 * places a phone opens TATO from (an embedded browser, a page not yet
 * trusted), so a hidden field and the old copy command stand in.
 */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  }
}

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
  firstPage,
  messageTemplates,
  templateVehicleOptions,
  library,
  vehicleLabels,
}: {
  locale: Locale;
  canDraft: boolean;
  /** The newest conversations; older pages load on request. */
  firstPage: Page;
  /** For the scheduled-message rules, which pick a template by name. */
  messageTemplates: MessageTemplateRow[];
  templateVehicleOptions: MessageTemplateVehicleOption[];
  /** The AI message library, for the composer's template picker. */
  library: KnowledgeEntry[];
  vehicleLabels: Record<string, string>;
}) {
  const messages = getMessages(locale);
  const t = messages.guestMessagesPage;
  const router = useRouter();

  // Older conversations, a page at a time, only when asked for: ten
  // years of history loaded at once would make this page slow for
  // everyone who opens it.
  const [olderPages, setOlderPages] = useState<Page[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  // A refresh (after "mark handled") brings a new first page whose
  // window has moved forward; the one it replaces is kept as an older
  // page, or the messages that slid out of the window would vanish from
  // a list that had already gone past them.
  const previousFirst = useRef(firstPage);
  useEffect(() => {
    if (previousFirst.current === firstPage) return;
    const replaced = previousFirst.current;
    previousFirst.current = firstPage;
    setOlderPages((pages) => (pages.length > 0 ? [replaced, ...pages] : pages));
  }, [firstPage]);
  const { threads, orders, conversations } = useMemo(
    () => mergePages([firstPage, ...olderPages]),
    [firstPage, olderPages],
  );
  const nextCursor = olderPages.length > 0 ? olderPages[olderPages.length - 1].nextCursor : firstPage.nextCursor;
  async function loadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    setOlderFailed(false);
    try {
      const response = await fetch(`/api/messages/threads?cursor=${encodeURIComponent(nextCursor)}`);
      if (!response.ok) throw new Error(String(response.status));
      const page = (await response.json()) as Page;
      setOlderPages((pages) => [...pages, page]);
    } catch {
      setOlderFailed(true);
    } finally {
      setLoadingOlder(false);
    }
  }

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Messages opened since the page loaded, so the badge clears at once
  // instead of on the next refresh.
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const unreadIn = useCallback(
    (thread: Thread) =>
      thread.messages.filter((message) => !message.acknowledgedAt && !message.readAt && !readIds.has(message.id))
        .length,
    [readIds],
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "today" | "scheduled">("all");
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
  const [tripOpen, setTripOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [turoLinkCopied, setTuroLinkCopied] = useState(false);
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

  // `/messages?order=<id>` opens that trip's conversation -- how the
  // calendar's order card hands over to the guest.
  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get("order");
    if (!orderId) return;
    const thread = threads.find((item) => item.orderId === orderId);
    if (thread) setSelectedKey(thread.key);
    // Once, on mount, like the desktop default above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On a phone an open conversation covers the page; the page under it
  // must not scroll along with the chat.
  useEffect(() => {
    if (!selectedKey || window.matchMedia(DESKTOP_QUERY).matches) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [selectedKey]);

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
  const ordersById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  // Conversations whose car changes hands today: the ones most likely to
  // need an answer within the hour.
  const handoverToday = useMemo(() => {
    const today = new Date();
    const keys = new Set<string>();
    for (const thread of threads) {
      const trip = thread.orderId ? ordersById.get(thread.orderId) : null;
      if (!trip) continue;
      if (sameDay(new Date(trip.pickupDatetime), today) || sameDay(new Date(trip.returnDatetime), today)) {
        keys.add(thread.key);
      }
    }
    return keys;
  }, [threads, ordersById]);
  const visibleThreads = useMemo(() => {
    return threads.filter((thread) => {
      if (filter === "open" && thread.openCount === 0) return false;
      if (filter === "today" && !handoverToday.has(thread.key)) return false;
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
  }, [threads, normalizedSearch, filter, handoverToday]);
  const [acknowledging, setAcknowledging] = useState(false);

  // The reply being written, per conversation: switching threads must
  // not hand one guest the words meant for another.
  const [composerTexts, setComposerTexts] = useState<Record<string, string>>({});
  const [aiBusy, setAiBusy] = useState<null | "draft" | "rewrite" | "translate">(null);
  const [aiStartedAt, setAiStartedAt] = useState(0);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeNote, setComposeNote] = useState<string | null>(null);

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

  const selected = threads.find((thread) => thread.key === selectedKey) ?? null;

  // Opening a conversation reads it, and so does a new message arriving
  // while it is open. Read is not handled: "needs reply" stays until
  // marked or answered.
  const selectedUnreadIds = selected
    ? selected.messages.filter((message) => !message.acknowledgedAt && !message.readAt && !readIds.has(message.id)).map((message) => message.id)
    : [];
  const selectedUnreadKey = selectedUnreadIds.join(",");
  useEffect(() => {
    if (!selectedUnreadKey) return;
    const ids = selectedUnreadKey.split(",");
    setReadIds((current) => new Set([...current, ...ids]));
    void fetch("/api/messages/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailIds: ids }),
    }).catch(() => null);
  }, [selectedUnreadKey]);
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
      // The guest's own words are what gets translated (the summary is
      // only the fallback for mail with none), so they alone are reason
      // enough. Asking for a summary as well left every message
      // untranslated whenever extraction had not run.
      selected.messages.some(
        (message) => !zh[message.id] && !message.summaryZh && (message.guestText || message.summary),
      ) ||
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
    setMenuOpen(false);
    setComposeError(null);
    setComposeNote(null);
    setTranslateError(null);
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

  /** The composer's text for the open conversation. */
  function setComposer(text: string) {
    if (!selected) return;
    const key = selected.key;
    setComposerTexts((current) => ({ ...current, [key]: text }));
  }

  /**
   * Whatever the AI wrote, with this trip's placeholders filled in. The
   * pickup code reaches the text here, in the operator's browser: the
   * AI never sees it, and keeps {{pickup_code}} where it belongs.
   */
  function fillIn(text: string) {
    return templateContext ? renderTemplate(text, templateContext.values).text : text;
  }

  /** Draft, rewrite or translate, through the one AI path. */
  async function runAi(mode: "draft" | "rewrite" | "translate") {
    if (!selected || aiBusy) return;
    const text = (composerTexts[selected.key] ?? "").trim();
    if (mode !== "draft" && !text) return;
    setAiBusy(mode);
    setAiStartedAt(Date.now());
    setComposeError(null);
    setComposeNote(null);
    try {
      const response =
        mode === "draft"
          ? await fetch("/api/messages/draft", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                emailIds: selected.messages.map((m) => m.id),
                guestName: selected.guestName,
                vehicleId: selected.vehicleId,
                emailId: selected.messages[0]?.id ?? null,
                // What the operator already typed steers the draft.
                instruction: text ? text.slice(0, 500) : null,
              }),
            })
          : await fetch("/api/messages/compose", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode,
                text,
                emailIds: selected.messages.map((m) => m.id),
                guestName: selected.guestName,
                vehicleId: selected.vehicleId,
              }),
            });
      const data = (await response.json().catch(() => ({}))) as {
        draft?: string;
        text?: string;
        libraryUsed?: unknown[];
        error?: string;
        reason?: string;
      };
      const result = data.draft ?? data.text;
      if (!response.ok || !result) {
        setComposeError(`${t.composeFailed}${data.reason ? ` (${data.reason})` : data.error ? ` (${data.error})` : ""}`);
        return;
      }
      setComposer(fillIn(result));
      const used = data.libraryUsed?.length ?? 0;
      if (used > 0) setComposeNote(t.libraryUsedNote(used));
    } catch {
      setComposeError(t.composeFailed);
    } finally {
      setAiBusy(null);
    }
  }

  function insertTemplate(text: string) {
    const current = selected ? (composerTexts[selected.key] ?? "").trim() : "";
    setComposer(current ? `${current}\n\n${text}` : text);
  }

  /**
   * TATO cannot send a Turo message, so "send" is: copy, and open the
   * conversation on Turo to paste it. Both run inside the click, before
   * any await, because both need the gesture -- a window opened after a
   * promise is a popup the browser blocks.
   */
  function copyAndOpen() {
    if (!selected) return;
    const text = (composerTexts[selected.key] ?? "").trim();
    if (!text) return;
    void navigator.clipboard.writeText(text).catch(() => null);
    if (turoUrl) {
      window.open(turoUrl, "_blank", "noopener");
      setComposeNote(t.copiedOpening);
    } else {
      setComposeNote(t.copiedNoLink);
    }
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
        stage: tripStageAt(order ? { pickup: order.pickupDatetime, return: order.returnDatetime } : null),
        pickupLocation: order?.pickupLocation ?? null,
        returnLocation: order?.returnLocation ?? null,
        question: selected.messages[0]?.guestText ?? selected.messages[0]?.summary ?? "",
        values: {
          guest: order?.renterName ?? selected.guestName,
          car: order?.vehicleName ?? selected.vehicleLabel,
          plate: order?.plateNumber ?? selected.vehiclePlate,
          pickup: order?.pickupDatetime ?? null,
          return: order?.returnDatetime ?? null,
          pickupLocation: order?.pickupLocation ?? null,
          returnLocation: order?.returnLocation ?? null,
          pickupSpot: order?.pickupSpot ?? null,
          returnSpot: order?.returnSpot ?? null,
          handoverNote: order?.handoverNote ?? null,
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
        templateContext ? (
          <MessageTemplatePanel
            locale={locale}
            entries={library}
            vehicleLabels={vehicleLabels}
            context={templateContext}
            onInsert={insertTemplate}
            onClose={() => setTemplatesOpen(false)}
          />
        ) : null
      ) : null}
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
  const composerText = selected ? (composerTexts[selected.key] ?? "") : "";
  const stage = tripStage(order, t);
  // Every conversation can be answered, so the composer is always there.
  const hasComposer = Boolean(selected);
  // A few templates that fit this conversation, one tap away; the rest
  // behind the Templates button.
  const quickTemplates = templateContext ? suggestTemplates(library, templateContext).filter((item) => !item.sent).slice(0, 4) : [];
  const unfilled = composerText && templateContext ? renderTemplate(composerText, templateContext.values).missing : [];

  // Reader imports and guest notifications complement each other.
  type StreamMessage = {
    id: string;
    at: string;
    outbound: boolean;
    body: string;
    chinese: string | null;
    open: boolean;
  };
  const stream: StreamMessage[] = selected
    ? mergeGuestConversation<StreamMessage>(conversation.map((message) => ({
          id: message.id,
          at: message.sentAt,
          outbound: message.direction === "outbound",
          body: message.body,
          chinese: message.bodyZh ?? zh[message.id] ?? null,
          open: false,
        })), selected.messages.map((message) => ({
          id: message.id,
          at: message.receivedAt,
          outbound: false,
          body: message.guestText ?? message.summary ?? message.subject ?? "",
          chinese: chinese(message),
          open: !message.acknowledgedAt,
        })), (recorded, email) => ({ ...recorded, open: email.open, chinese: recorded.chinese ?? email.chinese }))
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
        ...(order.pickupSpot ? [{ label: t.tripPickupSpot, value: order.pickupSpot }] : []),
        { label: t.tripReturnAddress, value: order.returnLocation },
        ...(order.returnSpot ? [{ label: t.tripReturnSpot, value: order.returnSpot }] : []),
        ...(order.handoverNote ? [{ label: t.tripHandoverNote, value: order.handoverNote }] : []),
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
      {/* On a phone the library (its tab is hidden there) and the alert
          settings sit in the top bar, so the search box gets the row. */}
      <MobilePageHeader
        actions={
          <>
            <MobileIconButton label={t.tabLibrary} href="/messages/ai-templates">
              <BookText className="h-[19px] w-[19px]" aria-hidden />
            </MobileIconButton>
            {/* Notification settings live on the settings page now. */}
            <MobileIconButton label={t.alertsButton} href="/account-settings#notifications">
              <Bell className="h-[19px] w-[19px]" aria-hidden />
            </MobileIconButton>
          </>
        }
      />
      <div className="lg:grid lg:h-[calc(100dvh-4.75rem)] lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-3">
        {/* ── The list ─────────────────────────────────────────── */}
        <section
          aria-label={messages.shell.nav.guestMessages}
          className={`-mx-2.5 min-h-0 flex-col overflow-hidden border-y border-[var(--line)] bg-[var(--surface)] sm:-mx-3 lg:mx-0 lg:flex lg:rounded-xl lg:border ${
            selected ? "hidden" : "flex"
          }`}
        >
          <div className="grid gap-2 border-b border-[var(--line)] px-3 py-2 lg:p-2.5">
            <div className="flex items-center gap-2">
              <label className="relative min-w-0 flex-1">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-soft)]"
                />
                <input
                  type="search"
                  {...SEARCH_FIELD_PROPS}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t.searchPlaceholder}
                  aria-label={t.searchPlaceholder}
                  className="tap-compact h-9 w-full rounded-full border border-[var(--line)] bg-[var(--surface-muted)] pl-9 pr-3 text-[13px] outline-none focus:border-[var(--line-strong)]"
                />
              </label>
              <Link
                href="/account-settings#notifications"
                title={t.alertsButton}
                aria-label={t.alertsButton}
                className="tap-press hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)] lg:flex"
              >
                <Bell className="h-4 w-4" aria-hidden />
              </Link>
            </div>

            <div className="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] lg:mx-0 lg:px-0" role="tablist">
              {(["all", "open", "today", "scheduled"] as const).map((value) => {
                const active = filter === value;
                const count =
                  value === "all"
                    ? threads.length
                    : value === "open"
                      ? openThreadCount
                      : value === "today"
                        ? handoverToday.size
                        : (due?.length ?? 0);
                return (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFilter(value)}
                    className={`tap-press tap-compact hit-area shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold tabular-nums transition ${
                      active
                        ? "bg-[var(--ink)] text-white"
                        : "bg-[var(--surface-muted)] text-[var(--ink-mid)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {value === "all"
                      ? t.filterAll
                      : value === "open"
                        ? t.filterOpen
                        : value === "today"
                          ? t.filterToday
                          : t.filterScheduled}{" "}
                    {count}
                  </button>
                );
              })}
              {normalizedSearch ? (
                <span className="ml-auto shrink-0 text-[11px] text-[var(--ink-soft)]">
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
                const unread = unreadIn(thread);
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
                      className={`tap-press flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-[var(--surface-muted)] ${
                        thread.key === selectedKey ? "lg:bg-[var(--surface-muted)]" : ""
                      }`}
                    >
                      <Avatar name={thread.guestName} src={thread.avatarUrl} size={38} />
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={`truncate text-[14px] text-[var(--ink)] ${unread > 0 ? "font-bold" : "font-semibold"}`}
                          >
                            {highlight(thread.guestName, normalizedSearch)}
                          </span>
                          <span
                            className={`shrink-0 text-[11px] tabular-nums ${unread > 0 ? "font-semibold text-[var(--brand)]" : "text-[var(--ink-soft)]"}`}
                          >
                            {formatListTime(thread.latestAt, locale, t)}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span
                            className={`line-clamp-1 min-w-0 flex-1 text-[13px] leading-[1.35] ${unread > 0 ? "font-medium text-[var(--ink)]" : "text-[var(--ink-mid)]"}`}
                          >
                            {highlight(preview, normalizedSearch)}
                          </span>
                          {/* Red is for what nobody has looked at yet. Read but
                              unanswered keeps a quiet label, which the
                              "needs reply" filter still finds. */}
                          {unread > 0 ? (
                            <span
                              aria-label={`${t.unreadBadge} ${unread}`}
                              className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10.5px] font-bold tabular-nums text-white"
                            >
                              {unread}
                            </span>
                          ) : open ? (
                            <span className="shrink-0 text-[10.5px] font-semibold text-[var(--ink-soft)]">{t.openBadge}</span>
                          ) : null}
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--ink-soft)]">
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

          {/* Older conversations, a page at a time. A button rather than
              loading on scroll: each page costs memory, so it is spent
              only when someone means to go back that far. */}
          {filter !== "scheduled" && (nextCursor || olderPages.length > 0) ? (
            <div className="grid shrink-0 justify-items-center gap-1 border-t border-[var(--line)] px-3 py-2.5">
              {nextCursor ? (
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="tap-press tap-compact hit-area inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-3.5 text-[12px] font-semibold text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)] disabled:opacity-60"
                >
                  {loadingOlder ? <InlineSpinner className="h-3 w-3" /> : null}
                  {loadingOlder ? t.loadingOlder : olderFailed ? t.loadOlderFailed : t.loadOlder}
                </button>
              ) : (
                <p className="text-[11.5px] text-[var(--ink-soft)]">{t.noOlder}</p>
              )}
              {normalizedSearch && nextCursor ? (
                <p className="text-center text-[11px] text-[var(--ink-soft)]">{t.searchLoadedOnly}</p>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* ── One conversation ─────────────────────────────────── */}
        {selected ? (
          // On a phone the conversation covers the whole screen, the
          // bottom tabs included, as a chat app's does: the reply box is
          // what the screen is for. Header and reply box stay put and
          // only the messages scroll, on a desktop too.
          <section className="fixed inset-x-0 top-0 z-[60] flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--surface)] lg:static lg:z-auto lg:h-auto lg:rounded-xl lg:border lg:border-[var(--line)]">
            {/* Who, which car, and the trip in one line. The rest of the
                trip is one tap away instead of a nine-cell grid above
                the chat. */}
            <header className="relative shrink-0 border-b border-[var(--line)] bg-[var(--surface)] pt-safe lg:pt-0">
              <div className="flex items-center gap-1.5 py-1.5 pl-1 pr-1.5 sm:px-3 lg:gap-2 lg:py-2">
                <button
                  type="button"
                  onClick={backToList}
                  aria-label={messages.shell.nav.guestMessages}
                  className="tap-press tap-compact hit-area flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink)] hover:bg-[var(--surface-muted)] lg:hidden"
                >
                  <ChevronLeft className="h-6 w-6" aria-hidden />
                </button>
                <Avatar name={selected.guestName} src={selected.avatarUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[15px] font-bold leading-5 text-[var(--ink)]">
                    {selected.guestName}
                  </h2>
                  <p className="truncate text-[11px] leading-4 text-[var(--ink-soft)] lg:text-[12px]">
                    {selected.vehicleLabel ?? t.noVehicle}
                    {selected.vehiclePlate ? ` · ${selected.vehiclePlate}` : ""}
                  </p>
                </div>
                {/* For when the Turo link will not open where it should --
                    signed out in this browser, or the app grabbing it --
                    so it can be pasted into the browser that is signed
                    in. An icon on a phone, where the header is full. */}
                {turoUrl ? (
                  <button
                    type="button"
                    onClick={() => {
                      void copyText(turoUrl).then((ok) => {
                        if (!ok) return;
                        setTuroLinkCopied(true);
                        setTimeout(() => setTuroLinkCopied(false), 1500);
                      });
                    }}
                    title={t.copyTuroLinkHint}
                    aria-label={turoLinkCopied ? t.turoLinkCopied : t.copyTuroLink}
                    className="tap-press tap-compact hit-area flex h-8 w-8 shrink-0 items-center justify-center gap-1 rounded-full border border-[var(--line-strong)] text-[12px] font-bold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] lg:w-auto lg:px-3"
                  >
                    {turoLinkCopied ? (
                      <Check className="h-3.5 w-3.5 text-[var(--success,#1f8a4c)]" aria-hidden />
                    ) : (
                      <CopyIcon className="h-3.5 w-3.5" aria-hidden />
                    )}
                    <span className="hidden lg:inline">{turoLinkCopied ? t.turoLinkCopied : t.copyTuroLink}</span>
                  </button>
                ) : null}
                {turoUrl ? (
                  <a
                    href={turoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t.replyOnTuroHint}
                    className="tap-press tap-compact hit-area flex h-8 shrink-0 items-center gap-1 rounded-full border border-[var(--line-strong)] px-3 text-[12px] font-bold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                  >
                    {t.replyOnTuroShort}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => setMenuOpen((value) => !value)}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  aria-label={t.threadMenu}
                  title={t.threadMenu}
                  className="tap-press tap-compact hit-area flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-mid)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                >
                  <MoreHorizontal className="h-5 w-5" aria-hidden />
                </button>
              </div>

              {/* Translation mode and "handled": things set now and then,
                  not every message, so they wait behind the menu. */}
              {menuOpen ? (
                <>
                  <button
                    type="button"
                    aria-hidden
                    tabIndex={-1}
                    onClick={() => setMenuOpen(false)}
                    className="fixed inset-0 z-10 cursor-default"
                  />
                  <div
                    role="menu"
                    className="absolute right-2 top-full z-20 mt-1 w-48 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] py-1 shadow-[0_12px_32px_-12px_rgba(17,19,24,0.35)]"
                  >
                    <p className="px-3 pb-1 pt-1.5 text-[11px] text-[var(--ink-soft)]" title={t.zhModeHint}>
                      {translating ? t.autoTranslating : t.messageCount(stream.length)}
                    </p>
                    {(["literal", "brief"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="menuitemradio"
                        aria-checked={zhMode === mode}
                        onClick={() => {
                          pickZhMode(mode);
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                      >
                        {mode === "literal" ? t.zhModeLiteral : t.zhModeSummary}
                        {zhMode === mode ? <Check className="h-4 w-4 text-[var(--brand)]" aria-hidden /> : null}
                      </button>
                    ))}
                    {selected.openCount > 0 ? (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={acknowledging}
                        onClick={() => {
                          setMenuOpen(false);
                          void markHandled();
                        }}
                        className="flex w-full items-center border-t border-[var(--line)] px-3 py-2 text-left text-[13px] text-[var(--ink)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                      >
                        {acknowledging ? t.markingHandled : t.markHandled}
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}

              <button
                type="button"
                onClick={() => setTripOpen((value) => !value)}
                aria-expanded={tripOpen}
                className="tap-press tap-compact flex min-h-9 w-full items-center gap-2 border-t border-[var(--line)] px-3 py-1.5 text-left text-[12px] text-[var(--ink-mid)] hover:bg-[var(--surface-muted)]"
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

            {/* Only the messages scroll. Chinese under each bubble: word
                for word, or the gist (the header's menu). */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {translating ? (
              <p className="flex items-center justify-center gap-1.5 px-3 pt-2 text-[11px] text-[var(--ink-soft)]">
                <InlineSpinner className="h-3 w-3" />
                {t.autoTranslating}
              </p>
            ) : null}
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
                      {!item.outbound ? (
                        <span className="hidden lg:block">
                          <Avatar name={selected.guestName} src={selected.avatarUrl} size={26} />
                        </span>
                      ) : null}
                      <div className={`grid max-w-[85%] gap-0.5 lg:max-w-[82%] ${item.outbound ? "justify-items-end" : ""}`}>
                        <div
                          className={`rounded-2xl px-3 py-2 lg:px-3.5 ${
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
                              className={`mt-1.5 border-t pt-1.5 text-[12.5px] leading-[1.45] lg:text-[13.5px] ${
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
            <div ref={threadEnd} />
            </div>

            {/* The reply. Written here, sent on Turo: TATO has no way to
                send a Turo message, so the draft is copied and the Turo
                conversation opened. Left out when there is nothing to do
                here, rather than drawn as an empty bar. */}
            {hasComposer ? (
            <div className="grid shrink-0 gap-1.5 border-t border-[var(--line)] bg-[var(--surface)] px-2.5 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 lg:gap-2 lg:px-3 lg:py-3">
              {quickTemplates.length > 0 ? (
                <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
                  {quickTemplates.map(({ entry }) => (
                    <button
                      key={entry.id}
                      type="button"
                      title={entry.content}
                      disabled={aiBusy !== null}
                      onClick={() => insertTemplate(renderTemplate(entry.content, templateContext?.values ?? null).text)}
                      className="tap-press tap-compact hit-area shrink-0 whitespace-nowrap rounded-full border border-[var(--line-strong)] px-3 py-1 text-[12px] text-[var(--ink-mid)] transition hover:border-[var(--ink)] hover:text-[var(--ink)] disabled:opacity-40"
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* One box, four tools and the copy button beneath it, as
                  HostHub has it: nothing crowds the text on a phone. */}
              <div className="flex flex-col rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] focus-within:border-[var(--brand)]">
                {aiBusy === "draft" || aiBusy === "rewrite" ? (
                  <div className="flex items-center gap-2 px-3 pb-1 pt-3 text-[13px] text-[var(--ink-soft)]">
                    {t.composing}
                    <TypingDots startedAt={aiStartedAt} locale={locale === "en" ? "en" : "zh"} />
                  </div>
                ) : null}
                <textarea
                  value={composerText}
                  onChange={(event) => setComposer(event.target.value)}
                  rows={2}
                  placeholder={t.composerPlaceholder}
                  aria-label={t.composerPlaceholder}
                  hidden={aiBusy === "draft" || aiBusy === "rewrite"}
                  className="tap-compact max-h-40 min-h-[2.9rem] w-full resize-y bg-transparent px-3 pt-2 text-[14px] lg:max-h-48 lg:min-h-[4.5rem] lg:pt-2.5 leading-[1.45] text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]"
                />
                <div className="flex items-center gap-1 px-1 pb-1 pt-0.5 lg:px-1.5 lg:pb-1.5 lg:pt-1">
                  <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
                    <ComposerTool label={t.toolTemplates} title={t.toolTemplates} onClick={() => setTemplatesOpen(true)} disabled={aiBusy !== null}>
                      <LayoutTemplate className="h-4 w-4" aria-hidden />
                    </ComposerTool>
                    {canDraft ? (
                      <>
                        <ComposerTool label={t.toolDraft} title={t.toolDraftHint} onClick={() => void runAi("draft")} disabled={aiBusy !== null || !latestEmail} busy={aiBusy === "draft"}>
                          <Sparkles className="h-4 w-4" aria-hidden />
                        </ComposerTool>
                        <ComposerTool label={t.toolRewrite} title={t.toolRewriteHint} onClick={() => void runAi("rewrite")} disabled={aiBusy !== null || !composerText.trim()} busy={aiBusy === "rewrite"}>
                          <PenLine className="h-4 w-4" aria-hidden />
                        </ComposerTool>
                        <ComposerTool label={t.toolTranslate} title={t.toolTranslateHint} onClick={() => void runAi("translate")} disabled={aiBusy !== null || !composerText.trim()} busy={aiBusy === "translate"}>
                          <Languages className="h-4 w-4" aria-hidden />
                        </ComposerTool>
                      </>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={copyAndOpen}
                    disabled={!composerText.trim() || aiBusy !== null}
                    title={turoUrl ? t.replyOnTuroHint : t.noTuroLink}
                    // Small on a phone, so the four tools beside it fit on one
                    // row at 375px; the full wording on a desktop.
                    className="tap-press tap-compact hit-area flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--brand)] px-2.5 text-[11.5px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40 lg:h-9 lg:gap-1.5 lg:px-3.5 lg:text-[13px] lg:font-bold"
                  >
                    {turoUrl ? (
                      <>
                        <span className="lg:hidden">{t.copyAndOpenShort}</span>
                        <span className="hidden lg:inline">{t.copyAndOpen}</span>
                      </>
                    ) : (
                      t.copyOnly
                    )}
                    {turoUrl ? <ExternalLink className="h-3 w-3 lg:h-3.5 lg:w-3.5" aria-hidden /> : null}
                  </button>
                </div>
              </div>

              {unfilled.length > 0 ? (
                <p className="text-[11.5px] text-[var(--warn-fg)]">{t.missingPlaceholders(unfilled.map((key) => `{{${key}}}`).join("、"))}</p>
              ) : null}
              {composeError ? <p className="text-[12px] text-[var(--bad-fg)]">{composeError}</p> : null}
              {composeNote ? <p className="text-[11.5px] text-[var(--ink-soft)]">{composeNote}</p> : null}

            </div>
            ) : null}
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

/** One of the composer's tools: an icon and a short label on one line, so
 *  the four fit beside the copy button on a phone. */
function ComposerTool({
  label,
  title,
  onClick,
  disabled,
  busy,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="tap-press tap-compact hit-area flex h-8 shrink-0 items-center gap-0.5 rounded-lg px-1 text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] disabled:opacity-40 lg:gap-1 lg:px-2"
    >
      {busy ? <InlineSpinner /> : children}
      <span className="text-[11.5px] font-semibold leading-none lg:text-[12px]">{label}</span>
    </button>
  );
}
