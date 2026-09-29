/**
 * Extras a renter can add to a booking. Client-safe: the booking panel
 * prices with these, and checkout prices with the same functions from
 * the list it loads itself.
 */

export type AddOnUnit = "day" | "booking";

export const ADD_ON_UNITS: readonly AddOnUnit[] = ["day", "booking"];

/** Most a renter may pick at once; keeps Stripe metadata inside its limits. */
export const MAX_ADD_ONS_PER_BOOKING = 10;
export const ADD_ON_NAME_MAX = 40;

export type BookingAddOnOption = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  unit: AddOnUnit;
  taxable: boolean;
};

export type AddOnLine = BookingAddOnOption & { amount: number };

export function isAddOnUnit(value: unknown): value is AddOnUnit {
  return value === "day" || value === "booking";
}

/** What one add-on costs for `days` charged days. */
export function priceAddOn(addOn: Pick<BookingAddOnOption, "price" | "unit">, days: number) {
  const amount = addOn.unit === "day" ? addOn.price * Math.max(0, days) : addOn.price;
  return Math.round(Math.max(0, amount) * 100) / 100;
}

export function priceAddOns(addOns: BookingAddOnOption[] | null | undefined, days: number): AddOnLine[] {
  return (addOns ?? []).map((addOn) => ({ ...addOn, amount: priceAddOn(addOn, days) }));
}

/**
 * The renter's picks, in the operator's order. An id that is not on the
 * list is reported rather than dropped: an extra the renter believes
 * they bought must not quietly go missing from the bill.
 */
export function resolveAddOns(options: BookingAddOnOption[], ids: string[]) {
  const wanted = new Set(ids);
  const picked = options.filter((option) => wanted.has(option.id));
  return { picked, unknown: picked.length !== wanted.size };
}

/**
 * The snapshot a booking keeps, compact enough for Stripe metadata
 * (500 characters a value, so it is split across two keys).
 */
type AddOnSnapshot = { n: string; p: number; u: "d" | "b"; t: 0 | 1; a: number };

export function encodeAddOnsMetadata(lines: AddOnLine[]): { addOns: string; addOns2: string } {
  const json = JSON.stringify(
    lines.map<AddOnSnapshot>((line) => ({
      n: line.name.slice(0, ADD_ON_NAME_MAX),
      p: line.price,
      u: line.unit === "day" ? "d" : "b",
      t: line.taxable ? 1 : 0,
      a: line.amount,
    })),
  );
  return { addOns: lines.length ? json.slice(0, 500) : "", addOns2: json.slice(500, 1000) };
}

export type AddOnRecord = { name: string; price: number; unit: AddOnUnit; taxable: boolean; amount: number };

export function decodeAddOnsMetadata(first: string | undefined, second: string | undefined): AddOnRecord[] {
  if (!first) return [];
  try {
    const parsed = JSON.parse(first + (second ?? "")) as AddOnSnapshot[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      name: String(item.n),
      price: Number(item.p) || 0,
      unit: item.u === "d" ? "day" : "booking",
      taxable: item.t === 1,
      amount: Number(item.a) || 0,
    }));
  } catch {
    return [];
  }
}
