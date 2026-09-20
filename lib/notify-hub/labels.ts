import "server-only";

/**
 * What the mini program calls each field.
 *
 * These used to live in the mini program as a hard-coded dictionary,
 * which meant a system sending a field nobody had named yet -- HostHub's
 * `room`, the wash bay's `plate` -- rendered as "room 302" until someone
 * shipped a new version of the client. That is a WeChat review, measured
 * in days, for the sake of one word.
 *
 * Resolved server-side instead, at read time rather than at send time:
 * changing a label is a database write, and it applies to messages that
 * have already been delivered.
 */

/**
 * The fields every system sends, named once.
 *
 * Deliberately short. A label belongs here only when more than one app
 * would use it; anything app-specific goes on the app.
 */
const DEFAULT_FIELD_LABELS: Record<string, string> = {
  title: "内容",
  due: "时间",
  // A fleet system: TATO assigns work on a car and the wash bay
  // photographs one, so this is shared vocabulary, not TATO's alone.
  vehicle: "车辆",
  action: "类型",
  details: "备注",
  source: "来源",
  location: "地点",
  amount: "金额",
};

function parseLabels(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const labels: Record<string, string> = {};
    for (const [field, label] of Object.entries(parsed as Record<string, unknown>)) {
      // A label long enough to break the layout is worse than the raw
      // field name, which at least fits.
      if (typeof label === "string" && label.trim()) {
        labels[field] = label.trim().slice(0, 12);
      }
    }
    return labels;
  } catch {
    return {};
  }
}

/**
 * One app's labels: its own over the shared defaults.
 *
 * An app may override a default -- the wash bay's "时间" might be
 * "拍照时间" -- which is why its own map wins.
 */
export function resolveFieldLabels(appFieldLabels: string | null | undefined) {
  return { ...DEFAULT_FIELD_LABELS, ...parseLabels(appFieldLabels) };
}

/** Validate a label map before storing it. Throws with a usable message. */
export function assertValidFieldLabels(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("--labels must be JSON, e.g. '{\"room\":\"房间\"}'");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--labels must be a JSON object of field -> label");
  }
  for (const [field, label] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof label !== "string" || !label.trim()) {
      throw new Error(`label for "${field}" must be a non-empty string`);
    }
  }
}

export { DEFAULT_FIELD_LABELS };
