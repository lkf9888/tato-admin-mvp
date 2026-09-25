"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import {
  ConnectCountry,
  createConnectLoginLink,
  createConnectOnboardingLink,
  ensureWorkspaceConnectAccount,
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
