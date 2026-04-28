import bcrypt from "bcryptjs";

import { bootstrapAdminCredentials } from "../lib/constants";
import { prisma } from "../lib/prisma";

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT) {
    throw new Error("Refusing to run the destructive seed script in production.");
  }

  await prisma.user.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.order.deleteMany();
  await prisma.shareLink.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.owner.deleteMany();

  await prisma.user.create({
    data: {
      name: "Admin",
      email: bootstrapAdminCredentials.email.toLowerCase(),
      passwordHash: await bcrypt.hash(bootstrapAdminCredentials.password, 10),
    },
  });
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
