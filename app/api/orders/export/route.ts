import { NextResponse } from "next/server";

import { requireCurrentWorkspace } from "@/lib/auth";
import { getStatusLabel, type Locale } from "@/lib/i18n";
import {
  isManualOfflineOrder,
  loadOrderList,
  orderReceipts,
  orderTaxes,
  type OrderListParams,
} from "@/lib/orders-list";
import { buildWorkbookXml, workbookResponseHeaders } from "@/lib/spreadsheet-xml";
import { formatDateTime, getOrderNetEarning } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * The orders list as it is filtered, every matching row -- not just the
 * page on screen -- as an Excel sheet. Same filters and search as the
 * page (lib/orders-list.ts), so the sheet and the screen cannot disagree.
 */
export async function GET(request: Request) {
  const workspace = await requireCurrentWorkspace();
  const url = new URL(request.url);
  const locale: Locale = url.searchParams.get("locale") === "en" ? "en" : "zh";
  const params: OrderListParams = {
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    vehicleId: url.searchParams.get("vehicleId") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  };

  const orders = await loadOrderList(workspace.id, params, locale);
  const zh = locale !== "en";
  const headers = zh
    ? ["取车", "还车", "车牌", "车辆", "车主", "客人", "电话", "来源", "状态", "收入", "税费", "已收", "待收", "付款方式", "合同号", "订单号"]
    : ["Pickup", "Return", "Plate", "Vehicle", "Owner", "Guest", "Phone", "Source", "Status", "Earnings", "Tax", "Received", "To collect", "Payment method", "Contract", "Reservation"];

  const rows = orders.map((order) => {
    const money = isManualOfflineOrder(order) ? orderReceipts(order) : null;
    const tax = orderTaxes(order).reduce((sum, line) => sum + line.amount, 0);
    return [
      formatDateTime(order.pickupDatetime, locale),
      formatDateTime(order.returnDatetime, locale),
      order.vehicle.plateNumber,
      `${order.vehicle.brand} ${order.vehicle.model} ${order.vehicle.year}`,
      order.vehicle.owner?.name ?? "",
      order.renterName,
      order.renterPhone ?? "",
      getStatusLabel(order.source, locale),
      getStatusLabel(order.status, locale),
      getOrderNetEarning(order.sourceMetadata, order.totalPrice) ?? null,
      tax > 0 ? Math.round(tax * 100) / 100 : null,
      money ? money.received : null,
      money ? money.outstanding : null,
      order.paymentMethod ?? "",
      order.contractNumber ?? "",
      order.externalOrderId ?? "",
    ];
  });

  const range = [params.from, params.to].filter(Boolean).join("_") || new Date().toISOString().slice(0, 10);
  const workbook = buildWorkbookXml(zh ? "订单" : "Orders", headers, rows);
  return new NextResponse(workbook, { status: 200, headers: workbookResponseHeaders(`orders-${range}.xls`) });
}
