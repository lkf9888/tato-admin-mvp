"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  OwnerCommissionPanel,
  type CommissionRuleRow,
} from "@/components/owner-commission-panel";
import type { Locale } from "@/lib/i18n";

type Owner = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  notes: string | null;
  shareToken: string | null;
};

type VehicleRow = {
  id: string;
  label: string;
  subLabel: string;
  ownerId: string | null;
  ownerName: string | null;
};

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        back: "车主分成",
        saveFailed: "保存失败，请稍后再试。",
        assignmentFailed: "车辆绑定保存失败，请稍后再试。",
        confirmRevokeShare: "确定关闭这个共享链接吗？",
        confirmDelete: "确定删除这个车主吗？如果车主名下还有车辆或账目，系统会拒绝删除。",
        deleteFailed: "删除失败。请先解除车辆绑定并保留账目记录。",
        sections: {
          profile: "资料",
          share: "共享链接",
          vehicles: "车辆",
          ledger: "对账单",
          danger: "危险操作",
        },
        fields: {
          name: "车主姓名",
          email: "邮箱",
          phone: "电话",
          company: "公司",
          notes: "备注",
        },
        save: "保存",
        saving: "保存中...",
        shareHint: "生成一个车主只读链接，让车主查看车辆日历和对账信息。",
        copyLink: "复制链接",
        copied: "已复制",
        createShare: "创建共享链接",
        revokeShare: "关闭共享链接",
        vehiclesHint: "选择这个车主名下的车辆。选择已属于其他车主的车辆会移动到当前车主名下。",
        noVehicles: "还没有车辆。",
        saveAssignments: "保存车辆绑定",
        pickerEmpty: "选择车辆",
        pickerCount: (count: number) => `已选择 ${count} 台车`,
        pickerSearchPlaceholder: "搜索车牌、车型、VIN、车主...",
        pickerNoMatch: "没有匹配的车辆",
        assignedToOther: (name: string) => `当前属于 ${name}`,
        remove: "移除",
        ledgerHint: "查看月度 statement、收入、佣金、报销和结算付款。",
        openLedger: "打开对账单",
        viewAsOwner: "以车主身份查看",
        openStatements: "打开 statement",
        openCalendar: "打开日历",
        deleteOwner: "删除车主",
      }
    : {
        back: "Owner revenue share",
        saveFailed: "Save failed. Please try again.",
        assignmentFailed: "Vehicle assignment failed. Please try again.",
        confirmRevokeShare: "Revoke this share link?",
        confirmDelete: "Delete this owner? The system will refuse if vehicles or ledger rows still exist.",
        deleteFailed: "Delete failed. Unassign vehicles and preserve ledger records first.",
        sections: {
          profile: "Profile",
          share: "Share link",
          vehicles: "Vehicles",
          ledger: "Ledger",
          danger: "Danger",
        },
        fields: {
          name: "Owner name",
          email: "Email",
          phone: "Phone",
          company: "Company",
          notes: "Notes",
        },
        save: "Save",
        saving: "Saving...",
        shareHint: "Create a read-only owner link for calendar and statement access.",
        copyLink: "Copy link",
        copied: "Copied",
        createShare: "Create share link",
        revokeShare: "Revoke share link",
        vehiclesHint: "Choose vehicles assigned to this owner. Selecting another owner's vehicle moves it here.",
        noVehicles: "No vehicles yet.",
        saveAssignments: "Save vehicle assignments",
        pickerEmpty: "Choose vehicles",
        pickerCount: (count: number) => `${count} vehicle(s) selected`,
        pickerSearchPlaceholder: "Search plate, model, VIN, owner...",
        pickerNoMatch: "No matching vehicles",
        assignedToOther: (name: string) => `Currently assigned to ${name}`,
        remove: "Remove",
        ledgerHint: "Review monthly statements, earnings, commission, reimbursements, and settlement payments.",
        openLedger: "Open ledger",
        viewAsOwner: "View as owner",
        openStatements: "Open statement",
        openCalendar: "Open calendar",
        deleteOwner: "Delete owner",
      };
}

