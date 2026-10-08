"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { Locale } from "@/lib/i18n";

type Status = {
  enabled: boolean;
  smsPhone: string | null;
  smsConfigured: boolean;
  lastSentAt: string | null;
  wechat: {
    bindCode: string;
    subscribers: number;
    remaining: number;
    templateConfigured: boolean;
  } | null;
};

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        title: "新消息推到手机",
        intro:
          "客人在 Turo 上发来消息时，TATO 同步到后推一条到你手机：客人、车，以及消息的开头。15 分钟内的多条合成一条。打开之前的旧消息不会补推。",
        enabled: "推送新客人消息",
        wechatTitle: "微信（优先）",
        wechatBind: (code: string) => `在 TATO 小程序里输入绑定码 ${code} 订阅这个频道。`,
        wechatSubscribers: (count: number) => (count === 0 ? "还没有人绑定。" : `${count} 个微信已绑定。`),
        wechatQuota: (count: number) =>
          count === 0
            ? "推送额度为 0：下一条会改发短信。打开一次小程序就会补上。"
            : `还能推 ${count} 条。每次打开小程序会自动补。`,
        wechatNoTemplate: "小程序还没配置「提醒」消息模板，微信这条暂时发不出去，会直接发短信。",
        wechatUnavailable: "微信通知中心没有配置，只能用短信。",
        smsTitle: "短信（微信发不出时）",
        smsHint: "微信没人绑定或额度用完时，改发到这个号码。按条收费。",
        smsPlaceholder: "手机号，例如 604 555 0100",
        smsNotConfigured: "服务器还没配置 Twilio，短信发不出去。",
        save: "保存",
        saving: "保存中…",
        saved: "已保存",
        test: "发一条测试",
        testing: "发送中…",
        testResult: (via: string) =>
          via === "wechat" ? "已通过微信发出。" : via === "sms" ? "已通过短信发出。" : "没有发出去：",
        invalidPhone: "这个号码认不出来，请带区号。",
        lastSent: (when: string) => `上次推送：${when}`,
        loadFailed: "读取设置失败。",
        close: "关闭",
      }
    : {
        title: "Push new messages to my phone",
        intro:
          "When a guest writes on Turo, TATO sends your phone one line after the sync files it: the guest, the car and how the message starts. Messages within 15 minutes go out together. Nothing from before you switch this on is pushed.",
        enabled: "Push new guest messages",
        wechatTitle: "WeChat (first)",
        wechatBind: (code: string) => `In the TATO mini program, enter bind code ${code} to subscribe.`,
        wechatSubscribers: (count: number) =>
          count === 0 ? "Nobody has bound yet." : `${count} WeChat account(s) bound.`,
        wechatQuota: (count: number) =>
          count === 0
            ? "No pushes left: the next one goes by SMS. Opening the mini program tops it up."
            : `${count} push(es) left. Opening the mini program tops it up.`,
        wechatNoTemplate:
          "The mini program has no alert template yet, so WeChat cannot deliver; pushes go by SMS.",
        wechatUnavailable: "The WeChat hub is not configured here; SMS only.",
        smsTitle: "SMS (when WeChat cannot deliver)",
        smsHint: "Used when nobody is bound on WeChat or the quota has run out. Charged per message.",
        smsPlaceholder: "Phone, e.g. 604 555 0100",
        smsNotConfigured: "Twilio is not configured on the server, so SMS cannot be sent.",
        save: "Save",
        saving: "Saving…",
        saved: "Saved",
        test: "Send a test",
        testing: "Sending…",
        testResult: (via: string) =>
          via === "wechat" ? "Sent over WeChat." : via === "sms" ? "Sent by SMS." : "Not delivered: ",
        invalidPhone: "That number is not recognised; include the area code.",
        lastSent: (when: string) => `Last push: ${when}`,
        loadFailed: "Could not load the setting.",
        close: "Close",
      };
}

/**
 * Where the operator turns guest-message pushes on, binds WeChat and
 * sets the SMS fallback. See lib/guest-message-push.
 */
