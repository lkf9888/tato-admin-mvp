import "server-only";

import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { OwnerLedgerKind, Prisma, StaffTaskStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { utcToZonedDate } from "@/lib/booking-time";
import { prisma } from "@/lib/prisma";
import { makeStaffReimbursementReceiptPath, resolveUploadPath, sanitizeFilename } from "@/lib/uploads";

/**
 * What a staff member has earned, been paid, and is owed.
 *
 * The one rule, kept here so the payout list, a person's own ledger and
 * the staff link (#14) cannot drift apart -- HostHub learned that the
 * hard way, with a total that disagreed with the rows printed above it.
 *
 * Work is earned once its day has arrived, not when somebody ticks it
 * done: a box nobody reliably ticks is not a record of work. A task that
 * did not happen is cancelled, and that is the lever for a no-show. Only
 * tasks of the top level are paid -- subtasks are a checklist inside one.
 *
 * Two balances, kept apart because they settle differently: pay for
 * tasks, and reimbursements for things bought on the business's behalf.
 */

export const STAFF_PAYMENT_PURPOSE = {
  task: "TASK",
  reimbursement: "REIMBURSEMENT",
} as const;

export type StaffPaymentPurpose = (typeof STAFF_PAYMENT_PURPOSE)[keyof typeof STAFF_PAYMENT_PURPOSE];

export function isStaffPaymentPurpose(value: unknown): value is StaffPaymentPurpose {
  return value === STAFF_PAYMENT_PURPOSE.task || value === STAFF_PAYMENT_PURPOSE.reimbursement;
}

type PayableTask = {
  dueDatetime: Date | null;
  completedAt: Date | null;
  payRate: number | null;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

/**
 * The day a task's work falls on, on the fleet's clock: its due date, or
 * for a task never given one, the day it was done. Null for an undated
 * task still open -- not yet anything anyone is owed.
 */
export function staffTaskWorkDate(task: Pick<PayableTask, "dueDatetime" | "completedAt">) {
  if (task.dueDatetime) return utcToZonedDate(task.dueDatetime);
  if (task.completedAt) return utcToZonedDate(task.completedAt);
  return null;
}

export function staffTaskPay(task: Pick<PayableTask, "payRate">, defaultRate: number | null | undefined) {
  return task.payRate ?? defaultRate ?? 0;
}

export function isStaffTaskDue(task: Pick<PayableTask, "dueDatetime" | "completedAt">, todayKey: string) {
  const day = staffTaskWorkDate(task);
  return day !== null && day <= todayKey;
}

export function splitStaffTaskEarnings(
  tasks: PayableTask[],
  options: { defaultRate: number | null | undefined; todayKey: string },
) {
  let earnedDue = 0;
  let countDue = 0;
  let earnedUpcoming = 0;
  let countUpcoming = 0;
  for (const task of tasks) {
    const pay = staffTaskPay(task, options.defaultRate);
    if (isStaffTaskDue(task, options.todayKey)) {
      earnedDue += pay;
      countDue += 1;
    } else {
      earnedUpcoming += pay;
      countUpcoming += 1;
    }
  }
  return {
    earnedDue: roundMoney(earnedDue),
    countDue,
    earnedUpcoming: roundMoney(earnedUpcoming),
    countUpcoming,
  };
}

/** Tasks that count toward pay: assigned, top level, not cancelled. */
export const payableTaskWhere = {
  parentTaskId: null,
  status: { not: StaffTaskStatus.cancelled },
} satisfies Prisma.StaffTaskWhereInput;

export type StaffPayoutSummary = {
  staffId: string;
  name: string;
  color: string;
  isActive: boolean;
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

export async function getStaffPayoutSummaries(
  workspaceId: string,
  options: { staffIds?: string[]; now?: Date } = {},
): Promise<StaffPayoutSummary[]> {
  const todayKey = utcToZonedDate(options.now ?? new Date());
  const staff = await prisma.staffMember.findMany({
    where: { workspaceId, ...(options.staffIds ? { id: { in: options.staffIds } } : {}) },
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      color: true,
      isActive: true,
      defaultTaskRate: true,
      tasks: {
        where: payableTaskWhere,
        select: { dueDatetime: true, completedAt: true, payRate: true },
      },
      payments: { select: { amount: true, purpose: true } },
      reimbursements: { select: { amount: true } },
    },
  });

  return staff.map((member) => {
    const earnings = splitStaffTaskEarnings(member.tasks, {
      defaultRate: member.defaultTaskRate,
      todayKey,
    });
    const taskPaid = roundMoney(
      member.payments
        .filter((payment) => payment.purpose !== STAFF_PAYMENT_PURPOSE.reimbursement)
        .reduce((sum, payment) => sum + payment.amount, 0),
    );
    const reimbursementPaid = roundMoney(
      member.payments
        .filter((payment) => payment.purpose === STAFF_PAYMENT_PURPOSE.reimbursement)
        .reduce((sum, payment) => sum + payment.amount, 0),
    );
    const reimbursed = roundMoney(member.reimbursements.reduce((sum, row) => sum + row.amount, 0));
    const taskOwed = roundMoney(earnings.earnedDue - taskPaid);
    const reimbursementOwed = roundMoney(reimbursed - reimbursementPaid);
    return {
      staffId: member.id,
      name: member.name,
      color: member.color,
      isActive: member.isActive,
      defaultTaskRate: member.defaultTaskRate,
      ...earnings,
      taskPaid,
      taskOwed,
      reimbursed,
      reimbursementPaid,
      reimbursementOwed,
      owed: roundMoney(taskOwed + reimbursementOwed),
    };
  });
}

/**
 * Keep a reimbursement's line on the car owner's ledger in step with it.
 *
 * Tied to a car that has an owner, the expense is the owner's to carry:
 * it is written there as a reimbursement (a deduction), with the same
 * receipt files attached. Untied, or the car has no owner, there is no
 * line. Written as a manual row (`isAuto: false`) so the order-driven
 * ledger sync, which owns the automatic rows, never removes it.
 */
export async function syncStaffReimbursementLedger(reimbursementId: string) {
  const reimbursement = await prisma.staffReimbursement.findUnique({
    where: { id: reimbursementId },
    include: { staff: { select: { name: true } }, receipts: true },
  });
  if (!reimbursement) return;

  const vehicle = reimbursement.vehicleId
    ? await prisma.vehicle.findFirst({
        where: { id: reimbursement.vehicleId, workspaceId: reimbursement.workspaceId },
        select: { id: true, ownerId: true },
      })
    : null;
  const ownerId = vehicle?.ownerId ?? null;
  const existing = reimbursement.ownerLedgerItemId
    ? await prisma.ownerLedgerItem.findUnique({ where: { id: reimbursement.ownerLedgerItemId } })
    : null;

  if (!vehicle || !ownerId) {
    if (existing) await prisma.ownerLedgerItem.delete({ where: { id: existing.id } });
    if (reimbursement.ownerLedgerItemId) {
      await prisma.staffReimbursement.update({
        where: { id: reimbursement.id },
        data: { ownerLedgerItemId: null },
      });
    }
    return;
  }

  const data = {
    workspaceId: reimbursement.workspaceId,
    ownerId,
    vehicleId: vehicle.id,
    kind: OwnerLedgerKind.EXPENSE_REIMBURSEMENT,
    amount: -roundMoney(Math.abs(reimbursement.amount)),
    occurredAt: reimbursement.occurredAt,
    note: `员工报销 · ${reimbursement.staff.name} · ${reimbursement.note}`,
    isAuto: false,
  };

  const item =
    existing && existing.ownerId === ownerId
      ? await prisma.ownerLedgerItem.update({ where: { id: existing.id }, data })
      : await prisma.$transaction(async (tx) => {
          if (existing) await tx.ownerLedgerItem.delete({ where: { id: existing.id } });
          return tx.ownerLedgerItem.create({ data });
        });

  await prisma.$transaction([
    prisma.ownerLedgerReceipt.deleteMany({ where: { itemId: item.id } }),
    prisma.ownerLedgerReceipt.createMany({
      data: reimbursement.receipts.map((receipt) => ({
        workspaceId: reimbursement.workspaceId,
        itemId: item.id,
        pathname: receipt.pathname,
        filename: receipt.filename,
        contentType: receipt.contentType,
        size: receipt.size,
        uploadedAt: receipt.uploadedAt,
      })),
    }),
    prisma.staffReimbursement.update({
      where: { id: reimbursement.id },
      data: { ownerLedgerItemId: item.id },
    }),
  ]);
}

/** The owner-ledger line goes with the reimbursement. */
export async function removeStaffReimbursementLedger(ownerLedgerItemId: string | null) {
  if (!ownerLedgerItemId) return;
  await prisma.ownerLedgerItem.deleteMany({ where: { id: ownerLedgerItemId } });
}

/** A calendar day from a date input, stored at noon UTC like the rest. */
export function parseLedgerDay(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The staff member, if they belong to this workspace. */
export function findWorkspaceStaff(workspaceId: string, staffId: string) {
  return prisma.staffMember.findFirst({
    where: { id: staffId, workspaceId },
    select: { id: true, name: true, defaultTaskRate: true },
  });
}

export function staffReimbursementReceiptUrl(staffId: string, reimbursementId: string, receiptId: string) {
  return `/api/staff-schedule/payouts/${staffId}/reimbursements/${reimbursementId}/receipts/${receiptId}`;
}

export const staffPaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  paidAt: z.string(),
  purpose: z.string().optional(),
  method: z.string().trim().max(80).optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export function revalidatePayoutPages(staffId: string) {
  revalidatePath("/staff-schedule/payouts");
  revalidatePath(`/staff-schedule/payouts/${staffId}`);
}

/** After a reimbursement moved money onto or off an owner's ledger. */
export function revalidateOwnerLedgerPages() {
  revalidatePath("/owners");
  revalidatePath("/owners/[ownerId]", "page");
  revalidatePath("/owners/[ownerId]/ledger", "page");
}

export const staffReimbursementSchema = z.object({
  amount: z.coerce.number().positive(),
  occurredAt: z.string(),
  note: z.string().trim().min(1).max(500),
  vehicleId: z.string().trim().optional().nullable(),
});

/** Write uploaded receipt files to the volume and record them. */
export async function saveStaffReimbursementReceipts(
  workspaceId: string,
  reimbursementId: string,
  files: File[],
) {
  for (const file of files) {
    const safeName = sanitizeFilename(file.name);
    const pathname = makeStaffReimbursementReceiptPath(reimbursementId, safeName);
    const absolutePath = resolveUploadPath(pathname);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));
    await prisma.staffReimbursementReceipt.create({
      data: {
        workspaceId,
        reimbursementId,
        pathname,
        filename: safeName,
        contentType: file.type || null,
        size: file.size,
      },
    });
  }
}

/** The car, if it is this workspace's; anything else is no car. */
export async function resolveWorkspaceVehicleId(workspaceId: string, vehicleId: string | null | undefined) {
  if (!vehicleId) return null;
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, workspaceId },
    select: { id: true },
  });
  return vehicle?.id ?? null;
}

