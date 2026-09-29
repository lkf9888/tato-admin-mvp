"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildConnectOAuthUrl,
  CONNECT_OAUTH_CALLBACK_PATH,
  CONNECT_OAUTH_COOKIE,
  ConnectCountry,
  createConnectLoginLink,
  createConnectOnboardingLink,
  ensureWorkspaceConnectAccount,
  isConnectExistingAvailable,
  isStripeConnectConfigured,
  refreshConnectAccountSnapshot,
} from "@/lib/stripe-connect";

const startOnboardingSchema = z.object({
  country: z.enum(["CA", "US"]),
});

export type ConnectErrorCode =
  | "NOT_CONFIGURED"
  | "CONNECT_NOT_ENABLED"
  | "CONNECT_UNDER_REVIEW"
  | "INVALID_COUNTRY"
  | "ALREADY_CONNECTED"
  | "UNKNOWN";

/**
 * Sort a Stripe failure into something the page can explain.
 *
 * Stripe's own message went straight to the screen before, in English,
 * and the commonest one -- "You can only create new accounts if you've
 * signed up for Connect" -- reads to an operator as if they had done
 * something wrong, when it is a one-time switch on the platform's
 * Stripe account. The raw text is still returned for anything this
 * does not recognise, so nothing is hidden.
 */
function describeConnectError(error: unknown): { code: ConnectErrorCode; error: string } {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/signed up for connect/i.test(message)) {
    return { code: "CONNECT_NOT_ENABLED", error: message };
  }
  if (/under review|cannot (currently )?create live|not (yet )?(been )?approved|review (of )?your (platform|application)/i.test(message)) {
    return { code: "CONNECT_UNDER_REVIEW", error: message };
  }
  return { code: "UNKNOWN", error: message };
}

const NOT_CONFIGURED = {
  ok: false,
  code: "NOT_CONFIGURED" as ConnectErrorCode,
  error: "Stripe is not configured on the server.",
} as const;

async function resolveOrigin() {
  try {
    const incoming = await headers();
    const proto = incoming.get("x-forwarded-proto") ?? "https";
    const host = incoming.get("host");
    return host ? `${proto}://${host}` : undefined;
  } catch {
    return undefined;
  }
}

export async function startConnectOnboarding(formData: FormData) {
  if (!isStripeConnectConfigured()) {
    return NOT_CONFIGURED;
  }

  const parsed = startOnboardingSchema.safeParse({
    country: formData.get("country"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_COUNTRY" as ConnectErrorCode,
      error: "Please pick a supported country (CA or US) before continuing.",
    } as const;
  }

  const { user, workspace } = await requireCurrentAdminContext();

  try {
    await ensureWorkspaceConnectAccount({
      workspaceId: workspace.id,
      country: parsed.data.country as ConnectCountry,
      email: user.email,
    });

    const origin = await resolveOrigin();
    const url = await createConnectOnboardingLink({
      workspaceId: workspace.id,
      origin,
    });

    revalidatePath("/payouts");

    return { ok: true, url } as const;
  } catch (error) {
    return { ok: false, ...describeConnectError(error) } as const;
  }
}

export async function continueConnectOnboarding() {
  if (!isStripeConnectConfigured()) {
    return NOT_CONFIGURED;
  }

  const { workspace } = await requireCurrentAdminContext();

  try {
    const origin = await resolveOrigin();
    const url = await createConnectOnboardingLink({
      workspaceId: workspace.id,
      origin,
    });
    return { ok: true, url } as const;
  } catch (error) {
    return { ok: false, ...describeConnectError(error) } as const;
  }
}

export async function openConnectDashboard() {
  if (!isStripeConnectConfigured()) {
    return NOT_CONFIGURED;
  }

  const { workspace } = await requireCurrentAdminContext();

  try {
    const url = await createConnectLoginLink({ workspaceId: workspace.id });
    return { ok: true, url } as const;
  } catch (error) {
    return { ok: false, ...describeConnectError(error) } as const;
  }
}

export async function refreshConnectStatus() {
  if (!isStripeConnectConfigured()) {
    return NOT_CONFIGURED;
  }

  const { workspace } = await requireCurrentAdminContext();

  try {
    await refreshConnectAccountSnapshot({ workspaceId: workspace.id });
    revalidatePath("/payouts");
    return { ok: true } as const;
  } catch (error) {
    return { ok: false, ...describeConnectError(error) } as const;
  }
}

/**
 * Send the host to Stripe to link the account they already have.
 *
 * The state that comes back must match the one set here, in a cookie
 * only this browser holds, so a link somebody else started cannot
 * attach their Stripe account to this workspace.
 */
export async function startConnectExistingAccount() {
  if (!isConnectExistingAvailable()) {
    return NOT_CONFIGURED;
  }

  const { user, workspace } = await requireCurrentAdminContext();
  const billing = await prisma.workspaceBilling.findUnique({
    where: { workspaceId: workspace.id },
    select: { stripeConnectAccountId: true },
  });
  if (billing?.stripeConnectAccountId) {
    return {
      ok: false,
      code: "ALREADY_CONNECTED" as ConnectErrorCode,
      error: "This workspace already has a payout account.",
    } as const;
  }

  const origin = await resolveOrigin();
  if (!origin) return { ok: false, code: "UNKNOWN" as ConnectErrorCode, error: "No origin." } as const;

  const state = randomBytes(24).toString("hex");
  const store = await cookies();
  store.set(CONNECT_OAUTH_COOKIE, `${state}.${workspace.id}`, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });

  const url = buildConnectOAuthUrl({
    state,
    redirectUri: `${origin}${CONNECT_OAUTH_CALLBACK_PATH}`,
    email: user.email,
  });
  return { ok: true, url } as const;
}
