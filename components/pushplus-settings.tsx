"use client";

import { useEffect, useState } from "react";

import type { Locale } from "@/lib/i18n";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/notifications";

type Status = {
  configured: boolean;
  group: boolean;
  enabled: boolean;
  categories: NotificationCategory[];
  lastSentAt: string | null;
  lastError: string | null;
  pending: number;
  failedToday: number;
};

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        title: "微信（PushPlus）",
        hint: "通知同时发到微信，你和加入 PushPlus 群组的员工都会收到，员工不需要账号。只发摘要（车辆、日期、金额、后台链接），电话和邮箱会被隐去。",
        notConfigured: "服务器还没配置 PushPlus 的消息 Token（PUSHPLUS_TOKEN），暂时发不出去。",
        noGroup: "没有配置群组编码（PUSHPLUS_TOPIC），现在只有 Token 的主人收得到。要发给员工，在 PushPlus 后台「一对多消息」建群组，把编码配上。",
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
      }
    : {
        title: "WeChat (PushPlus)",
        hint: "Notifications also go to WeChat: you and staff in the PushPlus group get them, without an account. Summaries only (car, dates, amounts, a link back); phone numbers and emails are hidden.",
        notConfigured: "The PushPlus message token (PUSHPLUS_TOKEN) is not set on the server yet.",
        noGroup: "No group code (PUSHPLUS_TOPIC) is set, so only the token's owner receives them. To reach staff, create a group under 一对多消息 in PushPlus and set its code.",
        enabled: "Send to WeChat",
        categories: "WeChat receives",
        test: "Send a test",
        testing: "Sending…",
        testOk: "Sent. Check WeChat.",
        testFailed: "Not delivered: ",
        lastSent: (when: string) => `Last delivered ${when}`,
        lastError: "Last failure: ",
        queue: (pending: number, failed: number) =>
          [pending ? `${pending} waiting to retry` : "", failed ? `${failed} given up today` : ""].filter(Boolean).join(", "),
        failed: "Couldn't save. Try again",
      };
}

/**
 * The WeChat (PushPlus) part of the notifications settings: one switch
 * and one set of categories for the whole workspace, since the group is
 * shared (lib/pushplus). Saves as it changes.
 */
export function PushPlusSettings({ locale }: { locale: Locale }) {
  const t = copy(locale);
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/messages/push/pushplus")
      .then((response) => (response.ok ? (response.json() as Promise<Status>) : null))
      .then((loaded) => setStatus(loaded))
      .catch(() => null);
  }, []);

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

  if (!status) return null;
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "en" ? "en-CA" : "zh-CN");
  const queue = t.queue(status.pending, status.failedToday);

  return (
    <section className="grid gap-2 border-t border-[var(--line)] pt-3">
      <h3 className="text-[13px] font-bold text-[var(--ink)]">{t.title}</h3>
      <p className="-mt-1 text-[var(--ink-soft)]">{t.hint}</p>
      {!status.configured ? (
        <p className="text-amber-800">{t.notConfigured}</p>
      ) : (
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
                      title={locale === "en" ? category.enHint : category.zhHint}
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
                      {locale === "en" ? category.en : category.zh}
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
      )}
    </section>
  );
}
