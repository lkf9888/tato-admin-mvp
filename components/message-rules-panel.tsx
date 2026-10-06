"use client";

import { Pencil, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { MessageTemplateRow, MessageTemplateVehicleOption } from "@/components/message-template-panel";
import { SearchableSelect } from "@/components/searchable-select";
import type { Locale } from "@/lib/i18n";

type Trigger = "booked" | "before_pickup" | "after_pickup" | "before_return" | "after_return";
type Source = "all" | "turo" | "offline";

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  templateId: string;
  trigger: Trigger;
  offsetHours: number;
  source: Source;
  vehicleIds: string[] | null;
};

const TRIGGERS: Trigger[] = ["before_pickup", "after_pickup", "before_return", "after_return", "booked"];

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        title: "定时消息规则",
        intro:
          "每笔行程到了设定的时间点，就把模板按这笔订单填好，放进消息页的「定时」清单。Turo 没有发送接口，所以要你复制过去发，再点「已发」。",
        close: "关闭",
        empty: "还没有规则。下面加一条，比如「取车前 24 小时发取车说明」。",
        name: "名称",
        namePlaceholder: "例如：取车说明",
        template: "模板",
        noTemplates: "先在「消息模板」里建一个模板。",
        when: "什么时候",
        hours: "小时",
        trigger: {
          booked: "订下后",
          before_pickup: "取车前",
          after_pickup: "取车后",
          before_return: "还车前",
          after_return: "还车后",
        } as Record<Trigger, string>,
        source: "哪些订单",
        sources: { all: "全部订单", turo: "只有 Turo 订单", offline: "只有线下和自有网站订单" } as Record<Source, string>,
        vehicle: "哪些车",
        allVehicles: "全部车辆",
        enabled: "启用",
        save: "保存规则",
        update: "更新规则",
        saving: "保存中…",
        cancelEdit: "取消编辑",
        edit: "编辑",
        remove: "删除",
        removeConfirm: "删除这条规则？已经发过的记录会保留。",
        off: "已停用",
        failed: "保存失败。",
        describe: (rule: Rule, templateLabel: string, vehicleLabel: string | null) =>
          `${templateLabel} · ${describeWhen(rule, "zh")} · ${
            { all: "全部订单", turo: "Turo 订单", offline: "线下订单" }[rule.source]
          }${vehicleLabel ? ` · ${vehicleLabel}` : ""}`,
      }
    : {
        title: "Scheduled message rules",
        intro:
          "At the set point in every trip, the template is filled in for that trip and put on the Scheduled list on the messages page. Turo has no send API, so you copy it across and mark it sent.",
        close: "Close",
        empty: "No rules yet. Add one below, e.g. pickup instructions 24 hours before pickup.",
        name: "Name",
        namePlaceholder: "e.g. Pickup instructions",
        template: "Template",
        noTemplates: "Create a message template first.",
        when: "When",
        hours: "hours",
        trigger: {
          booked: "after booking",
          before_pickup: "before pickup",
          after_pickup: "after pickup",
          before_return: "before return",
          after_return: "after return",
        } as Record<Trigger, string>,
        source: "Which trips",
        sources: { all: "All trips", turo: "Turo trips only", offline: "Offline and direct trips only" } as Record<Source, string>,
        vehicle: "Which cars",
        allVehicles: "All cars",
        enabled: "On",
        save: "Save rule",
        update: "Update rule",
        saving: "Saving…",
        cancelEdit: "Cancel edit",
        edit: "Edit",
        remove: "Delete",
        removeConfirm: "Delete this rule? Messages already sent stay on record.",
        off: "Off",
        failed: "Could not save.",
        describe: (rule: Rule, templateLabel: string, vehicleLabel: string | null) =>
          `${templateLabel} · ${describeWhen(rule, "en")} · ${
            { all: "all trips", turo: "Turo trips", offline: "offline trips" }[rule.source]
          }${vehicleLabel ? ` · ${vehicleLabel}` : ""}`,
      };
}

