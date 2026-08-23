import { notFound } from "next/navigation";

import { OwnerEditor } from "@/app/(admin)/owners/[ownerId]/owner-editor";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getOwnerCommissionRules, pickCommissionRule } from "@/lib/owner-commission";
import {
  FEE_CATALOGUE,
  parseFeeShareOverrides,
  resolveFeeTarget,
  resolveWorkspaceLedgerPolicy,
  sumFeeColumns,
} from "@/lib/ledger-policy";
import { getOrderNetEarning } from "@/lib/utils";

type Params = Promise<{ ownerId: string }>;

function vehicleLabel(vehicle: {
  plateNumber: string;
  nickname: string;
  brand: string;
  model: string;
  year: number;
}) {
  return `${vehicle.plateNumber} · ${vehicle.nickname || `${vehicle.brand} ${vehicle.model} ${vehicle.year}`}`;
}

export default async function OwnerEditPage({ params }: { params: Params }) {
  const workspace = await requireCurrentWorkspace();
  const [{ ownerId }, { locale }] = await Promise.all([params, getI18n()]);

  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: workspace.id },
    include: {
      vehicles: {
        orderBy: [{ plateNumber: "asc" }, { nickname: "asc" }],
        select: { id: true },
      },
      shareLinks: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { token: true },
      },
    },
  });
  if (!owner) notFound();

  // Newest start date first, which is also the order the panel shows
  // them in -- most recent terms at the top, history beneath.
  const commissionRules = await getOwnerCommissionRules(owner.id);
  const currentRule = pickCommissionRule(commissionRules, new Date());

  // Resolved here rather than in the panel, so the page shows what
  // actually applies -- the owner's exception where there is one, the
  // workspace policy where there is not.
  const policy = resolveWorkspaceLedgerPolicy(workspace);
  const overrides = parseFeeShareOverrides(owner.feeShareOverrides);
  const feeRows = FEE_CATALOGUE.filter((fee) => fee.column !== "Trip price").map((fee) => ({
    column: fee.column,
    group: fee.group,
    sign: fee.sign,
    target: resolveFeeTarget(fee.column, policy, overrides),
    isOverride: Boolean(overrides?.[fee.column]),
  }));

  // This owner's own numbers, so the calculator on the page works out
  // a real figure rather than a worked example. Imported orders only:
  // an offline booking has a price typed straight in and no component
  // columns to divide, so including them would inflate the payout side
  // of an arithmetic the fee rows cannot balance.
  const ownerOrders = await prisma.order.findMany({
    where: {
      workspaceId: workspace.id,
      vehicle: { ownerId: owner.id },
      sourceMetadata: { not: null },
    },
    select: { sourceMetadata: true, totalPrice: true },
  });
  const feeTotals = sumFeeColumns(ownerOrders);
  const payoutTotal =
    Math.round(
      ownerOrders.reduce(
        (sum, order) => sum + (getOrderNetEarning(order.sourceMetadata, order.totalPrice) ?? 0),
        0,
      ) * 100,
    ) / 100;

  const allVehicles = await prisma.vehicle.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ plateNumber: "asc" }, { nickname: "asc" }],
    select: {
      id: true,
      ownerId: true,
      plateNumber: true,
      nickname: true,
      brand: true,
      model: true,
      year: true,
      vin: true,
      turoListingName: true,
      turoVehicleCode: true,
      owner: { select: { name: true } },
    },
  });

  return (
    <OwnerEditor
      locale={locale}
      owner={{
        id: owner.id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        companyName: owner.companyName,
        notes: owner.notes,
        shareToken: owner.shareLinks[0]?.token ?? null,
      }}
      commissionRules={commissionRules.map((rule) => ({
        id: rule.id,
        // Stored as a fraction, read as a percentage. Rounded to one
        // decimal so 0.175 does not surface as 17.499999999999998.
        ratePercent: Math.round(rule.rate * 1000) / 10,
        settlement: rule.settlement,
        effectiveFrom: rule.effectiveFrom.toISOString(),
        note: rule.note,
        isCurrent: rule.id === currentRule?.id,
      }))}
      feeRows={feeRows}
      feeTotals={feeTotals}
      payoutTotal={payoutTotal}
      feeOrderCount={ownerOrders.length}
      assignedVehicleIds={owner.vehicles.map((vehicle) => vehicle.id)}
      allVehicles={allVehicles.map((vehicle) => ({
        id: vehicle.id,
        label: vehicleLabel(vehicle),
        subLabel: [
          `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
          vehicle.vin,
          vehicle.turoListingName,
          vehicle.turoVehicleCode,
        ]
          .filter(Boolean)
          .join(" · "),
        ownerId: vehicle.ownerId,
        ownerName: vehicle.owner?.name ?? null,
      }))}
    />
  );
}
