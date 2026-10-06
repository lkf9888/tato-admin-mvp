import { NextResponse } from "next/server";
import { OrderStatus } from "@prisma/client";

import { requireCurrentWorkspace } from "@/lib/auth";
import { getMessages, type Locale } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import { buildWorkbookXml, workbookResponseHeaders } from "@/lib/spreadsheet-xml";
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

export async function GET(request: Request) {
  const workspace = await requireCurrentWorkspace();

  const { searchParams } = new URL(request.url);
  const vehicleId = searchParams.get("vehicleId");
  const startDate = parseDateOnly(searchParams.get("startDate"));
  const endDate = parseDateOnly(searchParams.get("endDate"));
  const locale = parseLocale(searchParams.get("locale"));

  if (!vehicleId || !startDate || !endDate || endDate < startDate) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, workspaceId: workspace.id },
  });

  if (!vehicle) {
    return NextResponse.json({ error: "VEHICLE_NOT_FOUND" }, { status: 404 });
  }

  const endExclusive = addDays(endDate, 1);

  const orders = await prisma.order.findMany({
    where: {
      vehicleId,
      workspaceId: workspace.id,
      isArchived: false,
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
    `${vehicle.plateNumber} ${calendarMessages.exportSheetName}`,
    headers,
    rows,
  );

  const filename = `${vehicle.plateNumber}-orders-${searchParams.get("startDate")}-${searchParams.get("endDate")}.xls`;

  return new NextResponse(workbook, {
    status: 200,
    headers: workbookResponseHeaders(filename),
  });
}
