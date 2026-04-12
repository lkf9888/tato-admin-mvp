import "server-only";

import {
  Prisma,
  WorkspaceBillingStatus,
  type WorkspaceBilling,
} from "@prisma/client";
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

type FreeSlotCouponConfig = {
  code: string;
  bonusVehicleSlots: number;
  description: string;
};

export type BillingCouponResolution =
  | {
      kind: "free_slots";
      code: string;
      bonusVehicleSlots: number;
      description: string;
      snapshot: Awaited<ReturnType<typeof getWorkspaceBillingSnapshot>>;
    }
  | {
      kind: "promotion";
      code: string;
      promotionCodeId: string;
      description: string;
    };

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

function normalizeCouponCode(code: string) {
  return code.trim().toUpperCase();
}

function buildBillingReturnPath(input?: string, billingState?: string) {
  const fallback = "/billing";
  const normalized = input?.trim().startsWith("/") ? input.trim() : fallback;
  const url = new URL(normalized, "https://tato.local");
  if (billingState) {
    url.searchParams.set("billing", billingState);
  }
  return `${url.pathname}${url.search}`;
}

function formatStripeCouponDescription(coupon: Stripe.Coupon) {
  if (coupon.name?.trim()) {
    return coupon.name.trim();
  }

  if (coupon.percent_off) {
    return `${coupon.percent_off}% off`;
  }

  if (coupon.amount_off && coupon.currency) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: coupon.currency.toUpperCase(),
    }).format(coupon.amount_off / 100);
  }

  return "Stripe discount";
}

function parseConfiguredFreeSlotCoupons() {
  const rawCoupons = process.env.BILLING_FREE_SLOT_COUPONS?.trim();
  if (!rawCoupons) {
    return [];
  }

  return rawCoupons
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap<FreeSlotCouponConfig>((entry) => {
      const [rawCode, rawSlots, ...descriptionParts] = entry.split(":");
      const code = normalizeCouponCode(rawCode ?? "");
      const bonusVehicleSlots = Number.parseInt((rawSlots ?? "").trim(), 10);

      if (!code || !Number.isFinite(bonusVehicleSlots) || bonusVehicleSlots < 1) {
        return [];
      }

      return [
        {
          code,
          bonusVehicleSlots,
          description:
            descriptionParts.join(":").trim() || `${bonusVehicleSlots} free listing slot(s)`,
        },
      ];
    });
}

function getConfiguredFreeSlotCoupon(code: string) {
  const normalizedCode = normalizeCouponCode(code);
  return parseConfiguredFreeSlotCoupons().find((coupon) => coupon.code === normalizedCode) ?? null;
}

async function findStripePromotionCode(code: string) {
  if (!code || !isStripeBillingConfigured()) {
    return null;
  }

  const stripe = getStripeClient();
  const normalizedCode = normalizeCouponCode(code);
  const response = await stripe.promotionCodes.list({
    code: normalizedCode,
    active: true,
    limit: 1,
  });

  const promotionCode = response.data[0];
  if (!promotionCode?.active) {
    return null;
  }

  const coupon =
    typeof promotionCode.promotion.coupon === "string"
      ? await stripe.coupons.retrieve(promotionCode.promotion.coupon)
      : promotionCode.promotion.coupon;

  return {
    kind: "promotion" as const,
    code: promotionCode.code || normalizedCode,
    promotionCodeId: promotionCode.id,
    description: coupon ? formatStripeCouponDescription(coupon) : "Stripe discount",
  };
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
  return billing.freeVehicleSlots + billing.bonusVehicleSlots + getEffectivePurchasedVehicleSlots(billing);
}

export function getRequiredPaidSlotsForVehicleCount(
  vehicleCount: number,
  freeVehicleSlots = FREE_VEHICLE_SLOTS,
  bonusVehicleSlots = 0,
) {
  return Math.max(0, vehicleCount - freeVehicleSlots - bonusVehicleSlots);
}

