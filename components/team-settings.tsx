"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  pageAccess: string[] | null;
  vehicleScope: string[] | null;
};
type Invite = { id: string; email: string; name: string | null; role: string; expiresAt: string; acceptUrl: string };
type PageOption = { key: string; label: string };
type VehicleOption = { id: string; label: string };
type EditableRole = "ADMIN" | "VIEWER";

const field = "min-h-9 w-full rounded-md border border-[var(--line)] bg-white px-2.5 py-1.5 text-sm";

/**
 * The owner's view of the team: who can sign in, as what, to which pages;
 * which cars, if not the whole fleet; invitations still open; adding
 * someone by invite or by password.
 */
export function TeamSettings({
  locale,
  currentUserId,
  members,
  invites,
  pages,
  vehicles,
}: {
  locale: Locale;
  currentUserId: string;
  members: Member[];
  invites: Invite[];
  pages: PageOption[];
  vehicles: VehicleOption[];
}) {
  const t = getMessages(locale).accountSettingsPage.team;
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [notice, setNotice] = useState<{ text: string; link?: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const allKeys = pages.map((page) => page.key);
  const roleLabel = (role: string) => t.roleLabels[role as keyof typeof t.roleLabels] ?? role;

  async function copy(value: string, id: string) {
    // Links from the server may be paths; a copied link must be absolute.
    const text = value.startsWith("/") ? `${window.location.origin}${value}` : value;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt(t.copyLink, text);
    }
  }

  async function remove(member: Member) {
    if (!window.confirm(t.confirmRemove(member.name))) return;
    const response = await fetch(`/api/team/${member.id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) setNotice({ text: t.failed });
    router.refresh();
  }

  async function withdraw(invite: Invite) {
    await fetch(`/api/team/invites/${invite.id}`, { method: "DELETE" }).catch(() => null);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {notice ? (
        <div className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[12px] text-[var(--ink-mid)]">
          {notice.text}
          {notice.link ? (
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate">{notice.link}</code>
              <button type="button" className="underline" onClick={() => void copy(notice.link!, "notice")}>
                {copied === "notice" ? t.copied : t.copyLink}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <p className="text-[11px] font-semibold text-[var(--ink-soft)]">{t.members}</p>
        <ul className="mt-1 divide-y divide-[var(--line)] rounded-md border border-[var(--line)] bg-white">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12px]">
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-[var(--ink)]">{member.name}</span>
                {member.id === currentUserId ? <span className="ml-1 text-[var(--ink-soft)]">({t.you})</span> : null}
                <span className="ml-2 text-[var(--ink-soft)]">{member.email}</span>
              </span>
              <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px]">{roleLabel(member.role)}</span>
              {member.role !== "OWNER" ? (
                <>
                  <span className="text-[11px] text-[var(--ink-soft)]">
                    {member.pageAccess === null ? t.allPages : t.pageCount(member.pageAccess.length)}
                    {member.vehicleScope ? ` · ${t.vehicleCount(member.vehicleScope.length)}` : ""}
                  </span>
                  <button type="button" className="underline" onClick={() => setEditing(member)}>{t.edit}</button>
                  <button type="button" className="text-rose-600 underline" onClick={() => void remove(member)}>{t.remove}</button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {invites.length > 0 ? (
        <div>
          <p className="text-[11px] font-semibold text-[var(--ink-soft)]">{t.pending}</p>
          <ul className="mt-1 divide-y divide-[var(--line)] rounded-md border border-[var(--line)] bg-white">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12px]">
                <span className="min-w-0 flex-1">
                  {invite.name ? <span className="font-semibold">{invite.name} </span> : null}
                  <span className="text-[var(--ink-soft)]">{invite.email}</span>
                </span>
                <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px]">{roleLabel(invite.role)}</span>
                <span className="text-[11px] text-[var(--ink-soft)]">{t.expires(invite.expiresAt.slice(0, 10))}</span>
                <button type="button" className="underline" onClick={() => void copy(invite.acceptUrl, invite.id)}>
                  {copied === invite.id ? t.copied : t.copyLink}
                </button>
                <button type="button" className="text-rose-600 underline" onClick={() => void withdraw(invite)}>{t.withdraw}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {adding ? (
        <MemberForm
          t={t}
          pages={pages}
          vehicles={vehicles}
          onCancel={() => setAdding(false)}
          onDone={(result) => {
            setAdding(false);
            setNotice(result);
            router.refresh();
          }}
        />
      ) : (
        <button type="button" className="btn-secondary" onClick={() => { setNotice(null); setAdding(true); }}>
          + {t.add}
        </button>
      )}

      {editing ? (
        <MemberForm
          t={t}
          pages={pages}
          vehicles={vehicles}
          member={editing}
          onCancel={() => setEditing(null)}
          onDone={(result) => {
            setEditing(null);
            setNotice(result.text ? result : null);
            router.refresh();
          }}
          allKeys={allKeys}
        />
      ) : null}
    </div>
  );
}

type Copy = ReturnType<typeof getMessages>["accountSettingsPage"]["team"];

function MemberForm({
  t,
  pages,
  vehicles,
  member,
  allKeys,
  onCancel,
  onDone,
}: {
  t: Copy;
  pages: PageOption[];
  vehicles: VehicleOption[];
  member?: Member;
  allKeys?: string[];
  onCancel: () => void;
  onDone: (result: { text: string; link?: string }) => void;
}) {
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [role, setRole] = useState<EditableRole>(member?.role === "VIEWER" ? "VIEWER" : "ADMIN");
  const [selected, setSelected] = useState<string[]>(member?.pageAccess ?? allKeys ?? pages.map((page) => page.key));
  const [limited, setLimited] = useState(Boolean(member?.vehicleScope));
  const [cars, setCars] = useState<string[]>(member?.vehicleScope ?? []);
  const [carFilter, setCarFilter] = useState("");
  const [how, setHow] = useState<"invite" | "password">("invite");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: string) {
    setSelected((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  function toggleCar(id: string) {
    setCars((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  const query = carFilter.trim().toLowerCase();
  const shownCars = query ? vehicles.filter((vehicle) => vehicle.label.toLowerCase().includes(query)) : vehicles;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (limited && cars.length === 0) {
      setError(t.vehiclesNone);
      return;
    }
    setSaving(true);
    setError(null);
    const vehicleScope = limited ? cars : null;
    const response = await fetch(member ? `/api/team/${member.id}` : "/api/team", {
      method: member ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        member
          ? { role, pageAccess: selected, vehicleScope }
          : { name, email, role, pageAccess: selected, vehicleScope, ...(how === "password" ? { password } : {}) },
      ),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => ({})) : {};
    setSaving(false);
    if (!response?.ok) {
      setError(payload.error === "EMAIL_IN_USE" ? t.emailInUse : t.failed);
      return;
    }
    if (member) return onDone({ text: "" });
    if (payload.acceptUrl) {
      return onDone(payload.emailed ? { text: t.invited(email) } : { text: t.invitedNoEmail, link: payload.acceptUrl });
    }
    onDone({ text: t.added });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-md border border-[var(--line)] bg-white p-3 text-[12px]">
      {member ? (
        <p className="font-semibold text-[var(--ink)]">
          {member.name} · <span className="font-normal text-[var(--ink-soft)]">{member.email}</span>
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            {t.name}
            <input required value={name} onChange={(event) => setName(event.target.value)} className={field} />
          </label>
          <label className="grid gap-1">
            {t.email}
            <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={field} />
          </label>
        </div>
      )}

      <fieldset className="grid gap-1">
        <legend className="mb-1">{t.role}</legend>
        {(["ADMIN", "VIEWER"] as const).map((value) => (
          <label key={value} className="flex items-start gap-2">
            <input type="radio" name="role" checked={role === value} onChange={() => setRole(value)} className="mt-0.5" />
            <span>
              <span className="font-semibold">{t.roleLabels[value]}</span>
              <span className="ml-1 text-[var(--ink-soft)]">{t.roleHints[value]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend className="mb-1 flex items-center gap-3">
          {t.pages}
          <button type="button" className="underline" onClick={() => setSelected(pages.map((page) => page.key))}>{t.selectAll}</button>
          <button type="button" className="underline" onClick={() => setSelected([])}>{t.selectNone}</button>
        </legend>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {pages.map((page) => (
            <label key={page.key} className={cn("flex items-center gap-1.5 rounded px-1 py-0.5", selected.includes(page.key) ? "" : "text-[var(--ink-soft)]")}>
              <input type="checkbox" checked={selected.includes(page.key)} onChange={() => toggle(page.key)} />
              {page.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-1">
        <legend className="mb-1">{t.vehicles}</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="vehicles" checked={!limited} onChange={() => setLimited(false)} />
          {t.vehiclesAll}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="vehicles" checked={limited} onChange={() => setLimited(true)} />
          {t.vehiclesSome}
          {limited ? <span className="text-[var(--ink-soft)]">({t.vehicleCount(cars.length)})</span> : null}
        </label>
        {limited ? (
          <div className="grid gap-1.5 pl-6">
            <p className="text-[11px] leading-4 text-[var(--ink-soft)]">{t.vehiclesHint}</p>
            {vehicles.length > 8 ? (
              <input
                type="search"
                autoComplete="off"
                value={carFilter}
                onChange={(event) => setCarFilter(event.target.value)}
                placeholder={t.vehicleFilter}
                className={field}
              />
            ) : null}
            <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
              {shownCars.map((vehicle) => (
                <label key={vehicle.id} className={cn("flex items-center gap-1.5 rounded px-1 py-0.5", cars.includes(vehicle.id) ? "" : "text-[var(--ink-soft)]")}>
                  <input type="checkbox" checked={cars.includes(vehicle.id)} onChange={() => toggleCar(vehicle.id)} />
                  <span className="truncate">{vehicle.label}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </fieldset>

      {member ? null : (
        <fieldset className="grid gap-1">
          <legend className="mb-1">{t.how}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="how" checked={how === "invite"} onChange={() => setHow("invite")} />
            {t.howInvite}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="how" checked={how === "password"} onChange={() => setHow("password")} />
            {t.howPassword}
          </label>
          {how === "password" ? (
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              placeholder={t.password}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={field}
            />
          ) : null}
        </fieldset>
      )}

      {error ? <p className="text-rose-600">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>{t.cancel}</button>
        <button className="btn-primary" disabled={saving}>{saving ? t.saving : member ? t.save : t.send}</button>
      </div>
    </form>
  );
}
