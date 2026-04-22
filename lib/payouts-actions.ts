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
    return { ok: false, error: "Stripe is not configured on the server." } as const;
  }

  const parsed = startOnboardingSchema.safeParse({
    country: formData.get("country"),
  });
  if (!parsed.success) {
    return {
      ok: false,
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
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not start Stripe onboarding.",
    } as const;
  }
}

export async function continueConnectOnboarding() {
  if (!isStripeConnectConfigured()) {
    return { ok: false, error: "Stripe is not configured on the server." } as const;
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
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not resume Stripe onboarding.",
    } as const;
  }
}

export async function openConnectDashboard() {
  if (!isStripeConnectConfigured()) {
    return { ok: false, error: "Stripe is not configured on the server." } as const;
  }

  const { workspace } = await requireCurrentAdminContext();

  try {
    const url = await createConnectLoginLink({ workspaceId: workspace.id });
    return { ok: true, url } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not open the Stripe dashboard.",
    } as const;
  }
}

export async function refreshConnectStatus() {
  if (!isStripeConnectConfigured()) {
    return { ok: false, error: "Stripe is not configured on the server." } as const;
  }

  const { workspace } = await requireCurrentAdminContext();

  try {
    await refreshConnectAccountSnapshot({ workspaceId: workspace.id });
    revalidatePath("/payouts");
    return { ok: true } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not refresh Stripe status.",
    } as const;
  }
}
