"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Token = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/** The read API's endpoints, for the operator handing them to an
 *  agent. The machine-readable version lives at GET /api/agent, which
 *  is what the agent itself should call. */
const READ_ENDPOINTS: Array<[string, string]> = [
  ["GET /api/agent", "接口目录：所有端点、参数、返回格式"],
  ["GET /api/agent/account", "账户总览：车队规模、订单状态、本月收入、待处理事项"],
  ["GET /api/agent/vehicles", "车队"],
  ["GET /api/agent/orders", "订单，可按状态/来源/车辆/车主/日期筛选"],
  ["GET /api/agent/orders/{id}", "单笔订单，含 Turo 的逐项收费明细"],
  ["GET /api/agent/owners", "分成车主、当前佣金条款、余额"],
  ["GET /api/agent/owners/{id}/ledger", "某个车主的流水账"],
  ["GET /api/agent/threads", "客人会话"],
  ["GET /api/agent/pending-orders", "未能挂到车上的预订——等人决定的那些"],
  ["GET /api/agent/message-templates", "消息模板"],
];

/** What a read-write token adds. Both feed import code that already
 *  exists -- the CSV page's and the booking mail's -- so a trip written
 *  here is matched, deduplicated and parked exactly as one arriving any
 *  other way. */
const WRITE_ENDPOINTS: Array<[string, string]> = [
  ["POST /api/agent/imports", "上传 Turo 导出的 CSV 原文——带车牌和金额，和手动导入 CSV 同一套逻辑"],
  ["POST /api/agent/trips", "逐笔推送从 Turo 行程页读到的订单——和预订邮件同一套配车规则，配不上就进待分配，不写金额"],
];

