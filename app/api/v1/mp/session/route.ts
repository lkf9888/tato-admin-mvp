import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { listSubscriberChannels } from "@/lib/notify-hub/channels";
import { getQuota } from "@/lib/notify-hub/quota";
import { createSubscriberSession } from "@/lib/notify-hub/session";
import { exchangeLoginCode, getMiniProgramCredentials } from "@/lib/notify-hub/wechat";

export const runtime = "nodejs";

/**
 * Turn a `wx.login` code into a hub session.
 *
 * The session carries an openid and the mini program it belongs to,
 * and nothing else. A subscriber here is not a TATO staff member and
 * not a HostHub employee -- those identities live in the systems that
 * own them, and the hub stays usable by a customer who has neither.
 */

const sessionSchema = z.object({
  wxCode: z.string().trim().min(1).max(200),
  /** The caller's own appid. Optional while only one is configured. */
  appId: z.string().trim().max(64).optional(),
});

async function resolveMiniProgram(appId?: string) {
  if (appId) {
    return prisma.notifyMiniProgram.findFirst({ where: { appId, isActive: true } });
  }

  // One mini program is the normal case today, and making the client
  // send an appid it can already infer is friction with no payoff. The
  // moment a second exists, this stops guessing rather than guessing
  // wrong.
  const active = await prisma.notifyMiniProgram.findMany({ where: { isActive: true }, take: 2 });
  return active.length === 1 ? active[0] : null;
}

export async function POST(request: NextRequest) {
  const parsed = sessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const miniProgram = await resolveMiniProgram(parsed.data.appId);
  if (!miniProgram) {
    return NextResponse.json({ error: "MINI_PROGRAM_NOT_RESOLVED" }, { status: 400 });
  }

  let openId: string;
  try {
    const credentials = await getMiniProgramCredentials(miniProgram.id);
    const session = await exchangeLoginCode(credentials, parsed.data.wxCode);
    openId = session.openId;
  } catch (error) {
    const message = error instanceof Error ? error.message : "WECHAT_LOGIN_FAILED";
    return NextResponse.json({ error: message }, { status: message.startsWith("MINI_PROGRAM_") ? 503 : 502 });
  }

  const templates = await prisma.notifyTemplate.findMany({
    where: { miniProgramId: miniProgram.id, isActive: true },
    orderBy: { key: "asc" },
  });
  const templateKeys = templates.map((template) => template.key);

  return NextResponse.json({
    token: createSubscriberSession({ miniProgramId: miniProgram.id, openId }),
    channels: await listSubscriberChannels({ miniProgramId: miniProgram.id, openId }),
    // The client needs both halves to ask for an authorisation: the
    // real template ids to hand `wx.requestSubscribeMessage`, and the
    // counts, so it can stop pestering someone who is already topped
    // up.
    templates: templates.map((template) => ({ key: template.key, templateId: template.templateId })),
    quota: await getQuota({ miniProgramId: miniProgram.id, openId, templateKeys }),
  });
}
