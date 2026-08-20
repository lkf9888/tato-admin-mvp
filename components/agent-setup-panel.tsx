"use client";

import { useState } from "react";

type Token = {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function AgentSetupPanel({
  bookmarklet,
  tokens,
  stats,
  title,
}: {
  bookmarklet: string;
  tokens: Token[];
  stats: { scraped: number; outbound: number };
  title: string;
}) {
  const [minted, setMinted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function mint() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/agent/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "浏览器书签", scopes: ["messages:write"] }),
      });
      const data = (await response.json()) as { token?: string };
      if (data.token) setMinted(data.token);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <header className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-3 sm:px-4">
        <p className="t-eyebrow text-[var(--ink-soft)]">AGENT</p>
        <h1 className="mt-0.5 text-[17px] font-bold text-[var(--ink)] sm:text-[19px]">{title}</h1>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[var(--ink-soft)]">
          Turo 只在客人发消息时发邮件，你回复时什么都不发——所以系统里的每个会话都是单向的。
          这个书签在你自己的浏览器里读回完整对话，包括你说过的话。
        </p>
      </header>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
        <h2 className="t-title text-[var(--ink)]">已读回</h2>
        <dl className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <dt className="t-eyebrow text-[var(--ink-soft)]">消息总数</dt>
            <dd className="mt-0.5 text-[20px] font-black tabular-nums text-[var(--ink)]">
              {stats.scraped}
            </dd>
          </div>
          <div>
            <dt className="t-eyebrow text-[var(--ink-soft)]">其中你方发出</dt>
            <dd className="mt-0.5 text-[20px] font-black tabular-nums text-[var(--brand)]">
              {stats.outbound}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
        <h2 className="t-title text-[var(--ink)]">1 · 令牌</h2>
        <p className="mt-1 text-[12px] leading-5 text-[var(--ink-soft)]">
          只显示一次，存的是哈希。丢了就再签一个，旧的吊销即可。
        </p>

        {minted ? (
          <div className="mt-2 rounded-md border border-[var(--brand)] bg-[var(--brand-soft)] p-3">
            <p className="text-[11px] font-bold text-[var(--brand)]">现在复制，之后无法再看到</p>
            <code className="mt-1 block select-all break-all text-[12px] text-[var(--ink)]">
              {minted}
            </code>
          </div>
        ) : (
          <button
            type="button"
            onClick={mint}
            disabled={busy}
            className="tap-press mt-2 rounded-md bg-[var(--ink)] px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
          >
            {busy ? "签发中…" : "签发新令牌"}
          </button>
        )}

        {tokens.length > 0 ? (
          <ul className="mt-3 space-y-1.5 border-t border-[var(--line)] pt-2">
            {tokens.map((token) => (
              <li key={token.id} className="flex items-baseline justify-between gap-2 text-[11.5px]">
                <span className="text-[var(--ink)]">
                  <span className="font-bold">{token.name}</span>{" "}
                  <code className="text-[var(--ink-soft)]">{token.tokenPrefix}…</code>
                </span>
                <span className="text-[var(--ink-soft)]">
                  {token.revokedAt
                    ? "已吊销"
                    : token.lastUsedAt
                      ? `最后使用 ${new Date(token.lastUsedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                      : "未使用"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
        <h2 className="t-title text-[var(--ink)]">2 · 书签</h2>
        <p className="mt-1 text-[12px] leading-5 text-[var(--ink-soft)]">
          把下面这个链接<strong>拖到浏览器书签栏</strong>。然后在任意 Turo 页面点它一下——
          它会依次读取最近 25 个会话并推送回来。第一次会问你要令牌，只问一次。
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href={bookmarklet}
          onClick={(event) => event.preventDefault()}
          className="mt-2 inline-flex cursor-grab items-center rounded-md bg-[var(--brand)] px-4 py-2.5 text-[13px] font-bold text-white"
        >
          ↕ 读取 Turo 会话
        </a>
        <p className="mt-2 text-[11px] leading-4 text-[var(--ink-soft)]">
          为什么是书签而不是后台任务：Turo 由 Cloudflare 防护，自动化浏览器全部被拦——
          自带的 Chromium 和你机器上真正的 Chrome 都试过，有头无头都一样，它认的是自动化连接本身。
          你本人在已登录的浏览器里点一下，不是伪装，是你在读自己的会话。
        </p>
      </section>
    </div>
  );
}
