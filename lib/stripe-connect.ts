import "server-only";

import type Stripe from "stripe";

import { prisma } from "@/lib/prisma";
import { getAppUrl, getStripeClient, getStripeSecretKey } from "@/lib/stripe";

// Platform keeps a 5% cut of every renter-to-host payment. The rest is
// settled on-behalf-of the host's Connect account so the renter's card
// statement shows the host's business name, not the TATO platform name.
export const PLATFORM_APPLICATION_FEE_PERCENT = 5;

// Stripe's standard rate for Canadian cards. On a destination charge
// Stripe takes its fee from the platform, so without passing it on the
// platform's 5% would mostly go to Stripe. It is an estimate -- an
// international card costs more -- charged to the host with the fee.
export const STRIPE_CARD_FEE_PERCENT = 2.9;
export const STRIPE_CARD_FEE_FIXED_CENTS = 30;

/**
 * The application fee on a direct booking, in cents: the platform's
 * commission on what the host earns (rent, insurance, location fee --
 * not tax, which is collected for the government, nor the deposit,
 * which goes back) plus the Stripe fee on everything charged. The two
 * are kept apart because a refund gives back only the commission:
 * Stripe keeps its fee on a refunded payment, so returning that part
 * would make the platform pay it after all.
 */
export function computePlatformFeeCents(input: {
  commissionBaseCents: number;
  chargeTotalCents: number;
}) {
  const commission = Math.max(
    0,
    Math.round(input.commissionBaseCents * (PLATFORM_APPLICATION_FEE_PERCENT / 100)),
  );
  const processing =
    input.chargeTotalCents > 0
      ? Math.round(input.chargeTotalCents * (STRIPE_CARD_FEE_PERCENT / 100)) +
        STRIPE_CARD_FEE_FIXED_CENTS
      : 0;
  return {
    commission,
    processing,
    total: Math.min(commission + processing, Math.max(0, input.chargeTotalCents)),
  };
}

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
    // No business_type: Stripe's onboarding asks. Most hosts are a
    // company, and fixing it to "individual" made Stripe collect a
    // person's details and pay out to them instead of the business.
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
  // A host who connected the Stripe account they already had keeps
  // their own full dashboard; Express login links do not exist for it.
  const account = await stripe.accounts.retrieve(billing.stripeConnectAccountId);
  if (account.type === "standard") return "https://dashboard.stripe.com/";
  const link = await stripe.accounts.createLoginLink(billing.stripeConnectAccountId);
  return link.url;
}

/**
 * Connecting a Stripe account the host already has.
 *
 * Express onboarding creates a new account; a host who already takes
 * payments on Stripe (their own bank, branding, history) would rather
 * link that one. Stripe's OAuth for Standard accounts does it: the host
 * signs in on connect.stripe.com, approves, and comes back with a code
 * the platform exchanges for their account id. Charges are unchanged --
 * the same destination charge with `on_behalf_of` -- so refunds and
 * deposit settlement need nothing new.
 *
 * Needs the platform's OAuth client id (`ca_...`, Connect settings →
 * Onboarding options → OAuth) in `STRIPE_CONNECT_CLIENT_ID`, and each
 * admin origin's callback registered there as a redirect URI.
 */
/** Holds `<state>.<workspaceId>` between leaving for Stripe and coming back. */
export const CONNECT_OAUTH_COOKIE = "tato_connect_oauth";
export const CONNECT_OAUTH_CALLBACK_PATH = "/api/stripe/connect/oauth";

export function getConnectClientId() {
  const id = process.env.STRIPE_CONNECT_CLIENT_ID?.trim() ?? "";
  return id.startsWith("ca_") ? id : "";
}

export function isConnectExistingAvailable() {
  return isStripeConnectConfigured() && Boolean(getConnectClientId());
}

export function buildConnectOAuthUrl(input: {
  state: string;
  redirectUri: string;
  email?: string | null;
}) {
  const url = new URL("https://connect.stripe.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", getConnectClientId());
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  if (input.email) url.searchParams.set("stripe_user[email]", input.email);
  return url.toString();
}

