import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Prisma, StaffMember, StaffTaskStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  assignStaffShareToken,
  staffShareTaskAttachmentUrl,
  staffShareTaskInclude,
} from "@/lib/staff-share";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type WeChatAccessTokenCache = {
  value: string;
  expiresAt: number;
};

let accessTokenCache: WeChatAccessTokenCache | null = null;

export type StaffMiniProgramTaskRecord = Prisma.StaffTaskGetPayload<{
  include: typeof staffShareTaskInclude;
}>;

export const staffMiniProgramTaskInclude = staffShareTaskInclude;

export type StaffMiniProgramSessionStaff = Pick<
  StaffMember,
  | "id"
  | "workspaceId"
  | "name"
  | "role"
  | "email"
  | "phone"
  | "color"
  | "pinnedMessage"
  | "shareToken"
  | "miniProgramCode"
  | "wechatOpenId"
  | "wechatNotificationEnabled"
>;

type MiniProgramSessionPayload = {
  v: 1;
  staffId: string;
  openId: string;
  exp: number;
};

type WeChatLoginSession = {
  openid: string;
  session_key?: string;
  unionid?: string;
};

function getSigningSecret() {
  const secret = process.env.MINIPROGRAM_SESSION_SECRET || process.env.SESSION_SECRET;
  if (secret && secret.length > 0) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET or MINIPROGRAM_SESSION_SECRET must be set in production.");
  }
  return "local-dev-mini-program-secret";
}

function sign(value: string) {
  return createHmac("sha256", getSigningSecret()).update(value).digest("base64url");
}

