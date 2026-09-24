import "server-only";

import type { RentalSite } from "@prisma/client";

import { getStripeClient, getStripeSecretKey } from "@/lib/stripe";
import {
  getBookingConversionValue,
  parseAdsSendTo,
  parseMeasurementId,
  type SiteConversion,
} from "@/lib/site-conversion";

/**
 * The booking a visitor just paid for, as Google should hear about it.
 *
 * Null unless everything checks out: the site reports to Google at
 * all, the id came back from Stripe in the shape Stripe makes, Stripe
 * says it was paid, and it was for this car. The URL is public and
 * anyone can type a session id into it, so the id is a key to look up,
 * never a value to trust. A failed lookup reports nothing rather than
 * breaking the thank-you page.
 */
export async function loadCheckoutConversion(
  site: RentalSite,
  vehicle: { id: string; brand: string; model: string; year: number },
  rawSessionId: string | string[] | undefined,
): Promise<SiteConversion | null> {
  if (!parseMeasurementId(site.analyticsId) && !parseAdsSendTo(site.adsConversionSendTo)) {
    return null;
  }
  const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
  if (!sessionId || !/^cs_(?:test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return null;
  if (!getStripeSecretKey()) return null;

  try {
    const session = await getStripeClient().checkout.sessions.retrieve(sessionId);
    const metadata = (session.metadata ?? {}) as Record<string, string | undefined>;
    if (session.payment_status !== "paid") return null;
    if (metadata.vehicleId !== vehicle.id || metadata.workspaceId !== site.workspaceId) return null;

    const { value, tax } = getBookingConversionValue(metadata);
    const days = Number(metadata.bookedDays);
    return {
      transactionId: session.id,
      value,
      tax,
      currency: (session.currency ?? "cad").toUpperCase(),
      itemId: vehicle.id,
      itemName: `${vehicle.year} ${vehicle.brand} ${vehicle.model}`,
      days: Number.isFinite(days) && days > 0 ? days : 1,
    };
  } catch {
    return null;
  }
}
