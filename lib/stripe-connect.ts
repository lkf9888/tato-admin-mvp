import "server-only";

import type Stripe from "stripe";

import { prisma } from "@/lib/prisma";
import { getAppUrl, getStripeClient, getStripeSecretKey } from "@/lib/stripe";

// Platform keeps a 5% cut of every renter-to-host payment. The rest is
// settled on-behalf-of the host's Connect account so the renter's card
// statement shows the host's business name, not the TATO platform name.
export const PLATFORM_APPLICATION_FEE_PERCENT = 5;

export type ConnectCountry = "CA" | "US";

const SUPPORTED_CONNECT_COUNTRIES: ConnectCountry[] = ["CA", "US"];

export function isConnectCountry(value: string | null | undefined): value is ConnectCountry {
  return typeof value === "string" && SUPPORTED_CONNECT_COUNTRIES.includes(value as ConnectCountry);
}

export function getSupportedConnectCountries(): ConnectCountry[] {
  return [...SUPPORTED_CONNECT_COUNTRIES];
}

export function isStripeConnectConfigured() {
  return Boolean(getStripeSecretKey());
}

export type WorkspaceConnectSnapshot = {
  accountId: string | null;
  country: ConnectCountry | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  onboardedAt: Date | null;
};

export function summarizeConnectStatus(snapshot: WorkspaceConnectSnapshot):
  | "not_started"
  | "pending"
  | "restricted"
  | "active" {
  if (!snapshot.accountId) return "not_started";
  if (!snapshot.detailsSubmitted) return "pending";
  if (!snapshot.chargesEnabled || !snapshot.payoutsEnabled) return "restricted";
  return "active";
}

export async function ensureWorkspaceConnectAccount(input: {
  workspaceId: string;
  country: ConnectCountry;
  email?: string | null;
}) {
  const billing = await prisma.workspaceBilling.upsert({
    where: { workspaceId: input.workspaceId },
    update: {},
    create: { workspaceId: input.workspaceId },
  });

  if (billing.stripeConnectAccountId) {
    return billing;
  }

  const stripe = getStripeClient();
  const account = await stripe.accounts.create({
    type: "express",
    country: input.country,
    email: input.email ?? undefined,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_type: "individual",
    metadata: {
      tato_workspace_id: input.workspaceId,
    },
  });

  return prisma.workspaceBilling.update({
    where: { id: billing.id },
    data: {
      stripeConnectAccountId: account.id,
      stripeConnectCountry: input.country,
    },
  });
}

export async function createConnectOnboardingLink(input: {
  workspaceId: string;
  origin?: string;
}) {
  const billing = await prisma.workspaceBilling.findUnique({
    where: { workspaceId: input.workspaceId },
  });

  if (!billing?.stripeConnectAccountId) {
    throw new Error("Connect account must be created before an onboarding link.");
  }

  const stripe = getStripeClient();
  const appUrl = getAppUrl(input.origin);

  const accountLink = await stripe.accountLinks.create({
    account: billing.stripeConnectAccountId,
    refresh_url: `${appUrl}/payouts?refresh=1`,
    return_url: `${appUrl}/payouts?return=1`,
    type: "account_onboarding",
  });

  return accountLink.url;
}

export async function createConnectLoginLink(input: {
  workspaceId: string;
}) {
  const billing = await prisma.workspaceBilling.findUnique({
    where: { workspaceId: input.workspaceId },
  });

  if (!billing?.stripeConnectAccountId) {
    throw new Error("Connect account is not provisioned for this workspace.");
  }

  const stripe = getStripeClient();
  const link = await stripe.accounts.createLoginLink(billing.stripeConnectAccountId);
  return link.url;
}

