import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { isKimiConfigured, kimiChat } from "@/lib/kimi";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const TRANSLATE_LIMIT = 60;
const TRANSLATE_WINDOW_MS = 10 * 60 * 1000;

/** Messages translated per request. A thread is a conversation, not an
 *  archive; the operator reads the recent end of it. */
const BATCH = 12;

/**
 * A thread is identified by the ids of its messages, not by
 * guest + vehicle.
 *
 * The page resolves a thread's car from its matched trip when the
 * subject could not name one -- three Honda Odysseys mean "Honda
 * Odyssey" identifies none of them. That makes the thread's vehicle id
 * and the email rows' own vehicle ids legitimately different, so
 * selecting by guest + vehicle found nothing and the feature silently
 * did nothing. Ids cannot drift like that.
 *
 * Still scoped to the workspace: an id from another tenant must not
 * resolve, however it arrived.
 */
const translateSchema = z.object({
  emailIds: z.array(z.string().trim().min(1)).min(1).max(60),
});

const SYSTEM_PROMPT = [
  "你是翻译。把每条 Turo 客人消息翻译成简体中文。",
  "只输出译文，不要解释、不要引号、不要编号以外的任何前后缀。",
  "保留 emoji、数字、日期、金额、车牌和人名。语气贴近原文，客人怎么说就怎么译，不要润色成客服腔。",
  "输入是带编号的多行，每行形如 `3. <原文>`。输出必须是同样数量、同样编号的行，每条译文只占一行，不要换行。",
].join("\n");

/**
 * Translate a thread's summaries into Chinese.
 *
 * Cached on the row rather than recomputed per view: the operator
 * opens the same thread repeatedly and a translation is a model call.
 * Only rows without a translation are sent, so a second press costs
 * nothing and a thread that grows translates only what is new.
 *
 * Summaries are translated rather than the raw bodies. The body is a
 * Turo notification template wrapped around one or two sentences of
 * guest text; translating the wrapper would spend most of the budget
 * on boilerplate the operator does not read.
 */
export async function POST(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (!isKimiConfigured()) {
    return NextResponse.json({ error: "ASSISTANT_NOT_CONFIGURED" }, { status: 503 });
  }

  const parsed = translateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const ip = await getClientIp();
  const decision = await checkRateLimit({
    scope: "message_translate",
    identifier: `${context.workspace.id}:${ip}`,
    maxAttempts: TRANSLATE_LIMIT,
    windowMs: TRANSLATE_WINDOW_MS,
  });
  if (!decision.allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const pending = await prisma.inboundEmail.findMany({
    where: {
      workspaceId: context.workspace.id,
      id: { in: parsed.data.emailIds },
      summaryZh: null,
    },
    orderBy: { receivedAt: "desc" },
    take: BATCH,
    select: { id: true, guestText: true, parsed: true },
  });

  // The guest's own words when we have them. The summary is the
  // fallback for notifications that carry no message -- a cancellation,
  // a payout -- where there is nothing of theirs to translate.
  const items = pending
    .map((email) => {
      const own = email.guestText?.trim();
      // Newlines collapsed before sending. The protocol below is one
      // numbered line per message, and a guest who pressed Enter would
      // otherwise contribute unnumbered lines that the parser drops --
      // which is exactly what happened: "Good day! / Just confirming
      // the vehicle will be ready..." came back translated as "你好!"
      // and nothing else.
      if (own) return { id: email.id, text: own.replace(/\s*\n+\s*/g, " ").slice(0, 1200) };
      try {
        const summary = (JSON.parse(email.parsed ?? "{}") as { summary?: string }).summary;
        return summary?.trim() ? { id: email.id, text: summary.trim() } : null;
      } catch {
        return null;
      }
    })
    .filter((item): item is { id: string; text: string } => item !== null);

  if (items.length === 0) {
    return NextResponse.json({ translated: 0, translations: {} });
  }

  const result = await kimiChat({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: items.map((item, index) => `${index + 1}. ${item.text}`).join("\n"),
      },
    ],
    maxTokens: 3000,
  });

  if (!result.ok) {
    return NextResponse.json({ error: "TRANSLATE_FAILED", reason: result.reason }, { status: 502 });
  }

  // Match returned lines back by their number. A model that drops or
  // merges a line must not shift every following translation onto the
  // wrong message -- so a line is only accepted where its number
  // resolves, and anything unmatched is simply left untranslated.
  const byIndex = new Map<number, string>();
  for (const line of result.content.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)[.、)]\s*(.+)$/);
    if (match) byIndex.set(Number(match[1]), match[2].trim());
  }

  const translations: Record<string, string> = {};
  for (const [index, item] of items.entries()) {
    const text = byIndex.get(index + 1);
    if (!text) continue;
    translations[item.id] = text;
    await prisma.inboundEmail.update({
      where: { id: item.id },
      data: { summaryZh: text.slice(0, 600) },
    });
  }

  return NextResponse.json({
    translated: Object.keys(translations).length,
    requested: items.length,
    translations,
  });
}
