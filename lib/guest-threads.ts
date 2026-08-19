/**
 * Turning notification emails into conversations.
 *
 * Turo does not send us a thread; it sends one email per guest message
 * with no thread id and no in-reply-to. What it does put in every
 * subject is the guest's name and the car, and a guest talking about
 * one car is one conversation -- so that pair is the thread key.
 *
 * The grouping is deliberately not on the matched order. A guest often
 * writes before there is a booking to match, and those messages are
 * exactly the ones worth answering fastest; keying on the order would
 * scatter them into unattached singletons.
 *
 * Pure -- the query lives in the page. Same reason as the matcher:
 * grouping rules are worth testing without a database.
 */

export type ThreadEmail = {
  id: string;
  subject: string;
  guestName: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
  receivedAt: Date;
  acknowledgedAt: Date | null;
  turoLink: string | null;
  orderId: string | null;
  /** The model's one-line reading of the message, when it has run. */
  summary: string | null;
  needsAction: boolean;
};

export type GuestThread = {
  /** Stable across renders and reloads, so selection survives a refresh. */
  key: string;
  guestName: string;
  vehicleId: string | null;
  vehicleLabel: string | null;
  /** Newest first — the reason someone opens this page is the last message. */
  messages: ThreadEmail[];
  latestAt: Date;
  /** Messages not yet marked handled. Drives the badge and the sort. */
  openCount: number;
  /** The order these messages are about, if any message matched one. */
  orderId: string | null;
  /** Newest link Turo gave us for this guest — where "reply on Turo" goes. */
  turoLink: string | null;
};

export function threadKey(guestName: string, vehicleId: string | null) {
  return `${guestName.toLowerCase()}::${vehicleId ?? "-"}`;
}

export function groupIntoThreads(emails: ThreadEmail[]): GuestThread[] {
  const byKey = new Map<string, ThreadEmail[]>();

  for (const email of emails) {
    // A message with no guest name is not a conversation -- it is a
    // notification that happened to be classified as one. Leave it to
    // the inbox rather than inventing a thread called "unknown".
    if (!email.guestName) continue;
    const key = threadKey(email.guestName, email.vehicleId);
    const list = byKey.get(key) ?? [];
    list.push(email);
    byKey.set(key, list);
  }

  const threads = [...byKey.entries()].map(([key, list]) => {
    const messages = [...list].sort(
      (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
    );
    const newest = messages[0];

    return {
      key,
      guestName: newest.guestName as string,
      vehicleId: newest.vehicleId,
      // Read off whichever message actually resolved a vehicle: an
      // older message may have matched where the newest did not.
      vehicleLabel: messages.find((m) => m.vehicleLabel)?.vehicleLabel ?? null,
      messages,
      latestAt: newest.receivedAt,
      openCount: messages.filter((m) => !m.acknowledgedAt).length,
      orderId: messages.find((m) => m.orderId)?.orderId ?? null,
      turoLink: messages.find((m) => m.turoLink)?.turoLink ?? null,
    };
  });

  // Anything still open sorts above anything handled, and within each
  // half the most recent first. A page ordered purely by time buries
  // an unanswered message from this morning under this evening's
  // notifications.
  return threads.sort((a, b) => {
    if ((a.openCount > 0) !== (b.openCount > 0)) return a.openCount > 0 ? -1 : 1;
    return b.latestAt.getTime() - a.latestAt.getTime();
  });
}
