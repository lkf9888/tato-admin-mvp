import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";

import SignContractClient from "./SignContractClient";

type Params = Promise<{ token: string }>;

/**
 * The operator's name in the tab and never a search result: a signing
 * link is one person's, and before this it fell back to the root
 * layout's "TATO | Turo Fleet Calendar".
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { token } = await params;
  const recipient = await prisma.contractRecipient.findUnique({
    where: { token },
    select: { envelope: { select: { title: true, workspaceId: true } } },
  });
  const workspaceId = recipient?.envelope.workspaceId;
  if (!recipient || !workspaceId) return { robots };
  const [site, workspace] = await Promise.all([
    prisma.rentalSite.findUnique({ where: { workspaceId }, select: { brandName: true } }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
  ]);
  const brand = site?.brandName?.trim() || workspace?.name?.trim();
  return { title: brand ? `${recipient.envelope.title} · ${brand}` : recipient.envelope.title, robots };
}

export default async function SignContractPage({
  params,
}: {
  params: Params;
}) {
  const { token } = await params;
  return <SignContractClient token={token} />;
}
