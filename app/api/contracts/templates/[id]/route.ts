import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { requireCurrentAdminContext } from "@/lib/auth";
import {
  fetchDocumentBytes,
  mergeContractPdfBuffers,
  normalizeEditableContent,
  renderEditableContractPdf,
  renderUploadedContractDocumentPdf,
  uploadGeneratedTemplatePdf,
} from "@/lib/contract-documents";
import { DOCUMENT_EDIT_BLOCKING_STATUSES, planFieldEdit } from "@/lib/contract-template-edit";
import { prisma } from "@/lib/prisma";
import { resolveUploadPathWithin } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

const FIELD_TYPES = new Set(["SIGNATURE", "TEXT", "DATE", "CHECKBOX", "REDACTION"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Params },
) {
  const { id } = await params;
  const { workspace } = await requireCurrentAdminContext();

  const template = await prisma.contractTemplate.findFirst({
    where: { id, workspaceId: workspace.id },
    include: {
      fields: { orderBy: [{ page: "asc" }, { sortOrder: "asc" }] },
      recipients: { orderBy: { signingOrder: "asc" } },
      envelopes: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { recipients: { orderBy: { signingOrder: "asc" } } },
      },
    },
  });
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ template });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Params },
) {
  const { id } = await params;
  const { workspace } = await requireCurrentAdminContext();

  const template = await prisma.contractTemplate.findFirst({
    where: { id, workspaceId: workspace.id },
    select: {
      id: true,
      pageCount: true,
      name: true,
      sourceType: true,
      workspaceId: true,
      pdfPathname: true,
      fields: {
        select: {
          id: true,
          type: true,
          // What each field holds. ContractFieldValue cascades off its
          // field, so deleting a field deletes what was signed into it.
          _count: { select: { values: true } },
        },
      },
    },
  });
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const fields = Array.isArray(body?.fields) ? (body.fields as Array<{ id?: unknown; type?: unknown }>) : null;
  const plan = fields
    ? planFieldEdit(
        template.fields.map((field) => ({ id: field.id, type: field.type, valueCount: field._count.values })),
        fields,
      )
    : null;
  if (plan && !plan.ok) {
    return NextResponse.json(
      {
        error:
          plan.reason === "would_delete_signed_fields"
            ? `不能删除已经有人填写或签署的字段（共 ${plan.valueCount} 处内容）。可以移动、改大小、改名，或新增字段。`
            : `不能修改已经有人填写或签署的字段的类型（共 ${plan.valueCount} 处内容）。`,
        reason: plan.reason,
        valueCount: plan.valueCount,
        fieldIds: plan.fieldIds,
      },
      { status: 409 },
    );
  }
  const recipients = Array.isArray(body?.recipients) ? parseTemplateRecipients(body.recipients) : null;
  const updateData: {
    name?: string;
    description?: string | null;
    active?: boolean;
    editableContent?: string | null;
    pdfUrl?: string;
    pdfPathname?: string;
    pdfFilename?: string;
    pdfContentType?: string;
    pdfSize?: number;
    pageCount?: number;
    pageSizes?: Prisma.InputJsonValue;
    sourceType?: string;
    sourceUrl?: string;
    sourcePathname?: string;
    sourceFilename?: string | null;
    sourceContentType?: string | null;
    sourceSize?: number | null;
  } = {};
  const baseUrl = getPublicBase(req);

  if (typeof body?.name === "string" && body.name.trim()) {
    updateData.name = body.name.trim();
  }
  if (typeof body?.description === "string") {
    updateData.description = body.description.trim() || null;
  }
  if (typeof body?.active === "boolean") updateData.active = body.active;

  // Anything that replaces the document waits for envelopes out for
  // signature: they render onto this template's PDF when they complete.
  const replacesDocument =
    (template.sourceType === "WORD" && typeof body?.editableContent === "string") ||
    (body?.appendDocument != null && typeof body.appendDocument === "object");
  if (replacesDocument) {
    const inFlight = await prisma.contractEnvelope.count({
      where: { templateId: id, status: { in: [...DOCUMENT_EDIT_BLOCKING_STATUSES] } },
    });
    if (inFlight > 0) {
      return NextResponse.json(
        {
          error: `有 ${inFlight} 份用这个模板发出的合同还在等待签署，现在改正文会让签名落在对方没看过的文件上。请等签完或先作废，再修改。`,
          reason: "envelopes_in_flight",
          count: inFlight,
        },
        { status: 409 },
      );
    }
  }

  if (template.sourceType === "WORD" && typeof body?.editableContent === "string") {
    const nextName = updateData.name || template.name;
    const editableContent = normalizeEditableContent(body.editableContent);
    const rendered = await renderEditableContractPdf({
      title: nextName,
      content: editableContent || nextName,
    });
    const pdf = await uploadGeneratedTemplatePdf({
      templateId: template.id,
      title: nextName,
      buffer: rendered.buffer,
      baseUrl,
    });
    updateData.editableContent = editableContent;
    updateData.pdfUrl = pdf.url;
    updateData.pdfPathname = pdf.pathname;
    updateData.pdfFilename = `${nextName}.pdf`;
    updateData.pdfContentType = "application/pdf";
    updateData.pdfSize = rendered.buffer.length;
    updateData.pageCount = Math.max(1, rendered.pageSizes.length);
    updateData.pageSizes = rendered.pageSizes;
  }

  let appendDocument;
  try {
    appendDocument = parseAppendDocument(body?.appendDocument, workspace.id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid appended document." },
      { status: 400 },
    );
  }
  if (appendDocument) {
    const existingBytes = await fetchDocumentBytes(template.pdfPathname);
    const appended = await renderUploadedContractDocumentPdf({
      sourceType: appendDocument.sourceType,
      sourcePathname: appendDocument.sourcePathname,
      title: appendDocument.sourceFilename || `${template.name} attachment`,
    });
    const merged = await mergeContractPdfBuffers([existingBytes, appended.buffer]);
    const pdf = await uploadGeneratedTemplatePdf({
      templateId: template.id,
      title: `${template.name}-merged`,
      buffer: merged.buffer,
      baseUrl,
    });
    updateData.pdfUrl = pdf.url;
    updateData.pdfPathname = pdf.pathname;
    updateData.pdfFilename = `${template.name}.pdf`;
    updateData.pdfContentType = "application/pdf";
    updateData.pdfSize = merged.buffer.length;
    updateData.pageCount = Math.max(1, merged.pageSizes.length);
    updateData.pageSizes = merged.pageSizes;
    updateData.sourceType = "PDF";
    updateData.sourceUrl = pdf.url;
    updateData.sourcePathname = pdf.pathname;
    updateData.sourceFilename = `${template.name}.pdf`;
    updateData.sourceContentType = "application/pdf";
    updateData.sourceSize = merged.buffer.length;
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      if (fields && plan?.ok) {
        // In place, by id: a value follows its field through a move or a
        // resize. Only fields holding nothing are ever deleted.
        const pageCount = updateData.pageCount || template.pageCount;
        const updateIds = new Set(plan.updateIds);
        if (plan.deleteIds.length) {
          await tx.contractTemplateField.deleteMany({ where: { templateId: id, id: { in: plan.deleteIds } } });
        }
        for (const [index, field] of fields.entries()) {
          const data = normalizeField(field, id, pageCount, index);
          if (typeof field.id === "string" && updateIds.has(field.id)) {
            await tx.contractTemplateField.update({ where: { id: field.id }, data });
          } else {
            await tx.contractTemplateField.create({ data });
          }
        }
      }
      if (recipients) {
        await tx.contractTemplateRecipient.deleteMany({ where: { templateId: id } });
        if (recipients.length) {
          await tx.contractTemplateRecipient.createMany({
            data: recipients.map((recipient, index) => ({
              templateId: id,
              name: recipient.name,
              email: recipient.email,
              signingOrder: index + 1,
            })),
          });
        }
      }
      return tx.contractTemplate.update({
        where: { id },
        data: updateData,
        include: {
          fields: { orderBy: [{ page: "asc" }, { sortOrder: "asc" }] },
          recipients: { orderBy: { signingOrder: "asc" } },
        },
      });
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save template." },
      { status: 500 },
    );
  }

  return NextResponse.json({ template: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Params },
) {
  const { id } = await params;
  const { workspace } = await requireCurrentAdminContext();

  const template = await prisma.contractTemplate.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { id: true },
  });
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.contractTemplate.update({
    where: { id },
    data: { active: false },
  });

  return NextResponse.json({ ok: true });
}

