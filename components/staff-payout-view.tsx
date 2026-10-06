"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { SearchableSelect } from "@/components/searchable-select";
import { getMessages, type Locale } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";

type Summary = {
  staffId: string;
  name: string;
  color: string;
  defaultTaskRate: number | null;
  countDue: number;
  earnedDue: number;
  countUpcoming: number;
  earnedUpcoming: number;
  taskPaid: number;
  taskOwed: number;
  reimbursed: number;
  reimbursementPaid: number;
  reimbursementOwed: number;
  owed: number;
};

type PayoutTask = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done" | "cancelled";
  category: string | null;
  workDate: string | null;
  timeWindow: string | null;
  payRate: number | null;
  pay: number;
  due: boolean;
  vehicleLabel: string | null;
};

type Payment = {
  id: string;
  amount: number;
  paidAt: string;
  purpose: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
};

type Reimbursement = {
  id: string;
  amount: number;
  occurredAt: string;
  note: string;
  vehicleId: string | null;
  vehicleLabel: string | null;
  ownerName: string | null;
  onOwnerLedger: boolean;
  receipts: Array<{ id: string; filename: string | null; url: string }>;
};

type VehicleOption = { value: string; label: string; searchText: string };

type Tab = "tasks" | "payments" | "reimbursements";

const fieldClass =
  "min-h-9 w-full rounded-md border border-[var(--line)] bg-white px-2.5 py-1.5 text-sm text-[var(--ink)]";

function todayInput() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function inRange(day: string | null, from: string, to: string) {
  if (!from && !to) return true;
  if (!day) return false;
  return (!from || day >= from) && (!to || day <= to);
}

