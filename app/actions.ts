"use server";

import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { OrderStatus, OrderSource, ShareVisibility, VehicleStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  clearAdminSession,
  normalizeEmail,
  grantShareAccess,
  requireCurrentAdminContext,
  setAdminSession,
  validateAdminCredentials,
} from "@/lib/auth";
import { logActivity, reconcileVehicleConflicts } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { createWorkspaceForRegistration } from "@/lib/workspaces";

const ownerSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  companyName: z.string().optional(),
  notes: z.string().optional(),
});

const vehicleSchema = z.object({
  id: z.string().optional(),
  ownerId: z.string().optional(),
  plateNumber: z.string().min(2),
  nickname: z.string().min(2),
  brand: z.string().min(2),
  model: z.string().min(1),
  year: z.coerce.number().int().min(2000).max(2100),
  vin: z.string().optional(),
  status: z.nativeEnum(VehicleStatus),
  turoListingName: z.string().optional(),
  turoVehicleCode: z.string().optional(),
  purchasePrice: z.coerce.number().nonnegative().optional(),
  notes: z.string().optional(),
});

const orderSchema = z.object({
  id: z.string().optional(),
  vehicleId: z.string().min(1),
  renterName: z.string().min(2),
  renterPhone: z.string().optional(),
  pickupDatetime: z.string().min(1),
  returnDatetime: z.string().min(1),
  totalPrice: z.coerce.number().nonnegative().optional(),
  depositAmount: z.coerce.number().nonnegative().optional(),
  status: z.nativeEnum(OrderStatus),
  pickupLocation: z.string().optional(),
  returnLocation: z.string().optional(),
  paymentMethod: z.string().optional(),
  contractNumber: z.string().optional(),
  notes: z.string().optional(),
});

const registrationSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  password: z.string().min(6),
});

function cleanOptional(value: FormDataEntryValue | null) {
  if (!value) return undefined;
  const stringValue = value.toString().trim();
  return stringValue ? stringValue : undefined;
}

function revalidateAdminPages() {
  [
    "/dashboard",
    "/vehicles",
    "/vehicle-roi",
    "/direct-booking",
    "/owners",
    "/orders",
    "/calendar",
    "/imports",
    "/billing",
    "/share-links",
  ].forEach((path) => revalidatePath(path));
}

export async function loginAction(formData: FormData) {
  const email = formData.get("email")?.toString().trim() ?? "";
  const password = formData.get("password")?.toString() ?? "";

  const authenticatedUser = await validateAdminCredentials(email, password);
  if (!authenticatedUser) {
    redirect("/login?error=invalid");
  }

  await setAdminSession(authenticatedUser.sessionValue);
  redirect("/dashboard");
}

export async function logoutAction() {
  await clearAdminSession();
  redirect("/login");
}

export async function registerAction(formData: FormData) {
  const parsed = registrationSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect("/register?error=invalid");
  }

  const name = parsed.data.name.trim();
  const email = normalizeEmail(parsed.data.email);
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    redirect("/register?error=exists");
  }

  const workspace = await createWorkspaceForRegistration({ name, email });
  const [user] = await prisma.$transaction([
    prisma.user.create({
      data: {
        workspaceId: workspace.id,
        name,
        email,
        passwordHash: await bcrypt.hash(parsed.data.password, 10),
      },
    }),
    prisma.workspaceBilling.create({
      data: {
        workspaceId: workspace.id,
      },
    }),
  ]);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "user_registered",
    entityType: "User",
    entityId: user.id,
    metadata: { email: user.email },
  });

  await setAdminSession(user.id);
  redirect("/dashboard");
}

export async function saveOwnerAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = ownerSchema.parse({
    id: cleanOptional(formData.get("id")),
    name: formData.get("name"),
    phone: cleanOptional(formData.get("phone")),
    email: cleanOptional(formData.get("email")),
    companyName: cleanOptional(formData.get("companyName")),
    notes: cleanOptional(formData.get("notes")),
  });

  const { id, ...ownerData } = parsed;

  const existingOwner = id
    ? await prisma.owner.findFirst({
        where: { id, workspaceId: workspace.id },
      })
    : null;

  const owner = existingOwner
    ? await prisma.owner.update({
        where: { id: existingOwner.id },
        data: ownerData,
      })
    : await prisma.owner.create({
        data: {
          ...ownerData,
          workspaceId: workspace.id,
        },
      });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: id ? "owner_updated" : "owner_created",
    entityType: "Owner",
    entityId: owner.id,
    metadata: { name: owner.name },
  });

  revalidateAdminPages();
}

export async function deleteOwnerAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString();
  if (!id) return;

  const vehicleCount = await prisma.vehicle.count({
    where: { ownerId: id, workspaceId: workspace.id },
  });

  if (vehicleCount > 0) {
    redirect("/owners?error=owner-has-vehicles");
  }

  await prisma.shareLink.deleteMany({
    where: { ownerId: id, workspaceId: workspace.id },
  });

  const owner = await prisma.owner.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!owner) return;

  await prisma.owner.delete({
    where: { id: owner.id },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "owner_deleted",
    entityType: "Owner",
    entityId: owner.id,
  });

  revalidateAdminPages();
}

