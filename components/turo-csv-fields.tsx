import { TuroCsvFieldsView } from "@/components/turo-csv-fields-view";
import { userRole } from "@/lib/access";
import { requireAccessContext } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";
import { getHiddenCsvColumns, readCsvRow } from "@/lib/turo-csv-fields";

/**
 * The order's row from the Turo CSV, every column of it, minus the ones
 * the workspace chose to hide. Renders nothing for an order that did
 * not come from a CSV (mail, site, offline).
 */
export async function TuroCsvFields({
  sourceMetadata,
  locale,
}: {
  sourceMetadata: string | null;
  locale: Locale;
}) {
  const row = readCsvRow(sourceMetadata);
  if (!row) return null;
  const { user, workspace, vehicleIds } = await requireAccessContext();
  const hidden = await getHiddenCsvColumns(workspace.id);
  // The choice is the workspace's, so only someone who can change every
  // order may make it (see saveHiddenCsvColumnsAction).
  const canEdit = userRole(user) !== "VIEWER" && vehicleIds === null;
  return <TuroCsvFieldsView row={row} initialHidden={hidden} canEdit={canEdit} locale={locale} />;
}
