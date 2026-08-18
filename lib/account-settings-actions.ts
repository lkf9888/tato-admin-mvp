"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { LedgerShareTarget } from "@prisma/client";

import { normalizeEmail, requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { getStripeClient, getStripeSecretKey } from "@/lib/stripe";
import { isConnectCountry } from "@/lib/stripe-connect";

type AccountSettingsStatus =
  | "profile_saved"
  | "email_saved"
  | "password_saved"
  | "stripe_saved"
  | "stripe_cleared"
  | "ledger_policy_saved"
  | "invalid"
  | "bad_password"
  | "email_in_use"
  | "password_mismatch"
  | "stripe_invalid"
  | "stripe_in_use"
  | "stripe_missing";

function finish(status: AccountSettingsStatus): never {
  revalidatePath("/account-settings");
  redirect(`/account-settings?account=${status}`);
}

const profileSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  displayName: z.string().trim().min(1).max(80),
});

export async function updateAccountProfileAction(formData: FormData) {
  const parsed = profileSchema.safeParse({
    companyName: formData.get("companyName"),
    displayName: formData.get("displayName"),
  });

  if (!parsed.success) {
    finish("invalid");
  }

  const { user, workspace } = await requireCurrentAdminContext();

  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: workspace.id },
      data: { name: parsed.data.companyName },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { name: parsed.data.displayName },
    }),
  ]);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.email,
    action: "account_profile_updated",
    entityType: "Workspace",
    entityId: workspace.id,
    metadata: {
      companyName: parsed.data.companyName,
      displayName: parsed.data.displayName,
    },
  });

  finish("profile_saved");
}

const emailSchema = z.object({
  email: z.string().trim().email().max(160),
  currentPassword: z.string().min(1),
});

export async function updateAccountEmailAction(formData: FormData) {
  const parsed = emailSchema.safeParse({
    email: formData.get("email"),
    currentPassword: formData.get("currentPassword"),
  });

  if (!parsed.success) {
    finish("invalid");
  }

  const { user, workspace } = await requireCurrentAdminContext();
  const email = normalizeEmail(parsed.data.email);

  const passwordOk = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!passwordOk) {
    finish("bad_password");
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing && existing.id !== user.id) {
    finish("email_in_use");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { email },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.email,
    action: "account_email_updated",
    entityType: "User",
    entityId: user.id,
    metadata: { previousEmail: user.email, email },
  });

  finish("email_saved");
}

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128),
});

export async function updateAccountPasswordAction(formData: FormData) {
  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    finish("invalid");
  }

  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    finish("password_mismatch");
  }

  const { user, workspace } = await requireCurrentAdminContext();
  const passwordOk = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!passwordOk) {
    finish("bad_password");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 10) },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.email,
    action: "account_password_updated",
    entityType: "User",
    entityId: user.id,
  });

  finish("password_saved");
}

const stripeSchema = z.object({
  accountId: z.string().trim().max(128).optional().or(z.literal("")),
  country: z.enum(["CA", "US"]).default("CA"),
  clearStripeConnect: z.string().optional(),
});