export function OwnerEditor({
  owner,
  assignedVehicleIds,
  allVehicles,
  commissionRules,
  locale,
}: {
  owner: Owner;
  assignedVehicleIds: string[];
  allVehicles: VehicleRow[];
  commissionRules: CommissionRuleRow[];
  locale: Locale;
}) {
  const labels = copy(locale);
  const router = useRouter();
  const [form, setForm] = useState({
    name: owner.name,
    email: owner.email ?? "",
    phone: owner.phone ?? "",
    companyName: owner.companyName ?? "",
    notes: owner.notes ?? "",
  });
  const [shareToken, setShareToken] = useState<string | null>(owner.shareToken);
  const [assigned, setAssigned] = useState(() => new Set(assignedVehicleIds));
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingVehicles, setSavingVehicles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  async function saveProfile() {
    setSavingProfile(true);
    setError(null);
    const response = await fetch(`/api/owners/${owner.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSavingProfile(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error || labels.saveFailed);
      return;
    }
    router.refresh();
  }

  async function saveVehicles() {
    setSavingVehicles(true);
    setError(null);
    const response = await fetch(`/api/owners/${owner.id}/vehicles`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicleIds: Array.from(assigned) }),
    });
    setSavingVehicles(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error || labels.assignmentFailed);
      return;
    }
    router.refresh();
  }

  async function createShare() {
    const response = await fetch(`/api/owners/${owner.id}/share`, { method: "POST" });
    if (response.ok) {
      const payload = await response.json();
      setShareToken(payload.shareToken);
      router.refresh();
    }
  }

  async function revokeShare() {
    if (!confirm(labels.confirmRevokeShare)) return;
    const response = await fetch(`/api/owners/${owner.id}/share`, { method: "DELETE" });
    if (response.ok) {
      setShareToken(null);
      router.refresh();
    }
  }

  function copyShareLink() {
    if (!shareToken) return;
    void navigator.clipboard.writeText(`${window.location.origin}/share/${shareToken}`);
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 2000);
  }

  async function deleteOwner() {
    if (!confirm(labels.confirmDelete)) return;
    const response = await fetch(`/api/owners/${owner.id}`, { method: "DELETE" });
    if (response.ok) {
      router.push("/owners");
      router.refresh();
      return;
    }
    const payload = await response.json().catch(() => ({}));
    setError(payload.error || labels.deleteFailed);
  }

  function toggleVehicle(id: string) {
    setAssigned((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <Link href="/owners" className="text-sm text-[var(--ink-soft)] hover:text-[var(--ink)]">
          &lt; {labels.back}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{owner.name}</h1>
      </div>

      {error ? (
        <div className="card border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
      ) : null}

      <section className="card space-y-4 p-6">
        <h2 className="text-lg font-semibold">{labels.sections.profile}</h2>
        <div>
          <label className="label">{labels.fields.name}</label>
          <input
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">{labels.fields.email}</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </div>
          <div>
            <label className="label">{labels.fields.phone}</label>
            <input
              className="input"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="label">{labels.fields.company}</label>
          <input
            className="input"
            value={form.companyName}
            onChange={(event) => setForm({ ...form, companyName: event.target.value })}
          />
        </div>
        <div>
          <label className="label">{labels.fields.notes}</label>
          <textarea
            className="input"
            rows={3}
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button className="btn-primary" onClick={saveProfile} disabled={!form.name.trim() || savingProfile}>
            {savingProfile ? labels.saving : labels.save}
          </button>
        </div>
      </section>

      {/* Directly after the profile, and before the share link: the
          terms are the thing an owner and the operator argue about,
          and the share link publishes a statement computed from them. */}
      <OwnerCommissionPanel locale={locale} ownerId={owner.id} rules={commissionRules} />

      <section className="card space-y-3 p-6">
        <h2 className="text-lg font-semibold">{labels.sections.share}</h2>
        <p className="text-sm text-[var(--ink-soft)]">{labels.shareHint}</p>
        {shareToken ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-[var(--surface-muted)] px-3 py-2 text-xs">
                /share/{shareToken}
              </code>
              <button className="btn-secondary text-sm" onClick={copyShareLink}>
                {shareCopied ? labels.copied : labels.copyLink}
              </button>
            </div>
            <button className="text-xs text-red-600 hover:underline" onClick={revokeShare}>
              {labels.revokeShare}
            </button>
          </div>
        ) : (
          <button className="btn-secondary" onClick={createShare}>
            {labels.createShare}
          </button>
        )}
      </section>

      <section className="card space-y-3 p-6">
        <h2 className="text-lg font-semibold">{labels.sections.vehicles}</h2>
        <p className="text-sm text-[var(--ink-soft)]">{labels.vehiclesHint}</p>
        {allVehicles.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">{labels.noVehicles}</p>
        ) : (
          <VehiclePicker
            ownerId={owner.id}
            vehicles={allVehicles}
            assigned={assigned}
            labels={labels}
            onToggle={toggleVehicle}
          />
        )}
        <div className="flex gap-2 pt-2">
          <button className="btn-primary" onClick={saveVehicles} disabled={savingVehicles}>
            {savingVehicles ? labels.saving : labels.saveAssignments}
          </button>
        </div>
      </section>

      <section className="card space-y-2 p-6">
        <h2 className="text-lg font-semibold">{labels.sections.ledger}</h2>
        <p className="text-sm text-[var(--ink-soft)]">{labels.ledgerHint}</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Link href={`/owners/${owner.id}/ledger`} className="btn-secondary">
            {labels.openLedger}
          </Link>
          {shareToken ? (
            <a href={`/share/${shareToken}`} target="_blank" rel="noreferrer" className="btn-secondary">
              {labels.viewAsOwner}
            </a>
          ) : null}
          {shareToken ? (
            <a href={`/share/${shareToken}?tab=statements`} target="_blank" rel="noreferrer" className="btn-secondary">
              {labels.openStatements}
            </a>
          ) : null}
          {shareToken ? (
            <a href={`/share/${shareToken}?tab=calendar`} target="_blank" rel="noreferrer" className="btn-secondary">
              {labels.openCalendar}
            </a>
          ) : null}
        </div>
      </section>

      <section className="card border-red-200 p-6">
        <h2 className="mb-2 text-lg font-semibold text-red-700">{labels.sections.danger}</h2>
        <button className="text-sm text-red-600 hover:underline" onClick={deleteOwner}>
          {labels.deleteOwner}
        </button>
      </section>
    </div>
  );
}

function VehiclePicker({
  ownerId,
  vehicles,
  assigned,
  labels,
  onToggle,
}: {
  ownerId: string;
  vehicles: VehicleRow[];
  assigned: Set<string>;
  labels: ReturnType<typeof copy>;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = q
      ? vehicles.filter((vehicle) =>
          `${vehicle.label} ${vehicle.subLabel} ${vehicle.ownerName ?? ""}`.toLowerCase().includes(q),
        )
      : vehicles;
    return [...matches].sort((a, b) => {
      const aSelected = assigned.has(a.id) ? 0 : 1;
      const bSelected = assigned.has(b.id) ? 0 : 1;
      return aSelected - bSelected || a.label.localeCompare(b.label, undefined, { numeric: true });
    });
  }, [assigned, search, vehicles]);

  const selectedVehicles = useMemo(
    () => vehicles.filter((vehicle) => assigned.has(vehicle.id)),
    [assigned, vehicles],
  );

  const triggerLabel = assigned.size === 0 ? labels.pickerEmpty : labels.pickerCount(assigned.size);

  return (
    <div className="space-y-2">
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="input flex w-full items-center justify-between text-left"
        >
          <span className="truncate">{triggerLabel}</span>
          <span className="ml-2 text-xs text-[var(--ink-soft)]">v</span>
        </button>
        {open ? (
          <div className="absolute left-0 right-0 z-20 mt-1 flex max-h-80 flex-col rounded-md border border-[var(--line)] bg-white shadow-lg">
            <div className="border-b border-[var(--line)] p-2">
              <input
                type="text"
                placeholder={labels.pickerSearchPlaceholder}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="input text-sm"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-[var(--ink-soft)]">{labels.pickerNoMatch}</div>
              ) : (
                filtered.map((vehicle) => {
                  const checked = assigned.has(vehicle.id);
                  const otherOwner = !!vehicle.ownerId && vehicle.ownerId !== ownerId && vehicle.ownerName;
                  return (
                    <label
                      key={vehicle.id}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(vehicle.id)}
                        className="shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{vehicle.label}</span>
                        <span className="block truncate text-xs text-[var(--ink-soft)]">{vehicle.subLabel}</span>
                      </span>
                      {otherOwner ? (
                        <span className="shrink-0 text-[10px] text-amber-600">
                          {labels.assignedToOther(vehicle.ownerName!)}
                        </span>
                      ) : null}
                    </label>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>
      {selectedVehicles.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedVehicles.map((vehicle) => (
            <span
              key={vehicle.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--surface-muted)] py-1 pl-2.5 pr-1 text-xs"
            >
              <span className="truncate">{vehicle.label}</span>
              <button
                type="button"
                onClick={() => onToggle(vehicle.id)}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--accent-soft-strong)] hover:text-[var(--ink)]"
                aria-label={labels.remove}
              >
                x
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