export async function saveVehicleAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = vehicleSchema.parse({
    id: cleanOptional(formData.get("id")),
    ownerId: cleanOptional(formData.get("ownerId")),
    plateNumber: formData.get("plateNumber"),
    nickname: formData.get("nickname"),
    brand: formData.get("brand"),
    model: formData.get("model"),
    year: formData.get("year"),
    vin: cleanOptional(formData.get("vin")),
    status: formData.get("status"),
    turoListingName: cleanOptional(formData.get("turoListingName")),
    turoVehicleCode: cleanOptional(formData.get("turoVehicleCode")),
    purchasePrice: cleanOptional(formData.get("purchasePrice")),
    notes: cleanOptional(formData.get("notes")),
  });

  const { id, ...vehicleData } = parsed;

  const existingVehicle = id
    ? await prisma.vehicle.findFirst({
        where: { id, workspaceId: workspace.id },
      })
    : null;

  const vehicle = existingVehicle
    ? await prisma.vehicle.update({
        where: { id: existingVehicle.id },
        data: vehicleData,
      })
    : await prisma.vehicle.create({
        data: {
          ...vehicleData,
          workspaceId: workspace.id,
        },
      });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: id ? "vehicle_updated" : "vehicle_created",
    entityType: "Vehicle",
    entityId: vehicle.id,
    metadata: { plateNumber: vehicle.plateNumber },
  });

  revalidateAdminPages();
}

export async function saveVehiclePurchasePriceAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString().trim();
  if (!id) return;

  const rawPurchasePrice = cleanOptional(formData.get("purchasePrice"));
  const purchasePrice =
    rawPurchasePrice == null ? null : z.coerce.number().nonnegative().parse(rawPurchasePrice);

  const existingVehicle = await prisma.vehicle.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!existingVehicle) return;

  const vehicle = await prisma.vehicle.update({
    where: { id: existingVehicle.id },
    data: { purchasePrice },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "vehicle_purchase_price_updated",
    entityType: "Vehicle",
    entityId: vehicle.id,
    metadata: {
      plateNumber: vehicle.plateNumber,
      purchasePrice,
    },
  });

  revalidateAdminPages();
}

export async function saveVehicleDirectBookingAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString().trim();
  if (!id) return;

  const directBookingEnabled = formData.get("directBookingEnabled")?.toString() === "on";
  const rawDailyRate = cleanOptional(formData.get("bookingDailyRate"));
  const rawInsuranceFee = cleanOptional(formData.get("bookingInsuranceFee"));
  const rawDepositAmount = cleanOptional(formData.get("bookingDepositAmount"));
  const bookingIntro = cleanOptional(formData.get("bookingIntro"));

  const bookingDailyRate =
    rawDailyRate == null ? null : z.coerce.number().nonnegative().parse(rawDailyRate);
  const bookingInsuranceFee =
    rawInsuranceFee == null ? null : z.coerce.number().nonnegative().parse(rawInsuranceFee);
  const bookingDepositAmount =
    rawDepositAmount == null ? null : z.coerce.number().nonnegative().parse(rawDepositAmount);

  const existingVehicle = await prisma.vehicle.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!existingVehicle) return;

  const vehicle = await prisma.vehicle.update({
    where: { id: existingVehicle.id },
    data: {
      directBookingEnabled,
      bookingDailyRate,
      bookingInsuranceFee,
      bookingDepositAmount,
      bookingIntro,
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "vehicle_direct_booking_updated",
    entityType: "Vehicle",
    entityId: vehicle.id,
    metadata: {
      plateNumber: vehicle.plateNumber,
      directBookingEnabled,
      bookingDailyRate,
      bookingInsuranceFee,
      bookingDepositAmount,
    },
  });

  revalidateAdminPages();
  revalidatePath(`/reserve/${vehicle.id}`);
}

export async function deleteVehicleAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString();
  if (!id) return;

  const orderCount = await prisma.order.count({
    where: { vehicleId: id, workspaceId: workspace.id },
  });

  if (orderCount > 0) {
    redirect("/vehicles?error=vehicle-has-orders");
  }

  const vehicle = await prisma.vehicle.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!vehicle) return;

  await prisma.vehicle.delete({
    where: { id: vehicle.id },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "vehicle_deleted",
    entityType: "Vehicle",
    entityId: vehicle.id,
  });

  revalidateAdminPages();
}

