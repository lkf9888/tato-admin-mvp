import { OrderSource, OrderStatus, type Vehicle } from "@prisma/client";
import { parse } from "date-fns";

import { syncOrderOwnerLedger } from "@/lib/owner-ledger";
import { prisma } from "@/lib/prisma";
import { getNetEarningFromFinancials, normalizeText, parseNumberValue, safeString } from "@/lib/utils";

export type CsvFieldMapping = {
  vehicleLabel?: string;
  vehicleName?: string;
  externalVehicleId?: string;
  vin?: string;
  renterName?: string;
  renterPhone?: string;
  pickupDatetime?: string;
  returnDatetime?: string;
  pickupLocation?: string;
  returnLocation?: string;
  tripPrice?: string;
  totalEarnings?: string;
  totalPrice?: string;
  externalOrderId?: string;
  status?: string;
};

type CsvImportRow = Record<string, string>;
export type ProjectedImportVehicleOption = {
  key: string;
  label: string;
  secondaryLabel: string;
  rowCount: number;
};
const csvFieldKeys = new Set<string>([
  "vehicleLabel",
  "vehicleName",
  "externalVehicleId",
  "vin",
  "renterName",
  "renterPhone",
  "pickupDatetime",
  "returnDatetime",
  "pickupLocation",
  "returnLocation",
  "tripPrice",
  "totalEarnings",
  "totalPrice",
  "externalOrderId",
  "status",
]);

export function orderRangesOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
) {
  return startA < endB && endA > startB;
}

export async function reconcileVehicleConflicts(vehicleId: string) {
  const orders = await prisma.order.findMany({
    where: {
      vehicleId,
      isArchived: false,
      status: {
        not: OrderStatus.cancelled,
      },
    },
    orderBy: {
      pickupDatetime: "asc",
    },
  });

  const conflictedIds = new Set<string>();

  for (let index = 0; index < orders.length; index += 1) {
    const current = orders[index];
    for (let nextIndex = index + 1; nextIndex < orders.length; nextIndex += 1) {
      const candidate = orders[nextIndex];
      if (
        orderRangesOverlap(
          current.pickupDatetime,
          current.returnDatetime,
          candidate.pickupDatetime,
          candidate.returnDatetime,
        )
      ) {
        conflictedIds.add(current.id);
        conflictedIds.add(candidate.id);
      }
    }
  }

  await prisma.$transaction(
    orders.map((order) =>
      prisma.order.update({
        where: { id: order.id },
        data: { hasConflict: conflictedIds.has(order.id) },
      }),
    ),
  );
}

