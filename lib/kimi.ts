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

/**
 * Two providers, one wire format.
 *
 * OpenRouter is the default (2026-10, following HostHub): DeepSeek V4.1
 * Flash with reasoning off came out equal or better than Kimi on
 * HostHub's twelve real tasks at about a thirteenth of the cost, and
 * answers in a second. It is configured exactly as HostHub is, so the
 * two deployments read the same:
 *
 *   OPENAI_API_KEY        the OpenRouter key (the name is the wire
 *                         format, not the vendor)
 *   OPENAI_BASE_URL       default https://openrouter.ai/api/v1
 *   OPENAI_MODEL          default deepseek/deepseek-v4.1-flash
 *   OPENAI_REASONING      off | minimal | low | medium | high; default off
 *   OPENROUTER_PROVIDERS  hosts allowed to serve it, in order, no
 *                         fallback; default deepinfra,together
 *
 * Guest messages carry names and travel dates, so a router request
 * always asks for hosts that neither keep nor train on the data, and
 * only the named ones.
 *
 * Without OPENAI_API_KEY, the Moonshot (Kimi) settings below still work
 * unchanged.
 */
type Provider = "router" | "kimi";

function activeProvider(): Provider | null {
  if (process.env.OPENAI_API_KEY?.trim()) return "router";
  if (process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim()) return "kimi";
  return null;
}

const DEFAULT_ROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_ROUTER_MODEL = "deepseek/deepseek-v4.1-flash";
const DEFAULT_ROUTER_PROVIDERS = ["deepinfra", "together"];

const DEFAULT_BASE_URL = "https://api.moonshot.ai/v1";

/** Conversational assistant. Balanced cost/quality. */
const DEFAULT_CHAT_MODEL = "kimi-k2.6";

/** Bulk classification of inbound email. Was `kimi-k2.5`, the cheaper
 *  tier, until the account lost it (2026-10: "Not found the model
 *  kimi-k2.5 or Permission denied") and every extraction failed -- 400
 *  guest messages without a summary or a Chinese reading. The chat
 *  model is the one model this account is known to be able to call. */
const DEFAULT_EXTRACTION_MODEL = "kimi-k2.6";

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

/** The active provider's key: OpenRouter's when set, else Kimi's. */
export function getKimiApiKey() {
  if (activeProvider() === "router") return process.env.OPENAI_API_KEY?.trim() ?? "";
  return process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim() || "";
}

/** Which provider answers, for diagnostics. */
export function getAiProvider() {
  return activeProvider();
}

export function isKimiConfigured() {
  return getKimiApiKey().length > 0;
}

export function getBaseUrl() {
  const base =
    activeProvider() === "router"
      ? process.env.OPENAI_BASE_URL?.trim() || DEFAULT_ROUTER_BASE_URL
      : process.env.KIMI_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}

export function getChatModel() {
  if (activeProvider() === "router") return process.env.OPENAI_MODEL?.trim() || DEFAULT_ROUTER_MODEL;
  return process.env.KIMI_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}

export function getExtractionModel() {
  // One model on the router: the flash tier is already the cheap one.
  if (activeProvider() === "router") return getChatModel();
  return process.env.KIMI_EXTRACTION_MODEL?.trim() || DEFAULT_EXTRACTION_MODEL;
}

/**
 * The router's extra request fields: reasoning, and which hosts may
 * serve the model. `thinking: false` from a caller always turns
 * reasoning off; otherwise OPENAI_REASONING decides, off by default --
 * TATO's tasks are a reply, a translation, a parsed note.
 */
function routerFields(thinking: boolean | undefined): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const setting = process.env.OPENAI_REASONING?.trim().toLowerCase() || "off";
  if (thinking === false || setting === "off") fields.reasoning = { enabled: false };
  else if (["minimal", "low", "medium", "high"].includes(setting)) fields.reasoning = { effort: setting };
  const configured = (process.env.OPENROUTER_PROVIDERS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const order = configured.length > 0 ? configured : DEFAULT_ROUTER_PROVIDERS;
  fields.provider = { order, allow_fallbacks: false, data_collection: "deny" };
  return fields;
}

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      /** Reasoning models emit their scratchpad separately from the
       *  answer. Never shown to the operator, but its presence tells
       *  us why `content` came back empty. */
      reasoning_content?: string;
    };
    finish_reason?: string;
  }>;
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
  /**
   * False to skip the reasoning pass, for work that needs none --
   * translating a line, filling a JSON shape. The k2.5/k2.6 models
   * think by default, and on a long guest message that alone ran
   * translation past its 60s timeout. Sent only to models that accept
   * `thinking` (k3 and the code models reject it); if a model refuses,
   * the call is retried once with reasoning on, as before.
   */
  thinking?: boolean;
}): Promise<KimiResult> {
  const model = input.model ?? getChatModel();
  if (activeProvider() === "router") return kimiChatOnce({ ...input, model }, "router");
  if (input.thinking === false && /^kimi-k2\.[56]\b/.test(model)) {
    const fast = await kimiChatOnce({ ...input, model }, "kimi-fast");
    if (fast.ok || fast.status !== 400) return fast;
    // eslint-disable-next-line no-console
    console.error(`[kimi] thinking:disabled refused by ${model}, retrying with reasoning :: ${fast.reason}`);
  }
  return kimiChatOnce({ ...input, model }, "kimi");
}

