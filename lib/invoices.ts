import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { utcToZonedDate } from "@/lib/booking-time";
import { computeInvoice } from "@/lib/invoice-math";
import { prisma } from "@/lib/prisma";

/**
 * Invoices and receipts written by hand: for an offline rental, a damage
 * charge, a deposit kept -- anything the operator bills outside Turo and
 * the rental site.
 *
 * Totals are computed here, on save, from the lines -- never taken from
 * the browser -- and stored, so the list can show and sum them without
 * reading lines. A line's tax is its own rate on its own amount; the
 * discount comes off the whole, after tax, and never below zero.
 */

export const INVOICE_TYPES = ["INVOICE", "RECEIPT"] as const;
export const INVOICE_STATUSES = ["DRAFT", "SENT", "PAID", "VOID"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export { computeInvoice };

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((value) => (value ? value : null));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const invoiceInputSchema = z.object({
  type: z.enum(INVOICE_TYPES).default("INVOICE"),
  status: z.enum(INVOICE_STATUSES).optional(),
  recipientName: optionalText,
  recipientEmail: z
    .string()
    .trim()
    .email()
    .nullish()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  recipientPhone: optionalText,
  billToAddress: optionalText,
  issueDate: day,
  dueDate: day.nullish().or(z.literal("")),
  paidAt: day.nullish().or(z.literal("")),
  discountTotal: z.coerce.number().min(0).default(0),
  amountPaid: z.coerce.number().min(0).optional(),
  notes: optionalText,
  terms: optionalText,
  orderId: z.string().trim().nullish().or(z.literal("")),
  items: z
    .array(
      z.object({
        description: z.string().trim().max(500),
        quantity: z.coerce.number().min(0).default(1),
        unitPrice: z.coerce.number().default(0),
        taxRate: z.coerce.number().min(0).max(100).default(0),
      }),
    )
    .max(100),
});

export type InvoiceInput = z.infer<typeof invoiceInputSchema>;

const dayInstant = (value: string) => new Date(`${value}T12:00:00.000Z`);

/** The columns a save writes, totals included. */
export function invoiceData(input: InvoiceInput, existing?: { amountPaid: number; status: string }) {
  const computed = computeInvoice(input);
  const status = input.status ?? (existing?.status as InvoiceStatus | undefined) ?? "DRAFT";
  // A receipt records money already taken; a paid invoice is paid in full
  // unless an amount says otherwise.
  const amountPaid = roundMoney(
    input.amountPaid ??
      (input.type === "RECEIPT" || status === "PAID" ? computed.total : existing?.amountPaid ?? 0),
  );
  return {
    data: {
      type: input.type,
      status,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail,
      recipientPhone: input.recipientPhone,
      billToAddress: input.billToAddress,
      issueDate: dayInstant(input.issueDate),
      dueDate: input.dueDate ? dayInstant(input.dueDate) : null,
      paidAt: input.paidAt ? dayInstant(input.paidAt) : status === "PAID" ? dayInstant(utcToZonedDate(new Date())) : null,
      subtotal: computed.subtotal,
      taxTotal: computed.taxTotal,
      discountTotal: computed.discountTotal,
      total: computed.total,
      amountPaid,
      notes: input.notes,
      terms: input.terms,
      orderId: input.orderId || null,
    },
    items: computed.items,
  };
}

/**
 * The next number for this workspace, type and year: INV-2026-0001,
 * REC-2026-0001 -- one past the highest in use. Voiding, not deleting, is
 * how an issued number stays accounted for.
 */
export async function nextInvoiceNumber(workspaceId: string, type: InvoiceType, on = new Date()) {
  const prefix = `${type === "RECEIPT" ? "REC" : "INV"}-${utcToZonedDate(on).slice(0, 4)}-`;
  const rows = await prisma.invoice.findMany({
    where: { workspaceId, number: { startsWith: prefix } },
    select: { number: true },
  });
  const highest = rows.reduce((max, row) => Math.max(max, Number(row.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

/** Create, retrying the number if a simultaneous save took it. */
export async function createInvoice(workspaceId: string, input: InvoiceInput, createdBy: string) {
  const { data, items } = invoiceData(input);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const number = await nextInvoiceNumber(workspaceId, input.type);
    try {
      return await prisma.invoice.create({
        data: { ...data, workspaceId, number, createdBy, items: { create: items } },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }
  throw new Error("Could not allocate an invoice number");
}

export async function updateInvoice(workspaceId: string, id: string, input: InvoiceInput) {
  const existing = await prisma.invoice.findFirst({ where: { id, workspaceId } });
  if (!existing) return null;
  const { data, items } = invoiceData(input, existing);
  return prisma.$transaction(async (tx) => {
    await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
    return tx.invoice.update({
      where: { id },
      data: { ...data, items: { create: items } },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  });
}

export type InvoiceWithItems = Prisma.InvoiceGetPayload<{ include: { items: true } }>;

export function serializeInvoice(invoice: InvoiceWithItems) {
  const dayOf = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
  return {
    id: invoice.id,
    type: invoice.type as InvoiceType,
    number: invoice.number,
    status: invoice.status as InvoiceStatus,
    recipientName: invoice.recipientName,
    recipientEmail: invoice.recipientEmail,
    recipientPhone: invoice.recipientPhone,
    billToAddress: invoice.billToAddress,
    issueDate: dayOf(invoice.issueDate)!,
    dueDate: dayOf(invoice.dueDate),
    paidAt: dayOf(invoice.paidAt),
    currency: invoice.currency,
    subtotal: invoice.subtotal,
    taxTotal: invoice.taxTotal,
    discountTotal: invoice.discountTotal,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    notes: invoice.notes,
    terms: invoice.terms,
    orderId: invoice.orderId,
    lastSentAt: invoice.lastSentAt?.toISOString() ?? null,
    items: [...invoice.items]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((item) => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        lineTotal: item.lineTotal,
      })),
  };
}

export type SerializedInvoice = ReturnType<typeof serializeInvoice>;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(value);
}

/**
 * The invoice as a self-contained HTML document body: the email and the
 * print page show the same thing. Bilingual labels follow `locale`.
 */
export function renderInvoiceHtml(invoice: SerializedInvoice, issuer: string, locale: "zh" | "en") {
  const zh = locale !== "en";
  const L = zh
    ? {
        INVOICE: "发票", RECEIPT: "收据", number: "编号", issued: "开具日期", due: "到期日", paid: "付款日期",
        billTo: "开给", item: "项目", qty: "数量", price: "单价", tax: "税率", amount: "金额",
        subtotal: "小计", taxTotal: "税", discount: "折扣", total: "合计", amountPaid: "已付", balance: "应付余额",
        notes: "备注", terms: "条款", void: "已作废",
      }
    : {
        INVOICE: "Invoice", RECEIPT: "Receipt", number: "No.", issued: "Issued", due: "Due", paid: "Paid",
        billTo: "Bill to", item: "Item", qty: "Qty", price: "Unit price", tax: "Tax", amount: "Amount",
        subtotal: "Subtotal", taxTotal: "Tax", discount: "Discount", total: "Total", amountPaid: "Paid", balance: "Balance due",
        notes: "Notes", terms: "Terms", void: "VOID",
      };
  const m = (value: number) => money(value, invoice.currency);
  const balance = Math.max(0, Math.round((invoice.total - invoice.amountPaid) * 100) / 100);
  const recipient = [invoice.recipientName, invoice.billToAddress, invoice.recipientEmail, invoice.recipientPhone]
    .filter(Boolean)
    .map((line) => escapeHtml(line!).replace(/\n/g, "<br>"))
    .join("<br>");
  const rows = invoice.items
    .map(
      (item) => `<tr>
        <td style="padding:8px 6px;border-bottom:1px solid #eee">${escapeHtml(item.description)}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right">${item.quantity}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right">${m(item.unitPrice)}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right">${item.taxRate ? `${item.taxRate}%` : "—"}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right">${m(item.lineTotal)}</td>
      </tr>`,
    )
    .join("");
  const totalRow = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:4px 6px;color:#555">${label}</td><td style="padding:4px 6px;text-align:right;${strong ? "font-weight:700" : ""}">${value}</td></tr>`;

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:680px;color:#111;line-height:1.5">
    <table style="width:100%;border-collapse:collapse"><tr>
      <td style="vertical-align:top"><div style="font-size:20px;font-weight:700">${escapeHtml(issuer)}</div></td>
      <td style="vertical-align:top;text-align:right">
        <div style="font-size:22px;font-weight:700">${L[invoice.type]}${invoice.status === "VOID" ? ` · ${L.void}` : ""}</div>
        <div style="color:#555;font-size:13px">${L.number} ${escapeHtml(invoice.number)}</div>
        <div style="color:#555;font-size:13px">${L.issued} ${invoice.issueDate}</div>
        ${invoice.dueDate ? `<div style="color:#555;font-size:13px">${L.due} ${invoice.dueDate}</div>` : ""}
        ${invoice.paidAt ? `<div style="color:#555;font-size:13px">${L.paid} ${invoice.paidAt}</div>` : ""}
      </td>
    </tr></table>
    ${recipient ? `<div style="margin:20px 0 8px"><div style="color:#888;font-size:12px">${L.billTo}</div><div>${recipient}</div></div>` : ""}
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <thead><tr style="background:#f5f5f5">
        <th style="padding:8px 6px;text-align:left">${L.item}</th>
        <th style="padding:8px 6px;text-align:right">${L.qty}</th>
        <th style="padding:8px 6px;text-align:right">${L.price}</th>
        <th style="padding:8px 6px;text-align:right">${L.tax}</th>
        <th style="padding:8px 6px;text-align:right">${L.amount}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table style="margin:12px 0 0 auto;border-collapse:collapse;font-size:14px;min-width:260px">
      ${totalRow(L.subtotal, m(invoice.subtotal))}
      ${invoice.taxTotal ? totalRow(L.taxTotal, m(invoice.taxTotal)) : ""}
      ${invoice.discountTotal ? totalRow(L.discount, `−${m(invoice.discountTotal)}`) : ""}
      ${totalRow(L.total, m(invoice.total), true)}
      ${invoice.amountPaid ? totalRow(L.amountPaid, m(invoice.amountPaid)) : ""}
      ${invoice.type === "INVOICE" ? totalRow(L.balance, m(balance), true) : ""}
    </table>
    ${invoice.notes ? `<div style="margin-top:20px"><div style="color:#888;font-size:12px">${L.notes}</div><div style="white-space:pre-wrap">${escapeHtml(invoice.notes)}</div></div>` : ""}
    ${invoice.terms ? `<div style="margin-top:12px"><div style="color:#888;font-size:12px">${L.terms}</div><div style="white-space:pre-wrap;font-size:13px;color:#555">${escapeHtml(invoice.terms)}</div></div>` : ""}
  </div>`;
}
