import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import type { Locale } from "@/lib/i18n";

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
};

let cachedTransporter: Transporter | null = null;

function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD?.trim();
  const from = process.env.SMTP_FROM?.trim() || (user ? `TATO <${user}>` : "");
  const portRaw = process.env.SMTP_PORT?.trim();

  if (!host || !user || !pass || !from) {
    return null;
  }

  const port = portRaw ? Number.parseInt(portRaw, 10) : 587;
  if (!Number.isFinite(port)) {
    return null;
  }

  // Common convention: 465 = TLS-on-connect, others = STARTTLS
  const secure = port === 465;
  return { host, port, user, pass, from, secure };
}

export function isEmailConfigured(): boolean {
  return getSmtpConfig() !== null;
}

function getTransporter(config: SmtpConfig): Transporter {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
    });
  }
  return cachedTransporter;
}

type SendInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

async function sendMail(input: SendInput): Promise<{ ok: boolean; reason?: string }> {
  const config = getSmtpConfig();
  if (!config) {
    // Dev / unconfigured fallback: log the message so the verification flow
    // remains testable without an SMTP server. This is the only place we ever
    // print verification codes; production deployments must set SMTP_* vars.
    // eslint-disable-next-line no-console
    console.log(
      `[email] SMTP not configured. Would have sent to ${input.to} :: ${input.subject}\n${input.text}`,
    );
    return { ok: false, reason: "smtp_not_configured" };
  }

  try {
    const transporter = getTransporter(config);
    await transporter.sendMail({
      from: config.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "send_failed",
    };
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
