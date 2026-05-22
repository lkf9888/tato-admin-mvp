import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { OrderAttachmentKind, type StaffTaskAttachment } from "@prisma/client";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  isImageAttachment,
  makeStaffTaskAttachmentPath,
  resolveUploadPath,
  sanitizeFilename,
} from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ taskId: string }>;

function revalidateStaffSchedule() {
  revalidatePath("/staff-schedule");
}

async function requireTask(taskId: string) {
  const { workspace, user } = await requireCurrentAdminContext();
  const task = await prisma.staffTask.findFirst({
    where: { id: taskId, workspaceId: workspace.id },
    select: { id: true, workspaceId: true, title: true },
  });
  if (!task) return { error: "TASK_NOT_FOUND" as const, status: 404 as const };
  return { workspace, user, task };
}

function attachmentUrl(taskId: string, attachmentId: string) {
  return `/api/staff-schedule/tasks/${taskId}/attachments/file?attachmentId=${attachmentId}`;
}

export async function GET(_request: NextRequest, { params }: { params: Params }) {
  const { taskId } = await params;
  const context = await requireTask(taskId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const attachments = await prisma.staffTaskAttachment.findMany({
    where: {
      workspaceId: context.workspace.id,
      taskId: context.task.id,
      isArchived: false,
    },
    orderBy: { uploadedAt: "asc" },
  });

  return NextResponse.json({
    attachments: attachments.map((attachment) => ({
      ...attachment,
      url: attachmentUrl(context.task.id, attachment.id),
    })),
  });
}

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { taskId } = await params;
  const context = await requireTask(taskId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "NO_FILES" }, { status: 400 });
  }

  if (files.some((file) => !isImageAttachment(file.type, file.name))) {
    return NextResponse.json({ error: "ONLY_IMAGES_ALLOWED" }, { status: 400 });
  }

  const created: Array<StaffTaskAttachment & { url: string }> = [];
  for (const file of files) {
    const safeName = sanitizeFilename(file.name);
    const pathname = makeStaffTaskAttachmentPath(context.task.id, safeName);
    const absolutePath = resolveUploadPath(pathname);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

    const attachment = await prisma.staffTaskAttachment.create({
      data: {
        workspaceId: context.workspace.id,
        taskId: context.task.id,
        kind: OrderAttachmentKind.photo,
        url: null,
        pathname,
        filename: safeName,
        contentType: file.type || null,
        size: file.size,
      },
    });

    created.push({
      ...attachment,
      url: attachmentUrl(context.task.id, attachment.id),
    });
  }

  await logActivity({
    workspaceId: context.workspace.id,
    actor: context.user.name,
    action: "staff_task_attachments_uploaded",
    entityType: "StaffTask",
    entityId: context.task.id,
    metadata: {
      taskId: context.task.id,
      files: created.map((attachment) => attachment.filename),
    },
  });

  revalidateStaffSchedule();
  return NextResponse.json({ attachments: created });
}
