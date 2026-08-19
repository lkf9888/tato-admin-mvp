"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Locale } from "@/lib/i18n";

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        back: "车主分成",
        title: "新建车主",
        fields: {
          name: "车主姓名",
          email: "邮箱",
          phone: "电话",
          company: "公司",
          notes: "备注",
        },
        placeholders: {
          name: "输入车主姓名",
        },
        create: "创建车主",
        cancel: "取消",
        saving: "保存中...",
        saveFailed: "保存失败，请稍后再试。",
      }
    : {
        back: "Owner revenue share",
        title: "New owner",
        fields: {
          name: "Owner name",
          email: "Email",
          phone: "Phone",
          company: "Company",
          notes: "Notes",
        },
        placeholders: {
          name: "Owner name",
        },
        create: "Create owner",
        cancel: "Cancel",
        saving: "Saving...",
        saveFailed: "Save failed. Please try again.",
      };
}

export function NewOwnerForm({ locale }: { locale: Locale }) {
  const labels = copy(locale);
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const response = await fetch("/api/owners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        phone,
        companyName,
        notes,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.owner?.id) {
      setSaving(false);
      setError(payload.error || labels.saveFailed);
      return;
    }
    router.push(`/owners/${payload.owner.id}`);
    router.refresh();
  }

  return (
    <div className="max-w-2xl p-4 sm:p-6">
      <div className="mb-6">
        <Link href="/owners" className="text-sm text-[var(--ink-soft)] hover:text-[var(--ink)]">
          &lt; {labels.back}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{labels.title}</h1>
      </div>

      <div className="card space-y-4 p-6">
        <div>
          <label className="label">{labels.fields.name}</label>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={labels.placeholders.name}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">{labels.fields.email}</label>
            <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div>
            <label className="label">{labels.fields.phone}</label>
            <input className="input" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">{labels.fields.company}</label>
          <input className="input" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
        </div>
        <div>
          <label className="label">{labels.fields.notes}</label>
          <textarea className="input" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        <div className="flex gap-2 pt-2">
          <button className="btn-primary" onClick={save} disabled={!name.trim() || saving}>
            {saving ? labels.saving : labels.create}
          </button>
          <Link href="/owners" className="btn-secondary">
            {labels.cancel}
          </Link>
        </div>
      </div>
    </div>
  );
}
