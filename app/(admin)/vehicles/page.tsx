import { deleteVehicleAction, saveVehicleAction } from "@/app/actions";
import { SearchableSelect } from "@/components/searchable-select";
import { StatusBadge } from "@/components/status-badge";
import { VehicleEditDialog } from "@/components/vehicle-edit-dialog";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getVehicleStatusOptions } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import type { ReactNode } from "react";

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string }>;
}) {
  const workspace = await requireCurrentWorkspace();
  const [{ locale, messages }, vehicles, owners, params] = await Promise.all([
    getI18n(),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      include: { owner: true, orders: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.owner.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { name: "asc" },
    }),
    searchParams,
  ]);

  const vehicleMessages = messages.vehicles;
  const vehicleStatusOptions = getVehicleStatusOptions(locale);
  const statusLabel = locale === "zh" ? "状态" : "Status";
  const vehicleSectionLabels =
    locale === "en"
      ? {
          identity: "Vehicle identity",
          ownership: "Owner and costs",
          booking: "Booking settings",
          turo: "Turo and notes",
        }
      : locale === "zh-Hant"
        ? {
            identity: "基礎資訊",
            ownership: "車主與費用",
            booking: "預訂設定",
            turo: "Turo 與備註",
          }
        : {
            identity: "基础信息",
            ownership: "车主与费用",
            booking: "预订设置",
            turo: "Turo 与备注",
          };
  const ownerSelectOptions = [
    { value: "", label: vehicleMessages.placeholders.unassignedOwner },
    ...owners.map((owner) => ({ value: owner.id, label: owner.name })),
  ];
  const vehicleStatusSelectOptions = vehicleStatusOptions.map((option) => ({
    value: option.value,
    label: option.label,
  }));
  const vehicleQuery = (params.q ?? "").trim();
  const normalizedVehicleQuery = vehicleQuery.toLowerCase();
  const filteredVehicles = normalizedVehicleQuery
    ? vehicles.filter((vehicle) =>
        [
          vehicle.plateNumber,
          vehicle.nickname,
          vehicle.brand,
          vehicle.model,
          vehicle.year.toString(),
          vehicle.vin,
          vehicle.turoListingName,
          vehicle.turoVehicleCode,
          vehicle.owner?.name,
          vehicle.bookingTaxName,
          vehicle.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedVehicleQuery),
      )
    : vehicles;

  return (
    <div className="space-y-2.5">
      {params.error ? (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-[12px] text-amber-700">
          {vehicleMessages.deleteError}
        </div>
      ) : null}

      {/* Create form is 12 inputs deep — collapsed by default on every
       * viewport so the page opens straight to the existing fleet
       * cards. Same `<details>` pattern as the orders page. */}
      <details className="group overflow-hidden rounded-lg border border-white/70 bg-white/90 shadow-sm">
        <summary className="tap-press flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-3 sm:px-4 sm:py-3.5">
          <p className="text-[9px] uppercase tracking-[0.22em] text-slate-500 sm:text-[10px] sm:tracking-[0.24em]">
            {vehicleMessages.createKicker}
          </p>
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition group-open:rotate-45 group-open:bg-slate-950 group-open:text-white"
          >
            <span className="text-lg leading-none">+</span>
          </span>
        </summary>
        <form action={saveVehicleAction} className="grid gap-3 border-t border-slate-200 px-3 py-3 text-[12px] sm:px-4 sm:py-3.5">
          <VehicleFormSection title={vehicleSectionLabels.identity} gridClassName="md:grid-cols-2 xl:grid-cols-4">
            <input
              name="plateNumber"
              placeholder={vehicleMessages.placeholders.plateNumber}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
            <input
              name="nickname"
              placeholder={vehicleMessages.placeholders.nickname}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
            <input
              name="brand"
              placeholder={vehicleMessages.placeholders.brand}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
            <input
              name="model"
              placeholder={vehicleMessages.placeholders.model}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
            <input
              name="year"
              type="number"
              placeholder={vehicleMessages.placeholders.year}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
            <input
              name="vin"
              placeholder={vehicleMessages.placeholders.vin}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
            <SearchableSelect
              name="status"
              defaultValue="available"
              options={vehicleStatusSelectOptions}
              placeholder={statusLabel}
              searchPlaceholder={statusLabel}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
          </VehicleFormSection>

          <VehicleFormSection title={vehicleSectionLabels.ownership} gridClassName="md:grid-cols-2 xl:grid-cols-4">
            <SearchableSelect
              name="ownerId"
              options={ownerSelectOptions}
              placeholder={vehicleMessages.placeholders.unassignedOwner}
              searchPlaceholder={vehicleMessages.placeholders.unassignedOwner}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
            <input
              name="purchasePrice"
              type="number"
              step="0.01"
              placeholder={vehicleMessages.placeholders.purchasePrice}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
            <input
              name="ownerCommissionRate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder={vehicleMessages.placeholders.ownerCommissionRate}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
            <input
              name="cleaningFee"
              type="number"
              min="0"
              step="0.01"
              placeholder={vehicleMessages.placeholders.cleaningFee}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
          </VehicleFormSection>

          <VehicleFormSection title={vehicleSectionLabels.booking} gridClassName="md:grid-cols-2 xl:grid-cols-4">
            <input
              name="pickupPassword"
              placeholder={vehicleMessages.placeholders.pickupPassword}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
            <input
              name="bookingTaxName"
              placeholder={vehicleMessages.placeholders.bookingTaxName}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
            <input
              name="bookingTaxRate"
              type="number"
              min="0"
              max="100"
              step="0.001"
              placeholder={vehicleMessages.placeholders.bookingTaxRate}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
          </VehicleFormSection>

          <VehicleFormSection title={vehicleSectionLabels.turo} gridClassName="md:grid-cols-2 xl:grid-cols-4">
            <input
              name="turoListingName"
              placeholder={vehicleMessages.placeholders.turoListingName}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 xl:col-span-2"
            />
            <input
              name="turoVehicleCode"
              placeholder={vehicleMessages.placeholders.turoVehicleCode}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            />
            <input
              name="notes"
              placeholder={vehicleMessages.placeholders.notes}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 xl:col-span-4"
            />
          </VehicleFormSection>

          <button className="rounded-md bg-slate-950 px-3 py-2 font-medium text-white xl:col-span-1">
            {vehicleMessages.addVehicle}
          </button>
        </form>
      </details>

      <section className="rounded-lg border border-white/70 bg-white/90 p-3 shadow-sm sm:p-3.5">
        <form action="/vehicles" className="flex flex-col gap-2 sm:flex-row">
          <input
            type="search"
            name="q"
            defaultValue={vehicleQuery}
            placeholder={vehicleMessages.searchPlaceholder}
            className="min-h-9 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />
          <div className="flex gap-2">
            <button className="rounded-md bg-slate-950 px-3 py-2 text-[12px] font-medium text-white">
              {vehicleMessages.searchButton}
            </button>
            {vehicleQuery ? (
              <a
                href="/vehicles"
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-600"
              >
                {vehicleMessages.clearSearch}
              </a>
            ) : null}
          </div>
        </form>
        <p className="mt-1.5 text-[10.5px] text-slate-500">
          {vehicleMessages.searchResults(filteredVehicles.length, vehicles.length)}
        </p>
      </section>

      <section className="grid gap-2.5 sm:gap-3 xl:grid-cols-3">
        {filteredVehicles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white/80 p-4 text-[12px] text-slate-500 xl:col-span-3">
            {vehicleMessages.noSearchResults}
          </div>
        ) : null}
        {filteredVehicles.map((vehicle) => (
          <article key={vehicle.id} className="rounded-lg border border-white/70 bg-white/90 p-3 shadow-sm sm:p-3.5">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <h3 className="font-serif text-[0.95rem] font-semibold leading-tight text-slate-950 sm:text-[1.05rem] lg:text-[1.1rem]">{vehicle.nickname}</h3>
                <p className="mt-1 text-[11px] leading-snug text-slate-500 sm:text-[12px]">
                  {vehicle.brand} {vehicle.model} · {vehicle.year} · {vehicle.plateNumber}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-500 sm:text-[12px]">
                  {vehicleMessages.ownerPrefix}:{" "}
                  {vehicle.owner?.name ?? vehicleMessages.placeholders.unassignedOwner}
                </p>
                {vehicle.purchasePrice != null ? (
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500 sm:text-[12px]">
                    {vehicleMessages.placeholders.purchasePrice}: CA${vehicle.purchasePrice.toFixed(2)}
                  </p>
                ) : null}
                {vehicle.ownerCommissionRate != null ? (
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500 sm:text-[12px]">
                    {vehicleMessages.commissionPrefix}: {(vehicle.ownerCommissionRate * 100).toFixed(2)}%
                  </p>
                ) : null}
                {vehicle.cleaningFee != null && vehicle.cleaningFee > 0 ? (
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500 sm:text-[12px]">
                    {vehicleMessages.placeholders.cleaningFee}: CA${vehicle.cleaningFee.toFixed(2)}
                  </p>
                ) : null}
                {vehicle.bookingTaxRate != null && vehicle.bookingTaxRate > 0 ? (
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500 sm:text-[12px]">
                    {vehicleMessages.placeholders.bookingTaxName}:{" "}
                    {vehicle.bookingTaxName?.trim() || "Tax"} · {vehicle.bookingTaxRate.toFixed(3)}%
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1">
                <StatusBadge value={vehicle.status} locale={locale} />
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {vehicleMessages.orderCount(vehicle.orders.length)}
                </span>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <VehicleEditDialog
                locale={locale}
                owners={owners.map((owner) => ({ id: owner.id, label: owner.name }))}
                vehicle={{
                  id: vehicle.id,
                  ownerId: vehicle.ownerId,
                  plateNumber: vehicle.plateNumber,
                  nickname: vehicle.nickname,
                  brand: vehicle.brand,
                  model: vehicle.model,
                  year: vehicle.year,
                  vin: vehicle.vin,
                  status: vehicle.status,
                  turoListingName: vehicle.turoListingName,
                  turoVehicleCode: vehicle.turoVehicleCode,
                  purchasePrice: vehicle.purchasePrice,
                  ownerCommissionRate: vehicle.ownerCommissionRate,
                  cleaningFee: vehicle.cleaningFee,
                  pickupPassword: vehicle.pickupPassword,
                  bookingTaxName: vehicle.bookingTaxName,
                  bookingTaxRate: vehicle.bookingTaxRate,
                  notes: vehicle.notes,
                }}
                trigger={vehicleMessages.editVehicle}
                triggerClassName="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
              />
              <form action={deleteVehicleAction}>
              <input type="hidden" name="id" value={vehicle.id} />
              <button className="inline-flex min-h-9 items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-3 text-[12px] font-semibold text-rose-700 shadow-sm transition hover:border-rose-300 hover:bg-rose-100">
                {vehicleMessages.deleteVehicle}
              </button>
              </form>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function VehicleFormSection({
  title,
  children,
  gridClassName = "md:grid-cols-3",
}: {
  title: string;
  children: ReactNode;
  gridClassName?: string;
}) {
  return (
    <fieldset className="border-t border-slate-200 pt-3 first:border-t-0 first:pt-0">
      <legend className="px-0 text-[11px] font-semibold tracking-[0.08em] text-slate-600">
        {title}
      </legend>
      <div className={`mt-2 grid gap-2 ${gridClassName}`}>{children}</div>
    </fieldset>
  );
}
