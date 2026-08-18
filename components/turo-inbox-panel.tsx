"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";

type InboxEmail = {
  id: string;
  kind: string;
  subject: string;
  fromName: string | null;
  receivedAt: string;
  acknowledged: boolean;
  orderId: string | null;
  summary: { text: string | null; needsAction: boolean } | null;
};

const KIND_LABELS: Record<string, { en: string; zh: string }> = {
  GUEST_MESSAGE: { en: "Guest message", zh: "房客消息" },
  BOOKING_CREATED: { en: "New booking", zh: "新订单" },
  BOOKING_MODIFIED: { en: "Booking changed", zh: "订单变更" },
  BOOKING_CANCELLED: { en: "Cancelled", zh: "已取消" },
  TRIP_STARTED: { en: "Trip started", zh: "行程开始" },
  TRIP_ENDED: { en: "Trip ended", zh: "行程结束" },
  PAYOUT: { en: "Payout", zh: "打款" },
  SUPPORT: { en: "Support", zh: "客服" },
  OTHER: { en: "Other", zh: "其他" },
};

function kindLabel(kind: string, locale: Locale) {
  const entry = KIND_LABELS[kind] ?? KIND_LABELS.OTHER;
  return locale === "en" ? entry.en : entry.zh;
}

/** Tint by what the operator has to do about it, not by category. */
function kindTone(kind: string, needsAction: boolean) {
  if (needsAction) return "border-amber-300 bg-amber-50 text-amber-900";
  if (kind === "BOOKING_CANCELLED") return "border-rose-200 bg-rose-50 text-rose-800";
  if (kind === "BOOKING_CREATED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink-soft)]";
}

export function TuroInboxPanel({
  locale,
  configured,
  emails,
}: {
  locale: Locale;
  configured: boolean;
  emails: InboxEmail[];
}) {
  const t = getMessages(locale).assistantPage;
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function syncNow() {
    if (syncing || !configured) return;
    setSyncing(true);
    setNotice(null);
    try {
      const response = await fetch("/api/gmail-sync", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as {
        imported?: number;
        error?: string;
      };
      if (!response.ok) {
        setNotice(t.syncFailed);
        return;
      }
      setNotice(t.syncedCount(data.imported ?? 0));
      // Re-render the server component so newly pulled mail appears.
      router.refresh();
    } catch {
      setNotice(t.syncFailed);
    } finally {
      setSyncing(false);
    }
  }

  // Unreplied first — the panel's job is to surface what is waiting on
  // the operator, not to be a chronological mail list.
  const sorted = [...emails].sort((a, b) => {
    const aAction = a.summary?.needsAction ? 1 : 0;
    const bAction = b.summary?.needsAction ? 1 : 0;
    if (aAction !== bAction) return bAction - aAction;
    return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
  });

  return (
    <section className="flex h-[calc(100vh-13rem)] min-h-[26rem] flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <header className="flex items-start justify-between gap-2 border-b border-[var(--line)] px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-[var(--ink)]">{t.inboxTitle}</h2>
          <p className="mt-0.5 text-[11.5px] leading-5 text-[var(--ink-soft)]">{t.inboxCopy}</p>
        </div>
        <button
          type="button"
          onClick={syncNow}
          disabled={!configured || syncing}
          className="tap-press shrink-0 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing ? t.syncing : t.syncNow}
        </button>
      </header>

      {notice ? (
        <p className="border-b border-[var(--line)] bg-[var(--surface-muted)] px-3 py-1.5 text-[11.5px] text-[var(--ink-soft)] sm:px-4">
          {notice}
        </p>
      ) : null}

      {!configured ? (
        <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-5 text-amber-800 sm:px-4">
          {t.inboxNotConfigured}
        </p>
      ) : null}

      <div className="flex-1 overflow-y-auto px-3 py-2.5 sm:px-4">
        {sorted.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-[var(--ink-soft)]">{t.inboxEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((email) => {
              const needsAction = email.summary?.needsAction === true;
              const body = (
                <div
                  className={`rounded-lg border px-3 py-2 transition ${kindTone(email.kind, needsAction)}`}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">
                      {kindLabel(email.kind, locale)}
                    </span>
                    {needsAction ? (
                      <span className="rounded-full bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                        {t.needsReply}
                      </span>
                    ) : null}
                    <span className="ml-auto text-[10.5px] opacity-70">
                      {new Date(email.receivedAt).toLocaleString(
                        locale === "en" ? "en-CA" : "zh-CN",
                        { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" },
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] font-medium leading-5 text-[var(--ink)]">
                    {email.summary?.text || email.subject}
                  </p>
                  {email.summary?.text ? (
                    <p className="mt-0.5 truncate text-[11px] text-[var(--ink-soft)]">
                      {email.subject}
                    </p>
                  ) : null}
                </div>
              );

              return (
                <li key={email.id}>
                  {email.orderId ? (
                    <Link href={`/orders?q=${encodeURIComponent(email.orderId)}`} className="tap-press block">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
