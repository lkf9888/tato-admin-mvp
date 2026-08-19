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
  needsAction: boolean;
  turoLink: string | null;
};

type Thread = {
  key: string;
  guestName: string;
  vehicleId: string | null;
  vehicleLabel: string | null;
  messages: ThreadMessage[];
  latestAt: string;
  openCount: number;
  orderId: string | null;
  turoLink: string | null;
};

type Order = {
  id: string;
  renterName: string;
  pickupDatetime: string;
  returnDatetime: string;
  pickupLocation: string | null;
  status: string;
  netEarning: number | null;
  vehicleLabel: string | null;
};

function formatWhen(iso: string, locale: Locale) {
  const date = new Date(iso);
  return date.toLocaleString(locale === "en" ? "en-CA" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function GuestMessagesView({
  locale,
  canDraft,
  threads,
  orders,
}: {
  locale: Locale;
  /** False when KIMI_API_KEY is unset — the draft box explains itself
   *  rather than failing on click. */
  canDraft: boolean;
  threads: Thread[];
  orders: Order[];
}) {
  const t = getMessages(locale).guestMessagesPage;
  const router = useRouter();

  const [selectedKey, setSelectedKey] = useState<string | null>(threads[0]?.key ?? null);
  const [draft, setDraft] = useState("");
  const [instruction, setInstruction] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);

  const ordersById = useMemo(
    () => new Map(orders.map((order) => [order.id, order])),
    [orders],
  );

  const selected = threads.find((thread) => thread.key === selectedKey) ?? null;
  const order = selected?.orderId ? (ordersById.get(selected.orderId) ?? null) : null;

  function selectThread(key: string) {
    setSelectedKey(key);
    // A draft belongs to the conversation it was written for; carrying
    // it across would invite pasting one guest's reply to another.
    setDraft("");
    setInstruction("");
    setDraftError(null);
    setCopied(false);
  }

  async function generateDraft() {
    if (!selected || drafting) return;
    setDrafting(true);
    setDraftError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/messages/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestName: selected.guestName,
          vehicleId: selected.vehicleId,
          instruction: instruction.trim() || null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        draft?: string;
        error?: string;
        reason?: string;
      };
      if (!response.ok || !data.draft) {
        setDraftError(`${t.draftFailed}${data.reason ? ` (${data.reason})` : data.error ? ` (${data.error})` : ""}`);
        return;
      }
      setDraft(data.draft);
    } catch {
      setDraftError(t.draftFailed);
    } finally {
      setDrafting(false);
    }
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

  async function copyDraft() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft).catch(() => null);
    setCopied(true);
  }

  if (threads.length === 0) {
    return (
      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center">
        <p className="text-[12.5px] text-[var(--ink-soft)]">{t.empty}</p>
      </section>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      {/* Conversation list. On mobile it collapses to the list only once
          something is selected, so the detail gets the full screen. */}
      <section
        className={`rounded-lg border border-[var(--line)] bg-[var(--surface)] ${selected ? "hidden lg:block" : ""}`}
      >
        <ul className="max-h-[70vh] divide-y divide-[var(--line)] overflow-y-auto">
          {threads.map((thread) => (
            <li key={thread.key}>
              <button
                type="button"
                onClick={() => selectThread(thread.key)}
                className={`tap-press w-full px-3 py-2.5 text-left transition hover:bg-[var(--surface-muted)] ${
                  thread.key === selectedKey ? "bg-[var(--surface-muted)]" : ""
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-[var(--ink)]">
                    {thread.guestName}
                  </span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--ink-soft)]">
                    {formatWhen(thread.latestAt, locale)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11.5px] text-[var(--ink-soft)]">
                  {thread.vehicleLabel ?? t.noVehicle}
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  {thread.openCount > 0 ? (
                    <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                      {t.openBadge} {thread.openCount}
                    </span>
                  ) : null}
                  <span className="text-[10.5px] text-[var(--ink-soft)]">
                    {t.messageCount(thread.messages.length)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Detail */}
      {selected ? (
        <section className="space-y-3">
          {/* Name above, actions below, on phones. Side by side, the
              guest's name and two buttons each get about a third of a
              375px screen, and the buttons stack into tall thin
              columns -- the shape that is hardest to hit and reads as
              broken. */}
          <header className="flex flex-col gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:px-4">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                className="tap-press mb-1 text-[11.5px] font-semibold text-[var(--accent)] lg:hidden"
              >
                ← {t.kicker}
              </button>
              <h2 className="truncate text-[15px] font-semibold text-[var(--ink)]">
                {selected.guestName}
              </h2>
              <p className="truncate text-[11.5px] text-[var(--ink-soft)]">
                {selected.vehicleLabel ?? t.noVehicle}
              </p>
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
                <span className="flex-1 text-[11px] text-[var(--ink-soft)] sm:flex-none">{t.noTuroLink}</span>
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

          {/* Matching trip */}
          <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 sm:px-4">
            <h3 className="text-[12px] font-semibold text-[var(--ink)]">
              {order ? t.tripTitle : t.tripNone}
            </h3>
            {order ? (
              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px] sm:grid-cols-4">
                <div>
                  <dt className="text-[var(--ink-soft)]">{t.tripDates}</dt>
                  <dd className="font-medium tabular-nums text-[var(--ink)]">
                    {formatWhen(order.pickupDatetime, locale)} →{" "}
                    {formatWhen(order.returnDatetime, locale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-soft)]">{t.tripVehicle}</dt>
                  <dd className="truncate font-medium text-[var(--ink)]">
                    {order.vehicleLabel ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-soft)]">{t.tripStatus}</dt>
                  <dd className="font-medium text-[var(--ink)]">{order.status}</dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-soft)]">{t.tripTotal}</dt>
                  <dd className="font-medium tabular-nums text-[var(--ink)]">
                    {order.netEarning == null ? "—" : `$${order.netEarning.toFixed(2)}`}
                  </dd>
                </div>
                <div className="col-span-2 sm:col-span-4">
                  <Link
                    href={`/orders/${order.id}`}
                    className="text-[11.5px] font-semibold text-[var(--accent)] underline underline-offset-2"
                  >
                    {t.tripOpen}
                  </Link>
                </div>
              </dl>
            ) : (
              <p className="mt-1 text-[11.5px] leading-5 text-[var(--ink-soft)]">{t.tripNoneCopy}</p>
            )}
          </section>

          {/* Messages */}
          <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
            <ul className="max-h-[40vh] divide-y divide-[var(--line)] overflow-y-auto">
              {selected.messages.map((message) => (
                <li key={message.id} className="px-3 py-2.5 sm:px-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10.5px] tabular-nums text-[var(--ink-soft)]">
                      {formatWhen(message.receivedAt, locale)}
                    </span>
                    {!message.acknowledgedAt ? (
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                        {t.openBadge}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-5 text-[var(--ink)]">
                    {message.summary ?? message.subject}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {/* Draft */}
          <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 sm:px-4">
            <h3 className="text-[12px] font-semibold text-[var(--ink)]">{t.draftTitle}</h3>
            <p className="mt-0.5 text-[11px] leading-5 text-[var(--ink-soft)]">{t.draftCopy}</p>

            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={t.draftPlaceholder}
              rows={2}
              disabled={!canDraft || drafting}
              className="mt-2 w-full resize-none rounded-md border border-[var(--line)] bg-white px-2.5 py-1.5 text-[12px] text-[var(--ink)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
            />

            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={generateDraft}
                disabled={!canDraft || drafting}
                className="tap-press rounded-full bg-[var(--ink)] px-3 py-1.5 text-[11.5px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {drafting ? t.draftting : t.draftButton}
              </button>
              {draft ? (
                <button
                  type="button"
                  onClick={copyDraft}
                  className="tap-press rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                >
                  {copied ? t.draftCopied : t.draftCopyButton}
                </button>
              ) : null}
            </div>

            {draftError ? (
              <p className="mt-1.5 text-[11.5px] text-rose-600">{draftError}</p>
            ) : null}

            {draft ? (
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={4}
                className="mt-2 w-full resize-y rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-[12.5px] leading-5 text-[var(--ink)] outline-none focus:border-[var(--accent)]"
              />
            ) : null}
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
