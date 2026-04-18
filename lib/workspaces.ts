import { prisma } from "@/lib/prisma";

export const DEFAULT_WORKSPACE_SLUG = "default";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

export async function ensureDefaultWorkspace() {
  return prisma.workspace.upsert({
    where: { slug: DEFAULT_WORKSPACE_SLUG },
    update: {},
    create: {
      slug: DEFAULT_WORKSPACE_SLUG,
      name: "Default workspace",
    },
  });
}

export async function createWorkspaceForRegistration(input: {
  name: string;
  email: string;
}) {
  const base = slugify(input.name) || slugify(input.email.split("@")[0] ?? "") || "workspace";
  let slug = base;
  let attempts = 0;

  while (attempts < 10) {
    const existing = await prisma.workspace.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!existing) {
      return prisma.workspace.create({
        data: {
          name: `${input.name}'s workspace`,
          slug,
        },
      });
    }

    attempts += 1;
    slug = `${base}-${randomSuffix()}`;
  }

  return prisma.workspace.create({
    data: {
      name: `${input.name}'s workspace`,
      slug: `${base}-${Date.now().toString(36)}`,
    },
  });
}

export async function ensureUserWorkspace(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { workspace: true },
  });

  if (!user) {
    return null;
  }

  if (user.workspaceId && user.workspace) {
    return user.workspace;
  }

  const workspace = await ensureDefaultWorkspace();
  await prisma.user.update({
    where: { id: user.id },
    data: { workspaceId: workspace.id },
  });

  return workspace;
}
