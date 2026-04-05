import "server-only";

import { WorkspaceBillingStatus, type WorkspaceBilling } from "@prisma/client";
import type Stripe from "stripe";

import { getCurrentAdminUser } from "@/lib/auth";
import { estimateImportVehicleImpact, type CsvFieldMapping } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { getAppUrl, getStripeClient, getStripePriceId, isStripeBillingConfigured } from "@/lib/stripe";

const WORKSPACE_BILLING_ID = "default";
export const FREE_VEHICLE_SLOTS = 5;

const ACTIVE_BILLING_STATUSES = new Set<WorkspaceBillingStatus>([
  WorkspaceBillingStatus.active,
  WorkspaceBillingStatus.trialing,
]);

function mapStripeSubscriptionStatus(status?: Stripe.Subscription.Status | null) {
  switch (status) {
    case "incomplete":
      return WorkspaceBillingStatus.incomplete;
    case "incomplete_expired":
      return WorkspaceBillingStatus.incomplete_expired;
    case "trialing":
      return WorkspaceBillingStatus.trialing;
    case "active":
      return WorkspaceBillingStatus.active;
    case "past_due":
      return WorkspaceBillingStatus.past_due;
    case "canceled":
      return WorkspaceBillingStatus.canceled;
    case "unpaid":
      return WorkspaceBillingStatus.unpaid;
    case "paused":
      return WorkspaceBillingStatus.paused;
    default:
      return WorkspaceBillingStatus.inactive;
  }
}

export async function ensureWorkspaceBilling() {
  return prisma.workspaceBilling.upsert({
    where: { id: WORKSPACE_BILLING_ID },
    update: {},
    create: {
      id: WORKSPACE_BILLING_ID,
      freeVehicleSlots: FREE_VEHICLE_SLOTS,
    },
  });
}

export function getEffectivePurchasedVehicleSlots(billing: WorkspaceBilling) {
  return ACTIVE_BILLING_STATUSES.has(billing.status) ? billing.purchasedVehicleSlots : 0;
}

export function getAllowedVehicleCount(billing: WorkspaceBilling) {
  return billing.freeVehicleSlots + getEffectivePurchasedVehicleSlots(billing);
}

export function getRequiredPaidSlotsForVehicleCount(
  vehicleCount: number,
  freeVehicleSlots = FREE_VEHICLE_SLOTS,
) {
  return Math.max(0, vehicleCount - freeVehicleSlots);
}

export async function getWorkspaceBillingSnapshot() {
  const [billing, currentVehicleCount] = await Promise.all([
    ensureWorkspaceBilling(),
    prisma.vehicle.count(),
  ]);

  const effectivePurchasedVehicleSlots = getEffectivePurchasedVehicleSlots(billing);
  const allowedVehicleCount = getAllowedVehicleCount(billing);
  const requiredPaidSlots = getRequiredPaidSlotsForVehicleCount(currentVehicleCount, billing.freeVehicleSlots);

  return {
    billing,
    currentVehicleCount,
    freeVehicleSlots: billing.freeVehicleSlots,
    purchasedVehicleSlots: billing.purchasedVehicleSlots,
    effectivePurchasedVehicleSlots,
    allowedVehicleCount,
    requiredPaidSlots,
    isOverLimit: currentVehicleCount > allowedVehicleCount,
    stripeConfigured: isStripeBillingConfigured(),
  };
}

