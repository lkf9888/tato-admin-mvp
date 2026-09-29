import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Who mail to an operator's renters comes from.
 *
 * A renter who booked on SPEEDX's site should get their confirmation
 * and agreement from SPEEDX, not from TATO -- and the platform's own
 * sending domain may not be verified at all, in which case nothing
 * arrives. So an operator can set a sender on their own domain (one
 * verified with the email provider), and everything addressed to their
 * renters goes out as "Brand <sender>". Without one, the platform's
 * default sender is used, as before.
 */
export async function getWorkspaceSender(workspaceId: string | null | undefined) {
  if (!workspaceId) return undefined;
  const site = await prisma.rentalSite.findUnique({
    where: { workspaceId },
    select: { senderEmail: true, brandName: true },
  });
  return formatSiteSender(site);
}

/** Sender plus the brand to print, for mail that names who it is from. */
export async function getWorkspaceMailIdentity(workspaceId: string | null | undefined) {
  if (!workspaceId) return { from: undefined, brandName: null };
  const site = await prisma.rentalSite.findUnique({
    where: { workspaceId },
    select: { senderEmail: true, brandName: true },
  });
  return { from: formatSiteSender(site), brandName: site?.brandName?.trim() || null };
}

/** For a caller that has already loaded the site. */
export function formatSiteSender(
  site: { senderEmail?: string | null; brandName?: string | null } | null | undefined,
) {
  const email = site?.senderEmail?.trim();
  if (!email) return undefined;
  // Quotes and angle brackets would break the header; nothing else can.
  const name = site?.brandName?.replace(/["<>]/g, "").trim();
  return name ? `${name} <${email}>` : email;
}

const SENDER_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/** Normalise the settings field: lowercase, or null when blank. */
export function readSenderEmail(raw: string | null | undefined): string | null | "invalid" {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  return SENDER_PATTERN.test(value) && value.length <= 254 ? value : "invalid";
}
