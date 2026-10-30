/**
 * A rental site shown inside the operator's own company site.
 *
 * The operator's site frames the booking site as one of its pages
 * (speedxrental.com/en/rent frames rent.speedxrental.com), so a guest
 * books without leaving it. Two things change inside the frame:
 *
 * - the booking site's own header is hidden: the company site's
 *   navigation is right above it, and two headers with the same brand
 *   read as a broken page. SiteShell runs SITE_EMBED_SCRIPT before
 *   paint, which adds a style hiding `.site-embed-hide` when framed.
 * - Stripe Checkout refuses to load in a frame, so the payment page
 *   opens in the whole window (`openWholePage`).
 */

/** `postMessage` type the company site listens for. */
export const SITE_EMBED_OPEN_MESSAGE = "tato-site:open";

/** Class of whatever the frame hides. */
export const SITE_EMBED_HIDE_CLASS = "site-embed-hide";

/**
 * Inline, before paint, so a framed page never flashes the header.
 * A style element rather than an attribute on <html>: React owns the
 * attributes of the elements it rendered and would fight over them.
 */
export const SITE_EMBED_SCRIPT = `(function(){var framed;try{framed=window.self!==window.top}catch(e){framed=true}if(!framed||document.getElementById("site-embed-style"))return;var s=document.createElement("style");s.id="site-embed-style";s.textContent=".${SITE_EMBED_HIDE_CLASS}{display:none!important}";document.head.appendChild(s)})();`;

function isFramed() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** Last label pair of a host -- `speedxrental.com` for `rent.speedxrental.com`. */
function siteFamily(hostname: string) {
  return hostname.split(".").slice(-2).join(".");
}

/**
 * The framing page's origin, when it belongs to the same domain as this
 * site. Messages carry a checkout address, so they go only there, never
 * to `*` -- a stranger framing the site learns nothing from them.
 */
function framingOrigin(): string | null {
  const candidate =
    window.location.ancestorOrigins?.[0] ??
    (document.referrer ? (() => {
      try {
        return new URL(document.referrer).origin;
      } catch {
        return null;
      }
    })() : null);
  if (!candidate) return null;
  try {
    const parent = new URL(candidate).hostname;
    const family = siteFamily(window.location.hostname);
    return parent === family || parent.endsWith(`.${family}`) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Go to `url` in the whole browser window. Outside a frame that is an
 * ordinary navigation. Inside one, the company site is asked to do it
 * (it can, without the browser's limits on frames moving their parent),
 * and the frame also tries itself in case the parent does not listen.
 */
export function openWholePage(url: string) {
  if (!isFramed()) {
    window.location.href = url;
    return;
  }
  const origin = framingOrigin();
  if (origin) window.parent.postMessage({ type: SITE_EMBED_OPEN_MESSAGE, url }, origin);
  try {
    window.top!.location.href = url;
  } catch {
    if (!origin) window.location.href = url;
  }
}
