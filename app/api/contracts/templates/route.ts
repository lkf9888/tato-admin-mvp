import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import {
  extractDocxPlainText,
  fetchDocumentBytes,
  normalizeEditableContent,
  renderEditableContractPdf,
  renderUploadedContractDocumentPdf,
  uploadGeneratedTemplatePdf,
} from "@/lib/contract-documents";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const { workspace } = await requireCurrentAdminContext();

  const templates = await prisma.contractTemplate.findMany({
    where: { workspaceId: workspace.id, active: true },
    orderBy: { createdAt: "desc" },
    include: {
      fields: { orderBy: [{ page: "asc" }, { sortOrder: "asc" }] },
      recipients: { orderBy: { signingOrder: "asc" } },
    },
  });

  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const { workspace } = await requireCurrentAdminContext();
  const body = await req.json().catch(() => null);
  const name = clean(body?.name);
  const sourceType = clean(body?.sourceType) === "WORD" ? "WORD" : "PDF";
  const sourcePathname = clean(body?.sourcePathname) || clean(body?.pdfPathname);
  const sourceUrl = clean(body?.sourceUrl) || clean(body?.pdfUrl);
  const recipients = parseTemplateRecipients(body?.recipients);

  if (!name || !sourcePathname) {
    return NextResponse.json(
      { error: "Template name and uploaded file are required." },
      { status: 400 },
    );
  }
  if (!sourcePathname.startsWith(`contracts/templates/${workspace.id}/sources/`)) {
    return NextResponse.json({ error: "Invalid template pathname." }, { status: 400 });
  }

  const templateId = randomUUID();
  const baseUrl = getPublicBase(req);
  let editableContent: string | null = null;
  let rendered;

  if (sourceType === "WORD") {
    const docxBytes = await fetchDocumentBytes(sourcePathname);
    editableContent = normalizeEditableContent(
      rawString(body?.editableContent) || (await extractDocxPlainText(docxBytes)) || name,
    );
    rendered = await renderEditableContractPdf({ title: name, content: editableContent });
  } else {
    rendered = await renderUploadedContractDocumentPdf({
      sourceType: "PDF",
      sourcePathname,
      title: name,
    });
  }

  const pdf = await uploadGeneratedTemplatePdf({
    templateId,
    title: name,
    buffer: rendered.buffer,
    baseUrl,
  });

  const template = await prisma.contractTemplate.create({
    data: {
      id: templateId,
      workspaceId: workspace.id,
      name,
      description: clean(body?.description),
      pdfUrl: pdf.url,
      pdfPathname: pdf.pathname,
      pdfFilename: `${name}.pdf`,
      pdfContentType: "application/pdf",
      pdfSize: rendered.buffer.length,
      sourceType,
      sourceUrl,
      sourcePathname,
      sourceFilename: clean(body?.sourceFilename) || clean(body?.pdfFilename),
      sourceContentType: clean(body?.sourceContentType) || clean(body?.pdfContentType),
      sourceSize: toInt(body?.sourceSize) ?? toInt(body?.pdfSize),
      editableContent,
      pageCount: Math.max(1, rendered.pageSizes.length),
      pageSizes: rendered.pageSizes,
      recipients: recipients.length
        ? {
            create: recipients.map((recipient, index) => ({
              name: recipient.name,
              email: recipient.email,
              signingOrder: index + 1,
            })),
          }
        : undefined,
    },
    include: {
      fields: true,
      recipients: { orderBy: { signingOrder: "asc" } },
    },
  });

  return NextResponse.json({ template });
}

function getPublicBase(req: NextRequest) {
  const origin = req.headers.get("origin") || new URL(req.url).origin;
  return (process.env.APP_URL || origin).replace(/\/$/, "");
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rawString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function parseTemplateRecipients(value: unknown) {
  if (!Array.isArray(value)) return [];
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

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function toInt(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
