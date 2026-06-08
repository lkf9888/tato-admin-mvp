import "server-only";

type SmsResult = {
  ok: boolean;
  reason?: string;
  messageSid?: string;
};

type StaffTaskSmsInput = {
  to: string | null | undefined;
  staffName: string;
  taskTitle: string;
  action: "created" | "updated" | "deleted" | "removed";
  dueLabel?: string | null;
  timeWindow?: string | null;
  vehicleLabel?: string | null;
  orderLabel?: string | null;
  details?: string | null;
  taskUrl?: string | null;
};

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromPhone = process.env.TWILIO_FROM_PHONE?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();

  if (!accountSid || !authToken || (!fromPhone && !messagingServiceSid)) return null;
  return { accountSid, authToken, fromPhone, messagingServiceSid };
}

function normalizePhoneNumber(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;

  if (raw.startsWith("+")) {
    const digits = raw.slice(1).replace(/\D/g, "");
    return digits.length >= 8 ? `+${digits}` : null;
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && process.env.SMS_DEFAULT_COUNTRY_CODE) {
    const countryCode = process.env.SMS_DEFAULT_COUNTRY_CODE.trim().replace(/[^\d+]/g, "");
    const normalizedCode = countryCode.startsWith("+") ? countryCode : `+${countryCode}`;
    return `${normalizedCode}${digits}`;
  }
  return null;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function buildTaskSms(input: StaffTaskSmsInput) {
  const actionLabel = {
    created: "新任务",
    updated: "任务更新",
    deleted: "任务删除",
    removed: "任务移除",
  }[input.action];

  const lines = [
    `TATO ${actionLabel}: ${truncate(input.taskTitle, 80)}`,
    input.dueLabel ? `到期: ${input.dueLabel}` : null,
    input.timeWindow ? `时间: ${truncate(input.timeWindow, 40)}` : null,
    input.vehicleLabel ? `车辆: ${truncate(input.vehicleLabel, 60)}` : null,
    input.orderLabel ? `订单: ${truncate(input.orderLabel, 50)}` : null,
    input.details ? `说明: ${truncate(input.details.replace(/\s+/g, " "), 80)}` : null,
    input.taskUrl ? `查看: ${input.taskUrl}` : null,
  ].filter(Boolean);

  return lines.join("\n");
}

export async function sendStaffTaskSms(input: StaffTaskSmsInput): Promise<SmsResult> {
  const config = getTwilioConfig();
  if (!config) return { ok: false, reason: "sms_not_configured" };

  const to = normalizePhoneNumber(input.to);
  if (!to) return { ok: false, reason: "invalid_phone" };

  const params = new URLSearchParams({
    To: to,
    Body: buildTaskSms(input),
  });
  if (config.messagingServiceSid) {
    params.set("MessagingServiceSid", config.messagingServiceSid);
  } else if (config.fromPhone) {
    params.set("From", config.fromPhone);
  }

  const credentials = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
    };

    if (!response.ok) {
      console.error("[sms] staff task SMS failed", {
        to,
        status: response.status,
        reason: payload.message ?? response.statusText,
      });
      return { ok: false, reason: payload.message ?? `twilio_${response.status}` };
    }

    console.log("[sms] staff task SMS sent", { to, messageSid: payload.sid });
    return { ok: true, messageSid: payload.sid };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    console.error("[sms] staff task SMS failed", { to, reason });
    return { ok: false, reason };
  }
}
