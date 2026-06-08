import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ContractsClient from "../../ContractsClient";

export default async function NewContractTemplatePage() {
  const { workspace } = await requireCurrentAdminContext();

  const textPresets = await prisma.contractTextPreset.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <ContractsClient
      mode="create"
      userId={workspace.id}
      templates={[]}
      envelopes={[]}
      textPresets={JSON.parse(JSON.stringify(textPresets))}
      bookings={[]}
    />
  );
}