export function StaffPayoutView({
  locale,
  summary,
  tasks,
  payments,
  reimbursements,
  vehicles,
}: {
  locale: Locale;
  summary: Summary;
  todayKey: string;
  tasks: PayoutTask[];
  payments: Payment[];
  reimbursements: Reimbursement[];
  vehicles: VehicleOption[];
}) {
  const t = getMessages(locale).staffPayouts;
  const router = useRouter();
  const money = (value: number) => formatCurrency(value, locale);
  const [tab, setTab] = useState<Tab>("tasks");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState(summary.defaultTaskRate?.toString() ?? "");
  const [savingRate, setSavingRate] = useState(false);
  const [paymentModal, setPaymentModal] = useState<Payment | "new" | null>(null);
  const [reimbursementModal, setReimbursementModal] = useState<Reimbursement | "new" | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const visibleTasks = useMemo(() => tasks.filter((task) => inRange(task.workDate, from, to)), [tasks, from, to]);
  const visiblePayments = useMemo(
    () => payments.filter((payment) => inRange(payment.paidAt, from, to)),
    [payments, from, to],
  );
  const visibleReimbursements = useMemo(
    () => reimbursements.filter((row) => inRange(row.occurredAt, from, to)),
    [reimbursements, from, to],
  );

  async function send(url: string, init: RequestInit) {
    setError(null);
    const response = await fetch(url, init).catch(() => null);
    if (!response?.ok) {
      setError(t.failed);
      return false;
    }
    router.refresh();
    return true;
  }

  async function saveDefaultRate() {
    const trimmed = rateDraft.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setError(t.invalidAmount);
      return;
    }
    setSavingRate(true);
    await send(`/api/staff-schedule/staff/${summary.staffId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultTaskRate: value }),
    });
    setSavingRate(false);
  }

  async function saveTaskPay(task: PayoutTask, raw: string) {
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value === task.payRate) return;
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setError(t.invalidAmount);
      return;
    }
    await send(`/api/staff-schedule/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payRate: value }),
    });
  }

  async function deletePayment(payment: Payment) {
    if (!window.confirm(t.payment.confirmDelete)) return;
    await send(`/api/staff-schedule/payouts/${summary.staffId}/payments/${payment.id}`, { method: "DELETE" });
  }

  async function deleteReimbursement(row: Reimbursement) {
    if (!window.confirm(t.reimbursement.confirmDelete)) return;
    await send(`/api/staff-schedule/payouts/${summary.staffId}/reimbursements/${row.id}`, { method: "DELETE" });
  }

  async function addReceipts(row: Reimbursement, files: FileList | null) {
    if (!files?.length) return;
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("files", file));
    setUploadingId(row.id);
    await send(`/api/staff-schedule/payouts/${summary.staffId}/reimbursements/${row.id}/receipts`, {
      method: "POST",
      body: formData,
    });
    setUploadingId(null);
  }

  const taskStatusLabel = (status: PayoutTask["status"]) => t.taskStatus[status];

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-6">
      <div>
        <Link href="/staff-schedule/payouts" className="text-sm text-[var(--ink-soft)] hover:text-[var(--ink)]">
          ← {t.backToList}
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: summary.color }} aria-hidden />
          <h1 className="font-serif text-2xl text-[var(--ink)]">{summary.name}</h1>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <section className="card grid gap-4 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
        <SummaryBlock
          rows={[
            [`${t.taskEarned} · ${t.tasksDue(summary.countDue)}`, money(summary.earnedDue)],
            [t.taskPaid, money(summary.taskPaid)],
            [summary.taskOwed < 0 ? t.taskOverpaid : t.taskOwed, money(Math.abs(summary.taskOwed))],
          ]}
        />
        <SummaryBlock
          rows={[
            [t.reimbursed, money(summary.reimbursed)],
            [t.reimbursementPaid, money(summary.reimbursementPaid)],
            [
              summary.reimbursementOwed < 0 ? t.reimbursementOverpaid : t.reimbursementOwed,
              money(Math.abs(summary.reimbursementOwed)),
            ],
          ]}
        />
        <div className="sm:text-right">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
            {summary.owed < 0 ? t.totalOverpaid : t.totalOwed}
          </p>
          <p className="text-2xl font-semibold tabular-nums text-[var(--ink)]">{money(Math.abs(summary.owed))}</p>
          {summary.countUpcoming > 0 ? (
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              {t.upcomingNote(money(summary.earnedUpcoming), summary.countUpcoming)}
            </p>
          ) : null}
        </div>
      </section>

      <section className="card flex flex-wrap items-end gap-3 p-4">
        <label className="grid gap-1 text-xs text-[var(--ink-mid)]">
          {t.defaultRate}
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={rateDraft}
              onChange={(event) => setRateDraft(event.target.value)}
              placeholder={t.notSet}
              className={`${fieldClass} w-32 tabular-nums`}
            />
            <button className="btn-secondary min-h-9 px-3 text-sm" onClick={saveDefaultRate} disabled={savingRate}>
              {savingRate ? t.saving : t.save}
            </button>
          </div>
        </label>
        <p className="pb-2 text-xs text-[var(--ink-soft)]">{t.defaultRateHint}</p>
      </section>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-1 rounded-md border border-[var(--line)] bg-white p-0.5" role="tablist">
          {(["tasks", "payments", "reimbursements"] as const).map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`rounded-[5px] px-3 py-1.5 text-sm font-semibold transition ${
                tab === key ? "bg-[var(--ink)] text-white" : "text-[var(--ink-soft)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              {t.tabs[key]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2 text-xs text-[var(--ink-mid)]">
          <label className="grid gap-1">
            {t.dateFrom}
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={fieldClass} />
          </label>
          <label className="grid gap-1">
            {t.dateTo}
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={fieldClass} />
          </label>
          {from || to ? (
            <button className="btn-secondary min-h-9 px-3 text-sm" onClick={() => { setFrom(""); setTo(""); }}>
              {t.clearDates}
            </button>
          ) : null}
        </div>
      </div>

      {tab === "tasks" ? (
        <div className="card overflow-x-auto">
          {visibleTasks.length === 0 ? (
            <p className="p-6 text-center text-sm text-[var(--ink-soft)]">{t.noTasks}</p>
          ) : (
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-[var(--ink-soft)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="px-3 py-2 font-semibold">{t.colDate}</th>
                  <th className="px-3 py-2 font-semibold">{t.colTask}</th>
                  <th className="px-3 py-2 font-semibold">{t.colVehicle}</th>
                  <th className="px-3 py-2 font-semibold">{t.colStatus}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t.colPay}</th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.map((task) => (
                  <tr key={task.id} className="border-b border-[var(--line)] last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--ink-mid)]">
                      {task.workDate ?? "—"}
                      {task.timeWindow ? <span className="ml-1 text-[var(--ink-soft)]">{task.timeWindow}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-[var(--ink)]">{task.title}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--ink-mid)]">{task.vehicleLabel ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--ink-mid)]">
                      {taskStatusLabel(task.status)}
                      {!task.due ? (
                        <span className="ml-1.5 rounded-full border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--ink-soft)]">
                          {t.notDue}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        key={`${task.id}:${task.payRate ?? ""}`}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        defaultValue={task.payRate ?? ""}
                        placeholder={t.payPlaceholder(money(summary.defaultTaskRate ?? 0))}
                        onBlur={(event) => void saveTaskPay(task, event.target.value)}
                        className={`${fieldClass} w-32 text-right tabular-nums`}
                        aria-label={`${t.colPay} · ${task.title}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {tab === "payments" ? (
        <div className="space-y-2">
          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => setPaymentModal("new")}>
              {t.payment.add}
            </button>
          </div>
          <div className="card overflow-x-auto">
            {visiblePayments.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--ink-soft)]">{t.payment.empty}</p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {visiblePayments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <span className="w-24 tabular-nums text-[var(--ink-mid)]">{payment.paidAt}</span>
                    <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--ink-mid)]">
                      {payment.purpose === "REIMBURSEMENT" ? t.payment.purposeReimbursement : t.payment.purposeTask}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--ink-soft)]">
                      {[payment.method, payment.reference, payment.notes].filter(Boolean).join(" · ")}
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--ink)]">{money(payment.amount)}</span>
                    <span className="flex gap-1">
                      <button className="btn-secondary min-h-8 px-2 text-xs" onClick={() => setPaymentModal(payment)}>
                        {t.edit}
                      </button>
                      <button className="btn-secondary min-h-8 px-2 text-xs" onClick={() => void deletePayment(payment)}>
                        {t.delete}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {tab === "reimbursements" ? (
        <div className="space-y-2">
          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => setReimbursementModal("new")}>
              {t.reimbursement.add}
            </button>
          </div>
          <div className="card overflow-x-auto">
            {visibleReimbursements.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--ink-soft)]">{t.reimbursement.empty}</p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {visibleReimbursements.map((row) => (
                  <li key={row.id} className="space-y-1.5 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="w-24 tabular-nums text-[var(--ink-mid)]">{row.occurredAt}</span>
                      <span className="min-w-0 flex-1 text-[var(--ink)]">{row.note}</span>
                      <span className="font-semibold tabular-nums text-[var(--ink)]">{money(row.amount)}</span>
                      <span className="flex gap-1">
                        <button className="btn-secondary min-h-8 px-2 text-xs" onClick={() => setReimbursementModal(row)}>
                          {t.edit}
                        </button>
                        <button
                          className="btn-secondary min-h-8 px-2 text-xs"
                          onClick={() => void deleteReimbursement(row)}
                        >
                          {t.delete}
                        </button>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pl-0 text-xs text-[var(--ink-soft)] sm:pl-[6.75rem]">
                      {row.vehicleLabel ? <span>{row.vehicleLabel}</span> : null}
                      {row.vehicleLabel ? (
                        <span className="rounded-full border border-[var(--line)] px-1.5 py-0.5 text-[10px]">
                          {row.onOwnerLedger && row.ownerName
                            ? t.reimbursement.onOwnerLedger(row.ownerName)
                            : t.reimbursement.noOwner}
                        </span>
                      ) : null}
                      {row.receipts.map((receipt, index) => (
                        <a
                          key={receipt.id}
                          href={receipt.url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline decoration-dotted hover:text-[var(--ink)]"
                        >
                          {receipt.filename || `${t.reimbursement.receipts} ${index + 1}`}
                        </a>
                      ))}
                      <ReceiptPicker
                        label={uploadingId === row.id ? t.reimbursement.uploading : t.reimbursement.addReceipts}
                        disabled={uploadingId === row.id}
                        onFiles={(files) => void addReceipts(row, files)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {paymentModal ? (
        <PaymentModal
          t={t}
          initial={paymentModal === "new" ? null : paymentModal}
          onClose={() => setPaymentModal(null)}
          onSubmit={async (body) => {
            const isNew = paymentModal === "new";
            const ok = await send(
              isNew
                ? `/api/staff-schedule/payouts/${summary.staffId}/payments`
                : `/api/staff-schedule/payouts/${summary.staffId}/payments/${(paymentModal as Payment).id}`,
              {
                method: isNew ? "POST" : "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              },
            );
            if (ok) setPaymentModal(null);
          }}
        />
      ) : null}

      {reimbursementModal ? (
        <ReimbursementModal
          t={t}
          vehicles={vehicles}
          initial={reimbursementModal === "new" ? null : reimbursementModal}
          onClose={() => setReimbursementModal(null)}
          onSubmit={async (fields, files) => {
            const base = `/api/staff-schedule/payouts/${summary.staffId}/reimbursements`;
            let ok: boolean;
            if (reimbursementModal === "new") {
              const formData = new FormData();
              Object.entries(fields).forEach(([key, value]) => formData.append(key, value));
              files.forEach((file) => formData.append("files", file));
              ok = await send(base, { method: "POST", body: formData });
            } else {
              ok = await send(`${base}/${reimbursementModal.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...fields, vehicleId: fields.vehicleId || null }),
              });
            }
            if (ok) setReimbursementModal(null);
          }}
        />
      ) : null}
    </div>
  );
}

function SummaryBlock({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="space-y-1 text-sm">
      {rows.map(([label, value], index) => (
        <div key={label} className="flex items-baseline justify-between gap-3">
          <dt className="text-[var(--ink-mid)]">{label}</dt>
          <dd
            className={`tabular-nums ${
              index === rows.length - 1 ? "font-semibold text-[var(--ink)]" : "text-[var(--ink-mid)]"
            }`}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ReceiptPicker({
  label,
  disabled,
  onFiles,
}: {
  label: string;
  disabled?: boolean;
  onFiles: (files: FileList | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button
        type="button"
        className="rounded-full border border-dashed border-[var(--line)] px-2 py-0.5 text-[11px] hover:text-[var(--ink)]"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        + {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </>
  );
}

type Copy = ReturnType<typeof getMessages>["staffPayouts"];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-[var(--ink)]/40" onClick={onClose} aria-label="Close" />
      <div className="relative max-h-[90vh] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-[var(--line)] bg-white p-4 shadow-2xl">
        <h2 className="mb-3 text-base font-semibold text-[var(--ink)]">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function PaymentModal({
  t,
  initial,
  onClose,
  onSubmit,
}: {
  t: Copy;
  initial: Payment | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [amount, setAmount] = useState(initial?.amount.toString() ?? "");
  const [paidAt, setPaidAt] = useState(initial?.paidAt ?? todayInput());
  const [purpose, setPurpose] = useState(initial?.purpose ?? "TASK");
  const [method, setMethod] = useState(initial?.method ?? "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);

  return (
    <Modal title={initial ? t.payment.titleEdit : t.payment.titleNew} onClose={onClose}>
      <form
        className="grid gap-3 text-xs text-[var(--ink-mid)]"
        onSubmit={async (event) => {
          event.preventDefault();
          const value = Number(amount);
          if (!Number.isFinite(value) || value <= 0) {
            setInvalid(true);
            return;
          }
          setSaving(true);
          await onSubmit({ amount: value, paidAt, purpose, method, reference, notes });
          setSaving(false);
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            {t.payment.amount}
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={`${fieldClass} tabular-nums`}
            />
          </label>
          <label className="grid gap-1">
            {t.payment.paidAt}
            <input type="date" required value={paidAt} onChange={(event) => setPaidAt(event.target.value)} className={fieldClass} />
          </label>
        </div>
        <label className="grid gap-1">
          {t.payment.purpose}
          <select value={purpose} onChange={(event) => setPurpose(event.target.value)} className={fieldClass}>
            <option value="TASK">{t.payment.purposeTask}</option>
            <option value="REIMBURSEMENT">{t.payment.purposeReimbursement}</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            {t.payment.method}
            <input
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              placeholder={t.payment.methodPlaceholder}
              className={fieldClass}
            />
          </label>
          <label className="grid gap-1">
            {t.payment.reference}
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder={t.payment.referencePlaceholder}
              className={fieldClass}
            />
          </label>
        </div>
        <label className="grid gap-1">
          {t.payment.notes}
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className={fieldClass} />
        </label>
        {invalid ? <p className="text-red-700">{t.invalidAmount}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t.saving : t.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReimbursementModal({
  t,
  vehicles,
  initial,
  onClose,
  onSubmit,
}: {
  t: Copy;
  vehicles: VehicleOption[];
  initial: Reimbursement | null;
  onClose: () => void;
  onSubmit: (fields: Record<string, string>, files: File[]) => Promise<void>;
}) {
  const [amount, setAmount] = useState(initial?.amount.toString() ?? "");
  const [occurredAt, setOccurredAt] = useState(initial?.occurredAt ?? todayInput());
  const [note, setNote] = useState(initial?.note ?? "");
  const [vehicleId, setVehicleId] = useState(initial?.vehicleId ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <Modal title={initial ? t.reimbursement.titleEdit : t.reimbursement.titleNew} onClose={onClose}>
      <form
        className="grid gap-3 text-xs text-[var(--ink-mid)]"
        onSubmit={async (event) => {
          event.preventDefault();
          const value = Number(amount);
          if (!Number.isFinite(value) || value <= 0) {
            setProblem(t.invalidAmount);
            return;
          }
          if (!note.trim()) {
            setProblem(t.reimbursement.noteRequired);
            return;
          }
          setSaving(true);
          await onSubmit({ amount: String(value), occurredAt, note: note.trim(), vehicleId }, files);
          setSaving(false);
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            {t.reimbursement.amount}
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={`${fieldClass} tabular-nums`}
            />
          </label>
          <label className="grid gap-1">
            {t.reimbursement.date}
            <input
              type="date"
              required
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
              className={fieldClass}
            />
          </label>
        </div>
        <label className="grid gap-1">
          {t.reimbursement.note}
          <input
            required
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t.reimbursement.notePlaceholder}
            className={fieldClass}
          />
        </label>
        <div className="grid gap-1">
          {t.reimbursement.vehicle}
          <SearchableSelect
            value={vehicleId}
            onChange={setVehicleId}
            options={[{ value: "", label: t.reimbursement.noVehicle }, ...vehicles]}
            placeholder={t.reimbursement.noVehicle}
            searchPlaceholder={t.searchCar}
            emptyLabel={t.noResults}
          />
          <span className="text-[11px] text-[var(--ink-soft)]">{t.reimbursement.vehicleHint}</span>
        </div>
        {initial ? null : (
          <label className="grid gap-1">
            {t.reimbursement.receipts}
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              className="text-xs"
            />
          </label>
        )}
        {problem ? <p className="text-red-700">{problem}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t.saving : t.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
