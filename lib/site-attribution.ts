/**
 * Which ad or link brought a renter, carried from the page they landed
 * on to the thank-you page after Stripe.
 *
 * Google reads the source off the address: `utm_*` for GA4, `gclid`
 * (and Apple's `gbraid` / `wbraid`) for Ads. Those parameters are only
 * on the first page -- the company site hands them to the framed site
 * in its `src` -- and every click after that drops them. The payment
 * then happens on checkout.stripe.com, so the renter comes back with
 * Stripe as the referrer and, without help, GA4 credits the booking to
 * Stripe and Ads cannot tie it to the click.
 *
 * So the landing page keeps them (`rememberAttribution`), checkout
 * sends them with the booking, and the server puts them back on
 * Stripe's success URL. The thank-you page then has them in its own
 * address, where gtag picks them up before the purchase is reported.
 *
 * Nothing here is personal: campaign names and Google's click ids.
 */

export const ATTRIBUTION_KEYS = [
  "gclid",
  "gbraid",
  "wbraid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
] as const;

export type Attribution = Partial<Record<(typeof ATTRIBUTION_KEYS)[number], string>>;

const MAX_VALUE_CHARS = 200;

/** How long a click keeps the credit when the renter books on a later visit. */
const KEEP_MS = 30 * 24 * 3_600_000;

function clean(value: unknown) {
  if (typeof value !== "string") return null;
  // Printable text only: these go back into a URL and into gtag.
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!text || text.length > MAX_VALUE_CHARS) return null;
  // A lone surrogate would make encodeURIComponent throw mid-checkout.
  try {
    encodeURIComponent(text);
  } catch {
    return null;
  }
  return text;
}

/** The known keys of `source` with usable values; anything else is dropped. */
export function pickAttribution(source: URLSearchParams | Record<string, unknown> | null | undefined): Attribution {
  const picked: Attribution = {};
  if (!source) return picked;
  for (const key of ATTRIBUTION_KEYS) {
    const value = clean(source instanceof URLSearchParams ? source.get(key) : source[key]);
    if (value) picked[key] = value;
  }
  return picked;
}

/** `pickAttribution` of a JSON string, for the value a form posted. */
export function parseAttribution(raw: unknown): Attribution {
  if (typeof raw !== "string" || !raw || raw.length > 4_000) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? pickAttribution(parsed) : {};
  } catch {
    return {};
  }
}

/**
 * `url` with the attribution added to its query. String work, not
 * `URL`: Stripe's success URL carries a literal `{CHECKOUT_SESSION_ID}`
 * that `URL` would percent-encode out of Stripe's reach.
 */
export function appendAttribution(url: string, attribution: Attribution) {
  const pairs = ATTRIBUTION_KEYS.flatMap((key) =>
    attribution[key] ? [`${key}=${encodeURIComponent(attribution[key]!)}`] : [],
  );
  if (!pairs.length) return url;
  const hash = url.indexOf("#");
  const [base, fragment] = hash >= 0 ? [url.slice(0, hash), url.slice(hash)] : [url, ""];
  return `${base}${base.includes("?") ? "&" : "?"}${pairs.join("&")}${fragment}`;
}

/**
 * One store per site: on the platform host several sites share an
 * origin (`/s/<slug>`), and one site's ad must not credit another's.
 */
function storageKey(location: Pick<Location, "host" | "pathname">) {
  const slug = /^\/s\/([^/]+)/.exec(location.pathname)?.[1];
  return `tato-site-attribution:${slug ? `s/${slug}` : location.host}`;
}

type Remembered = { key: string; at: number; attribution: Attribution };

/** This tab's copy, for when storage is blocked; it lasts while the page does. */
let inMemory: Remembered | null = null;

/**
 * Keep this page's attribution, when it has any. A newer click replaces
 * the whole set rather than merging into it, so a `utm_source` from
 * last week is never paired with today's `gclid`.
 *
 * Not on the pages Stripe sends renters back to (`?checkout=`): the
 * thank-you page carries the source on purpose, and reopening it later
 * is not a new click -- taking it for one would overwrite a newer
 * source and restart the thirty days.
 */
export function rememberAttribution(now = Date.now()) {
  const params = new URLSearchParams(window.location.search);
  if (params.has("checkout")) return;
  const attribution = pickAttribution(params);
  if (!Object.keys(attribution).length) return;
  inMemory = { key: storageKey(window.location), at: now, attribution };
  try {
    window.localStorage.setItem(inMemory.key, JSON.stringify({ at: now, attribution }));
  } catch {
    // Storage blocked: the in-memory copy still reaches this visit's checkout.
  }
}

function fresh(at: unknown, now: number) {
  return typeof at === "number" && now - at <= KEEP_MS;
}

/**
 * What `rememberAttribution` kept for this site, unless it has expired:
 * the newer of the stored copy and this tab's, since a write can fail
 * (quota, blocked storage) while an older stored copy still reads.
 */
export function recallAttribution(now = Date.now()): Attribution {
  const key = storageKey(window.location);
  let stored: { at: number; attribution: Attribution } | null = null;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as { at?: unknown; attribution?: unknown }) : null;
    if (parsed && typeof parsed.at === "number") {
      stored = { at: parsed.at, attribution: pickAttribution(parsed.attribution as Record<string, unknown>) };
    }
  } catch {
    // Blocked or unreadable: this tab's copy is all there is.
  }
  const mine = inMemory && inMemory.key === key ? inMemory : null;
  const newest = [stored, mine]
    .filter((each): each is { at: number; attribution: Attribution } => Boolean(each && fresh(each.at, now)))
    .sort((a, b) => b.at - a.at)[0];
  return newest?.attribution ?? {};
}
