"use client";

import { useMemo, useState } from "react";

import { assignOwnerVehiclesAction } from "@/app/actions";

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
  vehicles: VehicleOption[];
  messages: {
    noVehicles: string;
    searchPlaceholder: string;
    noSearchResults: string;
    resultCount: (shown: number, total: number) => string;
    assignedTo: (name: string) => string;
    saveVehicleAssignments: string;
  };
};

function normalizeSearch(value: string) {
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

  return (
    <form action={assignOwnerVehiclesAction} className="mt-2.5 space-y-2.5">
      <input type="hidden" name="ownerId" value={ownerId} />
      {[...selectedVehicleIds].map((vehicleId) => (
        <input key={vehicleId} type="hidden" name="vehicleIds" value={vehicleId} />
      ))}

      {vehicles.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-500">
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
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
            <p className="text-[10.5px] text-slate-500">
              {messages.resultCount(filteredVehicles.length, vehicles.length)}
            </p>
          </div>

          <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-md border border-slate-200 bg-white p-2">
            {filteredVehicles.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-[12px] text-slate-500">
                {messages.noSearchResults}
              </div>
            ) : (
              filteredVehicles.map((vehicle) => {
                const assignedElsewhere = vehicle.ownerId && vehicle.ownerId !== ownerId;
                const checked = selectedVehicleIds.has(vehicle.id);

                return (
                  <label
                    key={vehicle.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleVehicle(vehicle.id)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-900">
                        {vehicle.plateNumber} · {vehicle.nickname}
                      </span>
                      <span className="block text-[10.5px] text-slate-500">
                        {vehicle.brand} {vehicle.model} {vehicle.year}
                        {assignedElsewhere && vehicle.ownerName
                          ? ` · ${messages.assignedTo(vehicle.ownerName)}`
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

      <button className="rounded-md bg-slate-950 px-3 py-2 text-[12px] font-medium text-white">
        {messages.saveVehicleAssignments}
      </button>
    </form>
  );
}
