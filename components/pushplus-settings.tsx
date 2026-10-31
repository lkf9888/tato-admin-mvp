"use client";

import { useEffect, useState } from "react";

import type { Locale } from "@/lib/i18n";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/notifications";

type Status = {
  configured: boolean;
  tokenTail: string | null;
  topic: string | null;
  group: boolean;
  enabled: boolean;
  categories: NotificationCategory[];
  lastSentAt: string | null;
  lastError: string | null;
  pending: number;
  failedToday: number;
};

/** Simplified Chinese only: PushPlus is a mainland-China WeChat service,
 *  and the section is shown only in that interface language. */
const t = {
  title: "微信通知（PushPlus）",
  hint: "通知同时发到微信，你和加入 PushPlus 群组的员工都会收到，员工不需要账号。每个 TATO 账号用自己的 PushPlus 账号和额度。只发摘要（车辆、日期、金额、后台链接），电话和邮箱会被隐去。",
  setupHint: "在 pushplus.plus 注册并实名，到「消息 Token」里给 TATO 新建一个 Token；要发给员工，再到「一对多消息」建一个群组，让员工扫码入群（你自己也要入群），把群组编码填在下面。",
  tokenLabel: "消息 Token",
  tokenPlaceholder: "粘贴 PushPlus 的消息 Token",
  tokenSaved: (tail: string) => `已保存（末四位 ${tail}）。要换就粘贴新的。`,
  topicLabel: "群组编码（可选）",
  topicPlaceholder: "一对多消息里的群组编码",
  noGroup: "没有填群组编码，现在只有 Token 的主人收得到。",
  saveAccount: "保存",
  savingAccount: "保存中…",
  clearToken: "移除 Token",
  enabled: "发到微信",
  categories: "微信接收这些通知",
  test: "发一条测试",
  testing: "发送中…",
  testOk: "已发出，去微信看看。",
  testFailed: "没有发出去：",
  lastSent: (when: string) => `上次送达 ${when}`,
  lastError: "上次失败：",
  queue: (pending: number, failed: number) =>
    [pending ? `${pending} 条等待重发` : "", failed ? `今天 ${failed} 条放弃` : ""].filter(Boolean).join("，"),
  failed: "保存失败，请重试",
};

/**
 * The WeChat (PushPlus) part of the notifications settings, shown only
 * in Simplified Chinese: the workspace's own PushPlus token and group
 * code, one switch and one set of categories for the workspace, since
 * the group is shared (lib/pushplus). Saves as it changes.
 */