export async function saveOfflineOrderAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = orderSchema.parse({
    id: cleanOptional(formData.get("id")),
    vehicleId: formData.get("vehicleId"),
    renterName: formData.get("renterName"),
    renterPhone: cleanOptional(formData.get("renterPhone")),
    pickupDatetime: formData.get("pickupDatetime"),
    returnDatetime: formData.get("returnDatetime"),
    totalPrice: cleanOptional(formData.get("totalPrice")),
    depositAmount: cleanOptional(formData.get("depositAmount")),
    status: formData.get("status"),
    pickupLocation: cleanOptional(formData.get("pickupLocation")),
    returnLocation: cleanOptional(formData.get("returnLocation")),
    paymentMethod: cleanOptional(formData.get("paymentMethod")),
    contractNumber: cleanOptional(formData.get("contractNumber")),
    notes: cleanOptional(formData.get("notes")),
  });

  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: parsed.vehicleId,
      workspaceId: workspace.id,
    },
  });
  if (!vehicle) {
    redirect("/orders?error=vehicle-not-found");
  }

  const payload = {
    workspaceId: workspace.id,
    vehicleId: parsed.vehicleId,
    renterName: parsed.renterName,
    renterPhone: parsed.renterPhone,
    pickupDatetime: new Date(parsed.pickupDatetime),
    returnDatetime: new Date(parsed.returnDatetime),
    totalPrice: parsed.totalPrice,
    depositAmount: parsed.depositAmount,
    status: parsed.status,
    pickupLocation: parsed.pickupLocation,
    returnLocation: parsed.returnLocation,
    paymentMethod: parsed.paymentMethod,
    contractNumber: parsed.contractNumber,
    notes: parsed.notes,
    source: OrderSource.offline,
    createdBy: user.name,
  };

  const existingOrder = parsed.id
    ? await prisma.order.findFirst({
        where: { id: parsed.id, workspaceId: workspace.id },
      })
    : null;

  const order = existingOrder
    ? await prisma.order.update({
        where: { id: existingOrder.id },
        data: payload,
      })
    : await prisma.order.create({
        data: payload,
      });

  await reconcileVehicleConflicts(parsed.vehicleId);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: parsed.id ? "offline_order_updated" : "offline_order_created",
    entityType: "Order",
    entityId: order.id,
    metadata: {
      source: "offline",
      renterName: order.renterName,
      vehicleId: order.vehicleId,
    },
  });

  revalidateAdminPages();
}

export async function updateOrderStatusAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString();
  const status = formData.get("status")?.toString() as OrderStatus | undefined;

  if (!id || !status) return;

  const existingOrder = await prisma.order.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!existingOrder) return;

  const order = await prisma.order.update({
    where: { id: existingOrder.id },
    data: { status },
  });

  await reconcileVehicleConflicts(order.vehicleId);
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "order_status_updated",
    entityType: "Order",
    entityId: id,
    metadata: { status },
  });

  revalidateAdminPages();
}

export async function deleteOrderAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString();
  if (!id) return;

  const existing = await prisma.order.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!existing) return;

  if (existing.source === OrderSource.turo) {
    redirect("/orders?error=turo-order-readonly");
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
    entityId: existing.id,
  });

  revalidateAdminPages();
}

export async function createShareLinkAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const ownerId = formData.get("ownerId")?.toString();
  if (!ownerId) return;

  const password = cleanOptional(formData.get("password"));
  const expiresAtValue = cleanOptional(formData.get("expiresAt"));
  const visibility =
    (formData.get("visibility")?.toString() as ShareVisibility | undefined) ??
    ShareVisibility.standard;

  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: workspace.id },
    select: { id: true },
  });
  if (!owner) return;

  const shareLink = await prisma.shareLink.create({
    data: {
      workspaceId: workspace.id,
      ownerId: owner.id,
      token: randomBytes(18).toString("hex"),
      passwordHash: password ? await bcrypt.hash(password, 10) : undefined,
      expiresAt: expiresAtValue ? new Date(expiresAtValue) : undefined,
      visibility,
      createdBy: user.name,
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "share_link_created",
    entityType: "ShareLink",
    entityId: shareLink.id,
    metadata: { ownerId, visibility },
  });

  revalidateAdminPages();
}

export async function revokeShareLinkAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString();
  if (!id) return;

  const existingShareLink = await prisma.shareLink.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!existingShareLink) return;

  await prisma.shareLink.update({
    where: { id: existingShareLink.id },
    data: { isActive: false },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "share_link_revoked",
    entityType: "ShareLink",
    entityId: existingShareLink.id,
  });

  revalidateAdminPages();
}

export async function deleteShareLinkAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString();
  if (!id) return;

  const existingShareLink = await prisma.shareLink.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!existingShareLink) return;

  await prisma.shareLink.delete({
    where: { id: existingShareLink.id },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "share_link_deleted",
    entityType: "ShareLink",
    entityId: existingShareLink.id,
  });

  revalidateAdminPages();
}

export async function unlockShareLinkAction(formData: FormData) {
  const token = formData.get("token")?.toString();
  const password = formData.get("password")?.toString() ?? "";
  if (!token) redirect("/login");

  const shareLink = await prisma.shareLink.findUnique({
    where: { token },
  });

  if (!shareLink || !shareLink.passwordHash) {
    redirect(`/share/${token}`);
  }

  const valid = await bcrypt.compare(password, shareLink.passwordHash);
  if (!valid) {
    redirect(`/share/${token}?error=password`);
  }

  await grantShareAccess(token, shareLink.passwordHash);
  redirect(`/share/${token}`);
}