export async function getImportBillingProjection(input: {
  mapping: CsvFieldMapping;
  rows: Record<string, string>[];
  createMissingVehicles?: boolean;
}) {
  const [snapshot, impact] = await Promise.all([
    getWorkspaceBillingSnapshot(),
    estimateImportVehicleImpact({
      mapping: input.mapping,
      rows: input.rows,
      createMissingVehicles: input.createMissingVehicles,
    }),
  ]);

  const projectedVehicleCount = Math.max(snapshot.currentVehicleCount, impact.projectedVehicleCount);
  const requiredPaidSlots = getRequiredPaidSlotsForVehicleCount(
    projectedVehicleCount,
    snapshot.freeVehicleSlots,
  );
  const additionalPaidSlotsNeeded = Math.max(
    0,
    requiredPaidSlots - snapshot.effectivePurchasedVehicleSlots,
  );

  return {
    ...snapshot,
    projectedVehicleCount,
    projectedNewVehicleCount: impact.projectedNewVehicleCount,
    requiredProjectedPaidSlots: requiredPaidSlots,
    additionalPaidSlotsNeeded,
    exceedsPurchasedLimit: projectedVehicleCount > snapshot.allowedVehicleCount,
  };
}

export async function assertImportWithinBillingLimit(input: {
  mapping: CsvFieldMapping;
  rows: Record<string, string>[];
  createMissingVehicles?: boolean;
}) {
  const projection = await getImportBillingProjection(input);
  if (!projection.exceedsPurchasedLimit) {
    return projection;
  }

  const error = new Error("Vehicle limit exceeded for the current subscription.");
  (error as Error & { code?: string; details?: unknown }).code = "BILLING_LIMIT_EXCEEDED";
  (error as Error & { code?: string; details?: unknown }).details = projection;
  throw error;
}

async function ensureStripeCustomer() {
  const [billing, currentUser] = await Promise.all([
    ensureWorkspaceBilling(),
    getCurrentAdminUser(),
  ]);

  if (!currentUser) {
    throw new Error("Please sign in again before starting checkout.");
  }

  if (billing.stripeCustomerId) {
    return {
      billing,
      currentUser,
      stripeCustomerId: billing.stripeCustomerId,
    };
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email: currentUser.email,
    name: currentUser.name,
    metadata: {
      workspaceBillingId: WORKSPACE_BILLING_ID,
    },
  });

  const nextBilling = await prisma.workspaceBilling.update({
    where: { id: billing.id },
    data: {
      stripeCustomerId: customer.id,
    },
  });

  return {
    billing: nextBilling,
    currentUser,
    stripeCustomerId: customer.id,
  };
}

async function ensurePortalConfigurationId(
  billing: WorkspaceBilling,
  stripe: Stripe,
) {
  if (billing.stripePortalConfigurationId) {
    return billing.stripePortalConfigurationId;
  }

  const priceId = getStripePriceId();
  const price = await stripe.prices.retrieve(priceId);
  const productId =
    typeof price.product === "string" ? price.product : price.product?.id;

  if (!productId) {
    throw new Error("Stripe price configuration is missing a product.");
  }

  const configuration = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: "Manage TATO listing subscription",
    },
    default_return_url: `${getAppUrl()}/imports`,
    features: {
      invoice_history: {
        enabled: true,
      },
      payment_method_update: {
        enabled: true,
      },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["quantity"],
        products: [
          {
            product: productId,
            prices: [priceId],
          },
        ],
        proration_behavior: "always_invoice",
      },
    },
  });

  await prisma.workspaceBilling.update({
    where: { id: billing.id },
    data: {
      stripePortalConfigurationId: configuration.id,
      stripePriceId: priceId,
    },
  });

  return configuration.id;
}

