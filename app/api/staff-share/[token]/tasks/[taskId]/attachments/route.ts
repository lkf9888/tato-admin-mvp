import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { OrderAttachmentKind, type StaffTaskAttachment } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { findSharedStaffTask, staffShareTaskAttachmentUrl } from "@/lib/staff-share";
import { checkUploadLimits, isImageAttachment, makeStaffTaskAttachmentPath, resolveUploadPath, sanitizeFilename } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ token: string; taskId: string }>;

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { token, taskId } = await params;
  const context = await findSharedStaffTask(token, taskId);
  if (!context) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "NO_FILES" }, { status: 400 });
  }

  // Reject oversized batches before anything reaches the volume. These
  // routes are Route Handlers, which Next does not body-size cap by
  // default (`serverActions.bodySizeLimit` covers Server Actions only).
  const limitError = checkUploadLimits(files);
  if (limitError) {
    const { status, ...payload } = limitError;
    return NextResponse.json(payload, { status });
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
        workspaceId: context.staff.workspaceId,
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
      url: staffShareTaskAttachmentUrl(token, context.task.id, attachment.id),
    });
  }

  await logActivity({
    workspaceId: context.staff.workspaceId,
    actor: `${context.staff.name} (staff link)`,
    action: "staff_task_attachments_uploaded_by_staff",
    entityType: "StaffTask",
    entityId: context.task.id,
    metadata: {
      taskId: context.task.id,
      files: created.map((attachment) => attachment.filename),
    },
  });

  revalidatePath(`/staff-share/${token}`);
  revalidatePath("/staff-schedule");
  return NextResponse.json({ attachments: created });
}
