import "server-only";

import { sendMail } from "@/lib/email";

type ContractSigningEmailInput = {
  to: string;
  recipientName: string;
  contractTitle: string;
  senderName: string | null;
  signingUrl: string;
  message?: string | null;
  /**
   * Whose name this arrives under. Defaults to TATO, which is right
   * when an operator sends a contract from the admin app. A renter who
   * booked on the operator's own domain must not find our name on the
   * agreement instead of theirs, so that path passes its own brand.
   */
  brandName?: string | null;
  /** The operator's own sender, when they have one (`lib/site-sender`). */
  from?: string | null;
};

type ContractCompletedEmailInput = {
  to: string;
  recipientName: string;
  contractTitle: string;
  signedPdfUrl: string;
  signedPdfAttachment?: {
    filename: string;
    content: Buffer;
    contentType: string;
  };
  /** As for the signing email: whose name and address it arrives under. */
  brandName?: string | null;
  from?: string | null;
};

export type ContractEmailResult =
  | { ok: true; status: "sent" }
  | { ok: false; status: "not_configured" | "failed"; error?: string };

export async function sendContractSigningEmail(
  input: ContractSigningEmailInput,
): Promise<ContractEmailResult> {
  const brand = input.brandName?.trim() || "TATO";
  // English first, Chinese below: renters here read either, and an
  // agreement they cannot read is not one they can be held to.
  const subject = `[${brand}] Please sign: ${input.contractTitle} / 请签署电子合约`;
  const text = [
    `Hi ${input.recipientName},`,
    "",
    `${brand} has sent you an agreement to review and sign.`,
    input.senderName ? `From: ${input.senderName}` : null,
    "",
    input.message || null,
    "",
    `Agreement: ${input.contractTitle}`,
    `Sign here: ${input.signingUrl}`,
    "",
    "This signing link is yours alone; please do not forward it.",
    "",
    `${input.recipientName}，您好：您收到一份需要查看并签署的${brand}电子合约，请点击上面的链接签署。这个链接只属于您本人，请不要转发。`,
    "",
    brand,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f6f6f6;padding:24px;font-family:Arial,sans-serif;color:#111827;">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="padding:28px;border-bottom:1px solid #e5e7eb;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#111827;">${brand} eSignature</div>
        <p style="margin:12px 0 0;color:#4b5563;line-height:1.6;">Hi ${escapeHtml(input.recipientName)}, you have an agreement to review and sign.</p>
        <p style="margin:6px 0 0;color:#6b7280;line-height:1.6;font-size:13px;">${escapeHtml(input.recipientName)}，您好，您收到一份需要查看并签署的电子合约。</p>
      </div>
      <div style="padding:28px;">
        <p style="margin:0 0 10px;color:#4b5563;">Agreement / 合约</p>
        <p style="margin:0 0 20px;font-size:18px;font-weight:700;">${escapeHtml(input.contractTitle)}</p>
        ${input.message ? `<div style="margin:0 0 20px;padding:14px;border-radius:8px;background:#f9fafb;color:#374151;line-height:1.5;">${escapeHtml(input.message)}</div>` : ""}
        <a href="${escapeHtml(input.signingUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;padding:16px 24px;font-size:22px;line-height:1.15;font-weight:800;">Review and sign / 查看并签署</a>
        <p style="margin:18px 0 0;color:#6b7280;font-size:13px;line-height:1.5;">This secure link is yours alone; please do not forward it. 这个安全签署链接只属于您本人，请不要转发。</p>
      </div>
    </div>
  </body>
</html>`;

  return toContractResult(
    await sendMail({
      to: input.to,
      subject,
      text,
      html,
      from: input.from ?? undefined,
      timeoutMs: 30_000,
    }),
  );
}

export async function sendContractCompletedEmail(
  input: ContractCompletedEmailInput,
): Promise<ContractEmailResult> {
  const brand = input.brandName?.trim() || "TATO";
  const subject = `[${brand}] Signed: ${input.contractTitle} / 电子合约已完成`;
  const text = [
    `Hi ${input.recipientName},`,
    "",
    "The agreement has been signed. Your copy is attached, and you can also download it here:",
    input.signedPdfUrl,
    "",
    `Agreement: ${input.contractTitle}`,
    "",
    `${input.recipientName}，您好：这份电子合约已经完成签署，已签署的 PDF 在附件里，也可以从上面的链接下载。`,
    "",
    brand,
  ].join("\n");
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f6f6f6;padding:24px;font-family:Arial,sans-serif;color:#111827;">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="padding:28px;border-bottom:1px solid #e5e7eb;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#111827;">${escapeHtml(brand)} eSignature</div>
        <h1 style="font-size:24px;line-height:1.25;margin:12px 0 0;">Agreement signed</h1>
        <p style="margin:6px 0 0;color:#6b7280;font-size:13px;">电子合约已完成签署</p>
      </div>
      <div style="padding:28px;">
        <p style="margin:0 0 20px;font-size:18px;font-weight:700;">${escapeHtml(input.contractTitle)}</p>
        <a href="${escapeHtml(input.signedPdfUrl)}" style="display:inline-block;background:#111827;color:white;text-decoration:none;border-radius:6px;padding:13px 18px;font-weight:700;">Download the signed PDF / 下载已签署 PDF</a>
        <p style="margin:16px 0 0;color:#6b7280;font-size:13px;line-height:1.5;">Your copy is also attached to this email. 已签署的合约也在附件里。</p>
      </div>
    </div>
  </body>
</html>`;

  return toContractResult(
    await sendMail({
      to: input.to,
      subject,
      text,
      html,
      from: input.from ?? undefined,
      attachments: input.signedPdfAttachment
        ? [
            {
              filename: input.signedPdfAttachment.filename,
              content: input.signedPdfAttachment.content.toString("base64"),
              contentType: input.signedPdfAttachment.contentType,
            },
          ]
        : undefined,
      timeoutMs: 60_000,
    }),
  );
}

function toContractResult(result: { ok: boolean; reason?: string }): ContractEmailResult {
  if (result.ok) return { ok: true, status: "sent" };
  if (result.reason === "smtp_not_configured") {
    return { ok: false, status: "not_configured", error: result.reason };
  }
  return { ok: false, status: "failed", error: result.reason };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
