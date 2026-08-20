import "server-only";

/**
 * The bookmarklet source.
 *
 * Turo sits behind Cloudflare, which blocked every automated browser
 * pointed at it -- Playwright's bundled Chromium and the real Chrome
 * binary alike, headed and headless. What it recognises is the
 * automation connection, not the absence of a window, so a better
 * browser was never going to be the answer.
 *
 * What is left, and what works, is the operator's own browser: a real
 * person, already signed in, clicking a bookmark. Nothing here evades
 * anything. It reads a page that is already open to someone entitled
 * to read it.
 *
 * The parsing is the algorithm verified against a live thread in
 * v0.45.1 -- attribution lines terminate messages, roles carry the
 * direction, day separators carry the year.
 *
 * Conversations after the first are loaded in a same-origin iframe.
 * Turo sends `X-Frame-Options: SAMEORIGIN`, which forbids *other*
 * sites from framing it and permits turo.com framing itself, so the
 * script can walk a queue without the page reloading out from under
 * it.
 */
export function buildBookmarkletSource(appUrl: string) {
  const base = appUrl.replace(/\/+$/, "");

  return `(async () => {
  const BASE = ${JSON.stringify(base)};
  const KEY = "tato.agentToken";

  let token = localStorage.getItem(KEY);
  if (!token) {
    token = prompt("Paste the TATO agent token (starts with tato_). Stored in this browser only.");
    if (!token) return;
    localStorage.setItem(KEY, token.trim());
    token = token.trim();
  }

  const ATTRIBUTION = /^(\\d{1,2}:\\d{2}\\s*(?:AM|PM))\\s*[-\\u2013]\\s*(.+?)\\s*\\((Guest|Co-host|Host|Owner)\\)\\s*$/i;
  const DAY = /^(Today|Yesterday|[A-Z][a-z]{2},\\s+[A-Z][a-z]{2}\\s+\\d{1,2},\\s+\\d{4})$/;

  function toIso(day, time) {
    let base;
    if (/^Today$/i.test(day)) base = new Date();
    else if (/^Yesterday$/i.test(day)) { base = new Date(); base.setDate(base.getDate() - 1); }
    else base = new Date(String(day).replace(/^[A-Z][a-z]{2},\\s*/, ""));
    const m = String(time).match(/^(\\d{1,2}):(\\d{2})\\s*(AM|PM)$/i);
    if (!m || isNaN(base.getTime())) return null;
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) h += 12;
    base.setHours(h, Number(m[2]), 0, 0);
    return base.toISOString();
  }

  function scrape(doc) {
    const bubbles = [...doc.querySelectorAll('div[class*="messageOuterContainerStyles"]')];
    if (!bubbles.length) return null;
    let root = doc.querySelector('div[class*="conversationInnerContainerStyles"]') || bubbles[0];
    while (root && !bubbles.every((b) => root.contains(b))) root = root.parentElement;
    if (!root) return null;

    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const out = [];
    let day = null, buf = [];
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (el.children.length !== 0) continue;
      const text = (el.textContent || "").trim();
      if (!text) continue;
      if (DAY.test(text)) { day = text; buf = []; continue; }
      const a = text.match(ATTRIBUTION);
      if (a) {
        const body = buf.join("\\n").trim();
        buf = [];
        const sentAt = toIso(day, a[1]);
        if (body && sentAt) {
          out.push({
            direction: /guest/i.test(a[3]) ? "inbound" : "outbound",
            authorName: (a[2] + " (" + a[3] + ")").slice(0, 120),
            body: body.slice(0, 4000),
            sentAt,
          });
        }
        continue;
      }
      if (text.length > 1 && !/^(View message options|Insert a new line)/i.test(text)) buf.push(text);
    }
    return out;
  }

  const banner = document.createElement("div");
  banner.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:340px;padding:12px 14px;border-radius:8px;background:#121214;color:#fff;font:13px/1.5 -apple-system,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3);white-space:pre-line";
  document.body.appendChild(banner);
  const say = (text) => { banner.textContent = text; };

  say("TATO：正在取会话清单…");

  let ids = [];
  try {
    const res = await fetch(BASE + "/api/agent/reservations?limit=25", {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.status === 401) {
      localStorage.removeItem(KEY);
      say("令牌无效，已清除。再点一次书签重新输入。");
      return;
    }
    ids = (await res.json()).reservationIds || [];
  } catch (e) {
    say("取清单失败：" + e.message);
    return;
  }

  const here = location.pathname.match(/reservation\\/(\\d+)/);
  if (here && !ids.includes(here[1])) ids.unshift(here[1]);
  if (!ids.length) { say("没有需要读取的会话。"); return; }

  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;left:-9999px;width:1200px;height:900px";
  document.body.appendChild(frame);

  let created = 0, updated = 0, failed = 0;

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    say("TATO：" + (i + 1) + " / " + ids.length + "\\n新增 " + created + " · 更新 " + updated + (failed ? " · 失败 " + failed : ""));
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("载入超时")), 25000);
        frame.onload = () => { clearTimeout(timer); resolve(); };
        frame.src = "https://turo.com/us/en/reservation/" + id + "/messages";
      });
      // The thread renders after load; give it a moment rather than
      // racing it and reporting an empty conversation.
      await new Promise((r) => setTimeout(r, 2500));

      const messages = scrape(frame.contentDocument);
      if (!messages || !messages.length) { failed += 1; continue; }

      const push = await fetch(BASE + "/api/agent/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ reservationId: id, source: "bookmarklet", messages }),
      });
      const body = await push.json();
      if (!push.ok) { failed += 1; continue; }
      created += body.created || 0;
      updated += body.updated || 0;
    } catch (e) {
      failed += 1;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  frame.remove();
  say("TATO 完成\\n新增 " + created + " · 更新 " + updated + (failed ? "\\n失败 " + failed + " 条会话" : ""));
  setTimeout(() => banner.remove(), 15000);
})();`;
}
