import "server-only";

import { sendMail } from "@/lib/email";

type ContractSigningEmailInput = {
  to: string;
  recipientName: string;
  contractTitle: string;
  senderName: string | null;
  signingUrl: string;
  message?: string | null;
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
};

export type ContractEmailResult =
  | { ok: true; status: "sent" }
  | { ok: false; status: "not_configured" | "failed"; error?: string };

export async function sendContractSigningEmail(
  input: ContractSigningEmailInput,
): Promise<ContractEmailResult> {
  const subject = `[TATO] 请签署电子合约：${input.contractTitle}`;
  const text = [
    `${input.recipientName}，您好：`,
    "",
    "您收到一份需要查看并签署的 TATO 电子合约。",
    input.senderName ? `发送人：${input.senderName}` : null,
    "",
    input.message || null,
    "",
    `合约：${input.contractTitle}`,
    `签署链接：${input.signingUrl}`,
    "",
    "这个签署链接只属于您本人，请不要转发。",
    "TATO",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f6f6f6;padding:24px;font-family:Arial,sans-serif;color:#111827;">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="padding:28px;border-bottom:1px solid #e5e7eb;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#111827;">TATO eSignature</div>
        <p style="margin:12px 0 0;color:#4b5563;line-height:1.6;">${escapeHtml(input.recipientName)}，您好，您收到一份需要查看并签署的电子合约。</p>
      </div>
      <div style="padding:28px;">
        <p style="margin:0 0 10px;color:#4b5563;">合约</p>
        <p style="margin:0 0 20px;font-size:18px;font-weight:700;">${escapeHtml(input.contractTitle)}</p>
        ${input.message ? `<div style="margin:0 0 20px;padding:14px;border-radius:8px;background:#f9fafb;color:#374151;line-height:1.5;">${escapeHtml(input.message)}</div>` : ""}
        <a href="${escapeHtml(input.signingUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;padding:16px 24px;font-size:22px;line-height:1.15;font-weight:800;">查看并签署</a>
        <p style="margin:18px 0 0;color:#6b7280;font-size:13px;line-height:1.5;">这个安全签署链接只属于您本人，请不要转发。</p>
      </div>
    </div>
  </body>
</html>`;

  return toContractResult(
    await sendMail({ to: input.to, subject, text, html, timeoutMs: 30_000 }),
  );
}

export async function sendContractCompletedEmail(
  input: ContractCompletedEmailInput,
): Promise<ContractEmailResult> {
  const subject = `[TATO] 电子合约已完成：${input.contractTitle}`;
  const text = [
    `${input.recipientName}，您好：`,
    "",
    "这份电子合约已经完成签署。",
    "",
    `合约：${input.contractTitle}`,
    `已签署 PDF：${input.signedPdfUrl}`,
    "",
    "TATO",
  ].join("\n");
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f6f6f6;padding:24px;font-family:Arial,sans-serif;color:#111827;">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="padding:28px;border-bottom:1px solid #e5e7eb;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#111827;">TATO eSignature</div>
        <h1 style="font-size:24px;line-height:1.25;margin:12px 0 0;">电子合约已完成</h1>
      </div>
      <div style="padding:28px;">
        <p style="margin:0 0 20px;font-size:18px;font-weight:700;">${escapeHtml(input.contractTitle)}</p>
        <a href="${escapeHtml(input.signedPdfUrl)}" style="display:inline-block;background:#111827;color:white;text-decoration:none;border-radius:6px;padding:13px 18px;font-weight:700;">下载已签署 PDF</a>
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
