import { prisma } from "../lib/prisma";
import {
  resolveTuroSyncWorkspace,
  runTuroCsvSync,
  summarizeTuroCsvSyncResult,
} from "../lib/turo-sync";

async function main() {
  const workspace = await resolveTuroSyncWorkspace();
  const result = await runTuroCsvSync({
    workspaceId: workspace.id,
    actor: process.env.TURO_SYNC_ACTOR?.trim() || "Turo auto sync",
    billingBypassActive: false,
  });

  console.log(`Turo CSV sync completed: ${summarizeTuroCsvSyncResult(result)}`);

  if (result.failedRows > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