function describeWhen(rule: Pick<Rule, "trigger" | "offsetHours">, lang: "zh" | "en") {
  const zh = { booked: "订下后", before_pickup: "取车前", after_pickup: "取车后", before_return: "还车前", after_return: "还车后" };
  const en = { booked: "after booking", before_pickup: "before pickup", after_pickup: "after pickup", before_return: "before return", after_return: "after return" };
  if (lang === "zh") return rule.offsetHours === 0 ? zh[rule.trigger].replace(/[前后]$/, "时") : `${zh[rule.trigger]} ${rule.offsetHours} 小时`;
  return rule.offsetHours === 0 ? `at ${en[rule.trigger].split(" ")[1]}` : `${rule.offsetHours}h ${en[rule.trigger]}`;
}

const emptyForm = {
  id: null as string | null,
  name: "",
  enabled: true,
  templateId: "",
  trigger: "before_pickup" as Trigger,
  offsetHours: 24,
  source: "all" as Source,
  vehicleId: "",
};

/** Rules for scheduled guest messages. See lib/message-rules. */
export function MessageRulesPanel({
  locale,
  templates,
  vehicleOptions,
  onClose,
  onChanged,
}: {
  locale: Locale;
  templates: MessageTemplateRow[];
  vehicleOptions: MessageTemplateVehicleOption[];
  onClose: () => void;
  /** The queue depends on the rules; the page refreshes it on change. */
  onChanged?: () => void;
}) {
  const t = useMemo(() => copy(locale), [locale]);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templateById = useMemo(() => new Map(templates.map((template) => [template.id, template])), [templates]);
  const vehicleById = useMemo(() => new Map(vehicleOptions.map((vehicle) => [vehicle.id, vehicle])), [vehicleOptions]);

  useEffect(() => {
    fetch("/api/messages/rules")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { rules: Rule[] }) => setRules(data.rules))
      .catch(() => setError(t.failed));
  }, [t]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function call(init: RequestInit, url = "/api/messages/rules") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, init);
      const data = (await response.json().catch(() => ({}))) as { rules?: Rule[] };
      if (!response.ok || !data.rules) {
        setError(t.failed);
        return false;
      }
      setRules(data.rules);
      onChanged?.();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.templateId) return;
    const ok = await call({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: form.id,
        name: form.name,
        enabled: form.enabled,
        templateId: form.templateId,
        trigger: form.trigger,
        offsetHours: Number.isFinite(form.offsetHours) ? form.offsetHours : 0,
        source: form.source,
        vehicleIds: form.vehicleId ? [form.vehicleId] : null,
      }),
    });
    if (ok) setForm(emptyForm);
  }

  async function toggle(rule: Rule) {
    await call({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
    });
  }

  const vehicleSelectOptions = [
    { value: "", label: t.allVehicles, searchText: t.allVehicles },
    ...vehicleOptions.map((vehicle) => ({ value: vehicle.id, label: vehicle.label, searchText: vehicle.searchText })),
  ];

  const field = "h-9 rounded-md border border-[var(--line)] bg-white px-2.5 text-[13px] outline-none focus:border-[var(--line-strong)]";

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-[var(--ink)]/35 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="message-rules-title"
    >
      <div
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] shadow-[0_28px_70px_-28px_rgba(17,19,24,0.55)] sm:w-[min(40rem,calc(100vw-2rem))] sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-3">
          <div className="min-w-0">
            <h3 id="message-rules-title" className="text-[15px] font-bold text-[var(--ink)]">
              {t.title}
            </h3>
            <p className="mt-0.5 text-[11.5px] leading-4 text-[var(--ink-soft)]">{t.intro}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="tap-press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-muted)]"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="grid gap-4 px-4 py-4 text-[13px]">
          {rules && rules.length === 0 ? <p className="text-[var(--ink-soft)]">{t.empty}</p> : null}
          {rules && rules.length > 0 ? (
            <ul className="grid gap-2">
              {rules.map((rule) => {
                const template = templateById.get(rule.templateId);
                const vehicle = rule.vehicleIds?.[0] ? vehicleById.get(rule.vehicleIds[0]) : null;
                return (
                  <li
                    key={rule.id}
                    className={`flex items-start gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 ${rule.enabled ? "" : "opacity-60"}`}
                  >
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => toggle(rule)}
                      disabled={busy}
                      aria-label={t.enabled}
                      className="tap-compact mt-1 h-4 w-4 accent-[var(--brand)]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[var(--ink)]">
                        {rule.name}
                        {!rule.enabled ? <span className="ml-1.5 text-[11px] font-normal text-[var(--ink-soft)]">{t.off}</span> : null}
                      </p>
                      <p className="mt-0.5 text-[12px] text-[var(--ink-soft)]">
                        {t.describe(rule, template?.label ?? "—", vehicle?.label ?? null)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          id: rule.id,
                          name: rule.name,
                          enabled: rule.enabled,
                          templateId: rule.templateId,
                          trigger: rule.trigger,
                          offsetHours: rule.offsetHours,
                          source: rule.source,
                          vehicleId: rule.vehicleIds?.[0] ?? "",
                        })
                      }
                      aria-label={t.edit}
                      title={t.edit}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--ink-soft)] hover:text-[var(--ink)]"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t.removeConfirm)) {
                          void call({ method: "DELETE" }, `/api/messages/rules?id=${encodeURIComponent(rule.id)}`);
                        }
                      }}
                      aria-label={t.remove}
                      title={t.remove}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--ink-soft)] hover:border-rose-300 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {templates.length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--line)] px-3 py-4 text-center text-[var(--ink-soft)]">
              {t.noTemplates}
            </p>
          ) : (
            <form onSubmit={save} className="grid gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)]/50 p-3">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold text-[var(--ink-soft)]">{t.name}</span>
                  <input
                    id="rule-name"
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder={t.namePlaceholder}
                    maxLength={80}
                    className={field}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold text-[var(--ink-soft)]">{t.template}</span>
                  <select
                    id="rule-template"
                    value={form.templateId}
                    onChange={(event) => setForm((current) => ({ ...current, templateId: event.target.value }))}
                    className={field}
                  >
                    <option value="">—</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.label}
                        {template.vehicleLabel ? ` (${template.vehicleLabel})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-1">
                <span className="text-[11px] font-semibold text-[var(--ink-soft)]">{t.when}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    id="rule-trigger"
                    value={form.trigger}
                    onChange={(event) => setForm((current) => ({ ...current, trigger: event.target.value as Trigger }))}
                    className={field}
                  >
                    {TRIGGERS.map((trigger) => (
                      <option key={trigger} value={trigger}>
                        {t.trigger[trigger]}
                      </option>
                    ))}
                  </select>
                  <input
                    id="rule-hours"
                    type="number"
                    min={0}
                    max={336}
                    value={form.offsetHours}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, offsetHours: Number.parseInt(event.target.value || "0", 10) }))
                    }
                    className={`${field} w-20`}
                  />
                  <span className="text-[var(--ink-soft)]">{t.hours}</span>
                </div>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold text-[var(--ink-soft)]">{t.source}</span>
                  <select
                    id="rule-source"
                    value={form.source}
                    onChange={(event) => setForm((current) => ({ ...current, source: event.target.value as Source }))}
                    className={field}
                  >
                    {(["all", "turo", "offline"] as Source[]).map((source) => (
                      <option key={source} value={source}>
                        {t.sources[source]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold text-[var(--ink-soft)]">{t.vehicle}</span>
                  <SearchableSelect
                    value={form.vehicleId}
                    onChange={(value) => setForm((current) => ({ ...current, vehicleId: value }))}
                    options={vehicleSelectOptions}
                    placeholder={t.allVehicles}
                    searchPlaceholder={t.vehicle}
                    className="h-9 text-[13px]"
                  />
                </label>
              </div>
              {error ? <p className="text-[12px] text-rose-600">{error}</p> : null}
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={busy || !form.name.trim() || !form.templateId}
                  className="h-9 rounded-md bg-[var(--ink)] px-3.5 text-[12px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? t.saving : form.id ? t.update : t.save}
                </button>
                {form.id ? (
                  <button
                    type="button"
                    onClick={() => setForm(emptyForm)}
                    className="h-9 rounded-md border border-[var(--line)] bg-white px-3.5 text-[12px] font-semibold text-[var(--ink)]"
                  >
                    {t.cancelEdit}
                  </button>
                ) : null}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
