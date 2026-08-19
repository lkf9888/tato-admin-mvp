"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

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
  return new Date(iso).toLocaleString(locale === "en" ? "en-CA" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  const [showZh, setShowZh] = useState(true);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const ordersById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  const selected = threads.find((thread) => thread.key === selectedKey) ?? null;
  const order = selected?.orderId ? (ordersById.get(selected.orderId) ?? null) : null;

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

  function bodyOf(message: ThreadMessage) {
    const original = message.summary ?? message.subject;
    if (!showZh) return original;
    return chinese(message) ?? original;
  }

  async function translateThread() {
    if (!selected || translating) return;
    setTranslating(true);
    setTranslateError(null);
    try {
      const response = await fetch("/api/messages/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestName: selected.guestName, vehicleId: selected.vehicleId }),
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
      setShowZh(true);
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
        body: JSON.stringify({ guestName: selected.guestName, vehicleId: selected.vehicleId }),
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
    <div className="grid gap-3 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <section
        className={`rounded-lg border border-[var(--line)] bg-[var(--surface)] ${selected ? "hidden lg:block" : ""}`}
      >
        <ul className="max-h-[70vh] divide-y divide-[var(--line)] overflow-y-auto">
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
                    {(showZh ? thread.latestSummaryZh : null) ??
                      thread.latestSummary ??
                      thread.messages[0]?.subject}
                  </span>

                  {thread.openCount > 0 ? (
                    <span className="mt-1 inline-flex rounded-[var(--radius-pill)] bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                      {t.openBadge} {thread.openCount}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selected ? (
        <section className="space-y-3">
          <header className="flex flex-col gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:px-4">
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

          <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 sm:px-4">
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
          </section>

          <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
            <header className="tap-row flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2 sm:px-4">
              <span className="t-eyebrow text-[var(--ink-soft)]">
                {t.messageCount(selected.messages.length)}
              </span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={translateThread}
                  disabled={!canDraft || translating}
                  className="tap-press rounded-md border border-[var(--line-strong)] bg-white px-2.5 py-1.5 text-[11.5px] font-bold text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
                >
                  {translating ? t.translating : t.translate}
                </button>
                <button
                  type="button"
                  onClick={() => setShowZh((v) => !v)}
                  className="tap-press rounded-md px-2 py-1.5 text-[11.5px] font-bold text-[var(--brand)]"
                >
                  {showZh ? t.showOriginal : t.showChinese}
                </button>
              </span>
            </header>

            {translateError ? (
              <p className="px-3 pt-2 text-[11.5px] text-rose-600 sm:px-4">{translateError}</p>
            ) : null}
            {draftError ? (
              <p className="px-3 pt-2 text-[11.5px] text-rose-600 sm:px-4">{draftError}</p>
            ) : null}

            <ul className="max-h-[52vh] divide-y divide-[var(--line)] overflow-y-auto">
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

                    <p className="mt-0.5 text-[12.5px] leading-5 text-[var(--ink)]">
                      {bodyOf(message)}
                    </p>

                    {/* Drafting sits on the message it answers rather
                        than at the bottom of the page: the operator
                        reads one message and replies to it, and a box
                        two screens away is a box they scroll back to
                        lose their place in. */}
                    <div className="tap-row mt-1.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => draftFor(message)}
                        disabled={!canDraft || draftingId !== null}
                        className="tap-press rounded-md bg-[var(--ink)] px-2.5 py-1.5 text-[11.5px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                      >
                        {draftingId === message.id ? t.draftingOne : t.draftOne}
                      </button>
                      {draft ? (
                        <button
                          type="button"
                          onClick={() => copy(message.id, draft)}
                          className="tap-press rounded-md border border-[var(--line-strong)] bg-white px-2.5 py-1.5 text-[11.5px] font-bold text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)]"
                        >
                          {copiedId === message.id ? t.draftCopied : t.draftCopyButton}
                        </button>
                      ) : null}
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
