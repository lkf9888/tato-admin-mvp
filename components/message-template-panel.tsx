"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Copy, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { SearchableSelect } from "@/components/searchable-select";
import { deleteMessageTemplateAction, saveMessageTemplateAction } from "@/app/actions";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type MessageTemplateRow = {
  id: string;
  label: string;
  content: string;
  vehicleId: string | null;
  vehicleLabel: string | null;
};

export type MessageTemplateVehicleOption = {
  id: string;
  label: string;
  searchText: string;
};

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        title: "消息模板设置",
        intro:
          "把常用的回复内容存起来，回复客人时搜一下就能复制。通用模板适用于任何对话；锁定车辆的模板只和那台车有关——比如取车密码、停车位置——列表里会带着车牌区分开。TATO 不能替你把消息发出去，复制之后请粘贴到 Turo 自己的消息框里发送。",
        close: "关闭",
        labelField: "标题",
        labelPlaceholder: "例如：入住指南",
        contentField: "内容",
        contentPlaceholder: "模板的完整文字……",
        vehicleField: "适用车辆",
        vehicleGeneral: "通用（不锁定车辆）",
        save: "保存模板",
        update: "更新模板",
        saving: "保存中…",
        saved: "已保存",
        cancelEdit: "取消编辑",
        searchPlaceholder: "搜索标题、内容或车辆",
        searchCount: (count: number) => `${count} 个模板`,
        empty: "还没有任何模板，先在上面添加一个。",
        emptySearch: "没有匹配的模板。",
        generalGroup: "通用模板",
        vehicleGroup: (label: string) => `${label} 专属`,
        copyAction: "复制",
        copied: "已复制",
        copyFailed: "复制失败，请手动选中文字",
        edit: "编辑",
        delete: "删除",
        deleting: "删除中…",
        deleteConfirm: "确认删除这个模板吗？",
        validationError: "请填写标题和内容。",
      }
    : {
        title: "Message template settings",
        intro:
          "Save the replies you send often, then search and copy them while answering a guest. General templates apply to any conversation; a vehicle-locked one is only about that car — a gate code, a parking spot — and carries its plate in the list. TATO cannot send the message for you: copy it, then paste into Turo's own message box.",
        close: "Close",
        labelField: "Title",
        labelPlaceholder: "e.g. Check-in guide",
        contentField: "Content",
        contentPlaceholder: "The full text of the template…",
        vehicleField: "Vehicle",
        vehicleGeneral: "General (no vehicle)",
        save: "Save template",
        update: "Update template",
        saving: "Saving…",
        saved: "Saved",
        cancelEdit: "Cancel edit",
        searchPlaceholder: "Search title, content, or vehicle",
        searchCount: (count: number) => (count === 1 ? "1 template" : `${count} templates`),
        empty: "No templates yet — add one above.",
        emptySearch: "No templates match.",
        generalGroup: "General templates",
        vehicleGroup: (label: string) => `${label} only`,
        copyAction: "Copy",
        copied: "Copied",
        copyFailed: "Copy failed — select the text manually",
        edit: "Edit",
        delete: "Delete",
        deleting: "Deleting…",
        deleteConfirm: "Delete this template?",
        validationError: "Title and content are both required.",
      };
}

/** The matched run, marked. Same treatment the calendar and guest-message searches use. */
function highlight(value: string, query: string) {
  if (!query) return value;
  const index = value.toLowerCase().indexOf(query);
  if (index === -1) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="rounded bg-[rgba(255,231,122,0.72)] px-0.5 text-inherit">
        {value.slice(index, index + query.length)}
      </mark>
      {value.slice(index + query.length)}
    </>
  );
}

const emptyForm = { id: null as string | null, label: "", content: "", vehicleId: "" };

/**
 * Canned replies, ready to search and copy.
 *
 * TATO cannot answer a Turo message on anyone's behalf -- there is no
 * write access to that channel -- so this stops at being fast to find
 * and easy to copy. A template is either general or locked to one
 * vehicle; locked content is content that would be wrong on any other
 * car, so it carries that car's plate rather than pretending to be
 * universal.
 */