export async function updateStripePayoutBindingAction(formData: FormData) {
  const parsed = stripeSchema.safeParse({
    accountId: formData.get("stripeConnectAccountId"),
    country: formData.get("stripeConnectCountry") || "CA",
    clearStripeConnect: formData.get("clearStripeConnect"),
  });

  if (!parsed.success) {
    finish("invalid");
  }

  const { user, workspace } = await requireCurrentAdminContext();

  if (parsed.data.clearStripeConnect === "on") {
    await prisma.workspaceBilling.upsert({
      where: { workspaceId: workspace.id },
      update: {
        stripeConnectAccountId: null,
        stripeConnectCountry: null,
        stripeConnectChargesEnabled: false,
        stripeConnectPayoutsEnabled: false,
        stripeConnectDetailsSubmitted: false,
        stripeConnectOnboardedAt: null,
      },
      create: { workspaceId: workspace.id },
    });

    await logActivity({
      workspaceId: workspace.id,
      actor: user.email,
      action: "stripe_connect_account_updated",
      entityType: "WorkspaceBilling",
      entityId: workspace.id,
      metadata: { cleared: true },
    });

    finish("stripe_cleared");
  }

  const accountId = parsed.data.accountId?.trim() ?? "";
  if (!accountId) {
    finish("stripe_missing");
  }
  if (!accountId.startsWith("acct_")) {
    finish("stripe_invalid");
  }

  const duplicate = await prisma.workspaceBilling.findFirst({
    where: {
      stripeConnectAccountId: accountId,
      NOT: { workspaceId: workspace.id },
    },
    select: { id: true },
  });
  if (duplicate) {
    finish("stripe_in_use");
  }

  let country = parsed.data.country;
  let chargesEnabled = false;
  let payoutsEnabled = false;
  let detailsSubmitted = false;

  if (getStripeSecretKey()) {
    try {
      const stripe = getStripeClient();
      const account = await stripe.accounts.retrieve(accountId);
      if ("deleted" in account && account.deleted) {
        finish("stripe_invalid");
      }
      country = isConnectCountry(account.country) ? account.country : country;
      chargesEnabled = Boolean(account.charges_enabled);
      payoutsEnabled = Boolean(account.payouts_enabled);
      detailsSubmitted = Boolean(account.details_submitted);
    } catch {
      finish("stripe_invalid");
    }
  }

  await prisma.workspaceBilling.upsert({
    where: { workspaceId: workspace.id },
    update: {
      stripeConnectAccountId: accountId,
      stripeConnectCountry: country,
      stripeConnectChargesEnabled: chargesEnabled,
      stripeConnectPayoutsEnabled: payoutsEnabled,
      stripeConnectDetailsSubmitted: detailsSubmitted,
      stripeConnectOnboardedAt: chargesEnabled && payoutsEnabled ? new Date() : null,
    },
    create: {
      workspaceId: workspace.id,
      stripeConnectAccountId: accountId,
      stripeConnectCountry: country,
      stripeConnectChargesEnabled: chargesEnabled,
      stripeConnectPayoutsEnabled: payoutsEnabled,
      stripeConnectDetailsSubmitted: detailsSubmitted,
      stripeConnectOnboardedAt: chargesEnabled && payoutsEnabled ? new Date() : null,
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.email,
    action: "stripe_connect_account_updated",
    entityType: "WorkspaceBilling",
    entityId: workspace.id,
    metadata: {
      accountId,
      country,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
    },
  });

  finish("stripe_saved");
}

const ledgerPolicySchema = z.object({
  reimbursementShare: z.nativeEnum(LedgerShareTarget),
  serviceShare: z.nativeEnum(LedgerShareTarget),
  penaltyShare: z.nativeEnum(LedgerShareTarget),
});

/**
 * Owner revenue-split policy.
 *
 * Changing this does not rewrite existing statements — ledger rows are
 * only recomputed when their order is next synced. That is deliberate:
 * silently restating a month that has already been settled with an
 * owner would be worse than requiring an explicit resync. Use the
 * per-owner "resync" action to apply a new policy to past trips once
 * you have agreed the change with that owner.
 */
export async function updateLedgerPolicyAction(formData: FormData) {
  const parsed = ledgerPolicySchema.safeParse({
    reimbursementShare: formData.get("reimbursementShare"),
    serviceShare: formData.get("serviceShare"),
    penaltyShare: formData.get("penaltyShare"),
  });

  if (!parsed.success) {
    finish("invalid");
  }

  const { user, workspace } = await requireCurrentAdminContext();

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      reimbursementShare: parsed.data.reimbursementShare,
      serviceShare: parsed.data.serviceShare,
      penaltyShare: parsed.data.penaltyShare,
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.email,
    action: "ledger_policy_updated",
    entityType: "Workspace",
    entityId: workspace.id,
    metadata: {
      reimbursementShare: parsed.data.reimbursementShare,
      serviceShare: parsed.data.serviceShare,
      penaltyShare: parsed.data.penaltyShare,
    },
  });

  finish("ledger_policy_saved");
}
