import { OwnerLedgerManager } from "@/components/owner-ledger-manager";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";

type SearchParams = Promise<{ ownerId?: string }>;

export default async function OwnerStatementsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const workspace = await requireCurrentWorkspace();
  const [{ locale }, params, owners] = await Promise.all([
    getI18n(),
    searchParams,
    prisma.owner.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { name: "asc" },
      include: {
        vehicles: {
          orderBy: [{ plateNumber: "asc" }, { nickname: "asc" }],
          select: {
            id: true,
            plateNumber: true,
            nickname: true,
            brand: true,
            model: true,
            year: true,
          },
        },
      },
    }),
  ]);

  const pageCopy =
    locale === "zh"
      ? {
          kicker: "车主分成",
          title: "车主分成与 monthly statement",
          description:
            "参考 HostHub 的房东分成模块，把每位车主的订单净收益、TATO 管理佣金、报销、调整和结算付款统一放在一张可编辑流水账里。",
          emptyTitle: "还没有车主",
          emptyCopy: "请先在“车主”页面创建车主，并在“车辆”页面把车辆绑定到车主后再使用分成账本。",
        }
      : {
          kicker: "Owner revenue share",
          title: "Owner ledger and monthly statements",
          description:
            "A HostHub-style owner share module for vehicle owners: order net earnings, TATO commissions, reimbursements, adjustments, and settlement payments in one editable ledger.",
          emptyTitle: "No owners yet",
          emptyCopy: "Create an owner first, then assign vehicles to that owner before using the ledger.",
        };

  const selectedOwner = owners.find((owner) => owner.id === params.ownerId) ?? owners[0] ?? null;

  if (!selectedOwner) {
    return (
      <div className="rounded-lg border border-[var(--line)] bg-white/90 p-8 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--ink-soft)]">
          {pageCopy.kicker}
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-[var(--ink)]">
          {pageCopy.emptyTitle}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--ink-soft)]">
          {pageCopy.emptyCopy}
        </p>
      </div>
    );
  }

  const ledgerItems = await prisma.ownerLedgerItem.findMany({
    where: {
      workspaceId: workspace.id,
      ownerId: selectedOwner.id,
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    include: {
      vehicle: {
        select: {
          id: true,
          plateNumber: true,
          nickname: true,
          brand: true,
          model: true,
          year: true,
        },
      },
      order: {
        select: {
          id: true,
          renterName: true,
          pickupDatetime: true,
          returnDatetime: true,
        },
      },
    },
  });

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[var(--line)] bg-white/90 p-4 shadow-sm sm:p-5">
        <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--ink-soft)]">
          {pageCopy.kicker}
        </p>
        <h1 className="mt-1 font-serif text-2xl font-semibold text-[var(--ink)] sm:text-3xl">
          {pageCopy.title}
        </h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--ink-soft)]">
          {pageCopy.description}
        </p>
      </section>

      <OwnerLedgerManager
        locale={locale}
        owners={owners.map((owner) => ({ id: owner.id, name: owner.name }))}
        selectedOwner={{ id: selectedOwner.id, name: selectedOwner.name }}
        vehicles={selectedOwner.vehicles.map((vehicle) => ({
          id: vehicle.id,
          label: `${vehicle.plateNumber} · ${vehicle.nickname}`,
        }))}
        items={ledgerItems.map((item) => ({
          id: item.id,
          ownerId: item.ownerId,
          vehicleId: item.vehicleId,
          orderId: item.orderId,
          kind: item.kind,
          amount: item.amount,
          occurredAt: item.occurredAt.toISOString(),
          note: item.note,
          isAuto: item.isAuto,
          createdAt: item.createdAt.toISOString(),
          vehicle: item.vehicle,
          order: item.order
            ? {
                id: item.order.id,
                renterName: item.order.renterName,
                pickupDatetime: item.order.pickupDatetime.toISOString(),
                returnDatetime: item.order.returnDatetime.toISOString(),
              }
            : null,
        }))}
      />
    </div>
  );
}
