import { TuroUpdatesFeed } from "@/components/turo-updates-feed";
import { requireCurrentAdminContext } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";

/**
 * Everything Turo has emailed, one line each.
 *
 * The guest-messages page answers "who is waiting on me". This
 * answers the different question the operator was opening their
 * mailbox for: what happened today. Bookings, cancellations, payouts,
 * pickups, support threads — the whole stream, summarised, so reading
 * it is a scroll rather than a session in Gmail.
 *
 * Deliberately read-only. Anything that needs doing has a page of its
 * own already; a feed that also acts on things becomes a second, worse
 * version of those pages.
 */
export default async function TuroUpdatesPage() {
  const [{ locale, messages }, { workspace }] = await Promise.all([
    getI18n(),
    requireCurrentAdminContext(),
  ]);

  const emails = await prisma.inboundEmail.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { receivedAt: "desc" },
    // A fortnight of activity. Older than that is a search, and the
    // page would be shipping a megabyte to answer a question nobody is
    // asking at a glance.
    take: 300,
    select: {
      id: true,
      kind: true,
      subject: true,
      guestName: true,
      guestText: true,
      guestTextZh: true,
      summaryZh: true,
      parsed: true,
      receivedAt: true,
      acknowledgedAt: true,
      turoLink: true,
      orderId: true,
      turoAccount: true,
      vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } },
      order: {
        select: {
          id: true,
          vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } },
        },
      },
    },
  });

  const t = messages.turoUpdates;

  return (
    <div className="space-y-3">
      <header className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-3 sm:px-4">
        <p className="t-eyebrow text-[var(--ink-soft)]">{t.kicker}</p>
        <h1 className="mt-0.5 text-[17px] font-bold text-[var(--ink)] sm:text-[19px]">{t.title}</h1>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[var(--ink-soft)]">{t.copy}</p>
      </header>

      <TuroUpdatesFeed
        locale={locale}
        items={emails.map((email) => {
          const extracted = (() => {
            if (!email.parsed) return null;
            try {
              return JSON.parse(email.parsed) as { summary?: string; needsAction?: boolean };
            } catch {
              return null;
            }
          })();

          const vehicle = email.vehicle ?? email.order?.vehicle ?? null;

          return {
            id: email.id,
            kind: email.kind,
            receivedAt: email.receivedAt.toISOString(),
            guestName: email.guestName,
            vehicleLabel: vehicle
              ? `${vehicle.year} ${vehicle.brand} ${vehicle.model}`
              : null,
            vehiclePlate: vehicle?.plateNumber ?? null,
            turoAccount: email.turoAccount,
            // What actually happened, in one line: the guest's words
            // where they wrote any, the model's reading of the
            // notification where they did not.
            headline: email.guestText ?? extracted?.summary ?? email.subject,
            // The Chinese summary first: this page is skimmed, and
            // "what is this about" is better served by a sentence
            // saying what happened than by a faithful rendering of
            // three paragraphs. The guest's translated words are the
            // fallback, for rows extracted before the summary existed.
            headlineZh: email.summaryZh ?? email.guestTextZh,
            needsAction: extracted?.needsAction === true && email.acknowledgedAt == null,
            turoLink: email.turoLink,
            orderId: email.orderId,
          };
        })}
      />
    </div>
  );
}