async function kimiChatOnce(
  input: {
    messages: KimiMessage[];
    model: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    jsonMode?: boolean;
    thinking?: boolean;
  },
  /** kimi: as before; kimi-fast: Moonshot with thinking off; router:
   *  OpenRouter, with its own reasoning and host fields. */
  mode: "kimi" | "kimi-fast" | "router",
): Promise<KimiResult> {
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
        model: input.model,
        messages: input.messages,
        // The current Kimi models accept exactly one temperature:
        // `invalid temperature: only 1 is allowed for this model`
        // (HTTP 400) — the same constraint OpenAI's reasoning models
        // carry. Send 1 explicitly rather than omitting the field:
        // omitting relies on the server defaulting to 1, which is
        // probable but unverified, and this call path is the one that
        // was already failing. A caller that knows better can override.
        //
        // With reasoning off the platform fixes a different value, so
        // the field is left out and the server picks it.
        ...(mode === "kimi"
          ? { temperature: input.temperature ?? 1 }
          : mode === "kimi-fast"
            ? { thinking: { type: "disabled" } }
            : {
                ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
                ...routerFields(input.thinking),
              }),
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
      console.error(`[ai] request failed :: status=${response.status} :: ${message}`);
      return { ok: false, reason: message || `http_${response.status}`, status: response.status };
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const choice = data.choices?.[0];
    const content = choice?.message?.content?.trim() ?? "";

    if (!content) {
      // An empty `content` with a non-error response almost always
      // means the token budget was spent before the answer started.
      // The current Kimi models reason before answering, and those
      // reasoning tokens count against `max_tokens` — so a budget
      // sized for the visible answer alone yields nothing at all.
      // Report enough to tell that apart from a genuine empty reply.
      const finish = choice?.finish_reason ?? "unknown";
      const reasoned = Boolean(choice?.message?.reasoning_content?.trim());
      const detail =
        finish === "length"
          ? `empty_response (truncated: finish_reason=length, max_tokens=${input.maxTokens ?? 2048}${reasoned ? ", model emitted reasoning tokens" : ""} — raise maxTokens)`
          : `empty_response (finish_reason=${finish}${reasoned ? ", reasoning only" : ""})`;
      // eslint-disable-next-line no-console
      console.error(`[ai] ${detail}`);
      return { ok: false, reason: detail };
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

/** Moonshot's wording when a model is retired or not on the account. */
function isUnavailableModel(reason: string) {
  return /not found the model|permission denied|model[_ ]not[_ ]found/i.test(reason);
}

export type KimiJsonResult<T> = { ok: true; data: T } | { ok: false; reason: string };

/**
 * Chat completion that must return a JSON object matching the caller's
 * shape. Returns a result rather than throwing — malformed model
 * output is an expected condition, not an exception.
 *
 * The reason is carried out rather than swallowed. An earlier version
 * returned a bare `null`, so a timeout, a bad key, and a model that
 * answered in prose were indistinguishable to the caller, and the only
 * record was a server log line nobody was reading. Callers surface
 * this now.
 */
export async function kimiExtractJson<T>(input: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<KimiJsonResult<T>> {
  const call = (model: string) =>
    kimiChat({
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      model,
      maxTokens: input.maxTokens ?? 2048,
      timeoutMs: input.timeoutMs,
      jsonMode: true,
      // Classification into a fixed shape: nothing to reason about,
      // and the reasoning pass is what made each call take 30-90s.
      thinking: false,
    });

  const model = input.model ?? getExtractionModel();
  let result = await call(model);
  // A model the account cannot reach -- retired, or never granted, or a
  // stale KIMI_EXTRACTION_MODEL left in the environment -- fails every
  // call the same way. Fall back to the chat model, which the assistant
  // and translation prove works, rather than leave the inbox untouched
  // until someone reads the workflow log.
  if (!result.ok && isUnavailableModel(result.reason) && model !== getChatModel()) {
    result = await call(getChatModel());
  }

  if (!result.ok) return { ok: false, reason: result.reason };

  try {
    return { ok: true, data: JSON.parse(result.content) as T };
  } catch {
    // Some models wrap JSON in a fenced block despite json mode.
    const fenced = result.content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced?.[1]) {
      try {
        return { ok: true, data: JSON.parse(fenced[1]) as T };
      } catch {
        return { ok: false, reason: "malformed_json_in_fence" };
      }
    }
    // DeepSeek with reasoning off sometimes writes a sentence around the
    // object (HostHub saw the same). Take the outermost braces.
    const start = result.content.indexOf("{");
    const end = result.content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return { ok: true, data: JSON.parse(result.content.slice(start, end + 1)) as T };
      } catch {
        // fall through
      }
    }
    return { ok: false, reason: "malformed_json" };
  }
}
