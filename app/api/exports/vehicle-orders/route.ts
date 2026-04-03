import { NextResponse } from "next/server";
import { OrderStatus } from "@prisma/client";

import { isAdminAuthenticated } from "@/lib/auth";
import { getMessages, type Locale } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDateTime, getOrderNetEarning } from "@/lib/utils";

function parseLocale(value: string | null): Locale {
  return value === "zh" ? "zh" : "en";
}

function parseDateOnly(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T00:00:00`);
}

function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeWorksheetName(value: string) {
  return value.replace(/[\\/*?:[\]]/g, "").slice(0, 31) || "Orders";
}

function buildCell(value: string, styleId?: string) {
  const styleAttribute = styleId ? ` ss:StyleID="${styleId}"` : "";
  return `<Cell${styleAttribute}><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function buildWorkbookXml(sheetName: string, headers: string[], rows: string[][]) {
  const headerRow = `<Row>${headers.map((header) => buildCell(header, "Header")).join("")}</Row>`;
  const dataRows = rows
    .map((row) => `<Row>${row.map((cell) => buildCell(cell)).join("")}</Row>`)
    .join("");

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
 <Worksheet ss:Name="${escapeXml(sheetName)}">
  <Table>
   ${headerRow}
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

export async function GET(request: Request) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const vehicleId = searchParams.get("vehicleId");
  const startDate = parseDateOnly(searchParams.get("startDate"));
  const endDate = parseDateOnly(searchParams.get("endDate"));
  const locale = parseLocale(searchParams.get("locale"));

  if (!vehicleId || !startDate || !endDate || endDate < startDate) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
  });

  if (!vehicle) {
    return NextResponse.json({ error: "VEHICLE_NOT_FOUND" }, { status: 404 });
  }

  const endExclusive = addDays(endDate, 1);

  const orders = await prisma.order.findMany({
    where: {
      vehicleId,
      status: {
        not: OrderStatus.cancelled,
      },
      pickupDatetime: {
        lt: endExclusive,
      },
      returnDatetime: {
        gt: startDate,
      },
    },
    orderBy: {
      pickupDatetime: "asc",
    },
    include: {
      vehicle: true,
    },
  });

  const calendarMessages = getMessages(locale).calendar;
  const headers = [
    calendarMessages.plateNumberField,
    calendarMessages.vehicleModelField,
    calendarMessages.renterNameField,
    calendarMessages.renterPhoneField,
    calendarMessages.pickup,
    calendarMessages.return,
    calendarMessages.revenue,
  ];

  const rows = orders.map((order) => [
    order.vehicle.plateNumber,
    `${order.vehicle.brand} ${order.vehicle.model} ${order.vehicle.year}`,
    order.renterName,
    order.renterPhone || "—",
    formatDateTime(order.pickupDatetime, locale),
    formatDateTime(order.returnDatetime, locale),
    formatCurrency(getOrderNetEarning(order.sourceMetadata, order.totalPrice), locale),
  ]);

  const workbook = buildWorkbookXml(
    sanitizeWorksheetName(`${vehicle.plateNumber} ${calendarMessages.exportSheetName}`),
    headers,
    rows,
  );

  const filename = `${vehicle.plateNumber}-orders-${searchParams.get("startDate")}-${searchParams.get("endDate")}.xls`;

  return new NextResponse(workbook, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