export async function getWorkspaceBillingSnapshot() {
  const [billing, currentVehicleCount, currentUser] = await Promise.all([
    ensureWorkspaceBilling(),
    prisma.vehicle.count(),
    getCurrentAdminUser(),
  ]);

  const effectivePurchasedVehicleSlots = getEffectivePurchasedVehicleSlots(billing);
  const allowedVehicleCount = getAllowedVehicleCount(billing);
  const billingBypassActive = Boolean(currentUser?.isBillingExempt);
  const requiredPaidSlots = getRequiredPaidSlotsForVehicleCount(
    currentVehicleCount,
    billing.freeVehicleSlots,
    billing.bonusVehicleSlots,
  );

  return {
    billing,
    currentVehicleCount,
    freeVehicleSlots: billing.freeVehicleSlots,
    bonusVehicleSlots: billing.bonusVehicleSlots,
    purchasedVehicleSlots: billing.purchasedVehicleSlots,
    effectivePurchasedVehicleSlots,
    allowedVehicleCount,
    requiredPaidSlots,
    isOverLimit: billingBypassActive ? false : currentVehicleCount > allowedVehicleCount,
    billingBypassActive,
    stripeConfigured: isStripeBillingConfigured(),
    status: billing.status,
    currentPeriodEnd: billing.currentPeriodEnd,
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
    snapshot.bonusVehicleSlots,
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
    exceedsPurchasedLimit: snapshot.billingBypassActive
      ? false
      : projectedVehicleCount > snapshot.allowedVehicleCount,
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
      headline: "Manage TATO listing quota",
    },
    default_return_url: `${getAppUrl()}/billing`,
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

export async function resolveBillingCoupon(code: string): Promise<BillingCouponResolution> {
  const normalizedCode = normalizeCouponCode(code);
  if (!normalizedCode) {
    throw new Error("Please enter a coupon code first.");
  }

  await ensureWorkspaceBilling();
  const freeSlotCoupon = getConfiguredFreeSlotCoupon(normalizedCode);
  if (freeSlotCoupon) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.billingCouponRedemption.create({
          data: {
            workspaceBillingId: WORKSPACE_BILLING_ID,
            code: normalizedCode,
            couponType: "free_slots",
            bonusVehicleSlots: freeSlotCoupon.bonusVehicleSlots,
            metadata: freeSlotCoupon.description,
          },
        });

        await tx.workspaceBilling.update({
          where: { id: WORKSPACE_BILLING_ID },
          data: {
            bonusVehicleSlots: {
              increment: freeSlotCoupon.bonusVehicleSlots,
            },
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new Error("This free quota coupon has already been redeemed.");
      }
      throw error;
    }

    return {
      kind: "free_slots",
      code: normalizedCode,
      bonusVehicleSlots: freeSlotCoupon.bonusVehicleSlots,
      description: freeSlotCoupon.description,
      snapshot: await getWorkspaceBillingSnapshot(),
    };
  }

  const promotionCode = await findStripePromotionCode(normalizedCode);
  if (promotionCode) {
    return promotionCode;
  }

  throw new Error("Coupon code is invalid or inactive.");
}

export async function createBillingCheckoutUrl(input: {
  desiredPaidVehicleSlots: number;
  origin?: string;
  returnPath?: string;
  couponCode?: string;
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
  const returnPath = buildBillingReturnPath(input.returnPath, "updated");
  const successPath = buildBillingReturnPath(input.returnPath, "success");
  const cancelPath = buildBillingReturnPath(input.returnPath, "cancelled");
  const couponCode = normalizeCouponCode(input.couponCode ?? "");

  if (couponCode && getConfiguredFreeSlotCoupon(couponCode)) {
    throw new Error("This coupon adds free quota. Apply it on the quota page before checkout.");
  }

  const promotionCode = couponCode ? await findStripePromotionCode(couponCode) : null;

  if (billing.stripeSubscriptionId && billing.stripeSubscriptionItemId) {
    if (promotionCode) {
      const updatedSubscription = await stripe.subscriptions.update(billing.stripeSubscriptionId, {
        items: [
          {
            id: billing.stripeSubscriptionItemId,
            price: priceId,
            quantity: desiredPaidVehicleSlots,
          },
        ],
        discounts: [
          {
            promotion_code: promotionCode.promotionCodeId,
          },
        ],
        proration_behavior: "always_invoice",
      });

      await syncWorkspaceBillingFromStripeSubscription(updatedSubscription);
      return `${appUrl}${returnPath}`;
    }

    const configurationId = await ensurePortalConfigurationId(billing, stripe);
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      configuration: configurationId,
      return_url: `${appUrl}${returnPath}`,
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
    success_url: `${appUrl}${successPath}`,
    cancel_url: `${appUrl}${cancelPath}`,
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
    discounts: promotionCode
      ? [
          {
            promotion_code: promotionCode.promotionCodeId,
          },
        ]
      : undefined,
    metadata: {
      workspaceBillingId: WORKSPACE_BILLING_ID,
      desiredPaidVehicleSlots: String(desiredPaidVehicleSlots),
      couponCode: promotionCode?.code ?? "",
    },
    subscription_data: {
      metadata: {
        workspaceBillingId: WORKSPACE_BILLING_ID,
        desiredPaidVehicleSlots: String(desiredPaidVehicleSlots),
        couponCode: promotionCode?.code ?? "",
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
