import bcrypt from "bcryptjs";

import { billingBypassAdminCredentials } from "../lib/constants";
import { prisma } from "../lib/prisma";
import { ensureDefaultWorkspace } from "../lib/workspaces";

async function upsertBillingBypassAdmin() {
  if (!billingBypassAdminCredentials.email || !billingBypassAdminCredentials.password) {
    return;
  }

  const workspace = await ensureDefaultWorkspace();

  await prisma.user.upsert({
    where: { email: billingBypassAdminCredentials.email },
    update: {
      workspaceId: workspace.id,
      name: billingBypassAdminCredentials.name,
      passwordHash: await bcrypt.hash(billingBypassAdminCredentials.password, 10),
      isBillingExempt: true,
    },
    create: {
      workspaceId: workspace.id,
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
