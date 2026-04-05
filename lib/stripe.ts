import "server-only";

import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY ?? "";
}

export function getStripePriceId() {
  return process.env.STRIPE_LISTING_PRICE_ID ?? "";
}

export function getStripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET ?? "";
}

export function isStripeBillingConfigured() {
  return Boolean(getStripeSecretKey() && getStripePriceId());
}

export function getStripeClient() {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    throw new Error("Stripe secret key is not configured.");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey);
  }

  return stripeClient;
}

export function getAppUrl(origin?: string) {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/$/, "");
  }

  if (origin) {
    return origin.replace(/\/$/, "");
  }

  return "http://localhost:3000";
}
