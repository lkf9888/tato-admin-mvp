import { NextResponse } from "next/server";

import { getCurrentAdminUser } from "@/lib/auth";
import { sendFeedbackEmail, type EmailAttachment } from "@/lib/email";
import { logActivity } from "@/lib/orders";

// Per-file and total caps. Resend tops out around 40MB for the whole
// JSON body after base64 encoding (which inflates raw bytes by ~33%),
// so the practical raw ceiling is ~28MB total. We give the user a
// little headroom under that — 25MB total / 10MB per file is enough
// for a few screenshots or a short screen recording.
const MAX_FILES = 5;
const MAX_BYTES_PER_FILE = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

// Whitelist the file types we expect from a feedback flow. Anything
// else gets rejected so we can't be used as a generic file relay. The
// UI's accept attribute mirrors this list.
const ALLOWED_PREFIXES = ["image/", "video/"];
const ALLOWED_EXACT = new Set([
  "application/pdf",
  "text/plain",
  "application/json",
]);

function isAllowedType(type: string) {
  if (ALLOWED_PREFIXES.some((prefix) => type.startsWith(prefix))) return true;
  return ALLOWED_EXACT.has(type);
}

export async function POST(request: Request) {
  const user = await getCurrentAdminUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "INVALID_FORM" }, { status: 400 });
  }

  const message = formData.get("message")?.toString().trim() ?? "";
  if (message.length < 5) {
    return NextResponse.json({ error: "MESSAGE_TOO_SHORT" }, { status: 400 });
  }
  if (message.length > 5000) {
    return NextResponse.json({ error: "MESSAGE_TOO_LONG" }, { status: 400 });
  }

  // FormData.getAll returns FormDataEntryValue[] (string | File). We
  // only want File entries here.
  const rawAttachments = formData.getAll("attachments");
  const files = rawAttachments.filter((entry): entry is File => entry instanceof File);

  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: "TOO_MANY_FILES", maxFiles: MAX_FILES },
      { status: 400 },
    );
  }

  let totalBytes = 0;
  for (const file of files) {
    if (file.size > MAX_BYTES_PER_FILE) {
      return NextResponse.json(
        {
          error: "FILE_TOO_LARGE",
          filename: file.name,
          maxBytes: MAX_BYTES_PER_FILE,
        },
        { status: 413 },
      );
    }
    if (!isAllowedType(file.type)) {
      return NextResponse.json(
        { error: "FILE_TYPE_NOT_ALLOWED", filename: file.name, type: file.type },
        { status: 400 },
      );
    }
    totalBytes += file.size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      { error: "TOTAL_TOO_LARGE", maxBytes: MAX_TOTAL_BYTES, totalBytes },
      { status: 413 },
    );
  }

  // Convert each File to a Resend attachment. We do this server-side
  // (rather than on the client) so the client only uploads the raw
  // bytes once via multipart — base64 happens here, in Node, where
  // the JSON envelope is built anyway.
  const attachments: EmailAttachment[] = await Promise.all(
    files.map(async (file) => {
      const buffer = Buffer.from(await file.arrayBuffer());
      return {
        filename: file.name,
        content: buffer.toString("base64"),
        contentType: file.type || "application/octet-stream",
      };
    }),
  );

  // Lightweight context dump — useful for triage without privacy
  // implications. We capture URL, locale cookie, and user agent
  // because those answer 80% of "why doesn't it work for them" on
  // the first look. Anything more would need explicit consent.
  const url = formData.get("url")?.toString().trim() ?? "";
  const locale = formData.get("locale")?.toString().trim() ?? "";
  const userAgent =
    request.headers.get("user-agent")?.slice(0, 300) ?? "";
  const appVersion = formData.get("appVersion")?.toString().trim() ?? "";

  const result = await sendFeedbackEmail({
    fromName: user.name,
    fromEmail: user.email,
    message,
    attachments,
    context: {
      "Workspace ID": user.workspaceId ?? undefined,
      "Page URL": url || undefined,
      Locale: locale || undefined,
      "App version": appVersion || undefined,
      "User agent": userAgent || undefined,
    },
  });

  if (!result.ok) {
    if (result.reason === "feedback_recipient_not_configured") {
      return NextResponse.json(
        { error: "FEEDBACK_NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    if (result.reason === "smtp_not_configured") {
      return NextResponse.json(
        { error: "SMTP_NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "SEND_FAILED", reason: result.reason },
      { status: 502 },
    );
  }

  // Audit trail — the operator sees this in the activity log too,
  // so a feedback submission is never silently dropped. We record
  // attachment count but not file contents.
  await logActivity({
    workspaceId: user.workspaceId ?? null,
    actor: user.name,
    action: "feedback_submitted",
    entityType: "User",
    entityId: user.id,
    metadata: {
      attachmentCount: files.length,
      totalBytes,
      messageLength: message.length,
    },
  });

  return NextResponse.json({ ok: true });
}