function getPublicBase(req: NextRequest) {
  const origin = req.headers.get("origin") || new URL(req.url).origin;
  return (process.env.APP_URL || origin).replace(/\/$/, "");
}

function normalizeField(
  value: unknown,
  templateId: string,
  pageCount: number,
  index: number,
) {
  const record = typeof value === "object" && value ? value as Record<string, unknown> : {};
  const type = typeof record.type === "string" && FIELD_TYPES.has(record.type)
    ? record.type
    : "TEXT";
  const label = typeof record.label === "string" && record.label.trim()
    ? record.label.trim()
    : `${type} ${index + 1}`;
  const page = clampInt(record.page, 1, pageCount);
  return {
    templateId,
    type: type as "SIGNATURE" | "TEXT" | "DATE" | "CHECKBOX" | "REDACTION",
    label,
    required: type === "REDACTION" || type === "CHECKBOX" ? false : record.required !== false,
    recipientIndex: type === "REDACTION" ? null : toOptionalPositiveInt(record.recipientIndex) ?? 1,
    page,
    x: clampNumber(record.x, 0, 0.98),
    y: clampNumber(record.y, 0, 0.98),
    width: clampNumber(record.width, 0.02, 1),
    height: clampNumber(record.height, 0.02, 1),
    placeholder: clean(record.placeholder),
    defaultValue: clean(record.defaultValue),
    fontSize: toOptionalNumber(record.fontSize),
    sortOrder: index,
  };
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseTemplateRecipients(value: unknown[]) {
  return value
    .map((item) => {
      const record = typeof item === "object" && item ? item as Record<string, unknown> : {};
      return {
        name: clean(record.name) || "",
        email: clean(record.email) || "",
      };
    })
    .filter((item) => item.name && isEmail(item.email))
    .slice(0, 20);
}

function parseAppendDocument(value: unknown, workspaceId: string) {
  const record = typeof value === "object" && value ? value as Record<string, unknown> : null;
  if (!record) return null;
  const sourceType = clean(record.sourceType) === "WORD" ? "WORD" : "PDF";
  const sourcePathname = clean(record.sourcePathname);
  if (!sourcePathname) return null;
  // Assert containment on the *resolved* path. The previous raw-string
  // prefix test could be satisfied by a pathname whose `../` segments
  // walk into another workspace's sources directory, which this route
  // would then merge into the caller's own template PDF.
  resolveUploadPathWithin(sourcePathname, `contracts/templates/${workspaceId}/sources`);
  return {
    sourceType: sourceType as "PDF" | "WORD",
    sourcePathname,
    sourceFilename: clean(record.sourceFilename),
    sourceContentType: clean(record.sourceContentType),
    sourceSize: toOptionalNumber(record.sourceSize),
  };
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function toOptionalPositiveInt(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toOptionalNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clampInt(value: unknown, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value: unknown, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}
