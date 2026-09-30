import "server-only";

import { WorkspaceBillingStatus, type WorkspaceBilling } from "@prisma/client";

import { estimateImportVehicleImpact, type CsvFieldMapping } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

/**
 * How many vehicles a workspace's plan allows, and whether an import
 * would go past it.
 *
 * Kept apart from `lib/billing` on purpose: that module is about the
 * signed-in operator and Stripe, and imports `lib/auth` to find them.
 * The scheduled Turo sync and the agent API import CSVs with nobody
 * signed in, and `lib/auth` does not even load in the sync's script. So
 * this arithmetic once had a second copy inside the sync, drifting on
 * its own. Now there is one, here, and both sides call it.
 */

export const FREE_VEHICLE_SLOTS = 5;

const ACTIVE_BILLING_STATUSES = new Set<WorkspaceBillingStatus>([
  WorkspaceBillingStatus.active,
  WorkspaceBillingStatus.trialing,
]);

export async function ensureWorkspaceBillingForWorkspace(workspaceId: string) {
  return prisma.workspaceBilling.upsert({
    where: { workspaceId },
    update: {},
    create: {
      workspaceId,
      freeVehicleSlots: FREE_VEHICLE_SLOTS,
    },
  });
}

/** Paid slots count only while the subscription is live. */
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

/**
 * A workspace's slots as they stand. Whether the limit is waived is the
 * caller's to say: a request knows its user, a cron job decides itself.
 */
export async function getVehicleSlotSnapshot(
  workspaceId: string,
  options: { billingBypassActive: boolean },
) {
  const [billing, currentVehicleCount] = await Promise.all([
    ensureWorkspaceBillingForWorkspace(workspaceId),
    prisma.vehicle.count({ where: { workspaceId } }),
  ]);

  const allowedVehicleCount = getAllowedVehicleCount(billing);

  return {
    billing,
    currentVehicleCount,
    freeVehicleSlots: billing.freeVehicleSlots,
    bonusVehicleSlots: billing.bonusVehicleSlots,
    purchasedVehicleSlots: billing.purchasedVehicleSlots,
    effectivePurchasedVehicleSlots: getEffectivePurchasedVehicleSlots(billing),
    allowedVehicleCount,
    requiredPaidSlots: getRequiredPaidSlotsForVehicleCount(
      currentVehicleCount,
      billing.freeVehicleSlots,
      billing.bonusVehicleSlots,
    ),
    isOverLimit: options.billingBypassActive ? false : currentVehicleCount > allowedVehicleCount,
    billingBypassActive: options.billingBypassActive,
    status: billing.status,
    currentPeriodEnd: billing.currentPeriodEnd,
  };
}

export type ImportVehicleLimitInput = {
  workspaceId: string;
  mapping: CsvFieldMapping;
  rows: Record<string, string>[];
  createMissingVehicles?: boolean;
  /** When the operator picked which new cars to create, only those count. */
  selectedVehicleKeys?: string[];
  billingBypassActive: boolean;
};

/** What the fleet would be after this import, against the plan. */
export async function getImportVehicleProjection(input: ImportVehicleLimitInput) {
  const [snapshot, impact] = await Promise.all([
    getVehicleSlotSnapshot(input.workspaceId, { billingBypassActive: input.billingBypassActive }),
    estimateImportVehicleImpact({
      workspaceId: input.workspaceId,
      mapping: input.mapping,
      rows: input.rows,
      createMissingVehicles: input.createMissingVehicles,
    }),
  ]);

  const availableNewVehicleSlots = Math.max(0, snapshot.allowedVehicleCount - snapshot.currentVehicleCount);
  const validSelectedVehicleKeys = new Set(
    (input.selectedVehicleKeys ?? []).filter((key) =>
      impact.projectedVehicleOptions.some((vehicle) => vehicle.key === key),
    ),
  );
  const selectedProjectedNewVehicleCount =
    input.createMissingVehicles && validSelectedVehicleKeys.size > 0
      ? validSelectedVehicleKeys.size
      : impact.projectedNewVehicleCount;
  const projectedVehicleCount = Math.max(
    snapshot.currentVehicleCount,
    snapshot.currentVehicleCount + selectedProjectedNewVehicleCount,
  );
  const requiredPaidSlots = getRequiredPaidSlotsForVehicleCount(
    projectedVehicleCount,
    snapshot.freeVehicleSlots,
    snapshot.bonusVehicleSlots,
  );

  return {
    ...snapshot,
    projectedVehicleCount,
    projectedNewVehicleCount: impact.projectedNewVehicleCount,
    selectedProjectedNewVehicleCount,
    requiredProjectedPaidSlots: requiredPaidSlots,
    additionalPaidSlotsNeeded: Math.max(0, requiredPaidSlots - snapshot.effectivePurchasedVehicleSlots),
    availableNewVehicleSlots,
    selectableVehicleOptions: impact.projectedVehicleOptions,
    exceedsPurchasedLimit: input.billingBypassActive
      ? false
      : projectedVehicleCount > snapshot.allowedVehicleCount,
  };
}

export type ImportVehicleProjection = Awaited<ReturnType<typeof getImportVehicleProjection>>;

/**
 * The projection and whether the import fits the plan. Returned rather
 * than thrown, so each caller raises its own error type -- the imports
 * API's and the Turo sync's differ -- without recomputing the limit.
 */
export async function checkImportVehicleLimit(input: ImportVehicleLimitInput) {
  const projection = await getImportVehicleProjection(input);
  return { projection, withinLimit: !projection.exceedsPurchasedLimit };
}
