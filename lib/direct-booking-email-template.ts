/**
 * The confirmation a renter gets after paying on a direct-booking page.
 *
 * Operator-editable, because the words are theirs: the pickup ritual,
 * what to bring, whether the deposit comes back in a week or two.
 * Baking that into the codebase means a wording change is a deploy.
 *
 * Same substitution shape as the staff-task templates -- `{name}` in
 * single braces, and a rendered line that reduces to a bare label is
 * dropped rather than emitted as "Security deposit:" with nothing
 * after it.
 *
 * No `server-only` here on purpose: the admin editor previews a
 * rendered sample in the browser, and that preview has to be the same
 * code that sends, or the preview is a drawing of an email rather than
 * the email.
 */

export type DirectBookingEmailTemplate = {
  subjectTemplate: string;
  bodyTemplate: string;
};

type NullableDirectBookingEmailTemplate = {
  subjectTemplate?: string | null;
  bodyTemplate?: string | null;
};

export type DirectBookingEmailValues = {
  renterName: string;
  brandName: string;
  vehicleName: string;
  vehicleDetail: string;
  plateNumber: string;
  pickupDate: string;
  returnDate: string;
  days: string;
  /**
   * What the card was actually charged. On a long booking billed in
   * periods that is the first period only -- which is why this keeps
   * the name the default template already uses next to "Total paid".
   * A saved template that predates instalments stays truthful.
   */
  totalAmount: string;
  /** The whole booking, when it differs from what was paid today. */
  bookingTotal: string;
  /** What is still to be collected. Empty on a single payment. */
  balanceDue: string;
  depositAmount: string;
  contactPhone: string;
  contactEmail: string;
  bookingRef: string;
};

export const DIRECT_BOOKING_EMAIL_DEFAULT_TEMPLATE: DirectBookingEmailTemplate = {
  subjectTemplate: "{brandName} booking confirmed — {vehicleName}, {pickupDate}",
  bodyTemplate: [
    "Hi {renterName},",
    "",
    "Your booking is confirmed and paid. Here are the details:",
    "",
    "Vehicle: {vehicleDetail} ({plateNumber})",
    "Pick-up: {pickupDate}",
    "Return: {returnDate}",
    "Days: {days}",
    "Paid today: {totalAmount}",
    "Booking total: {bookingTotal}",
    "Still to pay: {balanceDue}",
    "Security deposit: {depositAmount}",
    "Reference: {bookingRef}",
    "",
    "The security deposit is refunded after the vehicle is returned and checked over.",
    "",
    "Please bring the driver's licence you uploaded. If anything about your trip changes, tell us as early as you can.",
    "",
    "Questions: {contactPhone}",
    "Email: {contactEmail}",
    "",
    "{brandName}",
  ].join("\n"),
};

export const DIRECT_BOOKING_EMAIL_VARIABLES = [
  "renterName",
  "brandName",
  "vehicleName",
  "vehicleDetail",
  "plateNumber",
  "pickupDate",
  "returnDate",
  "days",
  "totalAmount",
  "bookingTotal",
  "balanceDue",
  "depositAmount",
  "contactPhone",
  "contactEmail",
  "bookingRef",
] as const;

/** What the admin editor renders its preview against. */
export const DIRECT_BOOKING_EMAIL_SAMPLE_VALUES: DirectBookingEmailValues = {
  renterName: "Jordan Fraser",
  brandName: "Pacific Coast Rentals",
  vehicleName: "Toyota Corolla",
  vehicleDetail: "Toyota Corolla 2022",
  plateNumber: "TC22CC",
  pickupDate: "2026/10/02",
  returnDate: "2026/10/06",
  days: "4",
  totalAmount: "$463.52",
  bookingTotal: "",
  balanceDue: "",
  depositAmount: "$300.00",
  contactPhone: "+1 604 555 0147",
  contactEmail: "hello@example.com",
  bookingRef: "A1B2C3D4",
};

export function normalizeDirectBookingEmailTemplate(
  template?: NullableDirectBookingEmailTemplate | null,
): DirectBookingEmailTemplate {
  return {
    subjectTemplate:
      template?.subjectTemplate?.trim() ||
      DIRECT_BOOKING_EMAIL_DEFAULT_TEMPLATE.subjectTemplate,
    bodyTemplate:
      template?.bodyTemplate?.trim() || DIRECT_BOOKING_EMAIL_DEFAULT_TEMPLATE.bodyTemplate,
  };
}

export function renderDirectBookingEmailTemplate(
  template: string,
  values: DirectBookingEmailValues,
) {
  const rendered = template.replace(
    /\{([a-zA-Z0-9_]+)\}/g,
    (_match, key: string) => values[key as keyof DirectBookingEmailValues] ?? "",
  );

  return rendered
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    // A line that reduced to "Security deposit:" is a field this
    // booking does not have. Dropping it beats sending the renter a
    // label with nothing after it.
    .filter((line) => !/^[^:：\n]{1,28}[：:]\s*$/.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A subject is one line, whatever the operator pasted in. */
export function renderDirectBookingEmailSubject(
  template: string,
  values: DirectBookingEmailValues,
) {
  return renderDirectBookingEmailTemplate(template, values).replace(/\s*\n+\s*/g, " ").trim();
}
