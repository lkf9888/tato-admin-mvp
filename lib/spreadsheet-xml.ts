/**
 * An Excel workbook as SpreadsheetML (Excel 2003 XML): one sheet, a bold
 * header row, and cells that are text or numbers. Excel, Numbers and
 * LibreOffice all open it, it needs no library, and a number cell stays
 * a number so the sheet can be summed.
 *
 * Shared by the exports so they look alike and escape alike.
 */

export type SheetCell = string | number | null | undefined;

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function sanitizeWorksheetName(value: string) {
  return value.replace(/[\\/*?:[\]]/g, "").slice(0, 31) || "Sheet1";
}

function buildCell(value: SheetCell, styleId?: string) {
  const styleAttribute = styleId ? ` ss:StyleID="${styleId}"` : "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<Cell${styleAttribute}><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  return `<Cell${styleAttribute}><Data ss:Type="String">${escapeXml(value == null ? "" : String(value))}</Data></Cell>`;
}

export function buildWorkbookXml(sheetName: string, headers: string[], rows: SheetCell[][]) {
  const headerRow = `<Row>${headers.map((header) => buildCell(header, "Header")).join("")}</Row>`;
  const dataRows = rows.map((row) => `<Row>${row.map((cell) => buildCell(cell)).join("")}</Row>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${escapeXml(sanitizeWorksheetName(sheetName))}">
  <Table>
   ${headerRow}
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

/** The download response for a workbook. */
export function workbookResponseHeaders(filename: string) {
  return {
    "Content-Type": "application/vnd.ms-excel; charset=utf-8",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Cache-Control": "no-store",
  };
}
