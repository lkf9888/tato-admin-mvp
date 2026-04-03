import bcrypt from "bcryptjs";
import {
  OrderSource,
  OrderStatus,
  OwnerAccessType,
  ShareVisibility,
  VehicleStatus,
} from "@prisma/client";

import { demoCredentials } from "../lib/constants";
import { prisma } from "../lib/prisma";

async function main() {
  await prisma.user.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.order.deleteMany();
  await prisma.shareLink.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.owner.deleteMany();

  await prisma.user.create({
    data: {
      name: "Demo Admin",
      email: demoCredentials.email.toLowerCase(),
      passwordHash: await bcrypt.hash(demoCredentials.password, 10),
    },
  });

  const ownerA = await prisma.owner.create({
    data: {
      name: "Daniel Wu",
      phone: "6045551200",
      email: "daniel@example.com",
      companyName: "DW Mobility",
      accessType: OwnerAccessType.share_link,
      notes: "Prefers privacy mode on shared calendars.",
    },
  });

  const ownerB = await prisma.owner.create({
    data: {
      name: "Olivia Chen",
      phone: "7785557800",
      email: "olivia@example.com",
      accessType: OwnerAccessType.share_link,
      notes: "Has both Turo and offline business.",
    },
  });

  const tesla3 = await prisma.vehicle.create({
    data: {
      ownerId: ownerA.id,
      plateNumber: "BC1234",
      nickname: "Tesla Model 3 - White",
      brand: "Tesla",
      model: "Model 3",
      year: 2023,
      vin: "5YJ3E1EA1PF123456",
      status: VehicleStatus.available,
      turoListingName: "Tesla Model 3 - White",
      turoVehicleCode: "TM3-WH",
      notes: "Airport delivery enabled.",
    },
  });

  const modelY = await prisma.vehicle.create({
    data: {
      ownerId: ownerA.id,
      plateNumber: "BC5678",
      nickname: "Tesla Model Y - Black",
      brand: "Tesla",
      model: "Model Y",
      year: 2024,
      status: VehicleStatus.available,
      turoListingName: "Tesla Model Y - Black",
      turoVehicleCode: "TMY-BK",
    },
  });

  const bmw = await prisma.vehicle.create({
    data: {
      ownerId: ownerB.id,
      plateNumber: "BC7788",
      nickname: "BMW X3 - Blue",
      brand: "BMW",
      model: "X3",
      year: 2022,
      status: VehicleStatus.maintenance,
      turoListingName: "BMW X3 - Blue",
      turoVehicleCode: "BMW-X3-B",
      notes: "Scheduled detail on Apr 3.",
    },
  });

  const importBatch = await prisma.importBatch.create({
    data: {
      fileName: "march-turo-export.csv",
      importedBy: "System Seed",
      totalRows: 2,
      successRows: 2,
      failedRows: 0,
      notes: "Seeded sample Turo import batch.",
    },
  });

  await prisma.order.createMany({
    data: [
      {
        vehicleId: tesla3.id,
        importBatchId: importBatch.id,
        source: OrderSource.turo,
        externalOrderId: "TURO-9001",
        renterName: "Alice Zhang",
        renterPhone: "7785550101",
        pickupDatetime: new Date("2026-03-29T09:00:00-07:00"),
        returnDatetime: new Date("2026-04-02T18:00:00-07:00"),
        totalPrice: 420.5,
        status: OrderStatus.booked,
        pickupLocation: "YVR Parking",
        returnLocation: "YVR Parking",
        createdBy: "System Seed",
        notes: "Imported from Turo CSV",
      },
      {
        vehicleId: modelY.id,
        importBatchId: importBatch.id,
        source: OrderSource.turo,
        externalOrderId: "TURO-9002",
        renterName: "Michael Chen",
        renterPhone: "6045550112",
        pickupDatetime: new Date("2026-03-30T11:00:00-07:00"),
        returnDatetime: new Date("2026-04-05T10:00:00-07:00"),
        totalPrice: 590,
        status: OrderStatus.ongoing,
        pickupLocation: "Burnaby",
        returnLocation: "Burnaby",
        createdBy: "System Seed",
        notes: "Imported from Turo CSV",
      },
      {
        vehicleId: tesla3.id,
        source: OrderSource.offline,
        renterName: "Jason Lin",
        renterPhone: "6045552244",
        pickupDatetime: new Date("2026-04-01T15:00:00-07:00"),
        returnDatetime: new Date("2026-04-03T09:30:00-07:00"),
        totalPrice: 360,
        depositAmount: 500,
        status: OrderStatus.booked,
        paymentMethod: "e-transfer",
        contractNumber: "OFF-2026-041",
        pickupLocation: "Richmond Office",
        returnLocation: "Richmond Office",
        createdBy: "System Seed",
        notes: "This order overlaps the imported Turo trip and should show as a conflict.",
      },
      {
        vehicleId: bmw.id,
        source: OrderSource.offline,
        renterName: "Sarah Lee",
        renterPhone: "2365550199",
        pickupDatetime: new Date("2026-04-04T15:00:00-07:00"),
        returnDatetime: new Date("2026-04-06T09:30:00-07:00"),
        totalPrice: 315.25,
        status: OrderStatus.booked,
        paymentMethod: "cash",
        createdBy: "System Seed",
        notes: "Offline weekend booking.",
      },
    ],
  });

  await prisma.shareLink.create({
    data: {
      ownerId: ownerA.id,
      token: "demo-daniel-owner",
      passwordHash: await bcrypt.hash("owner123", 10),
      visibility: ShareVisibility.privacy,
      createdBy: "System Seed",
      expiresAt: new Date("2026-12-31T23:59:59-08:00"),
    },
  });

  await prisma.activityLog.createMany({
    data: [
      {
        actor: "System Seed",
        action: "seed_created",
        entityType: "Owner",
        entityId: ownerA.id,
        metadata: JSON.stringify({ message: "Initial seed owner created." }),
      },
      {
        actor: "System Seed",
        action: "seed_created",
        entityType: "Owner",
        entityId: ownerB.id,
        metadata: JSON.stringify({ message: "Initial seed owner created." }),
      },
    ],
  });
}

main()
  .then(async () => {
    const tesla = await prisma.vehicle.findFirstOrThrow({
      where: { nickname: "Tesla Model 3 - White" },
    });
    const modelY = await prisma.vehicle.findFirstOrThrow({
      where: { nickname: "Tesla Model Y - Black" },
    });

    const orders = await prisma.order.findMany({
      where: {
        vehicleId: {
          in: [tesla.id, modelY.id],
        },
      },
      orderBy: { pickupDatetime: "asc" },
    });

    for (const order of orders) {
      const overlapping = orders.some(
        (candidate) =>
          candidate.id !== order.id &&
          candidate.vehicleId === order.vehicleId &&
          candidate.status !== OrderStatus.cancelled &&
          order.pickupDatetime < candidate.returnDatetime &&
          order.returnDatetime > candidate.pickupDatetime,
      );

      await prisma.order.update({
        where: { id: order.id },
        data: { hasConflict: overlapping },
      });
    }
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
