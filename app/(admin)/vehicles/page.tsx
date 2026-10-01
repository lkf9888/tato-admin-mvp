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

/**
 * Does this plate answer to what was typed, allowing for a character
 * that is present on one side and not the other?
 *
 * Ordinary containment only looks one way: type A661GL and a plate
 * stored as 661GL never matches, because the query is longer than the
 * thing it is searching. That is exactly the failure worth surviving
 * here -- an importer that dropped a leading letter, or an operator
 * typing one the record does not have -- and it is invisible, because
 * the two strings look almost identical.
 *
 * So containment is tested in both directions. Bounded to four
 * characters, since below that a stored plate would match half the
 * fleet, and only ever against the plate itself: reverse containment
 * over free text like notes would match everything.
 */
function plateMatchesLoosely(plateNumber: string | null, query: string): boolean {
  if (!plateNumber || query.length < 4) return false;
  const plate = foldLatinLookalikes(plateNumber).toLowerCase();
  return plate.length >= 4 && query.includes(plate);
}

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    q?: string;
    plate?: string;
    field?: string;
    reason?: string;
  }>;
}) {
  const workspace = await requireCurrentWorkspace();
  const [{ locale, messages }, vehicles, owners, params] = await Promise.all([
    getI18n(),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      // A count, not the orders themselves. Loading every order of every
      // car to print one number per row was thousands of rows per visit.
      include: {
        owner: true,
        // Trips the car took or will take. Deleted orders are in the
        // trash, and cancelled ones -- which stay on the calendar as a
        // thin bar since v1.20.0 -- never put the car on the road.
        _count: {
          select: { orders: { where: { isArchived: false, status: { not: "cancelled" } } } },
        },
      },
      // Archived cars last: they are history, not the fleet in use.
      orderBy: [{ isArchived: "asc" }, { createdAt: "desc" }],
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
          .includes(normalizedVehicleQuery) ||
        plateMatchesLoosely(vehicle.plateNumber, normalizedVehicleQuery),
      )
    : vehicles;

  return (
    <div className="space-y-2.5">
      {/* One banner, three reasons. A duplicate plate used to crash the
          request outright, so the operator saw an error digest and no
          hint that the cause was a car already on file -- and when the
          holder is another workspace, the car is invisible here, which
          looks exactly like the plate being free. */}
      {params.error ? (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-700">
          {params.error === "plate_taken"
            ? vehicleMessages.plateTaken(params.plate ?? "")
            : params.error === "plate_taken_elsewhere"
              ? vehicleMessages.plateTakenElsewhere(params.plate ?? "")
              : params.error === "invalid_field"
                ? vehicleMessages.invalidField(params.field ?? "", params.reason ?? "")
                : vehicleMessages.deleteError}
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

      {/* One row per car. The fleet is past 130 cars, and three cards
          across meant scrolling several screens to find one -- a list
          is what a fleet this size is read as. Secondary columns drop
          away on narrow screens; the car, plate, status and actions
          stay. */}
      {filteredVehicles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface)] p-4 text-[12px] text-[var(--ink-soft)]">
          {vehicleMessages.noSearchResults}
        </div>
      ) : (
        <section className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <table className="w-full min-w-[20rem] border-collapse text-left text-[12px]">
            <thead className="sticky top-0 z-10 bg-[var(--surface-muted)] text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-soft)]">
              <tr>
                <th className="px-3 py-2 font-semibold">{vehicleMessages.listVehicle}</th>
                <th className="hidden px-3 py-2 font-semibold sm:table-cell">{vehicleMessages.placeholders.plateNumber}</th>
                <th className="hidden px-3 py-2 font-semibold md:table-cell">{vehicleMessages.ownerPrefix}</th>
                <th className="px-3 py-2 font-semibold">{statusLabel}</th>
                <th className="hidden px-3 py-2 text-right font-semibold sm:table-cell">{vehicleMessages.listOrders}</th>
                <th className="hidden px-3 py-2 text-right font-semibold lg:table-cell">{vehicleMessages.commissionPrefix}</th>
                <th className="hidden px-3 py-2 text-right font-semibold lg:table-cell">{vehicleMessages.placeholders.cleaningFee}</th>
                <th className="px-3 py-2 text-right font-semibold">{vehicleMessages.listActions}</th>
              </tr>
            </thead>
            <tbody>
              {filteredVehicles.map((vehicle) => (
                <tr
                  key={vehicle.id}
                  className="border-t border-[var(--line)] transition hover:bg-[var(--surface-muted)]"
                >
                  <td className="max-w-[11rem] px-3 py-2 sm:max-w-[16rem]">
                    <p className="truncate font-semibold text-[var(--ink)]">{vehicle.nickname}</p>
                    <p className="truncate text-[11px] text-[var(--ink-soft)]">
                      {/* On a phone the plate rides here instead of taking
                          a column of its own, so the row fits the screen
                          and the actions are not scrolled off to the right. */}
                      <span className="font-medium text-[var(--ink)] sm:hidden">{vehicle.plateNumber} · </span>
                      {vehicle.brand} {vehicle.model} · {vehicle.year}
                    </p>
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 font-medium tabular-nums text-[var(--ink)] sm:table-cell">
                    {vehicle.plateNumber}
                  </td>
                  <td className="hidden max-w-[12rem] truncate px-3 py-2 text-[var(--ink)] md:table-cell">
                    {vehicle.owner?.name ?? (
                      <span className="text-[var(--ink-soft)]">
                        {vehicleMessages.placeholders.unassignedOwner}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {vehicle.isArchived ? (
                      <span className="inline-flex rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ink-soft)]">
                        {vehicleMessages.archivedBadge}
                      </span>
                    ) : (
                      <StatusBadge value={vehicle.status} locale={locale} />
                    )}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--ink)] sm:table-cell">
                    {vehicle._count.orders}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--ink)] lg:table-cell">
                    {vehicle.ownerCommissionRate != null
                      ? `${(vehicle.ownerCommissionRate * 100).toFixed(2)}%`
                      : "—"}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--ink)] lg:table-cell">
                    {vehicle.cleaningFee != null && vehicle.cleaningFee > 0
                      ? `CA$${vehicle.cleaningFee.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
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
                          isArchived: vehicle.isArchived,
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
                        trigger={
                          <>
                            <span className="sm:hidden">{vehicleMessages.listEdit}</span>
                            <span className="hidden sm:inline">{vehicleMessages.editVehicle}</span>
                          </>
                        }
                        triggerClassName="inline-flex h-8 items-center justify-center rounded-md border border-[var(--line-strong)] bg-white px-2.5 text-[11.5px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                      />
                      {/* Hidden on a phone: the edit dialog sets the same
                          status, and two buttons per row did not fit. */}
                      {vehicle.isArchived ? null : (
                      <form action={deleteVehicleAction} className="hidden sm:block">
                        <input type="hidden" name="id" value={vehicle.id} />
                        <button className="inline-flex h-8 items-center justify-center rounded-md border border-rose-200 bg-white px-2.5 text-[11.5px] font-semibold text-rose-700 transition hover:bg-rose-50">
                          {vehicleMessages.deleteVehicle}
                        </button>
                      </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
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
