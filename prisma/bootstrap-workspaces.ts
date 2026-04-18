import { prisma } from "../lib/prisma";
import { ensureDefaultWorkspace } from "../lib/workspaces";

async function backfillWorkspaceIds(workspaceId: string) {
  await prisma.$transaction([
    prisma.user.updateMany({
      where: { workspaceId: null },
      data: { workspaceId },
    }),
    prisma.owner.updateMany({
      where: { workspaceId: null },
      data: { workspaceId },
    }),
    prisma.vehicle.updateMany({
      where: { workspaceId: null },
      data: { workspaceId },
    }),
    prisma.order.updateMany({
      where: { workspaceId: null },
      data: { workspaceId },
    }),
    prisma.importBatch.updateMany({
      where: { workspaceId: null },
      data: { workspaceId },
    }),
    prisma.shareLink.updateMany({
      where: { workspaceId: null },
      data: { workspaceId },
    }),
    prisma.activityLog.updateMany({
      where: { workspaceId: null },
      data: { workspaceId },
    }),
  ]);

  await prisma.workspaceBilling.upsert({
    where: { workspaceId },
    update: {},
    create: {
      workspaceId,
    },
  });
}

async function main() {
  const workspace = await ensureDefaultWorkspace();
  await backfillWorkspaceIds(workspace.id);
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
