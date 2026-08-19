import Link from "next/link";

import { OwnersSearchInput } from "@/components/owners-search-input";
import { QuickVehicleReimbursementButton } from "@/components/quick-vehicle-reimbursement-button";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { cn, formatCurrency } from "@/lib/utils";

type SearchParams = Promise<{ q?: string; error?: string }>;

function vehicleLabel(vehicle: {
  plateNumber: string;
  nickname: string;
  brand: string;
  model: string;
  year: number;
}) {
  return `${vehicle.plateNumber} · ${vehicle.nickname || `${vehicle.brand} ${vehicle.model} ${vehicle.year}`}`;
}

function copy(locale: string) {
  return locale === "zh" || locale === "zh-Hant"
    ? {
        title: "车主分成",
        subtitle: "管理车主、共享他们的对账单、对账佣金和报销。",
        searchPlaceholder: "搜索车主、联系方式、备注、车辆...",
        addButton: "+ 新建车主",
        noSearchResults: "没有找到匹配的车主。",
        emptyTitle: "还没有车主。",
        emptyCta: "新建车主",
        vehicleCount: (count: number) => `${count} 台车`,
        balance: "余额",
        shareEnabled: "已开启共享链接",
        deleteError: "该车主名下还有车辆，请先重新分配车辆后再删除。",
      }
    : {
        title: "Owner revenue share",
        subtitle: "Manage owners, shared statements, commission ledger, and reimbursements.",
        searchPlaceholder: "Search owner, contact, notes, vehicle...",
        addButton: "+ New owner",
        noSearchResults: "No owners match this search.",
        emptyTitle: "No owners yet.",
        emptyCta: "New owner",
        vehicleCount: (count: number) => `${count} vehicle${count === 1 ? "" : "s"}`,
        balance: "Balance",
        shareEnabled: "Share link enabled",
        deleteError: "Owners with assigned vehicles need those vehicles reassigned first.",
      };
}

export default async function OwnersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const workspace = await requireCurrentWorkspace();
  const [{ locale }, params] = await Promise.all([getI18n(), searchParams]);
  const labels = copy(locale);
  const q = params.q?.trim() ?? "";
  const searchWhere = q
    ? {
        OR: [
          { name: { contains: q } },
          { phone: { contains: q } },
          { email: { contains: q } },
          { companyName: { contains: q } },
          { notes: { contains: q } },
          {
            vehicles: {
              some: {
                OR: [
                  { plateNumber: { contains: q } },
                  { nickname: { contains: q } },
                  { brand: { contains: q } },
                  { model: { contains: q } },
                  { vin: { contains: q } },
                  { turoListingName: { contains: q } },
                  { turoVehicleCode: { contains: q } },
                ],
              },
            },
          },
        ],
      }
    : {};

  const [owners, reimbursableVehicles, ownerBalances] = await Promise.all([
    prisma.owner.findMany({
      where: { workspaceId: workspace.id, ...searchWhere },
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { vehicles: true } },
        shareLinks: {
          where: { isActive: true },
          select: { id: true },
          take: 1,
        },
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
    prisma.vehicle.findMany({
      where: {
        workspaceId: workspace.id,
        ownerId: { not: null },
      },
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
        owner: { select: { id: true, name: true } },
      },
    }),
    prisma.ownerLedgerItem.groupBy({
      by: ["ownerId"],
      where: { workspaceId: workspace.id },
      _sum: { amount: true },
    }),
  ]);
  const balanceByOwnerId = new Map(
    ownerBalances.map((row) => [row.ownerId, row._sum.amount ?? 0]),
  );
  const ownersWithBalance = owners.map((owner) => ({
    owner,
    balance: balanceByOwnerId.get(owner.id) ?? 0,
  }));

  return (
    <div className="max-w-5xl p-3 sm:p-6">
      <div className="mb-4 flex flex-col gap-2 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{labels.title}</h1>
          <p className="text-sm text-[var(--ink-soft)]">{labels.subtitle}</p>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:justify-end sm:gap-2">
          <QuickVehicleReimbursementButton
            locale={locale}
            vehicles={reimbursableVehicles
              .filter((vehicle) => vehicle.ownerId && vehicle.owner)
              .map((vehicle) => ({
                id: vehicle.id,
                ownerId: vehicle.ownerId!,
                ownerName: vehicle.owner!.name,
                label: `${vehicleLabel(vehicle)} · ${vehicle.owner!.name}`,
                searchText: [
                  vehicle.plateNumber,
                  vehicle.nickname,
                  vehicle.brand,
                  vehicle.model,
                  vehicle.year,
                  vehicle.vin,
                  vehicle.turoListingName,
                  vehicle.turoVehicleCode,
                  vehicle.owner!.name,
                ]
                  .filter(Boolean)
                  .join(" "),
              }))}
          />
          <Link href="/owners/new" className="btn-primary">
            {labels.addButton}
          </Link>
        </div>
      </div>

      {params.error === "owner-has-vehicles" ? (
        <div className="mb-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {labels.deleteError}
        </div>
      ) : null}

      <div className="mb-3 max-w-md sm:mb-4">
        <OwnersSearchInput initialValue={q} placeholder={labels.searchPlaceholder} />
      </div>

      {owners.length === 0 && q ? (
        <div className="card p-10 text-center text-[var(--ink-soft)]">{labels.noSearchResults}</div>
      ) : owners.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="mb-3 text-[var(--ink-mid)]">{labels.emptyTitle}</p>
          <Link href="/owners/new" className="btn-primary">
            {labels.emptyCta}
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {ownersWithBalance.map(({ owner, balance }) => (
            <Link
              key={owner.id}
              href={`/owners/${owner.id}`}
              className="card block px-3 py-2.5 transition-shadow hover:"
            >
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{owner.name}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-[var(--ink-soft)]">
                    {owner.email ? <span>{owner.email}</span> : null}
                    {owner.phone ? <span>{owner.phone}</span> : null}
                    {owner.companyName ? <span>{owner.companyName}</span> : null}
                  </div>
                </div>
                <div className="shrink-0 text-left text-xs text-[var(--ink-soft)] sm:text-right">
                  <div className="font-medium text-[var(--ink-mid)]">
                    {labels.vehicleCount(owner._count.vehicles)}
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 font-semibold",
                      balance > 0
                        ? "text-emerald-700"
                        : balance < 0
                          ? "text-amber-700"
                          : "text-[var(--ink-soft)]",
                    )}
                  >
                    {labels.balance}: {formatCurrency(balance, locale)}
                  </div>
                  {owner.shareLinks.length > 0 ? (
                    <div className="mt-0.5 text-emerald-600">{labels.shareEnabled}</div>
                  ) : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