export function PushPlusSettings({ locale }: { locale: Locale }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [topicInput, setTopicInput] = useState<string | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = locale === "zh";
  useEffect(() => {
    if (!shown) return;
    fetch("/api/messages/push/pushplus")
      .then((response) => (response.ok ? (response.json() as Promise<Status>) : null))
      .then((loaded) => setStatus(loaded))
      .catch(() => null);
  }, [shown]);

  async function saveAccount(token: string | undefined) {
    setSavingAccount(true);
    try {
      const response = await fetch("/api/messages/push/pushplus", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(token === undefined ? {} : { token }), topic: topicInput ?? status?.topic ?? "" }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setStatus((await response.json()) as Status);
      setTokenInput("");
      setTopicInput(null);
      setMessage(null);
    } catch {
      setMessage(t.failed);
    } finally {
      setSavingAccount(false);
    }
  }

  async function save(change: { enabled?: boolean; categories?: NotificationCategory[] }) {
    if (!status) return;
    const previous = status;
    setStatus({ ...status, ...change });
    const response = await fetch("/api/messages/push/pushplus", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    }).catch(() => null);
    if (!response?.ok) {
      setStatus(previous);
      setMessage(t.failed);
      return;
    }
    setStatus((await response.json()) as Status);
    setMessage(null);
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/messages/push/pushplus", { method: "POST" });
      const data = (await response.json()) as { ok: boolean; error?: string; status?: Status };
      if (data.status) setStatus(data.status);
      setMessage(data.ok ? t.testOk : `${t.testFailed}${data.error ?? response.status}`);
    } catch {
      setMessage(t.testFailed);
    } finally {
      setBusy(false);
    }
  }

  if (!shown || !status) return null;
  const when = (iso: string) => new Date(iso).toLocaleString("zh-CN");
  const queue = t.queue(status.pending, status.failedToday);

  return (
    <section className="grid gap-2 border-t border-[var(--line)] pt-3">
      <h3 className="text-[13px] font-bold text-[var(--ink)]">{t.title}</h3>
      <p className="-mt-1 text-[var(--ink-soft)]">{t.hint}</p>
      <div className="grid gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5">
        {!status.configured ? <p className="text-[var(--ink-mid)]">{t.setupHint}</p> : null}
        <label className="grid gap-1">
          <span className="text-[11.5px] font-semibold text-[var(--ink-soft)]">{t.tokenLabel}</span>
          <input
            type="password"
            autoComplete="off"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            placeholder={t.tokenPlaceholder}
            className="h-9 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-[13px] outline-none focus:border-[var(--line-strong)]"
          />
          {status.tokenTail ? (
            <span className="text-[11.5px] text-[var(--ink-soft)]">{t.tokenSaved(status.tokenTail)}</span>
          ) : null}
        </label>
        <label className="grid gap-1">
          <span className="text-[11.5px] font-semibold text-[var(--ink-soft)]">{t.topicLabel}</span>
          <input
            type="text"
            autoComplete="off"
            value={topicInput ?? status.topic ?? ""}
            onChange={(event) => setTopicInput(event.target.value)}
            placeholder={t.topicPlaceholder}
            className="h-9 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-[13px] outline-none focus:border-[var(--line-strong)]"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void saveAccount(tokenInput.trim() ? tokenInput.trim() : undefined)}
            disabled={savingAccount || (!tokenInput.trim() && topicInput === null)}
            className="tap-press h-9 rounded-full bg-[var(--ink)] px-4 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {savingAccount ? t.savingAccount : t.saveAccount}
          </button>
          {status.configured ? (
            <button
              type="button"
              onClick={() => void saveAccount("")}
              disabled={savingAccount}
              className="tap-press h-9 rounded-full px-3 text-[12px] font-semibold text-[var(--ink-soft)] hover:text-[var(--bad-fg)] disabled:opacity-50"
            >
              {t.clearToken}
            </button>
          ) : null}
        </div>
      </div>
      {status.configured ? (
        <>
          {!status.group ? <p className="text-amber-800">{t.noGroup}</p> : null}
          <label className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-3 py-2.5">
            <span className="font-semibold text-[var(--ink)]">{t.enabled}</span>
            <input
              type="checkbox"
              checked={status.enabled}
              onChange={(event) => void save({ enabled: event.target.checked })}
              className="h-5 w-5 accent-[var(--brand)]"
            />
          </label>
          {status.enabled ? (
            <div className="grid gap-1.5">
              <span className="text-[11.5px] font-semibold text-[var(--ink-soft)]">{t.categories}</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.categories}>
                {NOTIFICATION_CATEGORIES.map((category) => {
                  const on = status.categories.includes(category.key);
                  return (
                    <button
                      key={category.key}
                      type="button"
                      role="switch"
                      aria-checked={on}
                      title={category.zhHint}
                      onClick={() =>
                        void save({
                          categories: on
                            ? status.categories.filter((key) => key !== category.key)
                            : [...status.categories, category.key],
                        })
                      }
                      className={`tap-press tap-compact hit-area rounded-full border px-2.5 py-1 text-[12px] font-semibold transition ${
                        on
                          ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                          : "border-[var(--line)] text-[var(--ink-soft)]"
                      }`}
                    >
                      {on ? "✓ " : ""}
                      {category.zh}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void test()}
              disabled={busy}
              className="tap-press h-9 rounded-full border border-[var(--line)] px-4 text-[13px] font-semibold text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
            >
              {busy ? t.testing : t.test}
            </button>
            {message ? <span className="text-[var(--ink-mid)]">{message}</span> : null}
          </div>
          <p className="text-[11.5px] text-[var(--ink-soft)]">
            {[status.lastSentAt ? t.lastSent(when(status.lastSentAt)) : "", queue].filter(Boolean).join(" · ")}
            {status.lastError ? (
              <span className="block text-amber-800">
                {t.lastError}
                {status.lastError}
              </span>
            ) : null}
          </p>
        </>
      ) : null}
      {message && !status.configured ? <p className="text-[var(--bad-fg)]">{message}</p> : null}
    </section>
  );
}
