"use client";

import { useState } from "react";

import type { Locale } from "@/lib/i18n";

export function InviteAcceptForm({ token, defaultName, locale }: { token: string; defaultName: string; locale: Locale }) {
  const zh = locale !== "en";
  const [name, setName] = useState(defaultName);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setError(zh ? "密码至少 8 位。" : "Use at least 8 characters.");
    if (password !== confirm) return setError(zh ? "两次输入的密码不一样。" : "The passwords do not match.");
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password }),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => ({})) : {};
    if (response?.ok) {
      window.location.href = "/dashboard";
      return;
    }
    setSaving(false);
    setError(
      payload.error === "EMAIL_IN_USE"
        ? zh ? "这个邮箱已经有 TATO 账号了，请直接登录，或让对方换一个邮箱邀请你。" : "This email already has a TATO account. Sign in, or ask to be invited at another address."
        : payload.error === "INVITE_INVALID"
          ? zh ? "邀请已失效。" : "This invitation is no longer valid."
          : zh ? "没能完成，请重试。" : "That did not work. Try again.",
    );
  }

  const field = "mt-1 min-h-10 w-full rounded-md border border-[var(--line)] px-3 text-sm";
  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 text-sm">
      <label>
        {zh ? "你的名字" : "Your name"}
        <input value={name} onChange={(event) => setName(event.target.value)} required className={field} />
      </label>
      <label>
        {zh ? "密码（至少 8 位）" : "Password (8+ characters)"}
        <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required className={field} />
      </label>
      <label>
        {zh ? "再输一次" : "Again"}
        <input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required className={field} />
      </label>
      {error ? <p className="text-rose-600">{error}</p> : null}
      <button className="btn-primary" disabled={saving}>{saving ? (zh ? "处理中…" : "Working…") : zh ? "加入团队" : "Join the team"}</button>
    </form>
  );
}
