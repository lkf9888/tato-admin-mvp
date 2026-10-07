"use server";

import { requireSectionContext } from "@/lib/auth";
import { saveHiddenCsvColumns } from "@/lib/turo-csv-fields";

/**
 * Which Turo CSV columns the order page hides, for the whole workspace.
 * Under orders, where the fields are shown; not open to members limited
 * to some cars, since the choice changes every order's page.
 */
export async function saveHiddenCsvColumnsAction(columns: string[]) {
  const { workspace } = await requireSectionContext("/orders");
  if (!Array.isArray(columns) || columns.some((column) => typeof column !== "string")) {
    throw new Error("BAD_INPUT");
  }
  return saveHiddenCsvColumns(workspace.id, columns);
}