export async function refreshConnectAccountSnapshot(input: {
  workspaceId: string;
}): Promise<WorkspaceConnectSnapshot | null> {
  const billing = await prisma.workspaceBilling.findUnique({
    where: { workspaceId: input.workspaceId },
  });

  if (!billing?.stripeConnectAccountId) {
    return null;
  }

  const stripe = getStripeClient();
  const account = await stripe.accounts.retrieve(billing.stripeConnectAccountId);

  const updated = await prisma.workspaceBilling.update({
    where: { id: billing.id },
    data: {
      stripeConnectChargesEnabled: Boolean(account.charges_enabled),
      stripeConnectPayoutsEnabled: Boolean(account.payouts_enabled),
      stripeConnectDetailsSubmitted: Boolean(account.details_submitted),
      stripeConnectOnboardedAt:
        account.charges_enabled && account.payouts_enabled && !billing.stripeConnectOnboardedAt
          ? new Date()
          : billing.stripeConnectOnboardedAt,
      stripeConnectCountry:
        isConnectCountry(billing.stripeConnectCountry) || !account.country
          ? billing.stripeConnectCountry
          : isConnectCountry(account.country)
            ? account.country
            : null,
    },
  });

  return {
    accountId: updated.stripeConnectAccountId,
    country: isConnectCountry(updated.stripeConnectCountry) ? updated.stripeConnectCountry : null,
    chargesEnabled: updated.stripeConnectChargesEnabled,
    payoutsEnabled: updated.stripeConnectPayoutsEnabled,
    detailsSubmitted: updated.stripeConnectDetailsSubmitted,
    onboardedAt: updated.stripeConnectOnboardedAt,
  };
}

export async function getWorkspaceConnectSnapshot(
  workspaceId: string,
): Promise<WorkspaceConnectSnapshot> {
  const billing = await prisma.workspaceBilling.findUnique({
    where: { workspaceId },
  });

  if (!billing) {
    return {
      accountId: null,
      country: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      onboardedAt: null,
    };
  }

  return {
    accountId: billing.stripeConnectAccountId,
    country: isConnectCountry(billing.stripeConnectCountry) ? billing.stripeConnectCountry : null,
    chargesEnabled: billing.stripeConnectChargesEnabled,
    payoutsEnabled: billing.stripeConnectPayoutsEnabled,
    detailsSubmitted: billing.stripeConnectDetailsSubmitted,
    onboardedAt: billing.stripeConnectOnboardedAt,
  };
}

/**
 * Webhook entry point: when Stripe sends an `account.updated` event for one of
 * our connected hosts, mirror the latest charges/payouts/details_submitted
 * flags into the host's WorkspaceBilling row so the admin UI and the public
 * booking page reflect the new state without the host having to click
 * "refresh status".
 */
export async function syncWorkspaceConnectFromAccount(account: Stripe.Account) {
  if (!account?.id) return null;

  const billing = await prisma.workspaceBilling.findFirst({
    where: { stripeConnectAccountId: account.id },
  });
  if (!billing) return null;

  const chargesEnabled = Boolean(account.charges_enabled);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const detailsSubmitted = Boolean(account.details_submitted);
  const becameActive =
    chargesEnabled && payoutsEnabled && !billing.stripeConnectOnboardedAt;
  const accountCountry =
    typeof account.country === "string" && isConnectCountry(account.country)
      ? account.country
      : null;

  return prisma.workspaceBilling.update({
    where: { id: billing.id },
    data: {
      stripeConnectChargesEnabled: chargesEnabled,
      stripeConnectPayoutsEnabled: payoutsEnabled,
      stripeConnectDetailsSubmitted: detailsSubmitted,
      stripeConnectOnboardedAt: becameActive
        ? new Date()
        : billing.stripeConnectOnboardedAt,
      stripeConnectCountry: accountCountry ?? billing.stripeConnectCountry,
    },
  });
}

/**
 * Used by the public direct-booking flow: given a vehicle id, return the
 * Connect snapshot for the host that owns it. Falls back to a "not connected"
 * snapshot when the vehicle is workspace-less or the workspace billing row
 * does not exist yet, which the booking UI gates on.
 */
export async function getWorkspaceConnectSnapshotByVehicleId(
  vehicleId: string,
): Promise<WorkspaceConnectSnapshot & { workspaceId: string | null }> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { workspaceId: true },
  });

  if (!vehicle?.workspaceId) {
    return {
      workspaceId: null,
      accountId: null,
      country: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      onboardedAt: null,
    };
  }

  const snapshot = await getWorkspaceConnectSnapshot(vehicle.workspaceId);
  return { workspaceId: vehicle.workspaceId, ...snapshot };
}
