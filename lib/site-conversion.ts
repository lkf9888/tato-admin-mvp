/**
 * What a paid booking tells Google, worked out without a browser.
 *
 * Pure, so the page can compute it on the server from the Checkout
 * session and the client only has to hand it to gtag.
 */

export type SiteConversion = {
  /** The Checkout session id. Google de-duplicates on it, so a renter
   *  reloading the thank-you page is still one booking. */
  transactionId: string;
  value: number;
  tax: number;
  currency: string;
  itemId: string;
  itemName: string;
  days: number;
};

const SEND_TO_PATTERN = /^(AW-\d{6,12})\/([A-Za-z0-9_-]{4,64})$/;

/** `AW-123456789/AbC-dEf` → its tag id, or null when it is not one. */
export function parseAdsSendTo(value: string | null | undefined) {
  const clean = value?.trim() ?? "";
  const match = SEND_TO_PATTERN.exec(clean);
  return match ? { sendTo: clean, tagId: match[1] } : null;
}

/** GA4 (`G-`), Ads (`AW-`) or a Google tag (`GT-`) id, or null. */
export function parseMeasurementId(value: string | null | undefined) {
  const clean = value?.trim() ?? "";
  return /^(?:G|AW|GT)-[A-Z0-9-]{4,20}$/i.test(clean) ? clean : null;
}

/**
 * What the booking is worth to the operator, which is what an ad
 * bidding on it should optimise for.
 *
 * The whole contract, not the first instalment: a three-month rental
 * paid monthly was still won by the one click. Less the deposit,
 * which goes back, and less the tax, which was never theirs -- a
 * bidder told a $300 deposit is revenue will pay for clicks that only
 * ever bring deposits.
 */
export function getBookingConversionValue(metadata: Record<string, string | undefined>) {
  const read = (key: string) => {
    const value = Number(metadata[key]);
    return Number.isFinite(value) ? value : 0;
  };
  const total = read("contractTotal");
  const tax = read("taxAmount");
  const value = Math.max(0, Math.round((total - read("depositAmount") - tax) * 100) / 100);
  return { value, tax: Math.round(tax * 100) / 100 };
}

/**
 * The hits a paid booking sends: a GA4 `purchase` when the site has a
 * GA4 property, and an Ads `conversion` when it has a conversion
 * action. Each is addressed with `send_to`, so the Ads conversion is
 * not also counted as a GA4 event and vice versa.
 */
export function sendConversionEvents(
  gtag: (...args: unknown[]) => void,
  conversion: SiteConversion,
  measurementId: string | null,
  adsSendTo: string | null,
) {
  if (measurementId && !measurementId.startsWith("AW-")) {
    gtag("event", "purchase", {
      send_to: measurementId,
      transaction_id: conversion.transactionId,
      value: conversion.value,
      tax: conversion.tax,
      currency: conversion.currency,
      items: [
        {
          item_id: conversion.itemId,
          item_name: conversion.itemName,
          quantity: conversion.days,
          price: Math.round((conversion.value / Math.max(1, conversion.days)) * 100) / 100,
        },
      ],
    });
  }
  if (adsSendTo) {
    gtag("event", "conversion", {
      send_to: adsSendTo,
      transaction_id: conversion.transactionId,
      value: conversion.value,
      currency: conversion.currency,
    });
  }
}
