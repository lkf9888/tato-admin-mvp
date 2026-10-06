"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { computeInvoice } from "@/lib/invoice-math";
import type { SerializedInvoice } from "@/lib/invoices";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";

type InvoiceType = SerializedInvoice["type"];
type InvoiceStatus = SerializedInvoice["status"];

type Draft = {
  type: InvoiceType;
  status: InvoiceStatus;
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string;
  billToAddress: string;
  issueDate: string;
  dueDate: string;
  paidAt: string;
  discountTotal: string;
  amountPaid: string;
  notes: string;
  terms: string;
  items: Array<{ description: string; quantity: string; unitPrice: string; taxRate: string }>;
};

const fieldClass = "min-h-9 w-full rounded-md border border-[var(--line)] bg-white px-2.5 py-1.5 text-sm";
const blankLine = { description: "", quantity: "1", unitPrice: "", taxRate: "" };

function toDraft(invoice: SerializedInvoice | null, type: InvoiceType, today: string): Draft {
  if (!invoice) {
    return {
      type,
      status: type === "RECEIPT" ? "PAID" : "DRAFT",
      recipientName: "",
      recipientEmail: "",
      recipientPhone: "",
      billToAddress: "",
      issueDate: today,
      dueDate: "",
      paidAt: type === "RECEIPT" ? today : "",
      discountTotal: "",
      amountPaid: "",
      notes: "",
      terms: "",
      items: [{ ...blankLine }],
    };
  }
  return {
    type: invoice.type,
    status: invoice.status,
    recipientName: invoice.recipientName ?? "",
    recipientEmail: invoice.recipientEmail ?? "",
    recipientPhone: invoice.recipientPhone ?? "",
    billToAddress: invoice.billToAddress ?? "",
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate ?? "",
    paidAt: invoice.paidAt ?? "",
    discountTotal: invoice.discountTotal ? String(invoice.discountTotal) : "",
    amountPaid: invoice.amountPaid ? String(invoice.amountPaid) : "",
    notes: invoice.notes ?? "",
    terms: invoice.terms ?? "",
    items: invoice.items.length
      ? invoice.items.map((item) => ({
          description: item.description,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
          taxRate: item.taxRate ? String(item.taxRate) : "",
        }))
      : [{ ...blankLine }],
  };
}

const num = (value: string) => (value.trim() === "" ? 0 : Number(value));

function draftPayload(draft: Draft) {
  return {
    type: draft.type,
    status: draft.status,
    recipientName: draft.recipientName,
    recipientEmail: draft.recipientEmail,
    recipientPhone: draft.recipientPhone,
    billToAddress: draft.billToAddress,
    issueDate: draft.issueDate,
    dueDate: draft.dueDate || null,
    paidAt: draft.paidAt || null,
    discountTotal: num(draft.discountTotal),
    ...(draft.amountPaid.trim() !== "" ? { amountPaid: num(draft.amountPaid) } : {}),
    notes: draft.notes,
    terms: draft.terms,
    items: draft.items.map((item) => ({
      description: item.description,
      quantity: num(item.quantity),
      unitPrice: num(item.unitPrice),
      taxRate: num(item.taxRate),
    })),
  };
}

/** The saved invoice as the body a PATCH takes, with some fields changed. */
function invoicePayload(invoice: SerializedInvoice, change: Partial<Draft>) {
  return draftPayload({ ...toDraft(invoice, invoice.type, invoice.issueDate), ...change });
}