export class ConnectOAuthError extends Error {
  constructor(
    readonly code: "ALREADY_CONNECTED" | "ACCOUNT_IN_USE" | "EXCHANGE_FAILED",
    message: string,
  ) {
    super(message);
  }
}

/** Exchange the code from Stripe's redirect and record the account. */
export async function completeConnectOAuth(input: { workspaceId: string; code: string }) {
  const stripe = getStripeClient();
  let accountId: string | undefined;
  try {
    const token = await stripe.oauth.token({ grant_type: "authorization_code", code: input.code });
    accountId = token.stripe_user_id;
  } catch (error) {
    throw new ConnectOAuthError(
      "EXCHANGE_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!accountId) throw new ConnectOAuthError("EXCHANGE_FAILED", "Stripe returned no account.");

  const billing = await prisma.workspaceBilling.upsert({
    where: { workspaceId: input.workspaceId },
    update: {},
    create: { workspaceId: input.workspaceId },
  });
  if (billing.stripeConnectAccountId && billing.stripeConnectAccountId !== accountId) {
    throw new ConnectOAuthError("ALREADY_CONNECTED", "This workspace already has a payout account.");
  }
  // One Stripe account pays out one workspace: the column is unique,
  // and a second workspace claiming it would split the same money two
  // ways in the books.
  const claimed = await prisma.workspaceBilling.findFirst({
    where: { stripeConnectAccountId: accountId, NOT: { id: billing.id } },
    select: { id: true },
  });
  if (claimed) {
    throw new ConnectOAuthError("ACCOUNT_IN_USE", "That Stripe account pays out another workspace.");
  }

  await prisma.workspaceBilling.update({
    where: { id: billing.id },
    data: { stripeConnectAccountId: accountId },
  });
  return refreshConnectAccountSnapshot({ workspaceId: input.workspaceId });
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

const DETACHED_CONNECT_FIELDS = {
  stripeConnectAccountId: null,
  stripeConnectCountry: null,
  stripeConnectChargesEnabled: false,
  stripeConnectPayoutsEnabled: false,
  stripeConnectDetailsSubmitted: false,
  stripeConnectOnboardedAt: null,
} as const;

/**
 * Stop paying this workspace out to its Stripe account, so another can
 * be set up in its place.
 *
 * Nothing is deleted on Stripe's side. A linked existing account is
 * de-authorised, which is the host's own account leaving the platform
 * and is what they would expect; an Express account the platform made
 * stays where it is, with whatever balance it holds, and can be closed
 * from the platform dashboard by hand. Bookings already paid keep their
 * charge and transfer, so their refunds and deposit settlement still
 * reach the old account -- only new bookings wait for the next one.
 */
export async function disconnectWorkspaceConnectAccount(input: { workspaceId: string }) {
  const billing = await prisma.workspaceBilling.findUnique({
    where: { workspaceId: input.workspaceId },
  });
  if (!billing?.stripeConnectAccountId) return null;

  const accountId = billing.stripeConnectAccountId;
  const stripe = getStripeClient();
  let accountType: string | null = null;
  try {
    accountType = (await stripe.accounts.retrieve(accountId)).type ?? null;
  } catch {
    // Already gone or no longer reachable: detaching is all that is left.
  }
  if (accountType === "standard" && getConnectClientId()) {
    try {
      await stripe.oauth.deauthorize({ client_id: getConnectClientId(), stripe_user_id: accountId });
    } catch {
      // The host may have disconnected from their side first.
    }
  }

  await prisma.workspaceBilling.update({
    where: { id: billing.id },
    data: DETACHED_CONNECT_FIELDS,
  });
  return { accountId, accountType };
}

/** Webhook: a host disconnected the platform from their own dashboard. */
export async function detachConnectAccountById(accountId: string) {
  const billing = await prisma.workspaceBilling.findFirst({
    where: { stripeConnectAccountId: accountId },
    select: { id: true },
  });
  if (!billing) return null;
  return prisma.workspaceBilling.update({ where: { id: billing.id }, data: DETACHED_CONNECT_FIELDS });
}
