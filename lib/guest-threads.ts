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
  vehiclePlate: string | null;
  avatarUrl: string | null;
  receivedAt: Date;
  acknowledgedAt: Date | null;
  /** When the operator opened the conversation; see `unreadCount`.
   *  Optional so callers that never show it (the agent API) need not
   *  select it; absent reads as unread. */
  readAt?: Date | null;
  turoLink: string | null;
  orderId: string | null;
  /** What the guest actually wrote, when the template carried it. */
  guestText: string | null;
  /** The model's one-line reading of the message, when it has run. */
  summary: string | null;
  /** The guest's words in Chinese, word for word. */
  summaryZh: string | null;
  /** One sentence in Chinese saying what the message is about. */
  summaryZhBrief: string | null;
  needsAction: boolean;
};

export type GuestThread = {
  /** Stable across renders and reloads, so selection survives a refresh. */
  key: string;
  guestName: string;
  vehicleId: string | null;
  vehicleLabel: string | null;
  vehiclePlate: string | null;
  /** Newest photo Turo sent for this guest, when any message carried one. */
  avatarUrl: string | null;
  /** Newest message's summary, for the list row. */
  latestSummary: string | null;
  latestSummaryZh: string | null;
  /** Newest first — the reason someone opens this page is the last message. */
  messages: ThreadEmail[];
  latestAt: Date;
  /** Messages not yet marked handled: "needs reply", and the sort. */
  openCount: number;
  /** Messages nobody has opened yet -- neither read nor handled. Drives
   *  the red badge, which used to show `openCount` and so stayed lit
   *  after the operator had looked. */
  unreadCount: number;
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
      vehiclePlate: messages.find((m) => m.vehiclePlate)?.vehiclePlate ?? null,
      avatarUrl: messages.find((m) => m.avatarUrl)?.avatarUrl ?? null,
      latestSummary: newest.guestText ?? newest.summary,
      latestSummaryZh: newest.summaryZh,
      messages,
      latestAt: newest.receivedAt,
      openCount: messages.filter((m) => !m.acknowledgedAt).length,
      unreadCount: messages.filter((m) => !m.acknowledgedAt && !m.readAt).length,
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
