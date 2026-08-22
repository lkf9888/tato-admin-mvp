/**
 * Checks for the vehicle form's validation schema.
 *
 * The bug this exists for: `turoAccount` is blank for every car on the
 * main Turo account, the action turns blank into an explicit `null`,
 * and the schema said `.optional()` -- which admits `undefined` and
 * rejects `null`. So adding any vehicle without a co-host account
 * failed validation, and because the parse was unguarded it surfaced
 * as an anonymous 500 rather than a message about a field.
 *
 * Same shape as the assistant's threadId bug earlier in this project:
 * nullable column, caller sends null, schema allows only undefined.
 *
 *   npx tsx scripts/check-vehicle-form.ts
 */
import { z } from "zod";
import { VehicleStatus } from "@prisma/client";

// Mirrors app/actions.ts vehicleSchema for the fields under test.
const schema = z.object({
  plateNumber: z.string().min(2),
  nickname: z.string().min(2),
  brand: z.string().min(2),
  model: z.string().min(1),
  year: z.coerce.number().int().min(2000).max(2100),
  status: z.nativeEnum(VehicleStatus),
  turoAccount: z.string().nullish(),
});

const base = {
  plateNumber: "A661GL",
  nickname: "Mitsubishi RVR",
  brand: "Mitsubishi",
  model: "RVR",
  year: "2026",
  status: VehicleStatus.available,
};

let failed = 0;
function check(label: string, input: Record<string, unknown>, shouldPass: boolean) {
  const result = schema.safeParse(input);
  const ok = result.success === shouldPass;
  if (!ok) failed++;
  const detail = result.success ? "" : `  (${result.error.issues[0]?.path.join(".")}: ${result.error.issues[0]?.message})`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : detail}`);
}

// The exact input the form produces for a main-account car.
check("turoAccount null (main account, blank field)", { ...base, turoAccount: null }, true);
check("turoAccount undefined (field absent)", { ...base }, true);
check("turoAccount 'kevin' (co-hosted)", { ...base, turoAccount: "kevin" }, true);

// Things that must still be rejected, so the guard is not just "allow everything".
check("year below range", { ...base, year: "1999" }, false);
check("plate too short", { ...base, plateNumber: "A" }, false);
check("status not a real value", { ...base, status: "sold" }, false);
check("nickname missing", { ...base, nickname: "" }, false);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
