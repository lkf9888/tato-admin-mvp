import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { OrderAttachmentKind, type StaffTaskAttachment } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  ensureStaffShareToken,
  getBearerToken,
  staffMiniProgramTaskInclude,
  verifyStaffAppSession,
} from "@/lib/staff-app";
import { staffShareTaskAttachmentUrl } from "@/lib/staff-share";
import {
  isImageAttachment,
  makeStaffTaskAttachmentPath,
  resolveUploadPath,
  sanitizeFilename,
} from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ taskId: string }>;

function getBaseUrl(request: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
}

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const token = getBearerToken(request);
  const staff = token ? await verifyStaffAppSession(token) : null;
  if (!staff) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { taskId } = await params;
  const task = await prisma.staffTask.findFirst({
    where: {
      id: taskId,
      workspaceId: staff.workspaceId,
      staffId: staff.id,
    },
    include: staffMiniProgramTaskInclude,
  });
  if (!task) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  const formData = await request.formData();
  const files = [...formData.getAll("files"), ...formData.getAll("file")].filter(
    (entry): entry is File => entry instanceof File,
  );
  if (files.length === 0) {
    return NextResponse.json({ error: "NO_FILES" }, { status: 400 });
  }

  if (files.some((file) => !isImageAttachment(file.type, file.name))) {
    return NextResponse.json({ error: "ONLY_IMAGES_ALLOWED" }, { status: 400 });
  }

  const shareToken = await ensureStaffShareToken(staff);
  if (!shareToken) {
    return NextResponse.json({ error: "STAFF_SHARE_TOKEN_NOT_AVAILABLE" }, { status: 500 });
  }

  const baseUrl = getBaseUrl(request);
  const created: Array<StaffTaskAttachment & { url: string }> = [];
  for (const file of files) {
    const safeName = sanitizeFilename(file.name);
    const pathname = makeStaffTaskAttachmentPath(task.id, safeName);
    const absolutePath = resolveUploadPath(pathname);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

    const attachment = await prisma.staffTaskAttachment.create({
      data: {
        workspaceId: staff.workspaceId,
        taskId: task.id,
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
      url: `${baseUrl}${staffShareTaskAttachmentUrl(shareToken, task.id, attachment.id)}`,
    });
  }

  await logActivity({
    workspaceId: staff.workspaceId,
    actor: `${staff.name} (iOS staff app)`,
    action: "staff_task_attachments_uploaded_by_staff_app",
    entityType: "StaffTask",
    entityId: task.id,
    metadata: {
      taskId: task.id,
      files: created.map((attachment) => attachment.filename),
    },
  });

  revalidatePath("/staff-schedule");
  revalidatePath(`/staff-share/${shareToken}`);
  return NextResponse.json({ attachments: created });
}
