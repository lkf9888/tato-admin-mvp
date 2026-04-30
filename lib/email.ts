import "server-only";

import type { Locale } from "@/lib/i18n";

type ResendConfig = {
  apiKey: string;
  from: string;
};

function getResendConfig(): ResendConfig | null {
  // We send via Resend's HTTPS API (https://api.resend.com/emails) instead of
  // SMTP. The SMTP path (smtp.resend.com:587) was timing out on Railway —
  // some egress paths can't hold a TCP session to port 587 reliably, while
  // outbound HTTPS:443 is unblocked everywhere. Resend also officially
  // recommends the HTTP API.
  //
  // Env-var reuse: SMTP_PASSWORD already holds the Resend API key in the
  // existing Railway setup, and SMTP_FROM already holds the sender address.
  // We accept dedicated RESEND_API_KEY / RESEND_FROM if they're set, but
  // fall back to the SMTP_* names so the deployment doesn't have to be
  // reconfigured.
  const apiKey = (process.env.RESEND_API_KEY || process.env.SMTP_PASSWORD || "").trim();
  const from = (process.env.RESEND_FROM || process.env.SMTP_FROM || "").trim();
  if (!apiKey || !from) {
    return null;
  }
  return { apiKey, from };
}

export function isEmailConfigured(): boolean {
  return getResendConfig() !== null;
}

export type EmailAttachment = {
  /** Display name in the recipient's inbox. Pass the original upload
   *  filename when you want it preserved. */
  filename: string;
  /** Base64-encoded file content. Use `Buffer.from(arrayBuffer).toString("base64")`
   *  on the server side. Resend caps the per-email payload at ~40MB after
   *  base64 expansion, so callers should enforce a raw byte limit closer
   *  to ~25-30MB before reaching this layer. */
  content: string;
  /** Optional MIME type. Resend will sniff if omitted, but explicit is
   *  cheaper and keeps Outlook from showing it as `application/octet-stream`. */
  contentType?: string;
};

type SendInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Optional Reply-To header. Useful for feedback flows where the
   *  envelope sender (`from`) is the platform domain but the user
   *  hitting "Reply" should be talking to the original requester. */
  replyTo?: string;
  /** Optional file attachments. Caller is responsible for total size. */
  attachments?: EmailAttachment[];
  /** Override the timeout. Feedback sends with ~25MB attachments need
   *  longer than the 15s used by the verification flow. */
  timeoutMs?: number;
};

async function sendMail(input: SendInput): Promise<{ ok: boolean; reason?: string }> {
  const config = getResendConfig();
  if (!config) {
    // Dev / unconfigured fallback: log the message so the verification flow
    // remains testable without a Resend account. This is the only place we
    // ever print verification codes; production deployments must set
    // RESEND_API_KEY (or SMTP_PASSWORD) and SMTP_FROM.
    // eslint-disable-next-line no-console
    console.log(
      `[email] Resend not configured. Would have sent to ${input.to} :: ${input.subject}\n${input.text}`,
    );
    return { ok: false, reason: "smtp_not_configured" };
  }

  const timeoutMs = input.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.attachments && input.attachments.length > 0
          ? { attachments: input.attachments }
          : {}),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.error(
        `[email] Resend API error :: status=${res.status} :: to=${input.to} :: from=${config.from} :: body=${body.slice(0, 500)}`,
      );
      return { ok: false, reason: `resend_${res.status}` };
    }

    const json = (await res.json().catch(() => ({}))) as { id?: string };
    // eslint-disable-next-line no-console
    console.log(
      `[email] sent ok :: to=${input.to} :: id=${json.id ?? "?"}`,
    );
    return { ok: true };
  } catch (error) {
    clearTimeout(timeoutId);
    const reason =
      error instanceof Error
        ? error.name === "AbortError"
          ? `timeout_${Math.round((input.timeoutMs ?? 15_000) / 1000)}s`
          : error.message
        : "send_failed";
    // eslint-disable-next-line no-console
    console.error(
      `[email] send failed :: to=${input.to} :: from=${config.from} :: reason=${reason}`,
    );
    return { ok: false, reason };
  }
}

