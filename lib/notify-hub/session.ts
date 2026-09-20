import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

/**
 * A mini program session, held by a person rather than a system.
 *
 * Deliberately not TATO's `staff-mini-program` session, which carries
 * a staff id: the hub's subscriber is an openid and nothing else, and
 * giving it a TATO identity would quietly make the hub depend on TATO
 * having one -- which HostHub's customers will not.
 */

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type SessionPayload = {
  v: 1;
  mp: string;
  openId: string;
  exp: number;
};

export type NotifySubscriberContext = {
  miniProgramId: string;
  openId: string;
};

function getSigningSecret() {
  const secret =
    process.env.NOTIFY_HUB_SESSION_SECRET ||
    process.env.MINIPROGRAM_SESSION_SECRET ||
    process.env.SESSION_SECRET;
  if (secret && secret.length > 0) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("NOTIFY_HUB_SESSION_SECRET must be set in production.");
  }
  return "local-dev-notify-hub-secret";
}

function sign(value: string) {
  return createHmac("sha256", getSigningSecret()).update(value).digest("base64url");
}

export function createSubscriberSession(input: NotifySubscriberContext) {
  const payload: SessionPayload = {
    v: 1,
    mp: input.miniProgramId,
    openId: input.openId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifySubscriberSession(token: string): NotifySubscriberContext | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  if (expected.length !== signature.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (payload.v !== 1 || !payload.mp || !payload.openId || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { miniProgramId: payload.mp, openId: payload.openId };
  } catch {
    return null;
  }
}

export function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export function authenticateSubscriber(request: Request) {
  const token = getBearerToken(request);
  return token ? verifySubscriberSession(token) : null;
}