export async function createBillingCheckoutUrl(input: {
  desiredPaidVehicleSlots: number;
  origin?: string;
}) {
  if (!isStripeBillingConfigured()) {
    throw new Error("Stripe billing is not configured yet.");
  }

  const desiredPaidVehicleSlots = Math.max(0, Math.floor(input.desiredPaidVehicleSlots));
  if (desiredPaidVehicleSlots < 1) {
    throw new Error("Please choose at least 1 paid vehicle slot.");
  }

  const stripe = getStripeClient();
  const { billing, stripeCustomerId } = await ensureStripeCustomer();
  const appUrl = getAppUrl(input.origin);
  const priceId = getStripePriceId();

  if (billing.stripeSubscriptionId && billing.stripeSubscriptionItemId) {
    const configurationId = await ensurePortalConfigurationId(billing, stripe);

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      configuration: configurationId,
      return_url: `${appUrl}/imports?billing=updated`,
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: billing.stripeSubscriptionId,
          items: [
            {
              id: billing.stripeSubscriptionItemId,
              price: priceId,
              quantity: desiredPaidVehicleSlots,
            },
          ],
        },
      },
    });

    return session.url;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    success_url: `${appUrl}/imports?billing=success`,
    cancel_url: `${appUrl}/imports?billing=cancelled`,
    line_items: [
      {
        price: priceId,
        quantity: desiredPaidVehicleSlots,
        adjustable_quantity: {
          enabled: true,
          minimum: 1,
          maximum: 500,
        },
      },
    ],
    metadata: {
      workspaceBillingId: WORKSPACE_BILLING_ID,
      desiredPaidVehicleSlots: String(desiredPaidVehicleSlots),
    },
    subscription_data: {
      metadata: {
        workspaceBillingId: WORKSPACE_BILLING_ID,
        desiredPaidVehicleSlots: String(desiredPaidVehicleSlots),
      },
    },
  });

  await prisma.workspaceBilling.update({
    where: { id: billing.id },
    data: {
      stripeLatestCheckoutSessionId: session.id,
      lastCheckoutAt: new Date(),
      stripePriceId: priceId,
      status:
        billing.status === WorkspaceBillingStatus.active
          ? billing.status
          : WorkspaceBillingStatus.incomplete,
    },
  });

  return session.url;
}

export async function syncWorkspaceBillingFromStripeSubscription(
  subscription: Stripe.Subscription,
) {
  const billing = await ensureWorkspaceBilling();
  const primaryItem = subscription.items.data[0];
  const purchasedVehicleSlots = primaryItem?.quantity ?? 0;

  return prisma.workspaceBilling.update({
    where: { id: billing.id },
    data: {
      stripeCustomerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id ?? billing.stripeCustomerId,
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionItemId: primaryItem?.id ?? null,
      stripePriceId:
        (typeof primaryItem?.price === "string"
          ? primaryItem.price
          : primaryItem?.price?.id) ?? billing.stripePriceId,
      purchasedVehicleSlots,
      status: mapStripeSubscriptionStatus(subscription.status),
      currentPeriodStart: subscription.items.data[0]?.current_period_start
        ? new Date(subscription.items.data[0].current_period_start * 1000)
        : null,
      currentPeriodEnd: subscription.items.data[0]?.current_period_end
        ? new Date(subscription.items.data[0].current_period_end * 1000)
        : null,
    },
  });
}

export async function syncWorkspaceBillingFromSubscriptionId(subscriptionId: string) {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return syncWorkspaceBillingFromStripeSubscription(subscription);
}

export async function markWorkspaceBillingInvoicePaid(customerId?: string | null) {
  const billing = await ensureWorkspaceBilling();
  if (customerId && billing.stripeCustomerId && customerId !== billing.stripeCustomerId) {
    return billing;
  }

  return prisma.workspaceBilling.update({
    where: { id: billing.id },
    data: {
      lastPaidAt: new Date(),
      status:
        billing.status === WorkspaceBillingStatus.trialing
          ? WorkspaceBillingStatus.trialing
          : WorkspaceBillingStatus.active,
    },
  });
}

export async function markWorkspaceBillingInvoiceFailed(customerId?: string | null) {
  const billing = await ensureWorkspaceBilling();
  if (customerId && billing.stripeCustomerId && customerId !== billing.stripeCustomerId) {
    return billing;
  }

  return prisma.workspaceBilling.update({
    where: { id: billing.id },
    data: {
      status: WorkspaceBillingStatus.past_due,
    },
  });
}