function createSignedToken(payload: MiniProgramSessionPayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function decodeSignedToken(token: string): MiniProgramSessionPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  if (expected.length !== signature.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<MiniProgramSessionPayload>;
    if (payload.v !== 1 || !payload.staffId || !payload.openId || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as MiniProgramSessionPayload;
  } catch {
    return null;
  }
}

export function createStaffMiniProgramCode() {
  const bytes = randomBytes(8);
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return code;
}

export async function createAvailableStaffMiniProgramCode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = createStaffMiniProgramCode();
    const existing = await prisma.staffMember.findUnique({
      where: { miniProgramCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }

  throw new Error("Unable to allocate a unique staff mini program code.");
}

export async function assignStaffMiniProgramCode(staffId: string) {
  const miniProgramCode = await createAvailableStaffMiniProgramCode();
  const staff = await prisma.staffMember.update({
    where: { id: staffId },
    data: { miniProgramCode },
  });
  return staff.miniProgramCode;
}

export async function ensureStaffMiniProgramCodes<T extends Pick<StaffMember, "id" | "miniProgramCode">>(
  staff: T[],
) {
  const result = [...staff];

  for (let index = 0; index < result.length; index += 1) {
    const member = result[index];
    if (member.miniProgramCode) continue;
    const miniProgramCode = await assignStaffMiniProgramCode(member.id);
    result[index] = { ...member, miniProgramCode };
  }

  return result;
}

export async function ensureStaffMiniProgramCode(staff: Pick<StaffMember, "id" | "miniProgramCode">) {
  if (staff.miniProgramCode) return staff.miniProgramCode;
  return assignStaffMiniProgramCode(staff.id);
}

export async function ensureStaffShareToken(staff: Pick<StaffMember, "id" | "shareToken">) {
  if (staff.shareToken) return staff.shareToken;
  return assignStaffShareToken(staff.id);
}

export function normalizeStaffMiniProgramCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function getWeChatTaskTemplateId() {
  return process.env.WECHAT_TASK_TEMPLATE_ID?.trim() || "";
}

function getWeChatMiniProgramConfig() {
  const appId = process.env.WECHAT_MINIPROGRAM_APP_ID?.trim();
  const appSecret = process.env.WECHAT_MINIPROGRAM_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

export function isWeChatMiniProgramConfigured() {
  return Boolean(getWeChatMiniProgramConfig());
}

export async function exchangeWeChatLoginCode(code: string): Promise<WeChatLoginSession> {
  const config = getWeChatMiniProgramConfig();
  if (!config) {
    throw new Error("WECHAT_MINIPROGRAM_NOT_CONFIGURED");
  }

  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", config.appId);
  url.searchParams.set("secret", config.appSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const response = await fetch(url);
  const payload = (await response.json().catch(() => ({}))) as {
    openid?: string;
    session_key?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
  };

  if (!response.ok || !payload.openid) {
    throw new Error(`WECHAT_LOGIN_FAILED:${payload.errcode ?? response.status}:${payload.errmsg ?? ""}`);
  }

  return {
    openid: payload.openid,
    session_key: payload.session_key,
    unionid: payload.unionid,
  };
}

export async function getWeChatAccessToken() {
  const now = Date.now();
  if (accessTokenCache && accessTokenCache.expiresAt > now + 60_000) {
    return accessTokenCache.value;
  }

  const config = getWeChatMiniProgramConfig();
  if (!config) {
    throw new Error("WECHAT_MINIPROGRAM_NOT_CONFIGURED");
  }

  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", config.appId);
  url.searchParams.set("secret", config.appSecret);

  const response = await fetch(url);
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(`WECHAT_ACCESS_TOKEN_FAILED:${payload.errcode ?? response.status}:${payload.errmsg ?? ""}`);
  }

  accessTokenCache = {
    value: payload.access_token,
    expiresAt: now + Math.max(60, payload.expires_in ?? 7200) * 1000,
  };
  return accessTokenCache.value;
}

export function createStaffMiniProgramSession(staffId: string, openId: string) {
  const now = Math.floor(Date.now() / 1000);
  return createSignedToken({
    v: 1,
    staffId,
    openId,
    exp: now + SESSION_TTL_SECONDS,
  });
}

export async function verifyStaffMiniProgramSession(token: string) {
  const payload = decodeSignedToken(token);
  if (!payload) return null;

  return prisma.staffMember.findFirst({
    where: {
      id: payload.staffId,
      wechatOpenId: payload.openId,
      isActive: true,
    },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      role: true,
      email: true,
      phone: true,
      color: true,
      pinnedMessage: true,
      shareToken: true,
      miniProgramCode: true,
      wechatOpenId: true,
      wechatNotificationEnabled: true,
    },
  });
}

export function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export function serializeStaffMiniProgramStaff(staff: StaffMiniProgramSessionStaff) {
  return {
    id: staff.id,
    name: staff.name,
    role: staff.role,
    email: staff.email,
    phone: staff.phone,
    color: staff.color,
    pinnedMessage: staff.pinnedMessage,
    miniProgramCode: staff.miniProgramCode,
    wechatNotificationEnabled: staff.wechatNotificationEnabled,
  };
}

export function serializeStaffMiniProgramTask(input: {
  task: StaffMiniProgramTaskRecord;
  staffShareToken: string;
  baseUrl: string;
}) {
  const { task, staffShareToken, baseUrl } = input;
  const prefix = baseUrl.replace(/\/$/, "");

  return {
    id: task.id,
    staffId: task.staffId,
    vehicleId: task.vehicleId,
    orderId: task.orderId,
    staffLabel: task.staffLabel,
    vehicleLabel: task.vehicleLabel,
    orderLabel: task.orderLabel,
    title: task.title,
    details: task.details,
    dueDatetime: task.dueDatetime ? task.dueDatetime.toISOString() : null,
    timeWindow: task.timeWindow,
    status: task.status,
    priority: task.priority,
    category: task.category,
    sortOrder: task.sortOrder,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    vehicle: task.vehicle,
    order: task.order
      ? {
          ...task.order,
          pickupDatetime: task.order.pickupDatetime.toISOString(),
          returnDatetime: task.order.returnDatetime.toISOString(),
        }
      : null,
    attachments: task.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      uploadedAt: attachment.uploadedAt.toISOString(),
      url: `${prefix}${staffShareTaskAttachmentUrl(staffShareToken, task.id, attachment.id)}`,
    })),
  };
}

