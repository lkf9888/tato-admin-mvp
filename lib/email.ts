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

type SendInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
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

  // Hard cap the request at 15s so the registration form fails fast instead
  // of leaving the user staring at a "Sending verification code…" spinner.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

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
          ? "timeout_15s"
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