export function InvoicesClient({
  locale,
  today,
  invoices,
}: {
  locale: Locale;
  today: string;
  invoices: SerializedInvoice[];
}) {
  const t = getMessages(locale).invoices;
  const router = useRouter();
  const money = (value: number) => formatCurrency(value, locale);
  const [typeFilter, setTypeFilter] = useState<InvoiceType | "">("");
  const [editor, setEditor] = useState<{ invoice: SerializedInvoice | null; type: InvoiceType } | null>(null);
  const [sending, setSending] = useState<SerializedInvoice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(
    () => invoices.filter((invoice) => !typeFilter || invoice.type === typeFilter),
    [invoices, typeFilter],
  );
  const outstanding = invoices
    .filter((invoice) => invoice.type === "INVOICE" && invoice.status !== "VOID" && invoice.status !== "DRAFT")
    .reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.amountPaid), 0);

  async function patch(invoice: SerializedInvoice, change: Partial<Draft>) {
    const response = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invoicePayload(invoice, change)),
    }).catch(() => null);
    if (!response?.ok) setNotice(t.failed);
    router.refresh();
  }

  async function remove(invoice: SerializedInvoice) {
    if (!window.confirm(t.confirmDelete)) return;
    await fetch(`/api/invoices/${invoice.id}`, { method: "DELETE" }).catch(() => null);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-3 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl text-[var(--ink)]">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-[var(--ink-soft)]">{t.intro}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setEditor({ invoice: null, type: "INVOICE" })}>
            + {t.newInvoice}
          </button>
          <button className="btn-secondary" onClick={() => setEditor({ invoice: null, type: "RECEIPT" })}>
            + {t.newReceipt}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md border border-[var(--line)] bg-white p-0.5">
          {(["", "INVOICE", "RECEIPT"] as const).map((key) => (
            <button
              key={key || "all"}
              type="button"
              onClick={() => setTypeFilter(key)}
              className={cn(
                "rounded-[5px] px-3 py-1.5 text-sm font-semibold",
                typeFilter === key ? "bg-[var(--ink)] text-white" : "text-[var(--ink-soft)] hover:bg-[var(--surface-muted)]",
              )}
            >
              {key ? t.typeLabels[key] : t.filterAll}
            </button>
          ))}
        </div>
        {outstanding > 0 ? <p className="text-sm text-amber-700">{t.outstanding(money(outstanding))}</p> : null}
      </div>

      {notice ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{notice}</p> : null}

      <div className="card overflow-x-auto">
        {visible.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--ink-soft)]">{t.empty}</p>
        ) : (
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-[var(--ink-soft)]">
              <tr className="border-b border-[var(--line)]">
                <th className="px-3 py-2">{t.colNumber}</th>
                <th className="px-3 py-2">{t.colRecipient}</th>
                <th className="px-3 py-2">{t.colIssued}</th>
                <th className="px-3 py-2">{t.colDue}</th>
                <th className="px-3 py-2 text-right">{t.colTotal}</th>
                <th className="px-3 py-2">{t.colStatus}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((invoice) => {
                const overdue =
                  invoice.type === "INVOICE" &&
                  invoice.status === "SENT" &&
                  invoice.dueDate !== null &&
                  invoice.dueDate < today &&
                  invoice.amountPaid < invoice.total;
                return (
                  <tr key={invoice.id} className={cn("border-b border-[var(--line)] last:border-0", invoice.status === "VOID" ? "opacity-50" : "")}>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="font-semibold text-[var(--ink)]">{invoice.number}</span>
                      <span className="ml-1.5 text-[11px] text-[var(--ink-soft)]">{t.typeLabels[invoice.type]}</span>
                    </td>
                    <td className="px-3 py-2 text-[var(--ink-mid)]">{invoice.recipientName || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--ink-mid)]">{invoice.issueDate}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--ink-mid)]">{invoice.dueDate ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{money(invoice.total)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                          invoice.status === "PAID"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : overdue
                              ? "border-red-300 bg-red-50 text-red-700"
                              : "border-[var(--line)] text-[var(--ink-mid)]",
                        )}
                      >
                        {overdue ? t.overdue : t.statusLabels[invoice.status]}
                      </span>
                      {invoice.lastSentAt ? (
                        <span className="ml-1.5 text-[10px] text-[var(--ink-soft)]">{t.lastSent(formatDateTime(invoice.lastSentAt, locale))}</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                      <div className="flex justify-end gap-2">
                        <button className="underline" onClick={() => setEditor({ invoice, type: invoice.type })}>{t.edit}</button>
                        <a className="underline" href={`/invoice-print/${invoice.id}?locale=${locale}`} target="_blank" rel="noreferrer">{t.print}</a>
                        <button className="underline" onClick={() => setSending(invoice)}>{t.send}</button>
                        {invoice.type === "INVOICE" && invoice.status !== "PAID" && invoice.status !== "VOID" ? (
                          <button className="underline" onClick={() => void patch(invoice, { status: "PAID", paidAt: today, amountPaid: "" })}>
                            {t.markPaid}
                          </button>
                        ) : null}
                        {invoice.status !== "VOID" ? (
                          <button
                            className="underline"
                            onClick={() => {
                              if (window.confirm(t.confirmVoid)) void patch(invoice, { status: "VOID" });
                            }}
                          >
                            {t.void}
                          </button>
                        ) : null}
                        <button className="text-rose-600 underline" onClick={() => void remove(invoice)}>{t.delete}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editor ? (
        <InvoiceEditor
          t={t}
          locale={locale}
          today={today}
          invoice={editor.invoice}
          type={editor.type}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            router.refresh();
          }}
        />
      ) : null}

      {sending ? (
        <SendDialog
          t={t}
          locale={locale}
          invoice={sending}
          onClose={() => {
            setSending(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

type Copy = ReturnType<typeof getMessages>["invoices"];

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-[var(--ink)]/40" onClick={onClose} aria-label="Close" />
      <div
        className={cn(
          "relative max-h-[92vh] overflow-y-auto rounded-lg border border-[var(--line)] bg-white p-4 shadow-2xl",
          wide ? "w-[min(52rem,calc(100vw-2rem))]" : "w-[min(30rem,calc(100vw-2rem))]",
        )}
      >
        <h2 className="mb-3 text-base font-semibold text-[var(--ink)]">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function InvoiceEditor({
  t,
  locale,
  today,
  invoice,
  type,
  onClose,
  onSaved,
}: {
  t: Copy;
  locale: Locale;
  today: string;
  invoice: SerializedInvoice | null;
  type: InvoiceType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(invoice, type, today));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (value: number) => formatCurrency(value, locale);
  const totals = computeInvoice({
    items: draft.items.map((item) => ({
      description: item.description,
      quantity: num(item.quantity),
      unitPrice: num(item.unitPrice),
      taxRate: num(item.taxRate),
    })),
    discountTotal: num(draft.discountTotal),
  });
  const set = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const setItem = (index: number, change: Partial<Draft["items"][number]>) =>
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...change } : item)),
    }));

  async function save() {
    setSaving(true);
    setError(null);
    const response = await fetch(invoice ? `/api/invoices/${invoice.id}` : "/api/invoices", {
      method: invoice ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftPayload(draft)),
    }).catch(() => null);
    setSaving(false);
    if (!response?.ok) {
      setError(t.failed);
      return;
    }
    onSaved();
  }

  const label = "grid gap-1 text-xs text-[var(--ink-mid)]";
  return (
    <Modal wide title={invoice ? t.editorEdit(invoice.number) : t.editorNew(t.typeLabels[type])} onClose={onClose}>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className={label}>
            {t.type}
            <select value={draft.type} onChange={(event) => set({ type: event.target.value as InvoiceType })} className={fieldClass} disabled={Boolean(invoice)}>
              <option value="INVOICE">{t.typeLabels.INVOICE}</option>
              <option value="RECEIPT">{t.typeLabels.RECEIPT}</option>
            </select>
          </label>
          <label className={label}>
            {t.status}
            <select value={draft.status} onChange={(event) => set({ status: event.target.value as InvoiceStatus })} className={fieldClass}>
              {(["DRAFT", "SENT", "PAID", "VOID"] as const).map((status) => (
                <option key={status} value={status}>{t.statusLabels[status]}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            {t.issueDate}
            <input type="date" value={draft.issueDate} onChange={(event) => set({ issueDate: event.target.value })} className={fieldClass} />
          </label>
          {draft.type === "INVOICE" ? (
            <label className={label}>
              {t.dueDate}
              <input type="date" value={draft.dueDate} onChange={(event) => set({ dueDate: event.target.value })} className={fieldClass} />
            </label>
          ) : (
            <label className={label}>
              {t.paidAt}
              <input type="date" value={draft.paidAt} onChange={(event) => set({ paidAt: event.target.value })} className={fieldClass} />
            </label>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>
            {t.recipientName}
            <input value={draft.recipientName} onChange={(event) => set({ recipientName: event.target.value })} className={fieldClass} />
          </label>
          <label className={label}>
            {t.recipientEmail}
            <input type="email" value={draft.recipientEmail} onChange={(event) => set({ recipientEmail: event.target.value })} className={fieldClass} />
          </label>
          <label className={label}>
            {t.recipientPhone}
            <input value={draft.recipientPhone} onChange={(event) => set({ recipientPhone: event.target.value })} className={fieldClass} />
          </label>
        </div>
        <label className={label}>
          {t.billToAddress}
          <textarea rows={2} value={draft.billToAddress} onChange={(event) => set({ billToAddress: event.target.value })} className={fieldClass} />
        </label>

        <div>
          <p className="mb-1 text-xs font-semibold text-[var(--ink-mid)]">{t.items}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-left text-[11px] text-[var(--ink-soft)]">
                <tr>
                  <th className="pb-1 pr-2 font-normal">{t.itemDescription}</th>
                  <th className="w-20 pb-1 pr-2 font-normal">{t.itemQuantity}</th>
                  <th className="w-28 pb-1 pr-2 font-normal">{t.itemUnitPrice}</th>
                  <th className="w-20 pb-1 pr-2 font-normal">{t.itemTaxRate}</th>
                  <th className="w-24 pb-1 text-right font-normal">{t.total}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {draft.items.map((item, index) => (
                  <tr key={index}>
                    <td className="py-1 pr-2">
                      <input value={item.description} onChange={(event) => setItem(index, { description: event.target.value })} className={fieldClass} />
                    </td>
                    <td className="py-1 pr-2">
                      <input type="number" step="any" min="0" value={item.quantity} onChange={(event) => setItem(index, { quantity: event.target.value })} className={`${fieldClass} tabular-nums`} />
                    </td>
                    <td className="py-1 pr-2">
                      <input type="number" step="0.01" value={item.unitPrice} onChange={(event) => setItem(index, { unitPrice: event.target.value })} className={`${fieldClass} tabular-nums`} />
                    </td>
                    <td className="py-1 pr-2">
                      <input type="number" step="any" min="0" max="100" value={item.taxRate} onChange={(event) => setItem(index, { taxRate: event.target.value })} className={`${fieldClass} tabular-nums`} />
                    </td>
                    <td className="py-1 text-right tabular-nums text-[var(--ink-mid)]">{money(num(item.quantity) * num(item.unitPrice))}</td>
                    <td className="py-1 pl-1 text-right">
                      {draft.items.length > 1 ? (
                        <button
                          type="button"
                          className="text-xs text-rose-600"
                          onClick={() => set({ items: draft.items.filter((_, itemIndex) => itemIndex !== index) })}
                          aria-label={t.removeItem}
                        >
                          ×
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="mt-1 text-xs underline" onClick={() => set({ items: [...draft.items, { ...blankLine }] })}>
            + {t.addItem}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_16rem]">
          <div className="grid gap-3">
            <label className={label}>
              {t.notes}
              <textarea rows={2} value={draft.notes} onChange={(event) => set({ notes: event.target.value })} className={fieldClass} />
            </label>
            <label className={label}>
              {t.terms}
              <textarea rows={2} value={draft.terms} onChange={(event) => set({ terms: event.target.value })} className={fieldClass} />
            </label>
          </div>
          <div className="grid content-start gap-2 text-sm">
            <label className={label}>
              {t.discount}
              <input type="number" step="0.01" min="0" value={draft.discountTotal} onChange={(event) => set({ discountTotal: event.target.value })} className={`${fieldClass} tabular-nums`} />
            </label>
            <label className={label}>
              {t.amountPaid}
              <input type="number" step="0.01" min="0" value={draft.amountPaid} onChange={(event) => set({ amountPaid: event.target.value })} className={`${fieldClass} tabular-nums`} />
              <span className="text-[10px] text-[var(--ink-soft)]">{t.amountPaidHint}</span>
            </label>
            <dl className="mt-1 space-y-0.5 border-t border-[var(--line)] pt-2 tabular-nums">
              <div className="flex justify-between"><dt className="text-[var(--ink-mid)]">{t.subtotal}</dt><dd>{money(totals.subtotal)}</dd></div>
              {totals.taxTotal ? <div className="flex justify-between"><dt className="text-[var(--ink-mid)]">{t.tax}</dt><dd>{money(totals.taxTotal)}</dd></div> : null}
              {totals.discountTotal ? <div className="flex justify-between"><dt className="text-[var(--ink-mid)]">{t.discount}</dt><dd>−{money(totals.discountTotal)}</dd></div> : null}
              <div className="flex justify-between font-semibold"><dt>{t.total}</dt><dd>{money(totals.total)}</dd></div>
            </dl>
          </div>
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>{t.cancel}</button>
          <button className="btn-primary" onClick={() => void save()} disabled={saving}>{saving ? t.saving : t.save}</button>
        </div>
      </div>
    </Modal>
  );
}

function SendDialog({ t, locale, invoice, onClose }: { t: Copy; locale: Locale; invoice: SerializedInvoice; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [emailLocale, setEmailLocale] = useState<"zh" | "en">(locale === "en" ? "en" : "zh");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "sent" | "error"; text?: string }>({ kind: "idle" });

  async function send() {
    setState({ kind: "sending" });
    const response = await fetch(`/api/invoices/${invoice.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, locale: emailLocale }),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => ({})) : {};
    if (response?.ok) {
      setState({ kind: "sent", text: t.sent(payload.sentTo ?? invoice.recipientEmail ?? "") });
      return;
    }
    setState({
      kind: "error",
      text: payload.error === "NO_RECIPIENT" ? t.noRecipientEmail : payload.error === "EMAIL_NOT_CONFIGURED" ? t.emailNotConfigured : t.sendFailed,
    });
  }

  return (
    <Modal title={t.sendTitle(invoice.number)} onClose={onClose}>
      {invoice.recipientEmail ? (
        <div className="grid gap-3 text-xs text-[var(--ink-mid)]">
          <p className="text-sm">{t.sendTo(invoice.recipientEmail)}</p>
          <label className="grid gap-1">
            {t.sendMessage}
            <textarea rows={3} value={message} onChange={(event) => setMessage(event.target.value)} className={fieldClass} />
          </label>
          <label className="grid gap-1">
            {t.emailLanguage}
            <select value={emailLocale} onChange={(event) => setEmailLocale(event.target.value === "en" ? "en" : "zh")} className={fieldClass}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
      ) : (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{t.noRecipientEmail}</p>
      )}
      {state.text ? <p className={cn("mt-3 text-sm", state.kind === "sent" ? "text-emerald-700" : "text-rose-600")}>{state.text}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>{t.cancel}</button>
        {invoice.recipientEmail && state.kind !== "sent" ? (
          <button className="btn-primary" onClick={() => void send()} disabled={state.kind === "sending"}>
            {state.kind === "sending" ? t.sending : t.send}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
