import { deleteVehicleAction, saveVehicleAction } from "@/app/actions";
import { StatusBadge } from "@/components/status-badge";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getVehicleStatusOptions } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
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

  return (
    <div className="space-y-6">
      {params.error ? (
        <div className="rounded-lg bg-amber-50 px-5 py-4 text-sm text-amber-700">
          {vehicleMessages.deleteError}
        </div>
      ) : null}

      <section className="rounded-lg border border-white/70 bg-white/90 p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
          {vehicleMessages.createKicker}
        </p>
        <form action={saveVehicleAction} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <input
            name="plateNumber"
            placeholder={vehicleMessages.placeholders.plateNumber}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="nickname"
            placeholder={vehicleMessages.placeholders.nickname}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="brand"
            placeholder={vehicleMessages.placeholders.brand}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="model"
            placeholder={vehicleMessages.placeholders.model}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="year"
            type="number"
            placeholder={vehicleMessages.placeholders.year}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="vin"
            placeholder={vehicleMessages.placeholders.vin}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="purchasePrice"
            type="number"
            step="0.01"
            placeholder={vehicleMessages.placeholders.purchasePrice}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <select name="ownerId" className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
            <option value="">{vehicleMessages.placeholders.unassignedOwner}</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
          <select
            name="status"
            defaultValue="available"
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
          >
            {vehicleStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            name="turoListingName"
            placeholder={vehicleMessages.placeholders.turoListingName}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 xl:col-span-2"
          />
          <input
            name="turoVehicleCode"
            placeholder={vehicleMessages.placeholders.turoVehicleCode}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="notes"
            placeholder={vehicleMessages.placeholders.notes}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 xl:col-span-4"
          />
          <button className="rounded-md bg-slate-950 px-4 py-3 font-medium text-white xl:col-span-1">
            {vehicleMessages.addVehicle}
          </button>
        </form>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        {vehicles.map((vehicle) => (
          <article key={vehicle.id} className="rounded-lg border border-white/70 bg-white/90 p-6 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="font-serif text-3xl text-slate-950">{vehicle.nickname}</h3>
                <p className="mt-2 text-sm text-slate-500">
                  {vehicle.brand} {vehicle.model} · {vehicle.year} · {vehicle.plateNumber}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {vehicleMessages.ownerPrefix}:{" "}
                  {vehicle.owner?.name ?? vehicleMessages.placeholders.unassignedOwner}
                </p>
                {vehicle.purchasePrice != null ? (
                  <p className="mt-1 text-sm text-slate-500">
                    {vehicleMessages.placeholders.purchasePrice}: CA${vehicle.purchasePrice.toFixed(2)}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <StatusBadge value={vehicle.status} locale={locale} />
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {vehicleMessages.orderCount(vehicle.orders.length)}
                </span>
              </div>
            </div>

            <details className="mt-5 rounded-lg bg-slate-50 px-5 py-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">
                {vehicleMessages.editVehicle}
              </summary>
              <form action={saveVehicleAction} className="mt-4 grid gap-3 md:grid-cols-2">
                <input type="hidden" name="id" value={vehicle.id} />
                <input
                  name="plateNumber"
                  defaultValue={vehicle.plateNumber}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                />
                <input
                  name="nickname"
                  defaultValue={vehicle.nickname}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                />
                <input
                  name="brand"
                  defaultValue={vehicle.brand}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                />
                <input
                  name="model"
                  defaultValue={vehicle.model}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                />
                <input
                  name="year"
                  type="number"
                  defaultValue={vehicle.year}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                />
                <input
                  name="vin"
                  defaultValue={vehicle.vin ?? ""}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                />
                <input
                  name="purchasePrice"
                  type="number"
                  step="0.01"
                  defaultValue={vehicle.purchasePrice ?? ""}
                  placeholder={vehicleMessages.placeholders.purchasePrice}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                />
                <select
                  name="ownerId"
                  defaultValue={vehicle.ownerId ?? ""}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                >
                  <option value="">{vehicleMessages.placeholders.unassignedOwner}</option>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </select>
                <select
                  name="status"
                  defaultValue={vehicle.status}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                >
                  {vehicleStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  name="turoListingName"
                  defaultValue={vehicle.turoListingName ?? ""}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3 md:col-span-2"
                />
                <input
                  name="turoVehicleCode"
                  defaultValue={vehicle.turoVehicleCode ?? ""}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                />
                <input
                  name="notes"
                  defaultValue={vehicle.notes ?? ""}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                />
                <div className="flex gap-3 md:col-span-2">
                  <button className="rounded-md bg-slate-950 px-4 py-3 font-medium text-white">
                    {vehicleMessages.saveChanges}
                  </button>
                </div>
              </form>
            </details>

            <form action={deleteVehicleAction} className="mt-4">
              <input type="hidden" name="id" value={vehicle.id} />
              <button className="text-sm font-medium text-rose-600">
                {vehicleMessages.deleteVehicle}
              </button>
            </form>
          </article>
        ))}
      </section>
    </div>
  );
}
