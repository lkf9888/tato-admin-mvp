import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * What a new account still has to do before TATO is useful, each step
 * read from the data rather than ticked by hand, so the list can never
 * claim a step is done that is not -- or nag about one that is.
 */

export const ONBOARDING_STEPS = ["vehicle", "trips", "owner", "commission", "share", "team"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_LINKS: Record<OnboardingStep, string> = {
  vehicle: "/vehicles",
  trips: "/imports",
  owner: "/owners",
  commission: "/owners",
  share: "/owners",
  team: "/account-settings",
};

export async function getOnboardingProgress(workspaceId: string) {
  const [vehicles, trips, imports, ownedCars, commissions, carRates, shares, members, invites] = await Promise.all([
    prisma.vehicle.count({ where: { workspaceId } }),
    prisma.order.count({ where: { workspaceId } }),
    prisma.importBatch.count({ where: { workspaceId } }),
    prisma.vehicle.count({ where: { workspaceId, ownerId: { not: null } } }),
    prisma.ownerCommissionRule.count({ where: { workspaceId } }),
    prisma.vehicle.count({ where: { workspaceId, ownerCommissionRate: { not: null } } }),
    prisma.shareLink.count({ where: { workspaceId } }),
    prisma.user.count({ where: { workspaceId } }),
    prisma.userInvite.count({ where: { workspaceId } }),
  ]);

  const done: Record<OnboardingStep, boolean> = {
    vehicle: vehicles > 0,
    trips: trips > 0 || imports > 0,
    owner: ownedCars > 0,
    commission: commissions > 0 || carRates > 0,
    share: shares > 0,
    team: members > 1 || invites > 0,
  };
  const completed = ONBOARDING_STEPS.filter((step) => done[step]).length;
  return { done, completed, total: ONBOARDING_STEPS.length, finished: completed === ONBOARDING_STEPS.length };
}