export function GuestMessageAlertPanel({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const t = useMemo(() => copy(locale), [locale]);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [smsPhone, setSmsPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/messages/alerts")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: Status) => {
        if (!alive) return;
        setStatus(data);
        setEnabled(data.enabled);
        setSmsPhone(data.smsPhone ?? "");
      })
      .catch(() => alive && setError(t.loadFailed));
    return () => {
      alive = false;
    };
  }, [t]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/messages/alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, smsPhone: smsPhone.trim() || null }),
      });
      const data = (await response.json().catch(() => ({}))) as Status & { error?: string };
      if (!response.ok) {
        setError(data.error === "INVALID_PHONE" ? t.invalidPhone : t.loadFailed);
        return;
      }
      setStatus(data);
      setSmsPhone(data.smsPhone ?? "");
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestMessage(null);
    try {
      const response = await fetch("/api/messages/alerts", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { via?: string; reason?: string };
      setTestMessage(`${t.testResult(data.via ?? "none")}${data.via === "none" || !data.via ? ` ${data.reason ?? ""}` : ""}`);
    } finally {
      setTesting(false);
    }
  }

  const wechat = status?.wechat ?? null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-alert-title"
    >
      <div
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] shadow-[0_28px_70px_-28px_rgba(17,19,24,0.55)] sm:w-[min(32rem,calc(100vw-2rem))] sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-3">
          <h3 id="guest-alert-title" className="text-[15px] font-bold text-[var(--ink)]">
            {t.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="tap-press flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-muted)]"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="grid gap-4 px-4 py-4 text-[13px] leading-5">
          <p className="text-[var(--ink-mid)]">{t.intro}</p>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-3 py-2.5">
            <span className="font-semibold text-[var(--ink)]">{t.enabled}</span>
            <input
              id="guest-alert-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-5 w-5 accent-[var(--brand)]"
            />
          </label>

          <section className="grid gap-1.5">
            <h4 className="text-[12px] font-bold text-[var(--ink)]">{t.wechatTitle}</h4>
            {!status ? null : !wechat ? (
              <p className="text-[var(--ink-soft)]">{t.wechatUnavailable}</p>
            ) : (
              <>
                <p className="text-[var(--ink-mid)]">{t.wechatBind(wechat.bindCode)}</p>
                <p className="text-[var(--ink-soft)]">{t.wechatSubscribers(wechat.subscribers)}</p>
                {!wechat.templateConfigured ? (
                  <p className="text-amber-800">{t.wechatNoTemplate}</p>
                ) : wechat.subscribers > 0 ? (
                  <p className={wechat.remaining === 0 ? "text-amber-800" : "text-[var(--ink-soft)]"}>
                    {t.wechatQuota(wechat.remaining)}
                  </p>
                ) : null}
              </>
            )}
          </section>

          <section className="grid gap-1.5">
            <h4 className="text-[12px] font-bold text-[var(--ink)]">{t.smsTitle}</h4>
            <p className="text-[var(--ink-soft)]">{t.smsHint}</p>
            <input
              id="guest-alert-sms"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={smsPhone}
              onChange={(event) => setSmsPhone(event.target.value)}
              placeholder={t.smsPlaceholder}
              className="h-10 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-[14px] outline-none focus:border-[var(--line-strong)]"
            />
            {status && !status.smsConfigured ? <p className="text-amber-800">{t.smsNotConfigured}</p> : null}
          </section>

          {error ? <p className="text-rose-600">{error}</p> : null}
          {testMessage ? <p className="text-[var(--ink-mid)]">{testMessage}</p> : null}
          {status?.lastSentAt ? (
            <p className="text-[11.5px] text-[var(--ink-soft)]">
              {t.lastSent(new Date(status.lastSentAt).toLocaleString(locale === "en" ? "en-CA" : "zh-CN"))}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || !status}
              className="tap-press h-10 rounded-full bg-[var(--ink)] px-5 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? t.saving : savedAt ? t.saved : t.save}
            </button>
            <button
              type="button"
              onClick={test}
              disabled={testing || !status}
              className="tap-press h-10 rounded-full border border-[var(--line)] px-4 text-[13px] font-semibold text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
            >
              {testing ? t.testing : t.test}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
