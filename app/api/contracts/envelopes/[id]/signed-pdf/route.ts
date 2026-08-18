import { readFile, stat } from "fs/promises";
import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { getCurrentAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

/**
 * Compare two tokens without leaking length/prefix information through
 * timing. `timingSafeEqual` throws on unequal byte lengths, so guard on
 * that first — and compare as utf8 bytes, not string length, since a
 * multibyte character makes those two differ.
 */
function tokensMatch(supplied: string, expected: string) {
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Serves the signed contract PDF.
 *
 * Two callers are legitimate, and both are authenticated:
 *
 *  1. An admin of the workspace that owns the envelope, reading it from
 *     the contracts UI.
 *  2. A signer following the download link in their completion email.
 *     That link carries `?token=<ContractRecipient.token>` — a 192-bit
 *     random value already used to gate the signing page itself.
 *
 * Before v0.23.1 this route had no authentication of any kind: any
 * caller holding an envelope id could download a completed contract
 * including renter name and signature images, and the response was
 * marked `Cache-Control: public` so shared proxies could retain it.
 * Envelope ids are not secrets — they appear in API responses, in the
 * admin UI, and inside `OrderAttachment.url`.
 *
 * Voided envelopes are already excluded: voiding sets `status` to
 * VOIDED, so the `status: "COMPLETED"` filter stops matching.
 */
export async function GET(request: NextRequest, { params }: { params: Params }) {
  const { id } = await params;

  const envelope = await prisma.contractEnvelope.findFirst({
    where: { id, status: "COMPLETED" },
    select: {
      title: true,
      workspaceId: true,
      signedPdfPathname: true,
      signedPdfFilename: true,
      signedPdfContentType: true,
      recipients: { select: { token: true } },
    },
  });
  if (!envelope?.signedPdfPathname) {
    return NextResponse.json({ error: "SIGNED_PDF_NOT_FOUND" }, { status: 404 });
  }

  const suppliedToken = request.nextUrl.searchParams.get("token")?.trim() || "";
  const isRecipient =
    suppliedToken.length > 0 &&
    envelope.recipients.some((recipient) => tokensMatch(suppliedToken, recipient.token));

  let authorized = isRecipient;
  if (!authorized) {
    const user = await getCurrentAdminUser();
    authorized = Boolean(
      user?.workspaceId && envelope.workspaceId && user.workspaceId === envelope.workspaceId,
    );
  }

  if (!authorized) {
    // Same shape as the not-found response so an unauthorized caller
    // can't use this endpoint to test whether an envelope id exists.
    return NextResponse.json({ error: "SIGNED_PDF_NOT_FOUND" }, { status: 404 });
  }

  const absolutePath = resolveUploadPath(envelope.signedPdfPathname);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }

  const file = await readFile(absolutePath);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": envelope.signedPdfContentType || "application/pdf",
      "Content-Length": String(file.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(envelope.signedPdfFilename || `${envelope.title} - signed.pdf`)}"`,
      // Never `public`: this document contains renter PII and signature
      // images, and must not be retained by a shared proxy or CDN.
      "Cache-Control": "private, no-store",
    },
  });
}
