import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { getGmailConfig, isGmailInboxConfigured } from "@/lib/gmail-inbox";
import { getChatModel, getExtractionModel, getKimiApiKey, kimiChat } from "@/lib/kimi";

export const runtime = "nodejs";

/**
 * Configuration diagnostics for the assistant and Turo inbox.
 *
 * The chat endpoint deliberately returns a generic failure to the UI,
 * which is right for normal use but useless when an operator is trying
 * to work out *why* nothing works. This route makes one minimal live
 * call to the model provider and reports exactly what came back.
 *
 * Admin-session only, and it never returns secret values — only
 * whether each is present, how long it is, and a masked prefix so the
 * operator can tell one key from another without the value leaking
 * into a screenshot or a support thread.
 */
function describeSecret(value: string) {
  if (!value) return { present: false as const };
  return {
    present: true as const,
    length: value.length,
    prefix: value.slice(0, 6),
  };
}

export async function GET() {
  try {
    await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const apiKey = getKimiApiKey();
  const baseUrl = (process.env.KIMI_BASE_URL?.trim() || "https://api.moonshot.ai/v1").replace(
    /\/+$/,
    "",
  );
  const gmail = getGmailConfig();

  const diagnostics: Record<string, unknown> = {
    kimi: {
      apiKey: describeSecret(apiKey),
      baseUrl,
      chatModel: getChatModel(),
      extractionModel: getExtractionModel(),
      // Which env var name actually supplied the key, so a typo in one
      // of the two accepted names is visible.
      keySource: process.env.KIMI_API_KEY?.trim()
        ? "KIMI_API_KEY"
        : process.env.MOONSHOT_API_KEY?.trim()
          ? "MOONSHOT_API_KEY"
          : null,
    },
    gmail: {
      configured: isGmailInboxConfigured(),
      user: gmail.user ? `${gmail.user.slice(0, 3)}***@${gmail.user.split("@")[1] ?? ""}` : null,
      password: describeSecret(gmail.password),
      host: gmail.host,
      port: gmail.port,
      mailbox: gmail.mailbox,
      allowedSenders: gmail.allowedSenders,
      syncSecretConfigured: Boolean(process.env.GMAIL_SYNC_SECRET?.trim()),
    },
  };

  if (!apiKey) {
    return NextResponse.json({
      ...diagnostics,
      kimiTest: { ok: false, reason: "KIMI_API_KEY is not set in this environment." },
    });
  }

  // One tiny live call. `max_tokens` is small on purpose — this should
  // cost effectively nothing to run repeatedly while debugging.
  const test = await kimiChat({
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
    maxTokens: 8,
    temperature: 0,
    timeoutMs: 20_000,
  });

  return NextResponse.json({
    ...diagnostics,
    kimiTest: test.ok
      ? { ok: true, reply: test.content, usage: test.usage }
      : {
          ok: false,
          status: test.status,
          reason: test.reason,
          // The two failures that actually happen, with the fix, since
          // the upstream message alone rarely makes them obvious.
          hint:
            test.status === 401
              ? "Key rejected. Moonshot runs two independent regions and keys are not shared between them: platform.moonshot.cn keys only work against https://api.moonshot.cn/v1, and platform.moonshot.ai keys only against https://api.moonshot.ai/v1. Set KIMI_BASE_URL to match where the key was issued."
              : test.status === 404
                ? `Model "${getChatModel()}" was not found. The kimi-k2 series was discontinued 2026-05-25; current models are kimi-k3, kimi-k2.6 and kimi-k2.5. Override with KIMI_CHAT_MODEL.`
                : test.status === 429
                  ? "Rate limited or out of credit. Moonshot requires a balance on the account before a key will serve requests."
                  : null,
        },
  });
}