export function AgentSetupPanel({
  appUrl,
  bookmarklet,
  tokens,
  stats,
  title,
}: {
  appUrl: string;
  bookmarklet: string;
  tokens: Token[];
  stats: { scraped: number; outbound: number };
  title: string;
}) {
  const [minted, setMinted] = useState<string | null>(null);
  const router = useRouter();
  const [mintedRead, setMintedRead] = useState<{ token: string; write: boolean } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyRead, setBusyRead] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  /**
   * The href is set through the DOM, not through JSX.
   *
   * React refuses to render a `javascript:` URL and substitutes one
   * that throws: the bookmark this page handed out contained React's
   * error rather than the reader, which is why clicking it did
   * nothing at all. Setting the attribute afterwards is the same
   * anchor, past the sanitiser -- and the sanitiser is protecting
   * against untrusted URLs reaching an href, which is not what this
   * is: the source is built on the server, in this repository.
   */
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    linkRef.current?.setAttribute("href", bookmarklet);
  }, [bookmarklet]);

  async function copyBookmarklet() {
    await navigator.clipboard.writeText(bookmarklet).catch(() => null);
    setCopied(true);
  }

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

  /** Read-only by default; `write` adds `orders:write` for an agent
   *  that imports trips. Two separate tokens rather than one upgraded
   *  in place, so an automation that only reports can never be handed
   *  a credential that edits the calendar. */
  async function mintApiToken(write: boolean) {
    if (busyRead) return;
    setBusyRead(true);
    try {
      const response = await fetch("/api/agent/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          write
            ? { name: "读写 API", scopes: ["read", "orders:write"] }
            : { name: "只读 API", scopes: ["read"] },
        ),
      });
      const data = (await response.json()) as { token?: string };
      if (data.token) {
        setMintedRead({ token: data.token, write });
        router.refresh();
      }
    } finally {
      setBusyRead(false);
    }
  }

  async function revoke(id: string) {
    if (revoking) return;
    if (!window.confirm("吊销后，用这个令牌的书签或 Agent 立即失效，不能恢复。继续？")) return;
    setRevoking(id);
    try {
      await fetch("/api/agent/tokens", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      router.refresh();
    } finally {
      setRevoking(null);
    }
  }

  async function copyCurl() {
    await navigator.clipboard
      .writeText(
        `curl -H "Authorization: Bearer $TATO_TOKEN" ${appUrl}/api/agent/account`,
      )
      .catch(() => null);
    setCopiedCurl(true);
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
                  <code className="text-[var(--ink-soft)]">{token.tokenPrefix}…</code>{" "}
                  <span className="rounded border border-[var(--line)] px-1 py-0.5 text-[10px] text-[var(--ink-soft)]">
                    {token.scopes}
                  </span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2 text-[var(--ink-soft)]">
                  {token.revokedAt
                    ? "已吊销"
                    : token.lastUsedAt
                      ? `最后使用 ${new Date(token.lastUsedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                      : "未使用"}
                  {token.revokedAt ? null : (
                    <button
                      type="button"
                      onClick={() => revoke(token.id)}
                      disabled={revoking === token.id}
                      className="tap-press font-bold text-[var(--bad-fg)] disabled:opacity-50"
                    >
                      {revoking === token.id ? "吊销中…" : "吊销"}
                    </button>
                  )}
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
        <div className="tap-row mt-2 flex flex-wrap items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            ref={linkRef}
            onClick={(event) => event.preventDefault()}
            className="inline-flex cursor-grab items-center rounded-md bg-[var(--brand)] px-4 py-2.5 text-[13px] font-bold text-white"
          >
            ↕ 读取 Turo 会话
          </a>
          <button
            type="button"
            onClick={copyBookmarklet}
            className="tap-press rounded-md border border-[var(--line-strong)] bg-white px-3 py-2.5 text-[12.5px] font-bold text-[var(--ink-mid)]"
          >
            {copied ? "已复制" : "复制代码"}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-[var(--ink-soft)]">
          拖不动的话用「复制代码」：书签栏右键 → 添加网页，名称随便填，网址栏粘贴。
        </p>
        <p className="mt-2 text-[11px] leading-4 text-[var(--ink-soft)]">
          为什么是书签而不是后台任务：Turo 由 Cloudflare 防护，自动化浏览器全部被拦——
          自带的 Chromium 和你机器上真正的 Chrome 都试过，有头无头都一样，它认的是自动化连接本身。
          你本人在已登录的浏览器里点一下，不是伪装，是你在读自己的会话。
        </p>
      </section>

      {/* The read API. Separate section, separate token: the bookmarklet
          writes conversations and this reads the account, and one
          credential doing both would mean revoking the laptop's token
          also breaks every automation. */}
      {/* Anchored, because the way in is a link from account settings
          and this sits below two screens of bookmarklet setup that
          have nothing to do with it. */}
      <section
        id="api"
        className="scroll-mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4"
      >
        <h2 className="t-title text-[var(--ink)]">API</h2>
        <p className="mt-1 text-[12px] leading-5 text-[var(--ink-soft)]">
          给 AI Agent 或脚本用。<strong>只读令牌</strong>只能读——订单、金额、分成规则、流水账都改不了。
          <strong>读写令牌</strong>另外能把 Turo 的订单导进来：新建或更新订单，配不上车的放进待分配；
          不会新建车辆，改不了分成规则，也删不掉任何东西。只需要读的 Agent，就给它只读的。
        </p>

        <div className="mt-2 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-2.5">
          <p className="t-eyebrow text-[var(--ink-soft)]">基址</p>
          <code className="mt-0.5 block select-all break-all text-[12px] text-[var(--ink)]">
            {appUrl}/api/agent
          </code>
        </div>

        {mintedRead ? (
          <div className="mt-2 rounded-md border border-[var(--brand)] bg-[var(--brand-soft)] p-3">
            <p className="text-[11px] font-bold text-[var(--brand)]">
              {mintedRead.write ? "读写令牌" : "只读令牌"} · 现在复制，之后无法再看到
            </p>
            <code className="mt-1 block select-all break-all text-[12px] text-[var(--ink)]">
              {mintedRead.token}
            </code>
          </div>
        ) : (
          <div className="tap-row mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => mintApiToken(false)}
              disabled={busyRead}
              className="tap-press rounded-md bg-[var(--ink)] px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
            >
              {busyRead ? "签发中…" : "签发只读令牌"}
            </button>
            <button
              type="button"
              onClick={() => mintApiToken(true)}
              disabled={busyRead}
              className="tap-press rounded-md border border-[var(--line-strong)] bg-white px-3 py-2 text-[12.5px] font-bold text-[var(--ink-mid)] disabled:opacity-50"
            >
              签发读写令牌
            </button>
          </div>
        )}

        <div className="mt-3 border-t border-[var(--line)] pt-2">
          <div className="tap-row flex flex-wrap items-center justify-between gap-2">
            <p className="t-eyebrow text-[var(--ink-soft)]">先试一下</p>
            <button
              type="button"
              onClick={copyCurl}
              className="tap-press rounded-md border border-[var(--line-strong)] bg-white px-2.5 py-1.5 text-[11.5px] font-bold text-[var(--ink-mid)]"
            >
              {copiedCurl ? "已复制" : "复制 curl"}
            </button>
          </div>
          <code className="mt-1 block overflow-x-auto whitespace-pre text-[11px] leading-5 text-[var(--ink-mid)]">
            {`curl -H "Authorization: Bearer $TATO_TOKEN" \\\n  ${appUrl}/api/agent/account`}
          </code>
        </div>

        <div className="mt-3 border-t border-[var(--line)] pt-2">
          <p className="t-eyebrow text-[var(--ink-soft)]">能读什么</p>
          <ul className="mt-1.5 space-y-1">
            {READ_ENDPOINTS.map(([path, description]) => (
              <li key={path} className="text-[11.5px] leading-5">
                <code className="text-[var(--ink)]">{path}</code>
                <span className="text-[var(--ink-soft)]"> — {description}</span>
              </li>
            ))}
          </ul>
          <p className="t-eyebrow mt-3 text-[var(--ink-soft)]">读写令牌还能写</p>
          <ul className="mt-1.5 space-y-1">
            {WRITE_ENDPOINTS.map(([path, description]) => (
              <li key={path} className="text-[11.5px] leading-5">
                <code className="text-[var(--ink)]">{path}</code>
                <span className="text-[var(--ink-soft)]"> — {description}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-4 text-[var(--ink-soft)]">
            把基址和令牌交给 Agent 就够了，剩下的它自己问：<code>GET /api/agent</code>{" "}
            会返回完整的接口目录、每个参数的含义和返回格式，不用它猜路径。
          </p>
          <p className="mt-1.5 text-[11px] leading-4 text-[var(--ink-soft)]">
            返回内容里包含客人的电话号码（自动化联系客人需要），所以这个令牌等同于持有客户个人信息，
            丢了就在上面吊销重签。
          </p>
        </div>
      </section>
    </div>
  );
}
