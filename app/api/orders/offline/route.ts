import { OrderSource, OrderStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity, reconcileVehicleConflicts } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

const manualOrderSchema = z.object({
  vehicleId: z.string().min(1),
  renterName: z.string().trim().min(2),
  renterPhone: z.string().trim().optional(),
  pickupDatetime: z.string().min(1),
  returnDatetime: z.string().min(1),
  totalPrice: z.preprocess((value) => {
    if (value == null || value === "") return undefined;
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value);
    return value;
  }, z.number().nonnegative().optional()),
});

function cleanOptional(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function revalidateOrderSurfaces() {
  ["/dashboard", "/orders", "/calendar"].forEach((path) => revalidatePath(path));
  revalidatePath("/share/[token]", "page");
}

async function fetchOrderForResponse(id: string) {
  const { workspace } = await requireCurrentAdminContext();
  return prisma.order.findFirstOrThrow({
    where: { id, workspaceId: workspace.id, isArchived: false },
    include: { vehicle: { include: { owner: true } } },
  });
}

type OrderForResponse = Awaited<ReturnType<typeof fetchOrderForResponse>>;

function buildResponseOrder(order: OrderForResponse) {
  return {
    id: order.id,
    source: order.source,
    status: order.status,
    hasConflict: order.hasConflict,
    vehicleId: order.vehicleId,
    vehicleName: order.vehicle.nickname,
    vehiclePlateNumber: order.vehicle.plateNumber,
    ownerId: order.vehicle.ownerId,
    ownerName: order.vehicle.owner?.name ?? null,
    renterName: order.renterName,
    renterPhone: order.renterPhone,
    pickupDatetime: order.pickupDatetime.toISOString(),
    returnDatetime: order.returnDatetime.toISOString(),
    totalPrice: order.totalPrice,
    notes: order.notes,
  };
}

export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();

  try {
    const parsed = manualOrderSchema.parse(await request.json());
    const pickupDatetime = new Date(parsed.pickupDatetime);
    const returnDatetime = new Date(parsed.returnDatetime);

    if (
      Number.isNaN(pickupDatetime.getTime()) ||
      Number.isNaN(returnDatetime.getTime()) ||
      returnDatetime <= pickupDatetime
    ) {
      return NextResponse.json({ error: "INVALID_DATES" }, { status: 400 });
    }

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: parsed.vehicleId, workspaceId: workspace.id },
      select: { id: true },
    });

    if (!vehicle) {
      return NextResponse.json({ error: "VEHICLE_NOT_FOUND" }, { status: 404 });
    }

    const order = await prisma.order.create({
      data: {
        workspaceId: workspace.id,
        source: OrderSource.offline,
        status: OrderStatus.booked,
        vehicleId: parsed.vehicleId,
        renterName: parsed.renterName,
        renterPhone: cleanOptional(parsed.renterPhone),
        pickupDatetime,
        returnDatetime,
        totalPrice: parsed.totalPrice,
        createdBy: user.name,
      },
    });

    await reconcileVehicleConflicts(order.vehicleId);
    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "offline_order_created",
      entityType: "Order",
      entityId: order.id,
      metadata: {
        source: "offline",
        renterName: order.renterName,
        vehicleId: order.vehicleId,
      },
    });

    revalidateOrderSurfaces();
    const refreshed = await fetchOrderForResponse(order.id);
    return NextResponse.json({ order: buildResponseOrder(refreshed) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
    }
    return NextResponse.json({ error: "SAVE_FAILED" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();

  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const id = typeof payload.id === "string" ? payload.id : "";

    if (!id) {
      return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
    }

    const existing = await prisma.order.findFirst({
      where: { id, workspaceId: workspace.id, isArchived: false },
    });

    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    if (existing.source !== OrderSource.offline) {
      return NextResponse.json({ error: "READ_ONLY_SOURCE" }, { status: 403 });
    }

    const parsed = manualOrderSchema.parse(payload);
    const pickupDatetime = new Date(parsed.pickupDatetime);
    const returnDatetime = new Date(parsed.returnDatetime);

    if (
      Number.isNaN(pickupDatetime.getTime()) ||
      Number.isNaN(returnDatetime.getTime()) ||
      returnDatetime <= pickupDatetime
    ) {
      return NextResponse.json({ error: "INVALID_DATES" }, { status: 400 });
    }

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: parsed.vehicleId, workspaceId: workspace.id },
      select: { id: true },
    });

    if (!vehicle) {
      return NextResponse.json({ error: "VEHICLE_NOT_FOUND" }, { status: 404 });
    }

    const order = await prisma.order.update({
      where: { id: existing.id },
      data: {
        vehicleId: parsed.vehicleId,
        renterName: parsed.renterName,
        renterPhone: cleanOptional(parsed.renterPhone),
        pickupDatetime,
        returnDatetime,
        totalPrice: parsed.totalPrice,
      },
    });

    await reconcileVehicleConflicts(order.vehicleId);
    if (existing.vehicleId !== order.vehicleId) {
      await reconcileVehicleConflicts(existing.vehicleId);
    }

    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "offline_order_updated",
      entityType: "Order",
      entityId: order.id,
      metadata: {
        source: "offline",
        renterName: order.renterName,
        vehicleId: order.vehicleId,
      },
    });

    revalidateOrderSurfaces();
    const refreshed = await fetchOrderForResponse(order.id);
    return NextResponse.json({ order: buildResponseOrder(refreshed) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
    }
    return NextResponse.json({ error: "SAVE_FAILED" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();

  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const id = typeof payload.id === "string" ? payload.id : "";

    if (!id) {
      return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
    }

    const existing = await prisma.order.findFirst({
      where: { id, workspaceId: workspace.id, isArchived: false },
    });

    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    if (existing.source !== OrderSource.offline) {
      return NextResponse.json({ error: "READ_ONLY_SOURCE" }, { status: 403 });
    }

    await prisma.order.delete({
      where: { id: existing.id },
    });

    await reconcileVehicleConflicts(existing.vehicleId);
    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "offline_order_deleted",
      entityType: "Order",
      entityId: id,
      metadata: {
        source: "offline",
        vehicleId: existing.vehicleId,
      },
    });

    revalidateOrderSurfaces();
    return NextResponse.json({ deletedId: id });
  } catch {
    return NextResponse.json({ error: "DELETE_FAILED" }, { status: 500 });
  }
}
