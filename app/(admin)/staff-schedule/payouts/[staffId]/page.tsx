import { notFound } from "next/navigation";

import { StaffPayoutView } from "@/components/staff-payout-view";
import { requireCurrentWorkspace } from "@/lib/auth";
import { utcToZonedDate } from "@/lib/booking-time";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import {
  getStaffPayoutSummaries,
  isStaffTaskDue,
  payableTaskWhere,
  staffReimbursementReceiptUrl,
  staffTaskPay,
  staffTaskWorkDate,
} from "@/lib/staff-payout";

type Params = Promise<{ staffId: string }>;

export default async function StaffPayoutDetailPage({ params }: { params: Params }) {
  const { staffId } = await params;
  const workspace = await requireCurrentWorkspace();
  const { locale } = await getI18n();

  const [summary] = await getStaffPayoutSummaries(workspace.id, { staffIds: [staffId] });
  if (!summary) notFound();

  const [tasks, payments, reimbursements, vehicles] = await Promise.all([
    prisma.staffTask.findMany({
      where: { workspaceId: workspace.id, staffId, ...payableTaskWhere },
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
      where: { workspaceId: workspace.id, staffId },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.staffReimbursement.findMany({
      where: { workspaceId: workspace.id, staffId },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      include: { receipts: { orderBy: { uploadedAt: "asc" } } },
    }),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
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

  return (
    <StaffPayoutView
      locale={locale}
      summary={summary}
      todayKey={todayKey}
      tasks={tasks.map((task) => ({
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
      }))}
      payments={payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        paidAt: payment.paidAt.toISOString().slice(0, 10),
        purpose: payment.purpose,
        method: payment.method,
        reference: payment.reference,
        notes: payment.notes,
      }))}
      reimbursements={reimbursements.map((row) => {
        const vehicle = row.vehicleId ? vehicleById.get(row.vehicleId) : undefined;
        return {
          id: row.id,
          amount: row.amount,
          occurredAt: row.occurredAt.toISOString().slice(0, 10),
          note: row.note,
          vehicleId: row.vehicleId,
          vehicleLabel: vehicle ? `${vehicle.plateNumber} · ${vehicle.nickname}` : null,
          ownerName: vehicle?.owner?.name ?? null,
          onOwnerLedger: Boolean(row.ownerLedgerItemId),
          receipts: row.receipts.map((receipt) => ({
            id: receipt.id,
            filename: receipt.filename,
            url: staffReimbursementReceiptUrl(staffId, row.id, receipt.id),
          })),
        };
      })}
      vehicles={vehicles.map((vehicle) => ({
        value: vehicle.id,
        label: `${vehicle.plateNumber} · ${vehicle.nickname}${vehicle.owner ? ` · ${vehicle.owner.name}` : ""}`,
        searchText: `${vehicle.brand} ${vehicle.model}`,
      }))}
    />
  );
}
