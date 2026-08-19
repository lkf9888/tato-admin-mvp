/**
 * Attaching a Turo notification to the order it is about.
 *
 * Two paths, and the difference matters:
 *
 * 1. Booking notifications carry a reservation id, and that id IS the
 *    CSV's `externalOrderId`. That is an exact join, handled at ingest
 *    -- no guessing, no scoring, nothing for this module to do.
 *
 * 2. Guest messages carry no reservation id. Turo's subject gives a
 *    name and a car ("Fatima has sent you a message about your Ford
 *    Explorer"), and that is all. This module turns those two strings
 *    plus the arrival time into an order, or into null.
 *
 * Null is a normal answer, not a failure. A message shown against the
 * wrong trip is worse than a message shown against no trip: the
 * operator reads the wrong dates, quotes the wrong price, and answers
 * a different guest. So an ambiguous match refuses.
 *
 * Deliberately pure -- no prisma import. The queries live in the
 * caller, which keeps the decision testable against fixtures.
 */

/** Ignore case, punctuation, spacing and accents; keep CJK. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "");
}

/** Vehicle text as Turo writes it, reduced for comparison. */
function normalizeVehicle(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export type VehicleForMatch = {
  id: string;
  brand: string;
  model: string;
  year: number;
  nickname: string;
  turoListingName: string | null;
  /** Which Turo account the listing sits on; null is the main one. */
  turoAccount?: string | null;
};

/**
 * Vehicles whose identity matches the listing text in the subject.
 *
 * Returns a set, not one vehicle, and that is the point: a fleet this
 * size runs several of the same model, so "Tesla Model 3" is a
 * narrowing, not an identification. The order match uses it that way.
 */
export function matchVehicles(
  vehicleText: string,
  vehicles: VehicleForMatch[],
  /** The account the notification came from, when known. Two Turo
   *  accounts can list the same model, and this fleet runs four Tesla
   *  Model Y 2020s across them -- so the account is often the only
   *  thing that narrows a match to one car. Undefined means "do not
   *  filter"; null means the main account, which is a real value. */
  coHostAccount?: string | null,
): VehicleForMatch[] {
  const wanted = normalizeVehicle(vehicleText);
  if (!wanted) return [];

  const scoped =
    coHostAccount === undefined
      ? vehicles
      : vehicles.filter((vehicle) => (vehicle.turoAccount ?? null) === coHostAccount);

  return scoped.filter((vehicle) => {
    const candidates = [
      `${vehicle.brand} ${vehicle.model}`,
      `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
      vehicle.turoListingName ?? "",
      vehicle.nickname,
    ]
      .filter(Boolean)
      .map(normalizeVehicle);

    // Turo sometimes appends the year and sometimes does not, so accept
    // either direction of containment rather than equality alone.
    return candidates.some(
      (candidate) =>
        candidate === wanted ||
        (candidate.length >= 6 && wanted.startsWith(candidate)) ||
        (wanted.length >= 6 && candidate.startsWith(wanted)),
    );
  });
}

export type OrderForMatch = {
  id: string;
  renterName: string;
  vehicleId: string;
  pickupDatetime: Date;
  returnDatetime: Date;
};

/**
 * How far outside a trip's own dates a message still counts as being
 * about that trip.
 *
 * Guests ask questions before they book and leave notes after they
 * return, so the window has to be wider than the trip. Fourteen days
 * is loose enough to catch both without spanning a repeat guest's next
 * booking of the same car -- and if it does span two, the ambiguity
 * check refuses rather than picking.
 */
const MESSAGE_WINDOW_DAYS = 14;

export function pickOrderForMessage(input: {
  guestName: string | null;
  /** Vehicles the subject's listing text matched, if any. */
  vehicleIds: string[];
  receivedAt: Date;
  candidates: OrderForMatch[];
}): string | null {
  if (!input.guestName) return null;
  const wanted = normalizeName(input.guestName);
  if (!wanted) return null;

  const windowMs = MESSAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const vehicleFilter = new Set(input.vehicleIds);

  const matches = input.candidates.filter((order) => {
    const name = normalizeName(order.renterName);
    // Turo shows a first name where the CSV may hold the full one, so
    // accept a prefix in either direction. Both sides are already
    // stripped to letters, which keeps "Anna" from matching "Annabel"
    // only by luck -- so require a real length before allowing it.
    const nameMatches =
      name === wanted ||
      (wanted.length >= 3 && name.startsWith(wanted)) ||
      (name.length >= 3 && wanted.startsWith(name));
    if (!nameMatches) return false;

    if (vehicleFilter.size > 0 && !vehicleFilter.has(order.vehicleId)) return false;

    const from = order.pickupDatetime.getTime() - windowMs;
    const to = order.returnDatetime.getTime() + windowMs;
    const at = input.receivedAt.getTime();
    return at >= from && at <= to;
  });

  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) return null;

  // Several trips fit. The one whose dates surround the message wins
  // outright -- a guest writing mid-trip is writing about that trip.
  const at = input.receivedAt.getTime();
  const during = matches.filter(
    (order) => at >= order.pickupDatetime.getTime() && at <= order.returnDatetime.getTime(),
  );
  if (during.length === 1) return during[0].id;

  // Still more than one, so there is no answer that is safe to show.
  return null;
}
