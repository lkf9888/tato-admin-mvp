import "server-only";

/**
 * Kimi (Moonshot AI) client.
 *
 * The API is OpenAI-compatible, so this is a thin `fetch` wrapper rather
 * than another SDK dependency — the same approach `lib/email.ts` takes
 * with Resend. Nothing here needs streaming or tool-calling yet; when
 * that changes, swapping in the `openai` package with a custom baseURL
 * is a drop-in.
 *
 * Model naming moves fast on this platform: the `kimi-k2` series was
 * discontinued on 2026-05-25 and `kimi-latest` on 2026-01-28. Current
 * models are `kimi-k3` (1M context), `kimi-k2.6` and `kimi-k2.5`
 * (256k). Both model names are env-configurable so a deprecation
 * doesn't require a deploy.
 */

const DEFAULT_BASE_URL = "https://api.moonshot.ai/v1";

/** Conversational assistant. Balanced cost/quality. */
const DEFAULT_CHAT_MODEL = "kimi-k2.6";

/** Bulk classification of inbound email. Cheapest tier that can do it. */
const DEFAULT_EXTRACTION_MODEL = "kimi-k2.5";

const DEFAULT_TIMEOUT_MS = 60_000;

export type KimiRole = "system" | "user" | "assistant";

export type KimiMessage = {
  role: KimiRole;
  content: string;
};

export type KimiResult =
  | { ok: true; content: string; usage?: KimiUsage }
  | { ok: false; reason: string; status?: number };

export type KimiUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export function getKimiApiKey() {
  return process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim() || "";
}

export function isKimiConfigured() {
  return getKimiApiKey().length > 0;
}

function getBaseUrl() {
  return (process.env.KIMI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function getChatModel() {
  return process.env.KIMI_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}

export function getExtractionModel() {
  return process.env.KIMI_EXTRACTION_MODEL?.trim() || DEFAULT_EXTRACTION_MODEL;
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string };
};

/**
 * One chat completion round-trip.
 *
 * Returns a result object rather than throwing: every caller here is a
 * user-facing feature that should degrade to "the assistant is
 * unavailable" rather than 500 the page.
 */
export async function kimiChat(input: {
  messages: KimiMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Ask the model for a JSON object. Used by the email extractor. */
  jsonMode?: boolean;
}): Promise<KimiResult> {
  const apiKey = getKimiApiKey();
  if (!apiKey) {
    return { ok: false, reason: "kimi_not_configured" };
  }

  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model ?? getChatModel(),
        messages: input.messages,
        // Temperature is omitted unless a caller explicitly sets one.
        // The current Kimi models reject any value other than 1 —
        // `invalid temperature: only 1 is allowed for this model` —
        // the same constraint OpenAI's reasoning models have. Sending
        // nothing lets each model use whatever it was tuned for, and
        // keeps this client working across a model switch.
        ...(input.temperature != null ? { temperature: input.temperature } : {}),
        max_tokens: input.maxTokens ?? 2048,
        ...(input.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let message = body.slice(0, 400);
      try {
        const parsed = JSON.parse(body) as ChatCompletionResponse;
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        // Non-JSON error body; keep the raw excerpt.
      }
      // eslint-disable-next-line no-console
      console.error(`[kimi] request failed :: status=${response.status} :: ${message}`);
      return { ok: false, reason: message || `http_${response.status}`, status: response.status };
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      return { ok: false, reason: "empty_response" };
    }

    return {
      ok: true,
      content,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.name === "AbortError"
          ? `timeout_${Math.round(timeoutMs / 1000)}s`
          : error.message
        : "request_failed";
    // eslint-disable-next-line no-console
    console.error(`[kimi] request error :: ${reason}`);
    return { ok: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Chat completion that must return a JSON object matching the caller's
 * shape. Returns `null` rather than throwing on any failure — malformed
 * model output is an expected condition, not an exception.
 */
export async function kimiExtractJson<T>(input: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<T | null> {
  const result = await kimiChat({
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    model: input.model ?? getExtractionModel(),
    maxTokens: input.maxTokens ?? 1024,
    timeoutMs: input.timeoutMs,
    jsonMode: true,
  });

  if (!result.ok) return null;

  try {
    return JSON.parse(result.content) as T;
  } catch {
    // Some models wrap JSON in a fenced block despite json mode.
    const fenced = result.content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
