import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * The hub's only conversation with WeChat.
 *
 * Two things live here that nothing else should have to think about:
 * getting an access token that survives having more than one server
 * process, and turning a set of values into a subscribe message whose
 * fields WeChat will actually accept.
 */

/**
 * WeChat's API host.
 *
 * Overridable because WeChat publishes failover domains for exactly
 * the days when the primary one is unreachable from a given network,
 * and because a hub whose only endpoint is a live third party is a hub
 * that can only be tested in production.
 */
const API = (process.env.WECHAT_API_BASE?.trim() || "https://api.weixin.qq.com").replace(/\/$/, "");

export type MiniProgramCredentials = {
  id: string;
  appId: string;
  secret: string;
  state: string;
};

/**
 * Resolve a mini program's credentials.
 *
 * The secret is read from the environment by the name recorded on the
 * row. Storing the name rather than the value keeps the secret out of
 * database backups and out of any admin screen that later edits this
 * table, at the cost of a deploy when a new mini program is added --
 * which happens roughly once a year and is already a deploy.
 */
export async function getMiniProgramCredentials(
  miniProgramId: string,
): Promise<MiniProgramCredentials> {
  const record = await prisma.notifyMiniProgram.findUnique({ where: { id: miniProgramId } });
  if (!record || !record.isActive) {
    throw new Error("MINI_PROGRAM_NOT_AVAILABLE");
  }

  const secret = process.env[record.secretEnvVar]?.trim();
  if (!secret) {
    throw new Error(`MINI_PROGRAM_SECRET_MISSING:${record.secretEnvVar}`);
  }

  return { id: record.id, appId: record.appId, secret, state: record.state };
}

type TokenCacheEntry = { value: string; expiresAt: number };

const tokenCache = new Map<string, TokenCacheEntry>();

/**
 * An access token that two server processes can both hold.
 *
 * `/cgi-bin/token` mints a *new* token on every call and invalidates
 * the previous one, so two instances refreshing on their own schedules
 * spend the day logging each other out -- a failure that only appears
 * once the app is scaled past one container, and appears as
 * intermittent 40001s that look like nothing.
 *
 * `/cgi-bin/stable_token` with `force_refresh: false` returns whatever
 * token is currently valid instead of replacing it, which makes the
 * call idempotent and the process-local cache below an optimisation
 * rather than a correctness requirement.
 */