/**
 * Everything one person's pay page shows, for the admin ledger and for
 * the staff link's own "my income" tab. `forStaff` is the staff link:
 * payment notes are the operator's, and the owners behind the cars and
 * the receipt files (served to signed-in admins only) are not theirs to
 * see, so those are left out.
 */
export async function getStaffPayoutDetail(
  workspaceId: string,
  staffId: string,
  options: { forStaff?: boolean } = {},
) {
  const [summary] = await getStaffPayoutSummaries(workspaceId, { staffIds: [staffId] });
  if (!summary) return null;
  const forStaff = Boolean(options.forStaff);

  const [tasks, payments, reimbursements, vehicles] = await Promise.all([
    prisma.staffTask.findMany({
      where: { workspaceId, staffId, ...payableTaskWhere },
      orderBy: [{ dueDatetime: "desc" }, { completedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        status: true,
        category: true,
        dueDatetime: true,
        timeWindow: true,
        completedAt: true,
        payRate: true,
        vehicleLabel: true,
        vehicle: { select: { plateNumber: true, nickname: true } },
      },
    }),
    prisma.staffPayment.findMany({
      where: { workspaceId, staffId },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.staffReimbursement.findMany({
      where: { workspaceId, staffId },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      include: { receipts: { orderBy: { uploadedAt: "asc" } } },
    }),
    prisma.vehicle.findMany({
      where: { workspaceId },
      orderBy: [{ isArchived: "asc" }, { plateNumber: "asc" }],
      select: {
        id: true,
        plateNumber: true,
        nickname: true,
        brand: true,
        model: true,
        owner: { select: { name: true } },
      },
    }),
  ]);

  const todayKey = utcToZonedDate(new Date());
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

  return {
    summary,
    todayKey,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      category: task.category,
      workDate: staffTaskWorkDate(task),
      timeWindow: task.timeWindow,
      payRate: task.payRate,
      pay: staffTaskPay(task, summary.defaultTaskRate),
      due: isStaffTaskDue(task, todayKey),
      vehicleLabel: task.vehicle ? `${task.vehicle.plateNumber} · ${task.vehicle.nickname}` : task.vehicleLabel,
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      amount: payment.amount,
      paidAt: payment.paidAt.toISOString().slice(0, 10),
      purpose: payment.purpose,
      method: payment.method,
      reference: payment.reference,
      notes: forStaff ? null : payment.notes,
    })),
    reimbursements: reimbursements.map((row) => {
      const vehicle = row.vehicleId ? vehicleById.get(row.vehicleId) : undefined;
      return {
        id: row.id,
        amount: row.amount,
        occurredAt: row.occurredAt.toISOString().slice(0, 10),
        note: row.note,
        vehicleId: row.vehicleId,
        vehicleLabel: vehicle ? `${vehicle.plateNumber} · ${vehicle.nickname}` : null,
        ownerName: forStaff ? null : vehicle?.owner?.name ?? null,
        onOwnerLedger: forStaff ? false : Boolean(row.ownerLedgerItemId),
        receipts: row.receipts.map((receipt) => ({
          id: receipt.id,
          filename: receipt.filename,
          url: forStaff ? null : staffReimbursementReceiptUrl(staffId, row.id, receipt.id),
        })),
      };
    }),
    vehicles: forStaff
      ? []
      : vehicles.map((vehicle) => ({
          value: vehicle.id,
          label: `${vehicle.plateNumber} · ${vehicle.nickname}${vehicle.owner ? ` · ${vehicle.owner.name}` : ""}`,
          searchText: `${vehicle.brand} ${vehicle.model}`,
        })),
  };
}

export type StaffPayoutDetail = NonNullable<Awaited<ReturnType<typeof getStaffPayoutDetail>>>;