function buildVerificationCopy(code: string, locale: Locale) {
  if (locale === "zh") {
    return {
      subject: `TATO 注册验证码：${code}`,
      text: [
        `你正在注册 TATO 账户。`,
        ``,
        `验证码：${code}`,
        ``,
        `验证码 10 分钟内有效。`,
        `如果不是你本人操作，请忽略这封邮件。`,
        ``,
        `— TATO`,
      ].join("\n"),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #111318;">
          <p style="font-size: 11px; letter-spacing: 0.34em; text-transform: uppercase; color: #6b6f78; margin: 0 0 8px;">TATO</p>
          <h1 style="font-size: 24px; font-weight: 600; margin: 0 0 16px;">注册验证码</h1>
          <p style="font-size: 14px; line-height: 22px; color: #3a3d44; margin: 0 0 24px;">你正在注册 TATO 账户。请在注册页面输入下方 6 位验证码以完成验证。</p>
          <div style="background: #f4f4f6; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
            <p style="font-family: 'SF Mono', Menlo, monospace; font-size: 32px; letter-spacing: 12px; font-weight: 600; margin: 0; color: #111318;">${code}</p>
          </div>
          <p style="font-size: 13px; line-height: 20px; color: #6b6f78; margin: 0 0 8px;">验证码 10 分钟内有效。</p>
          <p style="font-size: 13px; line-height: 20px; color: #6b6f78; margin: 0;">如果不是你本人操作，请忽略这封邮件。</p>
        </div>
      `,
    };
  }

  return {
    subject: `Your TATO verification code: ${code}`,
    text: [
      `You're signing up for a TATO account.`,
      ``,
      `Verification code: ${code}`,
      ``,
      `This code is valid for 10 minutes.`,
      `If you didn't request this, you can safely ignore this email.`,
      ``,
      `— TATO`,
    ].join("\n"),
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #111318;">
        <p style="font-size: 11px; letter-spacing: 0.34em; text-transform: uppercase; color: #6b6f78; margin: 0 0 8px;">TATO</p>
        <h1 style="font-size: 24px; font-weight: 600; margin: 0 0 16px;">Verification code</h1>
        <p style="font-size: 14px; line-height: 22px; color: #3a3d44; margin: 0 0 24px;">You're signing up for a TATO account. Enter the 6-digit code below on the signup page to verify your email.</p>
        <div style="background: #f4f4f6; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <p style="font-family: 'SF Mono', Menlo, monospace; font-size: 32px; letter-spacing: 12px; font-weight: 600; margin: 0; color: #111318;">${code}</p>
        </div>
        <p style="font-size: 13px; line-height: 20px; color: #6b6f78; margin: 0 0 8px;">This code is valid for 10 minutes.</p>
        <p style="font-size: 13px; line-height: 20px; color: #6b6f78; margin: 0;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  };
}

export async function sendVerificationEmail(input: {
  to: string;
  code: string;
  locale: Locale;
}): Promise<{ ok: boolean; reason?: string }> {
  const copy = buildVerificationCopy(input.code, input.locale);
  return sendMail({ to: input.to, ...copy });
}

function buildPasswordResetCopy(code: string, locale: Locale) {
  if (locale === "zh") {
    return {
      subject: `TATO 密码重置验证码：${code}`,
      text: [
        `你正在重置 TATO 后台账户的密码。`,
        ``,
        `验证码：${code}`,
        ``,
        `验证码 10 分钟内有效。`,
        `如果不是你本人操作，请忽略这封邮件，你的账户安全不会受到影响。`,
        ``,
        `— TATO`,
      ].join("\n"),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #111318;">
          <p style="font-size: 11px; letter-spacing: 0.34em; text-transform: uppercase; color: #6b6f78; margin: 0 0 8px;">TATO</p>
          <h1 style="font-size: 24px; font-weight: 600; margin: 0 0 16px;">密码重置验证码</h1>
          <p style="font-size: 14px; line-height: 22px; color: #3a3d44; margin: 0 0 24px;">你正在重置 TATO 后台账户的密码。请在重置页面输入下方 6 位验证码继续。</p>
          <div style="background: #f4f4f6; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
            <p style="font-family: 'SF Mono', Menlo, monospace; font-size: 32px; letter-spacing: 12px; font-weight: 600; margin: 0; color: #111318;">${code}</p>
          </div>
          <p style="font-size: 13px; line-height: 20px; color: #6b6f78; margin: 0 0 8px;">验证码 10 分钟内有效。</p>
          <p style="font-size: 13px; line-height: 20px; color: #6b6f78; margin: 0;">如果不是你本人操作，请忽略这封邮件，你的账户安全不会受到影响。</p>
        </div>
      `,
    };
  }

  return {
    subject: `Your TATO password reset code: ${code}`,
    text: [
      `You're resetting the password for your TATO admin account.`,
      ``,
      `Reset code: ${code}`,
      ``,
      `This code is valid for 10 minutes.`,
      `If you didn't request this, you can safely ignore this email — your account stays secure.`,
      ``,
      `— TATO`,
    ].join("\n"),
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #111318;">
        <p style="font-size: 11px; letter-spacing: 0.34em; text-transform: uppercase; color: #6b6f78; margin: 0 0 8px;">TATO</p>
        <h1 style="font-size: 24px; font-weight: 600; margin: 0 0 16px;">Password reset code</h1>
        <p style="font-size: 14px; line-height: 22px; color: #3a3d44; margin: 0 0 24px;">You're resetting the password for your TATO admin account. Enter the 6-digit code below on the reset page to continue.</p>
        <div style="background: #f4f4f6; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <p style="font-family: 'SF Mono', Menlo, monospace; font-size: 32px; letter-spacing: 12px; font-weight: 600; margin: 0; color: #111318;">${code}</p>
        </div>
        <p style="font-size: 13px; line-height: 20px; color: #6b6f78; margin: 0 0 8px;">This code is valid for 10 minutes.</p>
        <p style="font-size: 13px; line-height: 20px; color: #6b6f78; margin: 0;">If you didn't request this, you can safely ignore this email — your account stays secure.</p>
      </div>
    `,
  };
}

export async function sendPasswordResetEmail(input: {
  to: string;
  code: string;
  locale: Locale;
}): Promise<{ ok: boolean; reason?: string }> {
  const copy = buildPasswordResetCopy(input.code, input.locale);
  return sendMail({ to: input.to, ...copy });
}

/**
 * In-app feedback / bug report sender. Routes a TATO admin user's
 * message + uploaded attachments to the workspace operator (you) so a
 * user-reported bug arrives as a normal email with the screenshots /
 * videos already attached, no triage tooling needed.
 *
 * Recipient is read from `FEEDBACK_RECIPIENT_EMAIL`; if unset the
 * feature is treated as disabled and we return a structured error so
 * the UI can show "feedback not configured yet" rather than failing
 * silently.
 *
 * `replyTo` is the user's own email so the operator can hit Reply
 * once and start a real conversation — the platform's `from` address
 * (`SMTP_FROM`) is just the envelope.
 */
export async function sendFeedbackEmail(input: {
  fromName: string;
  fromEmail: string;
  message: string;
  attachments?: EmailAttachment[];
  /** Lightweight context dump (URL, locale, app version, user agent)
   *  rendered into the email body so the operator knows where the
   *  user was when they submitted. */
  context?: Record<string, string | undefined>;
}): Promise<{ ok: boolean; reason?: string }> {
  const recipient = process.env.FEEDBACK_RECIPIENT_EMAIL?.trim();
  if (!recipient) {
    return { ok: false, reason: "feedback_recipient_not_configured" };
  }

  const subject = `[TATO feedback] ${input.fromName} <${input.fromEmail}>`;

  const contextLines = input.context
    ? Object.entries(input.context)
        .filter(([, value]) => value && value.trim().length > 0)
        .map(([key, value]) => `${key}: ${value}`)
    : [];

  const text = [
    `From: ${input.fromName} <${input.fromEmail}>`,
    "",
    input.message,
    "",
    contextLines.length > 0 ? "—" : "",
    ...contextLines,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  const escape = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; color: #111318;">
      <p style="font-size: 11px; letter-spacing: 0.34em; text-transform: uppercase; color: #6b6f78; margin: 0 0 8px;">TATO feedback</p>
      <h1 style="font-size: 18px; font-weight: 600; margin: 0 0 12px;">${escape(input.fromName)} &lt;${escape(input.fromEmail)}&gt;</h1>
      <div style="background: #f4f4f6; border-radius: 12px; padding: 18px; margin-bottom: 16px; white-space: pre-wrap; word-break: break-word; font-size: 14px; line-height: 22px;">${escape(input.message)}</div>
      ${
        contextLines.length > 0
          ? `<table style="font-size: 12px; color: #3a3d44; border-collapse: collapse; width: 100%;">${contextLines
              .map((line) => {
                const [key, ...rest] = line.split(": ");
                return `<tr><td style="padding: 4px 8px 4px 0; color: #6b6f78;">${escape(key)}</td><td style="padding: 4px 0; word-break: break-all;">${escape(rest.join(": "))}</td></tr>`;
              })
              .join("")}</table>`
          : ""
      }
      ${
        input.attachments && input.attachments.length > 0
          ? `<p style="font-size: 12px; color: #6b6f78; margin-top: 16px;">📎 ${input.attachments.length} attachment(s)</p>`
          : ""
      }
    </div>
  `;

  // Larger attachments need longer than the verification-email
  // budget; 60 seconds is generous without leaving the user staring
  // forever if the upstream is dead.
  return sendMail({
    to: recipient,
    subject,
    text,
    html,
    replyTo: input.fromEmail,
    attachments: input.attachments,
    timeoutMs: 60_000,
  });
}