export async function getAccessToken(credentials: Pick<MiniProgramCredentials, "appId" | "secret">) {
  const now = Date.now();
  const cached = tokenCache.get(credentials.appId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const response = await fetch(`${API}/cgi-bin/stable_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credential",
      appid: credentials.appId,
      secret: credentials.secret,
      force_refresh: false,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(
      `WECHAT_ACCESS_TOKEN_FAILED:${payload.errcode ?? response.status}:${payload.errmsg ?? ""}`,
    );
  }

  // Five minutes of headroom: long enough that a token never expires
  // mid-request, short enough that a token revoked in the console is
  // not retried for the rest of the hour.
  const ttl = Math.max(60, (payload.expires_in ?? 7200) - 300);
  tokenCache.set(credentials.appId, { value: payload.access_token, expiresAt: now + ttl * 1000 });
  return payload.access_token;
}

/** Drop a cached token. Called when WeChat says the one we hold is dead. */
export function forgetAccessToken(appId: string) {
  tokenCache.delete(appId);
}

export async function exchangeLoginCode(
  credentials: Pick<MiniProgramCredentials, "appId" | "secret">,
  code: string,
) {
  const url = new URL(`${API}/sns/jscode2session`);
  url.searchParams.set("appid", credentials.appId);
  url.searchParams.set("secret", credentials.secret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const response = await fetch(url);
  const payload = (await response.json().catch(() => ({}))) as {
    openid?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
  };

  if (!response.ok || !payload.openid) {
    throw new Error(`WECHAT_LOGIN_FAILED:${payload.errcode ?? response.status}:${payload.errmsg ?? ""}`);
  }

  return { openId: payload.openid, unionId: payload.unionid ?? null };
}

/**
 * Per-type limits on a subscribe message value.
 *
 * WeChat rejects the whole message with 47003 if one field is too long
 * or the wrong shape, and the type is encoded in the field name the
 * console assigned -- `thing3`, `phrase4`, `time2`. So the limit is
 * derivable, and deriving it is much better than trusting each caller
 * to remember that `phrase` means five characters, not twenty.
 */
const FIELD_LIMITS: Record<string, number> = {
  thing: 20,
  character_string: 32,
  phrase: 5,
  number: 32,
  letter: 32,
  symbol: 5,
  name: 10,
  const: 20,
};

function fieldType(field: string) {
  const match = field.match(/^([a-z_]+?)\d+$/);
  return match?.[1] ?? "thing";
}

/**
 * The zone a person reads a reminder in.
 *
 * Not the server's. A container on Railway runs in UTC, so formatting
 * with local getters would have put "pick up at 14:30" in front of a
 * driver whose pickup is at 07:30 -- wrong by seven hours, every time,
 * and wrong in a way that looks like a perfectly ordinary message.
 * Falls back to the timezone the CSV importer already established as
 * the fleet's.
 */
function getDisplayTimeZone() {
  return (
    process.env.NOTIFY_TIMEZONE?.trim() ||
    process.env.CSV_IMPORT_TIMEZONE?.trim() ||
    "America/Vancouver"
  );
}

function zonedParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: getDisplayTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  // `hour12: false` yields "24" for midnight in some runtimes.
  if (parts.hour === "24") parts.hour = "00";
  return parts;
}

/**
 * Coerce a value into what its field will accept.
 *
 * Truncation is silent and deliberate. A message that arrives with an
 * elided tail still tells someone a task changed and still opens the
 * detail page; a message rejected for being one character long tells
 * them nothing at all.
 */
export function formatFieldValue(field: string, raw: string | number | Date) {
  const type = fieldType(field);

  if (raw instanceof Date) {
    const parts = zonedParts(raw);
    if (type === "date") {
      return `${parts.year}年${parts.month}月${parts.day}日`;
    }
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  }

  const text = String(raw).replace(/\s+/g, " ").trim();

  if (type === "time" || type === "date") {
    // Callers reach the hub over HTTP, where a Date has already become
    // a string. An ISO timestamp is unambiguous enough to re-hydrate,
    // and WeChat rejects one verbatim -- it wants `2026-09-19 14:30`,
    // not `2026-09-19T14:30:00.000Z`. Anything else is passed through
    // on the assumption the caller has already formatted it.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) return formatFieldValue(field, parsed);
    }
    return text;
  }

  const limit = FIELD_LIMITS[type];
  if (!limit || text.length <= limit) return text;
  // One character of the budget goes to the ellipsis, so the result is
  // within the limit rather than exactly at it.
  return `${text.slice(0, limit - 1)}…`;
}

export type SendResult =
  | { ok: true }
  | { ok: false; errcode: string; retryable: boolean; quotaExhausted: boolean };

/**
 * errcodes worth telling apart.
 *
 * 43101 is the one that matters: the person has no unspent
 * authorisation left, which is not a failure of ours and not something
 * a retry fixes. It has to zero the local quota and surface as "needs
 * re-authorising", because the alternative -- what the first TATO
 * integration did -- is to keep believing notifications are on while
 * every send is discarded.
 */
const QUOTA_EXHAUSTED = new Set([43101]);
const TOKEN_DEAD = new Set([40001, 42001, 40014]);
const RETRYABLE = new Set([-1, 45009, 45011]);

export async function sendSubscribeMessage(input: {
  credentials: MiniProgramCredentials;
  openId: string;
  templateId: string;
  page?: string | null;
  data: Record<string, { value: string }>;
}): Promise<SendResult> {
  const attempt = async (token: string) => {
    const url = new URL(`${API}/cgi-bin/message/subscribe/send`);
    url.searchParams.set("access_token", token);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        touser: input.openId,
        template_id: input.templateId,
        page: input.page || undefined,
        miniprogram_state: input.credentials.state,
        lang: "zh_CN",
        data: input.data,
      }),
    });
    return (await response.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
  };

  try {
    let payload = await attempt(await getAccessToken(input.credentials));

    // A token can die between being cached and being used -- someone
    // hits "reset" in the console, or another platform under the same
    // appid calls the non-stable endpoint. One forced retry costs a
    // round trip and saves a message.
    if (payload.errcode && TOKEN_DEAD.has(payload.errcode)) {
      forgetAccessToken(input.credentials.appId);
      payload = await attempt(await getAccessToken(input.credentials));
    }

    if (!payload.errcode) return { ok: true };

    return {
      ok: false,
      errcode: `${payload.errcode}:${payload.errmsg ?? ""}`,
      retryable: RETRYABLE.has(payload.errcode),
      quotaExhausted: QUOTA_EXHAUSTED.has(payload.errcode),
    };
  } catch (error) {
    return {
      ok: false,
      errcode: error instanceof Error ? error.message : "WECHAT_SEND_FAILED",
      retryable: true,
      quotaExhausted: false,
    };
  }
}
