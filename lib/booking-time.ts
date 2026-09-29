/**
 * Pickup and return as moments, not just days.
 *
 * A renter picks a date and a time on the operator's own clock --
 * Vancouver for every operator today -- and the booking is charged per
 * started 24 hours, with a grace period so a car back ten minutes late
 * is not a whole extra day. Turo counts the same way, which is what
 * renters here already expect.
 *
 * No `server-only`: the booking panel prices in the browser and must
 * count days exactly as checkout will.
 */

/** The operator's clock. Every date and time a renter picks is on it. */
export const BOOKING_TIME_ZONE = "America/Vancouver";

/** What a new booking form starts on. */
export const DEFAULT_BOOKING_TIME = "10:00";

/** Minutes a return may run over a whole day before it counts as another. */
export const DEFAULT_RETURN_GRACE_MINUTES = 60;

/** Every half hour of the day, `00:00` to `23:30`. */
export const BOOKING_TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, index) => {
  const hours = String(Math.floor(index / 2)).padStart(2, "0");
  return `${hours}:${index % 2 === 0 ? "00" : "30"}`;
});

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isBookingTime(value: string | null | undefined): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

/** Minutes the zone is ahead of UTC at this instant (negative in Vancouver). */
function zoneOffsetMinutes(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant) / 60_000);
}

/**
 * A date and time on the operator's clock, as the instant it is.
 * Null when either part is malformed. Checked twice against the zone
 * so a time near a daylight-saving change lands on the right side.
 */
export function zonedDateTimeToUtc(
  date: string,
  time: string,
  timeZone: string = BOOKING_TIME_ZONE,
): Date | null {
  const dateMatch = DATE_PATTERN.exec(date);
  const timeMatch = TIME_PATTERN.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const naive = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  const first = zoneOffsetMinutes(naive, timeZone);
  let instant = naive - first * 60_000;
  const second = zoneOffsetMinutes(instant, timeZone);
  if (second !== first) instant = naive - second * 60_000;
  return new Date(instant);
}

function zonedParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** `YYYY-MM-DD` on the operator's clock -- not UTC, which in the
 *  evening in Vancouver is already tomorrow. */
export function utcToZonedDate(value: Date, timeZone: string = BOOKING_TIME_ZONE) {
  return zonedParts(value, timeZone).date;
}

/** `HH:MM` on the operator's clock. */
export function utcToZonedTime(value: Date, timeZone: string = BOOKING_TIME_ZONE) {
  return zonedParts(value, timeZone).time;
}

/**
 * Days charged for a trip: one per started 24 hours, with `graceMinutes`
 * forgiven at the end. Ten to ten the next day is one; ten to eleven
 * with an hour's grace is still one; ten to eleven-oh-one is two. A
 * trip shorter than a day is a day. Zero when the return is not after
 * the pickup, or either moment does not parse.
 */
export function getChargedDays(input: {
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  graceMinutes?: number | null;
}) {
  const pickup = zonedDateTimeToUtc(input.pickupDate, input.pickupTime);
  const dropoff = zonedDateTimeToUtc(input.returnDate, input.returnTime);
  if (!pickup || !dropoff) return 0;
  const minutes = (dropoff.getTime() - pickup.getTime()) / 60_000;
  if (minutes <= 0) return 0;
  const grace = Math.max(0, input.graceMinutes ?? DEFAULT_RETURN_GRACE_MINUTES);
  return Math.max(1, Math.ceil((minutes - grace) / 1440));
}
