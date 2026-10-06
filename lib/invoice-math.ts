/**
 * An invoice's lines and totals from what was typed. No `server-only`:
 * the editor shows these numbers as you type, and the server stores the
 * same computation on save, so the preview cannot disagree with the
 * saved invoice.
 *
 * A line's tax is its own rate on its own amount; the discount comes
 * off the whole, after tax, and never takes it below zero. Blank lines
 * are dropped.
 */

export type InvoiceLineInput = {
  description: string;
  quantity: number;
  unitPrice: number;
  /** Percent: 5 is 5%. */
  taxRate: number;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function computeInvoice(input: { items: InvoiceLineInput[]; discountTotal: number }) {
  const items = input.items
    .filter((item) => item.description.trim() || item.unitPrice !== 0)
    .map((item, index) => ({
      description: item.description.trim() || "—",
      quantity: item.quantity,
      unitPrice: roundMoney(item.unitPrice),
      taxRate: item.taxRate,
      lineTotal: roundMoney(item.quantity * item.unitPrice),
      sortOrder: index,
    }));
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const taxTotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal * (item.taxRate / 100), 0));
  const discountTotal = roundMoney(Math.max(0, input.discountTotal || 0));
  const total = roundMoney(Math.max(0, subtotal + taxTotal - discountTotal));
  return { items, subtotal, taxTotal, discountTotal, total };
}
