"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";

type ThreadMessage = {
  id: string;
  subject: string;
  receivedAt: string;
  acknowledgedAt: string | null;
  summary: string | null;
  summaryZh: string | null;
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
  messages: ThreadMessage[];
  latestAt: string;
  openCount: number;
  orderId: string | null;
  turoLink: string | null;
};

type Order = {
  id: string;
  renterName: string;
  renterPhone: string | null;
  externalOrderId: string | null;
  plateNumber: string | null;
  pickupDatetime: string;
  returnDatetime: string;
  pickupLocation: string | null;
  returnLocation: string | null;
  status: string;
  netEarning: number | null;
  vehicleLabel: string | null;
};

function formatWhen(iso: string, locale: Locale) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (locale === "en") {
    return `${d.toLocaleString("en-CA", { month: "short", day: "numeric" })} ${hh}:${mm}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/** Hours from now, negative in the past. */
function hoursUntil(iso: string) {
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

/** How close a handover has to be before it earns a place on the list
 *  row. Twelve hours is "today or first thing tomorrow" -- near enough
 *  that a message about it is probably about that, and far enough that
 *  the tag is not on every row at once. */
const IMMINENT_HOURS = 12;

/**
 * Initials, coloured from the name.
 *
 * Turo only puts a guest's photo in the HTML part of a notification,
 * and the archive was ingested keeping the plain text alone — so most
 * threads have no photo and never will. A lettered disc is a better
 * answer than an empty circle: it is stable per guest, so the eye
 * still uses it to tell one row from another while scrolling.
 */
function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();

  // Hue from the name, so the same guest keeps the same colour.
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
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `hsl(${hash} 55% 45%)`,
      }}
    >
      {initials || "?"}
    </span>
  );
}

export function GuestMessagesView({
  locale,
  canDraft,
  threads,
  orders,
}: {
  locale: Locale;
  canDraft: boolean;
  threads: Thread[];
  orders: Order[];
}) {
  const t = getMessages(locale).guestMessagesPage;
  const router = useRouter();

  const [selectedKey, setSelectedKey] = useState<string | null>(threads[0]?.key ?? null);
  const [acknowledging, setAcknowledging] = useState(false);

  // Per-message drafts, keyed by message id: the operator answers one
  // message, not a thread, and a single shared box would silently
  // replace the draft they were about to copy.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [zh, setZh] = useState<Record<string, string>>({});
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  // Threads already asked for, so re-selecting one does not re-request
  // a translation that is already on screen.
  const [translatedKeys, setTranslatedKeys] = useState<Set<string>>(new Set());

  const ordersById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  const selected = threads.find((thread) => thread.key === selectedKey) ?? null;
  const order = selected?.orderId ? (ordersById.get(selected.orderId) ?? null) : null;

  // Translate on open rather than on request. The operator reads
  // Chinese and the guests write English; making that a button meant
  // pressing it every single time, which is not a choice, it is a
  // chore. Cached rows render immediately and only the untranslated
  // ones cost a call.
  useEffect(() => {
    if (!selected || !canDraft) return;
    if (translatedKeys.has(selected.key)) return;
    const missing = selected.messages.some(
      (message) => !zh[message.id] && !message.summaryZh && message.summary,
    );
    if (!missing) return;
    void translateThread(selected);
    // translateThread is stable enough for this: it only reads state
    // through setters, and the key guard stops a re-run loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key, canDraft]);

  function selectThread(key: string) {
    setSelectedKey(key);
    setDrafts({});
    setDraftError(null);
    setTranslateError(null);
    setCopiedId(null);
  }

  /** The Chinese reading of a message, from this session or the cache. */
  function chinese(message: ThreadMessage) {
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
        body: JSON.stringify({ emailIds: thread.messages.map((m) => m.id) }),
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

  if (threads.length === 0) {
    return (
      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center">
        <p className="text-[12.5px] text-[var(--ink-soft)]">{t.empty}</p>
      </section>
    );
  }

  const facts: { label: string; value: string | null }[] = order
    ? [
        {
          label: t.tripDates,
          value: `${formatWhen(order.pickupDatetime, locale)} → ${formatWhen(order.returnDatetime, locale)}`,
        },
        { label: t.tripVehicle, value: order.vehicleLabel },
        { label: t.tripPlate, value: order.plateNumber },
        { label: t.tripStatus, value: order.status },
        {
          label: t.tripTotal,
          value: order.netEarning == null ? null : `CA$${order.netEarning.toFixed(2)}`,
        },
        { label: t.tripPhone, value: order.renterPhone },
        { label: t.tripReservation, value: order.externalOrderId },
        { label: t.tripPickupAddress, value: order.pickupLocation },
        { label: t.tripReturnAddress, value: order.returnLocation },
      ]
    : [];

  return (
    // The lists fill whatever height the browser gives them instead of
    // a fixed vh guess, so a tall screen shows more conversation and a
    // short one still scrolls inside its own pane rather than pushing
    // the page. 13rem is the shell chrome above this grid.
    <div className="grid gap-3 lg:h-[calc(100dvh-13rem)] lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <section
        className={`flex min-h-0 flex-col rounded-lg border border-[var(--line)] bg-[var(--surface)] ${selected ? "hidden lg:flex" : ""}`}
      >
        <ul className="min-h-0 flex-1 divide-y divide-[var(--line)] overflow-y-auto max-lg:max-h-[60dvh]">
          {threads.map((thread) => (
            <li key={thread.key}>
              <button
                type="button"
                onClick={() => selectThread(thread.key)}
                className={`tap-press flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-[var(--surface-muted)] ${
                  thread.key === selectedKey ? "bg-[var(--surface-muted)]" : ""
                }`}
              >
                <Avatar name={thread.guestName} src={thread.avatarUrl} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-bold text-[var(--ink)]">
                      {thread.guestName}
                    </span>
                    <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--ink-soft)]">
                      {formatWhen(thread.latestAt, locale)}
                    </span>
                  </span>

                  {/* Model and plate, then what the last message said.
                      A row that only carries a name makes the operator
                      open threads to find out which car they are
                      about. */}
                  <span className="mt-0.5 block truncate text-[11.5px] text-[var(--ink-soft)]">
                    {thread.vehicleLabel ?? t.noVehicle}
                    {thread.vehiclePlate ? ` · ${thread.vehiclePlate}` : ""}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] leading-4 text-[var(--ink)]">
                    {thread.latestSummaryZh ?? thread.latestSummary ?? thread.messages[0]?.subject}
                  </span>

                  {(() => {
                    // A handover inside the next twelve hours is almost
                    // certainly what the message is about, and it is the
                    // thing that decides whether this thread can wait.
                    const trip = thread.orderId ? ordersById.get(thread.orderId) : null;
                    const pickupIn = trip ? hoursUntil(trip.pickupDatetime) : null;
                    const returnIn = trip ? hoursUntil(trip.returnDatetime) : null;
                    const imminent =
                      pickupIn !== null && pickupIn >= 0 && pickupIn <= IMMINENT_HOURS
                        ? { label: t.pickupSoon, at: trip!.pickupDatetime }
                        : returnIn !== null && returnIn >= 0 && returnIn <= IMMINENT_HOURS
                          ? { label: t.returnSoon, at: trip!.returnDatetime }
                          : null;

                    if (thread.openCount === 0 && !imminent) return null;

                    return (
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {thread.openCount > 0 ? (
                          <span className="inline-flex rounded-[var(--radius-pill)] bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                            {t.openBadge} {thread.openCount}
                          </span>
                        ) : null}
                        {imminent ? (
                          <span className="inline-flex rounded-[var(--radius-pill)] bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--brand)]">
                            {imminent.label} {formatWhen(imminent.at, locale)}
                          </span>
                        ) : null}
                      </span>
                    );
                  })()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selected ? (
        <section className="flex min-h-0 flex-col gap-3">
          {/* Guest and trip in one card. They were two, stacked, and
              the split was arbitrary: the name, the car and the
              handover time are one answer to "who is this and what is
              it about", read together. */}
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <header className="flex flex-col gap-2.5 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name={selected.guestName} src={selected.avatarUrl} size={40} />
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => setSelectedKey(null)}
                  className="tap-press mb-0.5 text-[11.5px] font-bold text-[var(--brand)] lg:hidden"
                >
                  ← {t.kicker}
                </button>
                <h2 className="truncate text-[15px] font-bold text-[var(--ink)]">
                  {selected.guestName}
                </h2>
                <p className="truncate text-[11.5px] text-[var(--ink-soft)]">
                  {selected.vehicleLabel ?? t.noVehicle}
                  {selected.vehiclePlate ? ` · ${selected.vehiclePlate}` : ""}
                </p>
              </div>
            </div>

            <div className="tap-row flex shrink-0 items-center gap-2 sm:flex-col sm:items-end sm:gap-1.5">
              {selected.turoLink ? (
                <a
                  href={selected.turoLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t.replyOnTuroHint}
                  className="tap-press flex flex-1 items-center justify-center rounded-md bg-[var(--brand)] px-3 py-2 text-[12px] font-bold text-white transition hover:opacity-90 sm:flex-none"
                >
                  {t.replyOnTuro} ↗
                </a>
              ) : (
                <span className="flex-1 text-[11px] text-[var(--ink-soft)] sm:flex-none">
                  {t.noTuroLink}
                </span>
              )}
              {selected.openCount > 0 ? (
                <button
                  type="button"
                  onClick={markHandled}
                  disabled={acknowledging}
                  className="tap-press flex flex-1 items-center justify-center rounded-md border border-[var(--line-strong)] bg-white px-3 py-2 text-[12px] font-bold text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)] disabled:opacity-50 sm:flex-none"
                >
                  {acknowledging ? t.markingHandled : t.markHandled}
                </button>
              ) : null}
            </div>
          </header>

          <div className="border-t border-[var(--line)] px-3 py-2.5 sm:px-4">
            <h3 className="text-[12px] font-bold text-[var(--ink)]">
              {order ? t.tripTitle : t.tripNone}
            </h3>
            {order ? (
              <>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                  {facts.map((fact) => (
                    <div key={fact.label} className="min-w-0">
                      <dt className="t-eyebrow text-[var(--ink-soft)]">{fact.label}</dt>
                      <dd className="mt-0.5 break-words text-[12px] font-bold leading-4 text-[var(--ink)]">
                        {fact.value ?? t.noValue}
                      </dd>
                    </div>
                  ))}
                </dl>
                <Link
                  href={`/orders/${order.id}`}
                  className="mt-2 inline-flex items-center text-[12px] font-bold text-[var(--brand)] underline underline-offset-2"
                >
                  {t.tripOpen}
                </Link>
              </>
            ) : (
              <p className="mt-1 text-[11.5px] leading-5 text-[var(--ink-soft)]">{t.tripNoneCopy}</p>
            )}
          </div>
          </div>

          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-[var(--line)] bg-[var(--surface)]">
            <header className="tap-row flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2 sm:px-4">
              <span className="t-eyebrow text-[var(--ink-soft)]">
                {t.messageCount(selected.messages.length)}
              </span>
              {translating ? (
                <span className="text-[11px] text-[var(--ink-soft)]">{t.autoTranslating}</span>
              ) : null}
            </header>

            {translateError ? (
              <p className="px-3 pt-2 text-[11.5px] text-rose-600 sm:px-4">{translateError}</p>
            ) : null}
            {draftError ? (
              <p className="px-3 pt-2 text-[11.5px] text-rose-600 sm:px-4">{draftError}</p>
            ) : null}

            <ul className="min-h-0 flex-1 divide-y divide-[var(--line)] overflow-y-auto max-lg:max-h-[60dvh]">
              {selected.messages.map((message) => {
                const draft = drafts[message.id];
                return (
                  <li key={message.id} className="px-3 py-2.5 sm:px-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[10.5px] tabular-nums text-[var(--ink-soft)]">
                        {formatWhen(message.receivedAt, locale)}
                      </span>
                      {!message.acknowledgedAt ? (
                        <span className="shrink-0 rounded-[var(--radius-pill)] bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                          {t.openBadge}
                        </span>
                      ) : null}
                    </div>

                    {/* Original above, Chinese beneath. Showing one or
                        the other behind a toggle meant deciding, per
                        message, which language you were about to need
                        -- and the answer is usually both: the English
                        is what the guest actually wrote and what any
                        reply has to line up with. */}
                    <p className="mt-0.5 text-[12.5px] leading-5 text-[var(--ink)]">
                      {message.summary ?? message.subject}
                    </p>
                    {chinese(message) ? (
                      <p className="mt-1 border-l-2 border-[var(--brand-soft)] pl-2 text-[12.5px] leading-5 text-[var(--ink-mid)]">
                        {chinese(message)}
                      </p>
                    ) : null}

                    {/* Drafting sits on the message it answers rather
                        than at the bottom of the page: the operator
                        reads one message and replies to it, and a box
                        two screens away is a box they scroll back to
                        lose their place in. */}
                    {/* Bottom-right: the reply is what you do after
                        reading, so it sits where reading ends. */}
                    <div className="tap-row mt-1.5 flex items-center justify-end gap-2">
                      {draft ? (
                        <button
                          type="button"
                          onClick={() => copy(message.id, draft)}
                          className="tap-press rounded-md border border-[var(--line-strong)] bg-white px-2.5 py-1.5 text-[11.5px] font-bold text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)]"
                        >
                          {copiedId === message.id ? t.draftCopied : t.draftCopyButton}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => draftFor(message)}
                        disabled={!canDraft || draftingId !== null}
                        className="tap-press rounded-md bg-[var(--ink)] px-2.5 py-1.5 text-[11.5px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                      >
                        {draftingId === message.id ? t.draftingOne : t.draftOne}
                      </button>
                    </div>

                    {draft ? (
                      <textarea
                        value={draft}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [message.id]: event.target.value }))
                        }
                        rows={3}
                        className="mt-1.5 w-full resize-y rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-[12.5px] leading-5 text-[var(--ink)] outline-none focus:border-[var(--brand)]"
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </section>
      ) : (
        <section className="hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center lg:block">
          <p className="text-[12.5px] text-[var(--ink-soft)]">{t.emptyThread}</p>
        </section>
      )}
    </div>
  );
}
