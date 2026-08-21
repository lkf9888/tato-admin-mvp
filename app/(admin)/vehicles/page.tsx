import { deleteVehicleAction, saveVehicleAction } from "@/app/actions";
import { SearchableSelect } from "@/components/searchable-select";
import { StatusBadge } from "@/components/status-badge";
import { VehicleEditDialog } from "@/components/vehicle-edit-dialog";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getVehicleStatusOptions } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import type { ReactNode } from "react";
import { foldLatinLookalikes } from "@/lib/utils";

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
  // Folded on both sides, so a plate pasted from Turo finds the same
  // car as one typed by hand. The two spellings are drawn identically
  // and nothing on screen can tell them apart.
  const normalizedVehicleQuery = foldLatinLookalikes(vehicleQuery).toLowerCase();
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
          .includes(normalizedVehicleQuery) ||
        foldLatinLookalikes(
          [vehicle.plateNumber, vehicle.vin, vehicle.turoVehicleCode].filter(Boolean).join(" "),
        )
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
      <details className="group overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <summary className="tap-press flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-3 sm:px-4 sm:py-3.5">
          <p className="text-[9px] uppercase tracking-[0.22em] text-[var(--ink-soft)] sm:text-[10px] sm:tracking-[0.24em]">
            {vehicleMessages.createKicker}
          </p>
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--ink-soft)] transition group-open:rotate-45 group-open:bg-[var(--ink)] group-open:text-white"
          >
            <span className="text-lg leading-none">+</span>
          </span>
        </summary>
        <form action={saveVehicleAction} className="grid gap-3 border-t border-[var(--line)] px-3 py-3 text-[12px] sm:px-4 sm:py-3.5">
          <VehicleFormSection title={vehicleSectionLabels.identity} gridClassName="md:grid-cols-2 xl:grid-cols-4">
            <input
              name="plateNumber"
              placeholder={vehicleMessages.placeholders.plateNumber}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
            <input
              name="nickname"
              placeholder={vehicleMessages.placeholders.nickname}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
            <input
              name="brand"
              placeholder={vehicleMessages.placeholders.brand}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
            <input
              name="model"
              placeholder={vehicleMessages.placeholders.model}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
            <input
              name="year"
              type="number"
              placeholder={vehicleMessages.placeholders.year}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
            <input
              name="vin"
              placeholder={vehicleMessages.placeholders.vin}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
            <SearchableSelect
              name="status"
              defaultValue="available"
              options={vehicleStatusSelectOptions}
              placeholder={statusLabel}
              searchPlaceholder={statusLabel}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
          </VehicleFormSection>

          <VehicleFormSection title={vehicleSectionLabels.ownership} gridClassName="md:grid-cols-2 xl:grid-cols-4">
            <SearchableSelect
              name="ownerId"
              options={ownerSelectOptions}
              placeholder={vehicleMessages.placeholders.unassignedOwner}
              searchPlaceholder={vehicleMessages.placeholders.unassignedOwner}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
            <input
              name="purchasePrice"
              type="number"
              step="0.01"
              placeholder={vehicleMessages.placeholders.purchasePrice}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
            <input
              name="ownerCommissionRate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder={vehicleMessages.placeholders.ownerCommissionRate}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
            <input
              name="cleaningFee"
              type="number"
              min="0"
              step="0.01"
              placeholder={vehicleMessages.placeholders.cleaningFee}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
          </VehicleFormSection>

          <VehicleFormSection title={vehicleSectionLabels.booking} gridClassName="md:grid-cols-2 xl:grid-cols-4">
            <input
              name="pickupPassword"
              placeholder={vehicleMessages.placeholders.pickupPassword}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
            <input
              name="bookingTaxName"
              placeholder={vehicleMessages.placeholders.bookingTaxName}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
            <input
              name="bookingTaxRate"
              type="number"
              min="0"
              max="100"
              step="0.001"
              placeholder={vehicleMessages.placeholders.bookingTaxRate}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
          </VehicleFormSection>

          <VehicleFormSection title={vehicleSectionLabels.turo} gridClassName="md:grid-cols-2 xl:grid-cols-4">
            <input
              name="turoListingName"
              placeholder={vehicleMessages.placeholders.turoListingName}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 xl:col-span-2"
            />
            <input
              name="turoVehicleCode"
              placeholder={vehicleMessages.placeholders.turoVehicleCode}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
            />
            <input
              name="notes"
              placeholder={vehicleMessages.placeholders.notes}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 xl:col-span-4"
            />
          </VehicleFormSection>

          <button className="rounded-md bg-[var(--ink)] px-3 py-2 font-medium text-white xl:col-span-1">
            {vehicleMessages.addVehicle}
          </button>
        </form>
      </details>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-3.5">
        <form action="/vehicles" className="flex flex-col gap-2 sm:flex-row">
          <input
            type="search"
            name="q"
            defaultValue={vehicleQuery}
            placeholder={vehicleMessages.searchPlaceholder}
            className="min-h-9 flex-1 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[12px] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--line)]"
          />
          <div className="flex gap-2">
            <button className="rounded-md bg-[var(--ink)] px-3 py-2 text-[12px] font-medium text-white">
              {vehicleMessages.searchButton}
            </button>
            {vehicleQuery ? (
              <a
                href="/vehicles"
                className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[12px] font-medium text-[var(--ink-mid)]"
              >
                {vehicleMessages.clearSearch}
              </a>
            ) : null}
          </div>
        </form>
        <p className="mt-1.5 text-[10.5px] text-[var(--ink-soft)]">
          {vehicleMessages.searchResults(filteredVehicles.length, vehicles.length)}
        </p>
      </section>

      <section className="grid gap-2.5 sm:gap-3 xl:grid-cols-3">
        {filteredVehicles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface)] p-4 text-[12px] text-[var(--ink-soft)] xl:col-span-3">
            {vehicleMessages.noSearchResults}
          </div>
        ) : null}
        {filteredVehicles.map((vehicle) => (
          <article key={vehicle.id} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-3.5">
            {/* Turo's hierarchy: one bold name, one grey identity
                line, then facts as labelled pairs. The previous card
                stacked up to seven grey lines of equal weight, which
                is a paragraph to read rather than a card to scan --
                and on a phone it was most of a screen per vehicle. */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="t-title truncate text-[var(--ink)]">{vehicle.nickname}</h3>
                <p className="t-meta mt-1 truncate text-[var(--ink-soft)]">
                  {vehicle.brand} {vehicle.model} · {vehicle.year} · {vehicle.plateNumber}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                <StatusBadge value={vehicle.status} locale={locale} />
                <span className="chip chip-neutral">
                  {vehicleMessages.orderCount(vehicle.orders.length)}
                </span>
              </div>
            </div>

            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[var(--line)] pt-2.5">
              <div className="min-w-0">
                <dt className="t-eyebrow text-[var(--ink-soft)]">{vehicleMessages.ownerPrefix}</dt>
                <dd className="mt-0.5 truncate text-[12.5px] font-bold text-[var(--ink)]">
                  {vehicle.owner?.name ?? vehicleMessages.placeholders.unassignedOwner}
                </dd>
              </div>
              {vehicle.ownerCommissionRate != null ? (
                <div className="min-w-0">
                  <dt className="t-eyebrow text-[var(--ink-soft)]">
                    {vehicleMessages.commissionPrefix}
                  </dt>
                  <dd className="mt-0.5 text-[12.5px] font-bold tabular-nums text-[var(--ink)]">
                    {(vehicle.ownerCommissionRate * 100).toFixed(2)}%
                  </dd>
                </div>
              ) : null}
              {vehicle.purchasePrice != null ? (
                <div className="min-w-0">
                  <dt className="t-eyebrow text-[var(--ink-soft)]">
                    {vehicleMessages.placeholders.purchasePrice}
                  </dt>
                  <dd className="mt-0.5 text-[12.5px] font-bold tabular-nums text-[var(--ink)]">
                    CA${vehicle.purchasePrice.toFixed(2)}
                  </dd>
                </div>
              ) : null}
              {vehicle.cleaningFee != null && vehicle.cleaningFee > 0 ? (
                <div className="min-w-0">
                  <dt className="t-eyebrow text-[var(--ink-soft)]">
                    {vehicleMessages.placeholders.cleaningFee}
                  </dt>
                  <dd className="mt-0.5 text-[12.5px] font-bold tabular-nums text-[var(--ink)]">
                    CA${vehicle.cleaningFee.toFixed(2)}
                  </dd>
                </div>
              ) : null}
              {vehicle.bookingTaxRate != null && vehicle.bookingTaxRate > 0 ? (
                <div className="min-w-0">
                  <dt className="t-eyebrow truncate text-[var(--ink-soft)]">
                    {vehicle.bookingTaxName?.trim() || vehicleMessages.placeholders.bookingTaxName}
                  </dt>
                  <dd className="mt-0.5 text-[12.5px] font-bold tabular-nums text-[var(--ink)]">
                    {vehicle.bookingTaxRate.toFixed(3)}%
                  </dd>
                </div>
              ) : null}
            </dl>

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
                  turoAccount: vehicle.turoAccount,
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
                triggerClassName="inline-flex min-h-9 items-center justify-center rounded-md border border-[var(--line-strong)] bg-white px-3 text-[12px] font-semibold text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-muted)]"
              />
              <form action={deleteVehicleAction}>
              <input type="hidden" name="id" value={vehicle.id} />
              <button className="inline-flex min-h-9 items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-3 text-[12px] font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100">
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
    <fieldset className="border-t border-[var(--line)] pt-3 first:border-t-0 first:pt-0">
      <legend className="px-0 text-[11px] font-semibold tracking-[0.08em] text-[var(--ink-mid)]">
        {title}
      </legend>
      <div className={`mt-2 grid gap-2 ${gridClassName}`}>{children}</div>
    </fieldset>
  );
}
