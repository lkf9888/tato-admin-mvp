import { notFound } from "next/navigation";
import ContractsClient from "../../ContractsClient";
import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ id: string }>;

export default async function EditContractTemplatePage({ params }: { params: Params }) {
  const { workspace } = await requireCurrentAdminContext();

  const { id } = await params;
  const [template, textPresets] = await Promise.all([
    prisma.contractTemplate.findFirst({
      where: { id, workspaceId: workspace.id, active: true },
      include: {
        fields: { orderBy: [{ page: "asc" }, { sortOrder: "asc" }] },
        recipients: { orderBy: { signingOrder: "asc" } },
      },
    }),
    prisma.contractTextPreset.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!template) notFound();

  return (
    <ContractsClient
      userId={workspace.id}
      templates={[JSON.parse(JSON.stringify(template))]}
      envelopes={[]}
      bookings={[]}
      textPresets={JSON.parse(JSON.stringify(textPresets))}
      mode="edit"
    />
  );
}