export async function listStaffMiniProgramTasks(input: {
  staff: Pick<StaffMember, "id" | "workspaceId" | "shareToken">;
  baseUrl: string;
}) {
  const staffShareToken = await ensureStaffShareToken(input.staff);
  if (!staffShareToken) {
    throw new Error("STAFF_SHARE_TOKEN_NOT_AVAILABLE");
  }
  const tasks = await prisma.staffTask.findMany({
    where: {
      workspaceId: input.staff.workspaceId,
      staffId: input.staff.id,
    },
    orderBy: [{ status: "asc" }, { dueDatetime: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    include: staffMiniProgramTaskInclude,
  });

  return tasks.map((task) =>
    serializeStaffMiniProgramTask({
      task,
      staffShareToken,
      baseUrl: input.baseUrl,
    }),
  );
}

function formatDateForWeChat(value: Date | null) {
  const date = value ?? new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function truncateMessageValue(value: string, maxLength = 20) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function getSubscribeDataFields() {
  const fallback = {
    title: "thing1",
    due: "time2",
    vehicle: "thing3",
    action: "phrase4",
    details: "thing5",
  };

  const raw = process.env.WECHAT_TASK_MESSAGE_FIELDS?.trim();
  if (!raw) return fallback;

  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<typeof fallback>) };
  } catch {
    return fallback;
  }
}

export async function sendStaffTaskWeChatMessage(input: {
  openId?: string | null;
  notificationEnabled?: boolean | null;
  taskId?: string;
  taskTitle: string;
  action: "created" | "updated" | "deleted" | "removed";
  dueDatetime?: Date | null;
  timeWindow?: string | null;
  vehicleLabel?: string | null;
  orderLabel?: string | null;
  details?: string | null;
}) {
  if (!input.openId || !input.notificationEnabled) return { ok: false, reason: "not_subscribed" };

  const templateId = getWeChatTaskTemplateId();
  if (!templateId) return { ok: false, reason: "template_not_configured" };

  const fields = getSubscribeDataFields();
  const actionLabel = {
    created: "新任务",
    updated: "任务更新",
    deleted: "任务删除",
    removed: "任务移除",
  }[input.action];
  const data: Record<string, { value: string }> = {};
  const add = (field: string | undefined, value: string | null | undefined, maxLength = 20) => {
    if (!field || !value) return;
    data[field] = { value: truncateMessageValue(value, maxLength) };
  };

  add(fields.title, input.taskTitle, 20);
  if (fields.due) {
    data[fields.due] = { value: formatDateForWeChat(input.dueDatetime ?? null) };
  }
  add(fields.vehicle, input.vehicleLabel || input.orderLabel, 20);
  add(fields.action, actionLabel, 10);
  add(fields.details, input.details || input.timeWindow || input.orderLabel || "请查看任务详情", 20);

  try {
    const accessToken = await getWeChatAccessToken();
    const url = new URL("https://api.weixin.qq.com/cgi-bin/message/subscribe/send");
    url.searchParams.set("access_token", accessToken);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        touser: input.openId,
        template_id: templateId,
        page: input.taskId ? `pages/tasks/index?taskId=${encodeURIComponent(input.taskId)}` : "pages/tasks/index",
        miniprogram_state: process.env.WECHAT_MINIPROGRAM_STATE?.trim() || "formal",
        lang: "zh_CN",
        data,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
    if (!response.ok || payload.errcode) {
      return { ok: false, reason: `wechat_${payload.errcode ?? response.status}:${payload.errmsg ?? ""}` };
    }
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "wechat_send_failed";
    return { ok: false, reason };
  }
}

export function getTaskStatusFromMiniProgram(value: string | null | undefined): StaffTaskStatus | null {
  if (value === "todo" || value === "in_progress" || value === "done") {
    return value;
  }
  return null;
}
