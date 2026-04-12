import bcrypt from "bcryptjs";

import { billingBypassAdminCredentials } from "../lib/constants";
import { prisma } from "../lib/prisma";

async function upsertBillingBypassAdmin() {
  if (!billingBypassAdminCredentials.email || !billingBypassAdminCredentials.password) {
    return;
  }

  await prisma.user.upsert({
    where: { email: billingBypassAdminCredentials.email },
    update: {
      name: billingBypassAdminCredentials.name,
      passwordHash: await bcrypt.hash(billingBypassAdminCredentials.password, 10),
      isBillingExempt: true,
    },
    create: {
      name: billingBypassAdminCredentials.name,
      email: billingBypassAdminCredentials.email,
      passwordHash: await bcrypt.hash(billingBypassAdminCredentials.password, 10),
      isBillingExempt: true,
    },
  });
}

async function main() {
  await upsertBillingBypassAdmin();
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
