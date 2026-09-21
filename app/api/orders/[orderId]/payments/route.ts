import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ orderId: string }>;

/**
 * The instalments against one order.
 *
 * Replaced as a set rather than patched row by row. The UI is a small
 * table the operator edits and saves, and reconciling per-row
 * creates/updates/deletes across that would be far more code for a
 * list that is typically three lines long.
 */

const MAX_ROWS = 40;

const paymentSchema = z.object({
  amount: z.number().finite(),
  /** `YYYY-MM-DD`, or null while the instalment is still expected. */
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  payer: z.string().trim().max(120).optional().default(""),
  method: z.string().trim().max(120).optional().default(""),
  note: z.string().trim().max(500).optional().default(""),
});

const bodySchema = z.object({
  payments: z.array(paymentSchema).max(MAX_ROWS),
});

async function requireOrder(orderId: string, workspaceId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, workspaceId, isArchived: false },
    select: { id: true },
  });
}

export async function GET(_request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace } = await requireCurrentAdminContext();

  if (!(await requireOrder(orderId, workspace.id))) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const payments = await prisma.orderPayment.findMany({
    where: { orderId },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({
    payments: payments.map((payment) => ({
      id: payment.id,
      amount: payment.amount,
      paidAt: payment.paidAt ? payment.paidAt.toISOString().slice(0, 10) : null,
      payer: payment.payer ?? "",
      method: payment.method ?? "",
      note: payment.note ?? "",
    })),
  });
}

export async function PUT(request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  if (!(await requireOrder(orderId, workspace.id))) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  // Both statements in one transaction: a delete that lands without
  // its create would wipe the schedule.
  await prisma.$transaction([
    prisma.orderPayment.deleteMany({ where: { orderId } }),
    prisma.orderPayment.createMany({
      data: parsed.data.payments.map((payment) => ({
        workspaceId: workspace.id,
        orderId,
        amount: payment.amount,
        // Parsed as local midnight, matching how every other date
        // input in this app is read.
        paidAt: payment.paidAt ? new Date(`${payment.paidAt}T00:00:00`) : null,
        payer: payment.payer || null,
        method: payment.method || null,
        note: payment.note || null,
        createdBy: user.name,
      })),
    }),
  ]);

  return NextResponse.json({ ok: true, count: parsed.data.payments.length });
}
