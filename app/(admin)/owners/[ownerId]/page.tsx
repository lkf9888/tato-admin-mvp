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
} from "@/lib/ledger-policy";

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
  const feeRows = FEE_CATALOGUE.filter(
    (fee) => fee.group !== "rent" && fee.group !== "discount",
  ).map((fee) => ({
    column: fee.column,
    group: fee.group,
    target: resolveFeeTarget(fee.column, policy, overrides),
    isOverride: Boolean(overrides?.[fee.column]),
  }));

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