export function MessageTemplatePanel({
  locale,
  templates,
  vehicleOptions,
  onClose,
}: {
  locale: Locale;
  templates: MessageTemplateRow[];
  vehicleOptions: MessageTemplateVehicleOption[];
  onClose: () => void;
}) {
  const t = copy(locale);
  const router = useRouter();

  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isEditing = form.id !== null;

  const vehicleSelectOptions = useMemo(
    () => [
      { value: "", label: t.vehicleGeneral, searchText: t.vehicleGeneral },
      ...vehicleOptions.map((vehicle) => ({
        value: vehicle.id,
        label: vehicle.label,
        searchText: vehicle.searchText,
      })),
    ],
    [vehicleOptions, t.vehicleGeneral],
  );

  const normalizedSearch = search.trim().toLowerCase();
  const visibleTemplates = useMemo(() => {
    if (!normalizedSearch) return templates;
    return templates.filter((template) =>
      [template.label, template.content, template.vehicleLabel]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedSearch)),
    );
  }, [templates, normalizedSearch]);

  // Grouped only when nothing is being searched for -- a filtered list
  // is already short enough to read flat, and empty groups either way
  // would be noise a manager has to scroll past.
  const general = visibleTemplates.filter((template) => !template.vehicleId);
  const byVehicle = new Map<string, { label: string; rows: MessageTemplateRow[] }>();
  for (const template of visibleTemplates) {
    if (!template.vehicleId) continue;
    const key = template.vehicleId;
    if (!byVehicle.has(key)) byVehicle.set(key, { label: template.vehicleLabel ?? "", rows: [] });
    byVehicle.get(key)!.rows.push(template);
  }
  const vehicleGroups = [...byVehicle.values()].sort((a, b) => a.label.localeCompare(b.label));

  function startEdit(template: MessageTemplateRow) {
    setForm({
      id: template.id,
      label: template.label,
      content: template.content,
      vehicleId: template.vehicleId ?? "",
    });
    setError(null);
  }

  function cancelEdit() {
    setForm(emptyForm);
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.label.trim() || !form.content.trim()) {
      setError(t.validationError);
      return;
    }

    setIsSaving(true);
    setError(null);

    const data = new FormData();
    if (form.id) data.set("templateId", form.id);
    data.set("label", form.label.trim());
    data.set("content", form.content.trim());
    data.set("vehicleId", form.vehicleId);

    try {
      await saveMessageTemplateAction(data);
      setForm(emptyForm);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(templateId: string) {
    if (deletingId) return;
    if (!window.confirm(t.deleteConfirm)) return;

    setDeletingId(templateId);
    try {
      const data = new FormData();
      data.set("templateId", templateId);
      await deleteMessageTemplateAction(data);
      if (form.id === templateId) setForm(emptyForm);
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCopy(template: MessageTemplateRow) {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    try {
      await navigator.clipboard.writeText(template.content);
      setCopyFailedId(null);
      setCopiedId(template.id);
      flashTimer.current = setTimeout(() => setCopiedId(null), 1800);
    } catch {
      setCopiedId(null);
      setCopyFailedId(template.id);
      flashTimer.current = setTimeout(() => setCopyFailedId(null), 2500);
    }
  }

  function renderRow(template: MessageTemplateRow) {
    return (
      <li
        key={template.id}
        className="rounded-md border border-[var(--line)] bg-white/80 px-3 py-2.5"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-[var(--ink)]">
              {highlight(template.label, normalizedSearch)}
            </p>
            {template.vehicleLabel ? (
              <span className="mt-0.5 inline-block rounded-full border border-[var(--line)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ink-soft)]">
                {highlight(template.vehicleLabel, normalizedSearch)}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => handleCopy(template)}
              title={t.copyAction}
              className={cn(
                "inline-flex h-8 items-center justify-center gap-1 rounded-md px-2.5 text-[11px] font-semibold transition",
                copiedId === template.id
                  ? "bg-emerald-600 text-white"
                  : "border border-[var(--line)] bg-white text-[var(--ink)] hover:border-[rgba(17,19,24,0.22)] hover:bg-[var(--surface-muted)]",
              )}
            >
              {copiedId === template.id ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
              {copiedId === template.id ? t.copied : t.copyAction}
            </button>
            <button
              type="button"
              onClick={() => startEdit(template)}
              title={t.edit}
              aria-label={t.edit}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.22)] hover:text-[var(--ink)]"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => handleDelete(template.id)}
              disabled={deletingId === template.id}
              title={t.delete}
              aria-label={t.delete}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--ink-soft)] transition hover:border-rose-300 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-5 text-[var(--ink-mid)]">
          {highlight(template.content, normalizedSearch)}
        </p>
        {copyFailedId === template.id ? (
          <p className="mt-1 text-[11px] text-rose-600">{t.copyFailed}</p>
        ) : null}
      </li>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--ink)]/35 p-3 backdrop-blur-sm sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[calc(100vh-1.5rem)] w-[min(40rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-[rgba(17,19,24,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,247,247,0.98))] shadow-[0_28px_70px_-28px_rgba(17,19,24,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--line)] bg-[rgba(255,255,255,0.94)] px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <h3 className="truncate font-serif text-[1.1rem] font-semibold text-[var(--ink)]">
              {t.title}
            </h3>
            <p className="mt-1 text-[11.5px] leading-4 text-[var(--ink-soft)]">{t.intro}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
            aria-label={t.close}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <form
            onSubmit={handleSubmit}
            className="space-y-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)]/50 p-3"
          >
            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-[10px] font-medium uppercase tracking-[0.13em] text-[var(--ink-soft)]">
                  {t.labelField}
                </span>
                <input
                  value={form.label}
                  onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                  placeholder={t.labelPlaceholder}
                  className="h-9 rounded-md border border-[var(--line)] bg-white px-3 text-[13px] outline-none focus:border-[rgba(17,19,24,0.28)]"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-medium uppercase tracking-[0.13em] text-[var(--ink-soft)]">
                  {t.vehicleField}
                </span>
                <SearchableSelect
                  value={form.vehicleId}
                  onChange={(value) => setForm((current) => ({ ...current, vehicleId: value }))}
                  options={vehicleSelectOptions}
                  placeholder={t.vehicleGeneral}
                  searchPlaceholder={t.vehicleField}
                  className="h-9 text-[13px]"
                />
              </label>
            </div>

            <label className="grid gap-1">
              <span className="text-[10px] font-medium uppercase tracking-[0.13em] text-[var(--ink-soft)]">
                {t.contentField}
              </span>
              <textarea
                value={form.content}
                onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                placeholder={t.contentPlaceholder}
                rows={3}
                className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[13px] leading-5 outline-none focus:border-[rgba(17,19,24,0.28)]"
              />
            </label>

            {error ? <p className="text-[12px] text-rose-600">{error}</p> : null}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-3.5 text-[12px] font-semibold text-white shadow-[0_8px_22px_-10px_rgba(89,60,251,0.55)] transition hover:bg-[#4830d4] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? t.saving : isEditing ? t.update : t.save}
              </button>
              {isEditing ? (
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={isSaving}
                  className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--line)] bg-white px-3.5 text-[12px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t.cancelEdit}
                </button>
              ) : null}
            </div>
          </form>

          <div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t.searchPlaceholder}
              className="h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-[13px] outline-none focus:border-[rgba(17,19,24,0.22)]"
            />
            {search.trim() ? (
              <p className="mt-1 px-1 text-[11px] text-[var(--ink-soft)]">
                {t.searchCount(visibleTemplates.length)}
              </p>
            ) : null}
          </div>

          {visibleTemplates.length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--line)] px-3 py-6 text-center text-[12px] text-[var(--ink-soft)]">
              {templates.length === 0 ? t.empty : t.emptySearch}
            </p>
          ) : normalizedSearch ? (
            <ul className="space-y-2">{visibleTemplates.map(renderRow)}</ul>
          ) : (
            <div className="space-y-4">
              {general.length > 0 ? (
                <div>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
                    {t.generalGroup}
                  </p>
                  <ul className="mt-1.5 space-y-2">{general.map(renderRow)}</ul>
                </div>
              ) : null}
              {vehicleGroups.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
                    {t.vehicleGroup(group.label)}
                  </p>
                  <ul className="mt-1.5 space-y-2">{group.rows.map(renderRow)}</ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
