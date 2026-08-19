import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCurrentAdminContext } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getNetEarningFromFinancials } from "@/lib/utils";

/**
 * One trip, laid out the way Turo lays out a reservation.
 *
 * The pattern is theirs and it earns its keep: a small uppercase label
 * over a large value, separated by hairlines rather than boxed into
 * cards. Facts read as facts, the eye finds a number without landing
 * on a border first, and it collapses to one column on a phone without
 * any of the nesting that card-in-card layouts need.
 *
 * This route also existed as a dangling link until now — the guest
 * messages page has been pointing at /orders/<id> since v0.29.0 with
 * nothing behind it.
 */

function Fact({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="t-eyebrow text-[var(--ink-soft)]">{label}</dt>
      <dd className="mt-1 text-[15px] font-bold leading-5 text-[var(--ink)]">{children}</dd>
    </div>
  );
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const [{ locale, messages }, { workspace }] = await Promise.all([
    getI18n(),
    requireCurrentAdminContext(),
  ]);

  const order = await prisma.order.findFirst({
    where: { id: orderId, workspaceId: workspace.id },
    include: { vehicle: { include: { owner: true } } },
  });

  if (!order) notFound();

  const emails = await prisma.inboundEmail.findMany({
    where: { workspaceId: workspace.id, orderId: order.id },
    orderBy: { receivedAt: "desc" },
    take: 20,
    select: { id: true, subject: true, receivedAt: true, parsed: true, guestName: true },
  });

  const t = messages.orderDetail;

  const financials = (() => {
    if (!order.sourceMetadata) return undefined;
    try {
      return JSON.parse(order.sourceMetadata) as Record<string, string>;
    } catch {
      return undefined;
    }
  })();
  const netEarning = getNetEarningFromFinancials(financials, order.totalPrice);

  const fmt = (date: Date) =>
    date.toLocaleString(locale === "en" ? "en-CA" : "zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const days = Math.max(
    1,
    Math.round(
      (order.returnDatetime.getTime() - order.pickupDatetime.getTime()) / 86_400_000,
    ),
  );

  const turoUrl = order.externalOrderId
    ? `https://turo.com/us/en/reservation/${order.externalOrderId.trim()}`
    : null;

  return (
    <div className="space-y-3">
      <Link
        href="/orders"
        className="inline-flex items-center gap-1 text-[12px] font-bold text-[var(--brand)]"
      >
        ← {t.back}
      </Link>

      <header className="flex flex-col gap-2 border-b border-[var(--line)] pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="t-eyebrow text-[var(--ink-soft)]">{order.status}</p>
          <h1 className="t-display mt-1 text-[var(--ink)]">{t.tripOf(order.renterName)}</h1>
        </div>
        <Link
          href={`/vehicles?q=${encodeURIComponent(order.vehicle.plateNumber)}`}
          className="t-meta inline-flex shrink-0 items-center text-[var(--brand)] underline underline-offset-2"
        >
          {order.vehicle.year} {order.vehicle.brand} {order.vehicle.model} ·{" "}
          {order.vehicle.plateNumber}
        </Link>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        {/* Facts. Hairlines between groups, not boxes around them. */}
        <section className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-4 sm:px-4">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-4">
            <Fact label={t.pickup}>{fmt(order.pickupDatetime)}</Fact>
            <Fact label={t.dropoff}>{fmt(order.returnDatetime)}</Fact>
          </dl>

          <div className="border-t border-[var(--line)] pt-4">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-4">
              <Fact label={t.duration}>{t.days(days)}</Fact>
              <Fact label={t.source}>{order.source}</Fact>
              {order.pickupLocation ? (
                <Fact label={t.location} wide>
                  <span className="font-medium">{order.pickupLocation}</span>
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(order.pickupLocation)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center text-[12px] font-bold text-[var(--brand)] underline underline-offset-2"
                  >
                    {t.directions}
                  </a>
                </Fact>
              ) : null}
            </dl>
          </div>

          <div className="border-t border-[var(--line)] pt-4">
            <dt className="t-eyebrow text-[var(--ink-soft)]">{t.netEarnings}</dt>
            <dd className="mt-1 text-[24px] font-black leading-7 tracking-[-0.5px] text-[var(--ink)]">
              {netEarning == null ? t.noAmount : `CA$${netEarning.toFixed(2)}`}
            </dd>
            <p className="mt-1 text-[11px] leading-4 text-[var(--ink-soft)]">
              {t.netEarningsNote}
            </p>
          </div>

          {order.notes ? (
            <div className="border-t border-[var(--line)] pt-4">
              <dt className="t-eyebrow text-[var(--ink-soft)]">{t.notes}</dt>
              <dd className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-[var(--ink)]">
                {order.notes}
              </dd>
            </div>
          ) : null}
        </section>

        {/* Right rail: who, and where to act. */}
        <aside className="space-y-3">
          <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
            <p className="t-eyebrow text-[var(--ink-soft)]">{t.guest}</p>
            <p className="mt-1 t-title text-[var(--ink)]">{order.renterName}</p>
            {order.renterPhone ? (
              <a
                href={`tel:${order.renterPhone}`}
                className="mt-1 block text-[13px] font-bold text-[var(--brand)]"
              >
                {order.renterPhone}
              </a>
            ) : null}

            <div className="mt-3 border-t border-[var(--line)] pt-3">
              <p className="t-eyebrow text-[var(--ink-soft)]">{t.reservation}</p>
              <p className="mt-1 text-[13px] font-bold tabular-nums text-[var(--ink)]">
                {order.externalOrderId ?? "—"}
              </p>
              {turoUrl ? (
                <a
                  href={turoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tap-press mt-2 flex items-center justify-center rounded-md bg-[var(--brand)] px-3 py-2 text-[12px] font-bold text-white transition hover:opacity-90"
                >
                  {t.openOnTuro} ↗
                </a>
              ) : (
                <p className="mt-1 text-[11px] leading-4 text-[var(--ink-soft)]">
                  {t.noExternalId}
                </p>
              )}
            </div>

            {order.vehicle.owner ? (
              <div className="mt-3 border-t border-[var(--line)] pt-3">
                <p className="t-eyebrow text-[var(--ink-soft)]">{t.owner}</p>
                <p className="mt-1 text-[13px] font-bold text-[var(--ink)]">
                  {order.vehicle.owner.name}
                </p>
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
            <p className="t-eyebrow text-[var(--ink-soft)]">
              {t.messages}
              {emails.length > 0 ? ` · ${t.messagesCount(emails.length)}` : ""}
            </p>
            {emails.length === 0 ? (
              <p className="mt-1.5 text-[11.5px] leading-5 text-[var(--ink-soft)]">
                {t.noMessages}
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {emails.slice(0, 5).map((email) => {
                  const summary = (() => {
                    if (!email.parsed) return null;
                    try {
                      return (JSON.parse(email.parsed) as { summary?: string }).summary ?? null;
                    } catch {
                      return null;
                    }
                  })();
                  return (
                    <li key={email.id} className="border-t border-[var(--line)] pt-2 first:border-0 first:pt-0">
                      <p className="text-[10.5px] tabular-nums text-[var(--ink-soft)]">
                        {email.receivedAt.toLocaleString(locale === "en" ? "en-CA" : "zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="mt-0.5 text-[12px] leading-5 text-[var(--ink)]">
                        {summary ?? email.subject}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link
              href="/messages"
              className="mt-2 inline-flex text-[12px] font-bold text-[var(--brand)] underline underline-offset-2"
            >
              {messages.guestMessagesPage.title} →
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
