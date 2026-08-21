"use client";

import { useMemo, useState } from "react";

import { assignOwnerVehiclesAction } from "@/app/actions";
import type { Locale } from "@/lib/i18n";
import { foldLatinLookalikes } from "@/lib/utils";

type VehicleOption = {
  id: string;
  plateNumber: string;
  nickname: string;
  brand: string;
  model: string;
  year: number;
  vin: string | null;
  turoListingName: string | null;
  turoVehicleCode: string | null;
  ownerId: string | null;
  ownerName: string | null;
};

type OwnerVehicleAssignmentFormProps = {
  ownerId: string;
  locale: Locale;
  vehicles: VehicleOption[];
  messages: {
    noVehicles: string;
    searchPlaceholder: string;
    noSearchResults: string;
    saveVehicleAssignments: string;
  };
};

function normalizeSearch(value: string) {
  value = foldLatinLookalikes(value);
  return value.trim().toLowerCase();
}

function buildVehicleSearchText(vehicle: VehicleOption) {
  return [
    vehicle.plateNumber,
    vehicle.nickname,
    vehicle.brand,
    vehicle.model,
    vehicle.year.toString(),
    vehicle.vin,
    vehicle.turoListingName,
    vehicle.turoVehicleCode,
    vehicle.ownerName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function OwnerVehicleAssignmentForm({
  ownerId,
  locale,
  vehicles,
  messages,
}: OwnerVehicleAssignmentFormProps) {
  const [query, setQuery] = useState("");
  const [selectedVehicleIds, setSelectedVehicleIds] = useState(
    () => new Set(vehicles.filter((vehicle) => vehicle.ownerId === ownerId).map((vehicle) => vehicle.id)),
  );

  const normalizedQuery = normalizeSearch(query);
  const filteredVehicles = useMemo(() => {
    if (!normalizedQuery) return vehicles;
    return vehicles.filter((vehicle) => buildVehicleSearchText(vehicle).includes(normalizedQuery));
  }, [normalizedQuery, vehicles]);

  function toggleVehicle(vehicleId: string) {
    setSelectedVehicleIds((current) => {
      const next = new Set(current);
      if (next.has(vehicleId)) {
        next.delete(vehicleId);
      } else {
        next.add(vehicleId);
      }
      return next;
    });
  }

  const resultCount =
    locale === "zh"
      ? `当前显示 ${filteredVehicles.length} / ${vehicles.length} 台车`
      : `${filteredVehicles.length} of ${vehicles.length} vehicle(s) shown`;

  function formatAssignedOwner(ownerName: string) {
    return locale === "zh" ? `当前属于 ${ownerName}` : `Currently assigned to ${ownerName}`;
  }

  return (
    <form action={assignOwnerVehiclesAction} className="mt-2.5 space-y-2.5">
      <input type="hidden" name="ownerId" value={ownerId} />
      {[...selectedVehicleIds].map((vehicleId) => (
        <input key={vehicleId} type="hidden" name="vehicleIds" value={vehicleId} />
      ))}

      {vehicles.length === 0 ? (
        <div className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[12px] text-[var(--ink-soft)]">
          {messages.noVehicles}
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={messages.searchPlaceholder}
              className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[12px] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--line)]"
            />
            <p className="text-[10.5px] text-[var(--ink-soft)]">
              {resultCount}
            </p>
          </div>

          <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-md border border-[var(--line)] bg-white p-2">
            {filteredVehicles.length === 0 ? (
              <div className="rounded-md border border-dashed border-[var(--line)] bg-[var(--surface-muted)] px-3 py-3 text-[12px] text-[var(--ink-soft)]">
                {messages.noSearchResults}
              </div>
            ) : (
              filteredVehicles.map((vehicle) => {
                const assignedElsewhere = vehicle.ownerId && vehicle.ownerId !== ownerId;
                const checked = selectedVehicleIds.has(vehicle.id);

                return (
                  <label
                    key={vehicle.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-[12px] text-[var(--ink-mid)]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleVehicle(vehicle.id)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-[var(--line-strong)]"
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold text-[var(--ink)]">
                        {vehicle.plateNumber} · {vehicle.nickname}
                      </span>
                      <span className="block text-[10.5px] text-[var(--ink-soft)]">
                        {vehicle.brand} {vehicle.model} {vehicle.year}
                        {assignedElsewhere && vehicle.ownerName
                          ? ` · ${formatAssignedOwner(vehicle.ownerName)}`
                          : ""}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </>
      )}

      <button className="rounded-md bg-[var(--ink)] px-3 py-2 text-[12px] font-medium text-white">
        {messages.saveVehicleAssignments}
      </button>
    </form>
  );
}