export async function logActivity(input: {
  workspaceId?: string | null;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: unknown;
}) {
  await prisma.activityLog.create({
    data: {
      workspaceId: input.workspaceId ?? undefined,
      actor: input.actor,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  });
}

function tokenizeVehicleReference(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function vehicleMatchesCsvRecord(
  vehicle: Vehicle,
  refs: {
    vehicleLabel?: string;
    vehicleName?: string;
    externalVehicleId?: string;
    vin?: string;
  },
) {
  const normalizedTargets = new Set(
    [
      refs.vehicleLabel,
      refs.vehicleName,
      refs.externalVehicleId,
      refs.vin,
      ...tokenizeVehicleReference(refs.vehicleLabel),
    ]
      .filter(Boolean)
      .map((value) => normalizeText(value)),
  );

  if (normalizedTargets.size === 0) return false;

  const vehicleCandidates = [
    vehicle.nickname,
    vehicle.plateNumber,
    vehicle.turoListingName,
    vehicle.turoVehicleCode,
    vehicle.vin,
    `${vehicle.brand} ${vehicle.model}`,
    `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
  ]
    .filter(Boolean)
    .map((value) => normalizeText(value));

  return vehicleCandidates.some((candidate) => normalizedTargets.has(candidate));
}

function resolveVehicleFromCsv(
  vehicles: Vehicle[],
  refs: {
  vehicleLabel?: string;
  vehicleName?: string;
  externalVehicleId?: string;
  vin?: string;
},
) {
  const normalizedVin = normalizeText(refs.vin);
  if (normalizedVin) {
    const byVin = vehicles.find((vehicle) => normalizeText(vehicle.vin) === normalizedVin);
    if (byVin) return byVin;
  }

  const normalizedExternalVehicleId = normalizeText(refs.externalVehicleId);
  if (normalizedExternalVehicleId) {
    const byTuroVehicleCode = vehicles.find(
      (vehicle) => normalizeText(vehicle.turoVehicleCode) === normalizedExternalVehicleId,
    );
    if (byTuroVehicleCode) return byTuroVehicleCode;
  }

  const extractedPlate = extractPlateNumber(
    refs.vehicleLabel,
    refs.externalVehicleId,
    refs.vin,
  );
  if (extractedPlate) {
    const byPlate = vehicles.find(
      (vehicle) => normalizeText(vehicle.plateNumber) === normalizeText(extractedPlate),
    );
    if (byPlate) return byPlate;
  }

  return vehicles.find((vehicle) => vehicleMatchesCsvRecord(vehicle, refs));
}

async function findExistingImportedOrder(input: {
  workspaceId: string;
  externalOrderId?: string | null;
  vehicleId: string;
  renterName: string;
  pickupDatetime: Date;
  returnDatetime: Date;
}) {
  if (input.externalOrderId) {
    const exact = await prisma.order.findFirst({
      where: {
        workspaceId: input.workspaceId,
        source: OrderSource.turo,
        externalOrderId: input.externalOrderId,
      },
    });
    if (exact) return exact;
  }

  return prisma.order.findFirst({
    where: {
      workspaceId: input.workspaceId,
      source: OrderSource.turo,
      vehicleId: input.vehicleId,
      renterName: input.renterName,
      pickupDatetime: input.pickupDatetime,
      returnDatetime: input.returnDatetime,
    },
  });
}

function parseCsvOrderStatus(value?: string) {
  const normalized = normalizeText(value);
  if (normalized === "ongoing" || normalized === "in progress" || normalized === "in-progress") {
    return OrderStatus.ongoing;
  }
  if (normalized === "completed") return OrderStatus.completed;
  if (
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized.includes("cancellation")
  ) {
    return OrderStatus.cancelled;
  }
  return OrderStatus.booked;
}

const CSV_DATE_FORMATS = [
  // ISO-ish formats
  "yyyy-MM-dd HH:mm:ss",
  "yyyy-MM-dd HH:mm",
  "yyyy-MM-dd hh:mm a",
  "yyyy-MM-dd h:mm a",
  "yyyy-MM-dd'T'HH:mm:ss",
  "yyyy-MM-dd'T'HH:mm",
  // US-style formats Turo earnings export commonly uses
  "MM/dd/yyyy hh:mm a",
  "MM/dd/yyyy h:mm a",
  "MM/dd/yyyy HH:mm",
  "M/d/yyyy h:mm a",
  "M/d/yyyy hh:mm a",
  "M/d/yyyy HH:mm",
  "M/d/yyyy H:mm",
  "M/d/yy h:mm a",
  "M/d/yy H:mm",
  // Month-name formats, e.g. "Apr 22, 2026 9:00 AM"
  "MMM d, yyyy h:mm a",
  "MMM d, yyyy hh:mm a",
  "MMM dd, yyyy h:mm a",
  "MMMM d, yyyy h:mm a",
  "MMMM d, yyyy hh:mm a",
  // Date-only fallbacks
  "yyyy-MM-dd",
  "MM/dd/yyyy",
  "M/d/yyyy",
];

function getCsvImportTimeZone() {
  return process.env.CSV_IMPORT_TIMEZONE?.trim() || "America/Vancouver";
}

function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcGuess));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const tzYear = Number(map.year);
  const tzMonth = Number(map.month);
  const tzDay = Number(map.day);
  const tzHour = Number(map.hour === "24" ? "00" : map.hour);
  const tzMinute = Number(map.minute);
  const tzSecond = Number(map.second);
  const tzAsUtc = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, tzSecond);
  const offset = tzAsUtc - utcGuess;
  return new Date(utcGuess - offset);
}

function parseCsvDate(value: string) {
  const timeZone = getCsvImportTimeZone();
  const trimmed = value.trim();

  for (const format of CSV_DATE_FORMATS) {
    const parsed = parse(trimmed, format, new Date());
    if (Number.isNaN(parsed.getTime())) continue;

    return zonedWallClockToUtc(
      parsed.getFullYear(),
      parsed.getMonth() + 1,
      parsed.getDate(),
      parsed.getHours(),
      parsed.getMinutes(),
      parsed.getSeconds(),
      timeZone,
    );
  }

  const fallback = new Date(trimmed);
  return fallback;
}

function extractFinancialsFromRow(row: CsvImportRow) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) =>
      [
        "Trip price",
        "Boost price",
        "3-day discount",
        "1-week discount",
        "2-week discount",
        "3-week discount",
        "1-month discount",
        "2-month discount",
        "3-month discount",
        "Non-refundable discount",
        "Early bird discount",
        "Host promotional credit",
        "Delivery",
        "Excess distance",
        "Extras",
        "Cancellation fee",
        "Additional usage",
        "Late fee",
        "Improper return fee",
        "Airport operations fee",
        "Airport parking credit",
        "Tolls & tickets",
        "On-trip EV charging",
        "Post-trip EV charging",
        "Smoking",
        "Cleaning",
        "Fines (paid to host)",
        "Gas reimbursement",
        "Gas fee",
        "Other fees",
        "Sales tax",
        "Total earnings",
      ].includes(key),
    ),
  );
}

function buildSourceMetadata(row: CsvImportRow) {
  const financials = extractFinancialsFromRow(row);

  return JSON.stringify({
    vehicle: {
      label: row["Vehicle"] ?? null,
      name: row["Vehicle name"] ?? null,
      vehicleId: row["Vehicle id"] ?? null,
      vin: row["VIN"] ?? null,
    },
    financials,
    rawRow: row,
  });
}

function extractPlateNumber(vehicleLabel?: string, externalVehicleId?: string, vin?: string) {
  // 1. Explicit BC-style plate marker, e.g. "Tesla Model Y #A603JM".
  const bcPlateMatch = (vehicleLabel ?? "").match(/#([A-Za-z0-9]+)/);
  if (bcPlateMatch?.[1]) return bcPlateMatch[1].toUpperCase();

  // 2. Parenthesised plate, e.g. "2022 Tesla Model Y (A603JM)".
  const parenPlateMatch = (vehicleLabel ?? "").match(/\(([A-Za-z0-9]{5,10})\)/);
  if (parenPlateMatch?.[1] && !/^\d+$/.test(parenPlateMatch[1])) {
    return parenPlateMatch[1].toUpperCase();
  }

  // 3. A plate-shaped token (letters+digits) inside the label. Skip pure-digit
  // tokens because a leading year (e.g. "2022 Tesla Model Y") must NOT be
  // treated as the plate — that collapses every 2022-year car into one row.
  const plateLikeToken = (vehicleLabel ?? "")
    .split(/[\s,()\[\]]+/)
    .map((token) => token.replace(/[^A-Za-z0-9]/g, "").trim())
    .find(
      (token) =>
        token.length >= 5 &&
        token.length <= 10 &&
        /[A-Za-z]/.test(token) &&
        /[0-9]/.test(token),
    );
  if (plateLikeToken) return plateLikeToken.toUpperCase();

  // 4. Deterministic fallbacks — these guarantee each Turo vehicle gets its
  // own plate bucket even when the label has no plate.
  if (externalVehicleId) return `TURO-${externalVehicleId}`;
  if (vin) return `VIN-${vin.slice(-8).toUpperCase()}`;
  return null;
}

function buildPlateNumberCandidates(
  vehicleLabel?: string,
  externalVehicleId?: string,
  vin?: string,
) {
  return Array.from(
    new Set(
      [
        extractPlateNumber(vehicleLabel, externalVehicleId, vin),
        externalVehicleId ? `TURO-${externalVehicleId}` : null,
        vin ? `VIN-${vin.slice(-8).toUpperCase()}` : null,
      ].filter(Boolean) as string[],
    ),
  );
}

async function findAvailablePlateNumber(candidates: string[], workspaceId: string) {
  for (const candidate of candidates) {
    const existing = await prisma.vehicle.findFirst({
      where: { plateNumber: candidate },
      select: { workspaceId: true },
    });
    if (!existing || existing.workspaceId === workspaceId) {
      return candidate;
    }
  }

  const base = candidates[0];
  if (!base) return null;
  const suffix = workspaceId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase() || "LOCAL";
  const fallback = `${base}-${suffix}`;
  const existingFallback = await prisma.vehicle.findFirst({
    where: { plateNumber: fallback },
    select: { id: true },
  });
  return existingFallback ? null : fallback;
}

function buildProjectedVehicleKey(input: {
  vehicleLabel?: string;
  vehicleName?: string;
  externalVehicleId?: string;
  vin?: string;
}) {
  if (input.vin) return `vin:${normalizeText(input.vin)}`;
  if (input.externalVehicleId) return `vehicle:${normalizeText(input.externalVehicleId)}`;
  const plateNumber = extractPlateNumber(
    input.vehicleLabel,
    input.externalVehicleId,
    input.vin,
  );
  if (plateNumber) return `plate:${plateNumber}`;
  if (input.vehicleName) return `name:${normalizeText(input.vehicleName)}`;
  if (input.vehicleLabel) return `label:${normalizeText(input.vehicleLabel)}`;
  return null;
}

function buildProjectedVehicleLabels(input: {
  vehicleLabel?: string;
  vehicleName?: string;
  externalVehicleId?: string;
  vin?: string;
}) {
  const label =
    input.vehicleName?.trim() ||
    input.vehicleLabel?.trim() ||
    input.externalVehicleId?.trim() ||
    input.vin?.trim() ||
    "Imported vehicle";

  const secondaryLabel = [
    input.vehicleLabel?.trim(),
    input.externalVehicleId?.trim(),
    input.vin?.trim(),
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    label,
    secondaryLabel,
  };
}

function parseVehicleBasics(vehicleName?: string) {
  const fallback = {
    brand: "Unknown",
    model: vehicleName || "Imported Vehicle",
    year: 2026,
  };

  if (!vehicleName) return fallback;

  const twoWordBrands = [
    "Land Rover",
    "Mercedes-Benz",
    "Alfa Romeo",
    "Aston Martin",
    "Rolls Royce",
  ];

  const yearMatch = vehicleName.match(/(19|20)\d{2}$/);
  const year = yearMatch ? Number(yearMatch[0]) : fallback.year;
  const nameWithoutYear = yearMatch ? vehicleName.slice(0, yearMatch.index).trim() : vehicleName.trim();

  const matchedBrand = twoWordBrands.find((brand) => nameWithoutYear.startsWith(brand));
  if (matchedBrand) {
    return {
      brand: matchedBrand,
      model: nameWithoutYear.slice(matchedBrand.length).trim() || "Imported Vehicle",
      year,
    };
  }

  const [brand, ...rest] = nameWithoutYear.split(" ");
  return {
    brand: brand || fallback.brand,
    model: rest.join(" ").trim() || "Imported Vehicle",
    year,
  };
}

function summarizeImportError(error: unknown): string {
  if (!error) return "Unknown import error";
  const message = error instanceof Error ? error.message : String(error);
  // Prisma unique-constraint shape: "Unique constraint failed on the fields: (`plateNumber`)"
  const uniqueMatch = message.match(/Unique constraint failed on the fields?:\s*\(`?([^`)]+)`?\)/i);
  if (uniqueMatch) {
    return `Duplicate ${uniqueMatch[1]} value (unique constraint)`;
  }
  // Foreign-key shape: "Foreign key constraint failed on the field: `vehicleId`"
  const fkMatch = message.match(/Foreign key constraint failed on the field:\s*`?([^`]+)`?/i);
  if (fkMatch) {
    return `Foreign key violation on ${fkMatch[1]}`;
  }
  // Truncate verbose Prisma error envelopes so the breakdown panel stays readable.
  const firstLine = message.split("\n").find((line) => line.trim().length > 0) ?? message;
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;
}

async function createVehicleFromCsvRow(input: {
  workspaceId: string;
  row: CsvImportRow;
  mapping: CsvFieldMapping;
  actor: string;
}) {
  const vehicleLabel = safeString(input.row[input.mapping.vehicleLabel ?? ""]);
  const vehicleName = safeString(input.row[input.mapping.vehicleName ?? ""]);
  const externalVehicleId = safeString(input.row[input.mapping.externalVehicleId ?? ""]);
  const vin = safeString(input.row[input.mapping.vin ?? ""]);
  const plateNumberCandidates = buildPlateNumberCandidates(vehicleLabel, externalVehicleId, vin);

  if (plateNumberCandidates.length === 0) return null;

  const basics = parseVehicleBasics(vehicleName || vehicleLabel);

  const existingVehicle = await prisma.vehicle.findFirst({
    where: {
      workspaceId: input.workspaceId,
      OR: plateNumberCandidates.map((plateNumber) => ({ plateNumber })),
    },
  });

  const plateNumber = existingVehicle
    ? existingVehicle.plateNumber
    : await findAvailablePlateNumber(plateNumberCandidates, input.workspaceId);

  if (!plateNumber) return null;

  const sharedUpdateData = {
    nickname: vehicleName || vehicleLabel || plateNumber,
    brand: basics.brand,
    model: basics.model,
    year: basics.year,
    vin: vin || undefined,
    turoListingName: vehicleName || vehicleLabel || undefined,
    turoVehicleCode: externalVehicleId || undefined,
    notes: "Auto-created from Turo CSV import.",
  };

  const vehicle = existingVehicle
    ? await prisma.vehicle.update({
        where: { id: existingVehicle.id },
        data: sharedUpdateData,
      })
    : await prisma.vehicle.create({
        data: {
          workspaceId: input.workspaceId,
          plateNumber,
          ...sharedUpdateData,
        },
      });

  await logActivity({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "vehicle_auto_created_from_csv",
    entityType: "Vehicle",
    entityId: vehicle.id,
    metadata: {
      plateNumber: vehicle.plateNumber,
      vehicleLabel,
      vehicleName,
      externalVehicleId,
    },
  });

  return vehicle;
}

async function syncVehicleFromCsvRow(input: {
  vehicle: Vehicle;
  vehicles: Vehicle[];
  row: CsvImportRow;
  mapping: CsvFieldMapping;
}) {
  const vehicleLabel = safeString(input.row[input.mapping.vehicleLabel ?? ""]);
  const vehicleName = safeString(input.row[input.mapping.vehicleName ?? ""]);
  const externalVehicleId = safeString(input.row[input.mapping.externalVehicleId ?? ""]);
  const vin = safeString(input.row[input.mapping.vin ?? ""]);
  const basics = parseVehicleBasics(vehicleName || vehicleLabel);

  // Intentionally do NOT touch `plateNumber` here. Plates are stable
  // identifiers, re-writing them during per-row CSV sync can collide with the
  // global unique constraint (two rows parse the same plate, a cross-workspace
  // vehicle already owns it, etc.) and takes down the whole batch. Users can
  // edit the plate directly from the vehicle management UI when they truly
  // need to change it.
  const nextData = {
    nickname: vehicleName || vehicleLabel || input.vehicle.nickname,
    brand: basics.brand,
    model: basics.model,
    year: basics.year,
    vin: vin || input.vehicle.vin || null,
    turoListingName: vehicleName || vehicleLabel || input.vehicle.turoListingName || null,
    turoVehicleCode: externalVehicleId || input.vehicle.turoVehicleCode || null,
  };

  const hasChanges =
    input.vehicle.nickname !== nextData.nickname ||
    input.vehicle.brand !== nextData.brand ||
    input.vehicle.model !== nextData.model ||
    input.vehicle.year !== nextData.year ||
    (input.vehicle.vin ?? null) !== nextData.vin ||
    (input.vehicle.turoListingName ?? null) !== nextData.turoListingName ||
    (input.vehicle.turoVehicleCode ?? null) !== nextData.turoVehicleCode;

  if (!hasChanges) {
    return input.vehicle;
  }

  const updatedVehicle = await prisma.vehicle.update({
    where: { id: input.vehicle.id },
    data: nextData,
  });

  const vehicleIndex = input.vehicles.findIndex((candidate) => candidate.id === updatedVehicle.id);
  if (vehicleIndex >= 0) {
    input.vehicles[vehicleIndex] = updatedVehicle;
  }

  return updatedVehicle;
}

export function normalizeCsvFieldMapping(input: Record<string, string>): CsvFieldMapping {
  const entries = Object.entries(input).filter(([, value]) => value);
  const looksLikeFieldToHeader = entries.some(([key]) => csvFieldKeys.has(key));

  if (looksLikeFieldToHeader) {
    return input as CsvFieldMapping;
  }

  const normalized: CsvFieldMapping = {};
  for (const [header, field] of entries) {
    if (!csvFieldKeys.has(field)) continue;
    normalized[field as keyof CsvFieldMapping] = header;
  }

  return normalized;
}

export async function estimateImportVehicleImpact(input: {
  workspaceId: string;
  mapping: CsvFieldMapping;
  rows: CsvImportRow[];
  createMissingVehicles?: boolean;
}) {
  const mapping = normalizeCsvFieldMapping(input.mapping as Record<string, string>);
  const vehicles = await prisma.vehicle.findMany({
    where: { workspaceId: input.workspaceId },
  });
  const projectedVehicleMap = new Map<string, ProjectedImportVehicleOption>();

  for (const row of input.rows) {
    const vehicleLabel = safeString(row[mapping.vehicleLabel ?? ""]);
    const vehicleName = safeString(row[mapping.vehicleName ?? ""]);
    const externalVehicleId = safeString(row[mapping.externalVehicleId ?? ""]);
    const vin = safeString(row[mapping.vin ?? ""]);

    if (!vehicleLabel && !vehicleName && !externalVehicleId && !vin) {
      continue;
    }

    const existingVehicle = resolveVehicleFromCsv(vehicles, {
      vehicleLabel,
      vehicleName,
      externalVehicleId,
      vin,
    });

    if (existingVehicle || !input.createMissingVehicles) {
      continue;
    }

    const projectedKey = buildProjectedVehicleKey({
      vehicleLabel,
      vehicleName,
      externalVehicleId,
      vin,
    });

    if (projectedKey) {
      const existingProjectedVehicle = projectedVehicleMap.get(projectedKey);
      const labels = buildProjectedVehicleLabels({
        vehicleLabel,
        vehicleName,
        externalVehicleId,
        vin,
      });

      projectedVehicleMap.set(projectedKey, {
        key: projectedKey,
        label: labels.label,
        secondaryLabel: labels.secondaryLabel,
        rowCount: (existingProjectedVehicle?.rowCount ?? 0) + 1,
      });
    }
  }

  return {
    currentVehicleCount: vehicles.length,
    projectedNewVehicleCount: projectedVehicleMap.size,
    projectedVehicleCount: vehicles.length + projectedVehicleMap.size,
    projectedVehicleOptions: Array.from(projectedVehicleMap.values()),
  };
}

export async function importTuroOrders(input: {
  workspaceId: string;
  fileName: string;
  actor: string;
  mapping: CsvFieldMapping;
  rows: CsvImportRow[];
  createMissingVehicles?: boolean;
  selectedVehicleKeys?: string[];
}) {
  const mapping = normalizeCsvFieldMapping(input.mapping as Record<string, string>);
  const failures: Array<{ rowNumber: number; reason: string; row: CsvImportRow }> = [];
  const selectedVehicleKeys = new Set((input.selectedVehicleKeys ?? []).filter(Boolean));

  const batch = await prisma.importBatch.create({
    data: {
      workspaceId: input.workspaceId,
      fileName: input.fileName,
      importedBy: input.actor,
      totalRows: input.rows.length,
      successRows: 0,
      failedRows: 0,
      mapping: JSON.stringify(mapping),
    },
  });

  let successRows = 0;
  const touchedVehicleIds = new Set<string>();
  const vehicles = await prisma.vehicle.findMany({
    where: { workspaceId: input.workspaceId },
  });
  const syncedVehicleIds = new Set<string>();
  const syncedOrderIds = new Set<string>();
  let createdVehicles = 0;
  let updatedVehicles = 0;
  let deletedCancelledRows = 0;
  let deletedStaleOrders = 0;
  let skippedRows = 0;

  for (const [index, row] of input.rows.entries()) {
    const vehicleLabel = safeString(row[mapping.vehicleLabel ?? ""]);
    const vehicleName = safeString(row[mapping.vehicleName ?? ""]);
    const externalVehicleId = safeString(row[mapping.externalVehicleId ?? ""]);
    const vin = safeString(row[mapping.vin ?? ""]);
    const renterName = safeString(row[mapping.renterName ?? ""]);
    const pickupValue = safeString(row[mapping.pickupDatetime ?? ""]);
    const returnValue = safeString(row[mapping.returnDatetime ?? ""]);
    const projectedVehicleKey = buildProjectedVehicleKey({
      vehicleLabel,
      vehicleName,
      externalVehicleId,
      vin,
    });

    try {
      if ((!vehicleLabel && !vehicleName && !externalVehicleId && !vin) || !renterName || !pickupValue || !returnValue) {
        failures.push({
          rowNumber: index + 1,
          reason: "Missing required mapped fields",
          row,
        });
        continue;
      }

      let vehicle = resolveVehicleFromCsv(vehicles, {
        vehicleLabel,
        vehicleName,
        externalVehicleId,
        vin,
      });

      if (!vehicle && input.createMissingVehicles) {
        if (
          selectedVehicleKeys.size > 0 &&
          projectedVehicleKey &&
          !selectedVehicleKeys.has(projectedVehicleKey)
        ) {
          skippedRows += 1;
          continue;
        }

        const createdVehicle = await createVehicleFromCsvRow({
          workspaceId: input.workspaceId,
          row,
          mapping,
          actor: input.actor,
        });

        if (createdVehicle) {
          vehicles.push(createdVehicle);
          vehicle = createdVehicle;
          createdVehicles += 1;
        }
      }

      if (!vehicle) {
        failures.push({
          rowNumber: index + 1,
          reason: `Vehicle not found for "${vehicleLabel || vehicleName || externalVehicleId || vin}"`,
          row,
        });
        continue;
      }

      if (!syncedVehicleIds.has(vehicle.id)) {
        const syncedVehicle = await syncVehicleFromCsvRow({
          vehicle,
          vehicles,
          row,
          mapping,
        });

        if (syncedVehicle !== vehicle) {
          vehicle = syncedVehicle;
          updatedVehicles += 1;
        }

        syncedVehicleIds.add(vehicle.id);
      }

      const pickupDatetime = parseCsvDate(pickupValue);
      const returnDatetime = parseCsvDate(returnValue);

      if (Number.isNaN(pickupDatetime.getTime()) || Number.isNaN(returnDatetime.getTime())) {
        failures.push({
          rowNumber: index + 1,
          reason: "Invalid pickup or return date",
          row,
        });
        continue;
      }

      const externalOrderId = safeString(row[mapping.externalOrderId ?? ""]) || null;
      const existing = await findExistingImportedOrder({
        workspaceId: input.workspaceId,
        externalOrderId,
        vehicleId: vehicle.id,
        renterName,
        pickupDatetime,
        returnDatetime,
      });
      const status = parseCsvOrderStatus(row[mapping.status ?? ""]);
      const importedRenterPhone = safeString(row[mapping.renterPhone ?? ""]);
      const importedPickupLocation = safeString(row[mapping.pickupLocation ?? ""]);
      const importedReturnLocation = safeString(row[mapping.returnLocation ?? ""]);
      const importedTotalPrice = getNetEarningFromFinancials(
        extractFinancialsFromRow(row),
        parseNumberValue(row[mapping.totalEarnings ?? ""]) ??
          parseNumberValue(row[mapping.tripPrice ?? ""]) ??
          parseNumberValue(row[mapping.totalPrice ?? ""]),
      );

      const payload = {
        vehicleId: vehicle.id,
        workspaceId: input.workspaceId,
        importBatchId: batch.id,
        source: OrderSource.turo,
        externalOrderId,
        renterName,
        renterPhone: importedRenterPhone || existing?.renterPhone || null,
        pickupDatetime,
        returnDatetime,
        totalPrice: importedTotalPrice ?? existing?.totalPrice ?? null,
        status,
        createdBy: input.actor,
        pickupLocation: importedPickupLocation || existing?.pickupLocation || null,
        returnLocation: importedReturnLocation || existing?.returnLocation || null,
        notes: existing?.notes ?? null,
        sourceMetadata: buildSourceMetadata(row),
        isArchived: status === OrderStatus.cancelled,
      };

      if (status === OrderStatus.cancelled) {
        const savedCancelledOrder = existing
          ? await prisma.order.update({
              where: { id: existing.id },
              data: payload,
            })
          : await prisma.order.create({
              data: payload,
            });

        await syncOrderOwnerLedger(savedCancelledOrder.id);
        syncedOrderIds.add(savedCancelledOrder.id);
        touchedVehicleIds.add(vehicle.id);
        deletedCancelledRows += 1;
        successRows += 1;
        continue;
      }

      const savedOrder = existing
        ? await prisma.order.update({
            where: { id: existing.id },
            data: payload,
          })
        : await prisma.order.create({
            data: payload,
          });
      await syncOrderOwnerLedger(savedOrder.id);
      syncedOrderIds.add(savedOrder.id);

      touchedVehicleIds.add(vehicle.id);
      successRows += 1;
    } catch (error) {
      // Any unexpected DB/Prisma error (unique constraint, FK violation, etc.)
      // gets reported as a per-row failure instead of taking down the whole
      // batch. The surfaced reason feeds into the aggregated breakdown panel.
      failures.push({
        rowNumber: index + 1,
        reason: summarizeImportError(error),
        row,
      });
    }
  }

  if (failures.length === 0) {
    const staleTuroOrders = await prisma.order.findMany({
      where: {
        workspaceId: input.workspaceId,
        source: OrderSource.turo,
        isArchived: false,
        ...(syncedVehicleIds.size > 0
          ? {
              vehicleId: {
                in: Array.from(syncedVehicleIds),
              },
            }
          : {
              id: "__no_stale_orders__",
            }),
        ...(syncedOrderIds.size > 0
          ? {
              id: {
                notIn: Array.from(syncedOrderIds),
              },
            }
          : {}),
      },
      select: {
        id: true,
        vehicleId: true,
      },
    });

    if (staleTuroOrders.length > 0) {
      await prisma.order.updateMany({
        where: {
          id: {
            in: staleTuroOrders.map((order) => order.id),
          },
        },
        data: {
          isArchived: true,
        },
      });

      deletedStaleOrders = staleTuroOrders.length;
      for (const order of staleTuroOrders) {
        await syncOrderOwnerLedger(order.id);
        touchedVehicleIds.add(order.vehicleId);
      }
    }
  }

  for (const vehicleId of touchedVehicleIds) {
    await reconcileVehicleConflicts(vehicleId);
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      successRows,
      failedRows: failures.length,
      failures: JSON.stringify(failures),
      notes:
        failures.length > 0
          ? `${failures.length} row(s) need manual review${createdVehicles > 0 ? ` · ${createdVehicles} vehicle(s) auto-created` : ""}${updatedVehicles > 0 ? ` · ${updatedVehicles} vehicle(s) refreshed` : ""}${skippedRows > 0 ? ` · ${skippedRows} row(s) skipped by vehicle selection` : ""}${deletedCancelledRows > 0 ? ` · ${deletedCancelledRows} cancelled row(s) archived` : ""} · previous Turo orders kept until the file imports cleanly`
          : `Import completed without row-level issues${createdVehicles > 0 ? ` · ${createdVehicles} vehicle(s) auto-created` : ""}${updatedVehicles > 0 ? ` · ${updatedVehicles} vehicle(s) refreshed` : ""}${skippedRows > 0 ? ` · ${skippedRows} row(s) skipped by vehicle selection` : ""}${deletedCancelledRows > 0 ? ` · ${deletedCancelledRows} cancelled row(s) archived` : ""}${deletedStaleOrders > 0 ? ` · ${deletedStaleOrders} stale Turo order(s) archived` : ""}`,
    },
  });

  await logActivity({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "import_csv",
    entityType: "ImportBatch",
    entityId: batch.id,
    metadata: {
      fileName: input.fileName,
      successRows,
      failedRows: failures.length,
      createdVehicles,
      updatedVehicles,
      skippedRows,
      deletedCancelledRows,
      deletedStaleOrders,
    },
  });

  return {
    batchId: batch.id,
    successRows,
    failedRows: failures.length,
    createdVehicles,
    updatedVehicles,
    skippedRows,
    deletedCancelledRows,
    deletedStaleOrders,
    failures,
  };
}
