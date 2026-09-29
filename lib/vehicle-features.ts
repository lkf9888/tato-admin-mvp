/**
 * The handful of things a renter picks a car by, set per car in the
 * direct-booking drawer and shown on the rental site. A fixed list, not
 * free text, so the same feature reads the same on every car and can be
 * translated.
 *
 * No `server-only`: the drawer and the public page both render these.
 */
export const VEHICLE_FEATURES = [
  "seats5",
  "seats6",
  "seats7",
  "snowTires",
  "awd",
  "carplay",
  "androidAuto",
  "backupCamera",
  "adaptiveCruise",
] as const;

export type VehicleFeature = (typeof VEHICLE_FEATURES)[number];

export function isVehicleFeature(value: unknown): value is VehicleFeature {
  return typeof value === "string" && (VEHICLE_FEATURES as readonly string[]).includes(value);
}

/** Read the stored JSON; unknown or repeated entries are dropped, order follows the list. */
export function parseVehicleFeatures(raw: string | null | undefined): VehicleFeature[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return VEHICLE_FEATURES.filter((feature) => parsed.includes(feature));
  } catch {
    return [];
  }
}

export const VEHICLE_FEATURE_LABELS: Record<"en" | "zh" | "zh-Hant", Record<VehicleFeature, string>> = {
  en: {
    seats5: "5 seats",
    seats6: "6 seats",
    seats7: "7 seats",
    snowTires: "Snow tires",
    awd: "AWD / 4WD",
    carplay: "Apple CarPlay",
    androidAuto: "Android Auto",
    backupCamera: "Backup camera",
    adaptiveCruise: "Adaptive cruise (ACC)",
  },
  zh: {
    seats5: "5 人座",
    seats6: "6 人座",
    seats7: "7 人座",
    snowTires: "雪胎",
    awd: "四驱",
    carplay: "Apple CarPlay",
    androidAuto: "Android Auto",
    backupCamera: "倒车影像",
    adaptiveCruise: "自适应巡航 (ACC)",
  },
  "zh-Hant": {
    seats5: "5 人座",
    seats6: "6 人座",
    seats7: "7 人座",
    snowTires: "雪胎",
    awd: "四驅",
    carplay: "Apple CarPlay",
    androidAuto: "Android Auto",
    backupCamera: "倒車影像",
    adaptiveCruise: "自適應巡航 (ACC)",
  },
};
