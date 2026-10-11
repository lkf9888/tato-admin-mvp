import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { recentGuestExchanges } from "@/lib/guest-reply-context";
import { isKimiConfigured, kimiExtractJson } from "@/lib/kimi";
import { loadKnowledge } from "@/lib/message-knowledge-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_SUGGESTIONS = 10;

const SYSTEM_PROMPT = [
  "You help a car-rental host (Turo) build a library of saved answers from their past guest conversations.",
  `Read the exchanges and list at most ${MAX_SUGGESTIONS} distinct things guests keep asking, most frequent first.`,
  "Merge questions that ask the same thing. Skip greetings, thanks, and anything about one guest's own booking (their dates, payment, a specific complaint).",
  "For each, return:",
  '- "label": a short title in Simplified Chinese (at most 12 characters), e.g. 取车方式, 加油要求.',
  '- "triggers": 2-4 short phrasings of how guests ask it, in the language the guests used.',
  '- "content": the host\'s answer, taken ONLY from the host\'s own replies shown, kept in the host\'s wording and language. If the host never answered it, return an empty string. Never invent an answer, a time, a place, a price or a code.',
  '- "kind": "reply" when content is a complete message the host could send again; "fact" when it is a short fact.',
  "Do not repeat a subject the host already has (listed below).",
  'Answer with a JSON object: {"suggestions": [{"label": "...", "triggers": ["..."], "content": "...", "kind": "reply"}]}',
].join("\n");

type Suggestion = { label: string; triggers: string[]; content: string; kind: "reply" | "fact" };

/**
 * Entries the library could start with, from what guests actually asked
 * and how the host actually answered -- suggestions for the page to
 * offer, never saved here. An answer the host never gave comes back
 * empty, for the host to write.
 */
export async function POST() {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isKimiConfigured()) return NextResponse.json({ error: "ASSISTANT_NOT_CONFIGURED" }, { status: 503 });

  const ip = await getClientIp();
  const decision = await checkRateLimit({
    scope: "message_library_suggest",
    identifier: `${context.workspace.id}:${ip}`,
    maxAttempts: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!decision.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

  const [exchanges, existing] = await Promise.all([
    recentGuestExchanges(context.workspace.id),
    loadKnowledge(context.workspace.id),
  ]);
  if (exchanges.length === 0) return NextResponse.json({ suggestions: [], read: 0 });

  const sample = exchanges
    .map((pair, index) => `${index + 1}. Guest: ${pair.guest}${pair.host ? `\n   Host: ${pair.host}` : ""}`)
    .join("\n");
  const have = existing.map((entry) => entry.label).join(" | ");

  const result = await kimiExtractJson<{ suggestions?: unknown }>({
    system: have ? `${SYSTEM_PROMPT}\nThe host already has: ${have}` : SYSTEM_PROMPT,
    user: sample,
    maxTokens: 3000,
    timeoutMs: 90_000,
  });
  if (!result.ok) return NextResponse.json({ error: "SUGGEST_FAILED", reason: result.reason }, { status: 502 });

  const known = new Set(existing.map((entry) => entry.label.trim().toLowerCase()));
  const raw = Array.isArray(result.data.suggestions) ? result.data.suggestions : [];
  const suggestions: Suggestion[] = raw
    .map((item) => {
      const value = (item ?? {}) as Record<string, unknown>;
      return {
        label: typeof value.label === "string" ? value.label.trim().slice(0, 80) : "",
        triggers: Array.isArray(value.triggers)
          ? value.triggers.filter((line): line is string => typeof line === "string" && line.trim() !== "").slice(0, 6)
          : [],
        content: typeof value.content === "string" ? value.content.trim().slice(0, 4000) : "",
        kind: value.kind === "fact" ? ("fact" as const) : ("reply" as const),
      };
    })
    .filter((item) => item.label && !known.has(item.label.toLowerCase()))
    .slice(0, MAX_SUGGESTIONS);

  return NextResponse.json({ suggestions, read: exchanges.length });
}
