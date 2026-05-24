"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  ImagePlus,
  Pencil,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import type { Locale } from "@/lib/i18n";

type StaffTaskStatus = "todo" | "in_progress" | "done" | "cancelled";

export type StaffShareTask = {
  id: string;
  staffId: string | null;
  vehicleId: string | null;
  orderId: string | null;
  staffLabel: string | null;
  vehicleLabel: string | null;
  orderLabel: string | null;
  title: string;
  details: string | null;
  dueDatetime: string | null;
  timeWindow: string | null;
  status: StaffTaskStatus;
  priority: string;
  category: string | null;
  sortOrder: number;
  completedAt: string | null;
  vehicle: { id: string; plateNumber: string; nickname: string } | null;
  order: {
    id: string;
    renterName: string;
    pickupDatetime: string;
    returnDatetime: string;
  } | null;
  attachments: StaffShareAttachment[];
};

type StaffShareAttachment = {
  id: string;
  filename: string | null;
  contentType: string | null;
  size: number | null;
  uploadedAt: string;
  url: string;
};

type ShareStaff = {
  name: string;
  role: string | null;
  color: string;
  pinnedMessage: string | null;
};

function copy(locale: Locale) {
  return locale === "zh"
    ? {
        kicker: "我的任务",
        subtitle: "只显示分配给你的任务",
        active: "待处理",
        history: "已完成 / 已取消",
        noTasks: "暂无任务",
        today: "今天",
        tomorrow: "明天",
        dayAfterTomorrow: "后天",
        overdue: "逾期",
        noDue: "无到期",
        complete: "完成",
        reopen: "重开",
        edit: "编辑",
        delete: "删除",
        unassign: "放回未分配",
        confirmDelete: "确定删除这个任务吗？",
        confirmUnassign: "放回未分配后你将看不到这个任务，管理员可以重新分配。继续吗？",
        save: "保存",
        saving: "保存中...",
        cancel: "取消",
        title: "任务标题",
        date: "日期",
        window: "时间段",
        details: "任务说明",
        photos: "照片",
        uploadPhotos: "上传照片",
        addPhotos: "添加照片",
        saved: "已保存",
        failed: "操作失败，请稍后再试。",
        vehicle: "车辆",
        order: "订单",
        language: "语言",
      }
    : {
        kicker: "My tasks",
        subtitle: "Only tasks assigned to you are shown",
        active: "Open",
        history: "Done / cancelled",
        noTasks: "No tasks",
        today: "Today",
        tomorrow: "Tomorrow",
        dayAfterTomorrow: "Day after tomorrow",
        overdue: "Overdue",
        noDue: "No due date",
        complete: "Complete",
        reopen: "Reopen",
        edit: "Edit",
        delete: "Delete",
        unassign: "Move to unassigned",
        confirmDelete: "Delete this task?",
        confirmUnassign:
          "After moving this task to unassigned, it disappears from your list and admin can assign it again. Continue?",
        save: "Save",
        saving: "Saving...",
        cancel: "Cancel",
        title: "Task title",
        date: "Date",
        window: "Time window",
        details: "Details",
        photos: "Photos",
        uploadPhotos: "Upload photos",
        addPhotos: "Add photos",
        saved: "Saved",
        failed: "Something went wrong. Please try again.",
        vehicle: "Vehicle",
        order: "Order",
        language: "Language",
      };
}

export function StaffShareClient({
  locale,
  token,
  staff,
  initialTasks,
}: {
  locale: Locale;
  token: string;
  staff: ShareStaff;
  initialTasks: StaffShareTask[];
}) {
  const [activeLocale, setActiveLocale] = useState<Locale>("en");
  const labels = copy(activeLocale);
  const [tasks, setTasks] = useState(initialTasks.map(normalizeTask));
  const [editingTask, setEditingTask] = useState<StaffShareTask | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status !== "done" && task.status !== "cancelled")
        .sort(sortTasks),
    [tasks],
  );
  const historyTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status === "done" || task.status === "cancelled")
        .sort(sortTasks),
    [tasks],
  );
  const activeTaskGroups = useMemo(
    () => groupTasksByDate(activeTasks, activeLocale, labels),
    [activeLocale, activeTasks, labels],
  );
  const historyTaskGroups = useMemo(
    () => groupTasksByDate(historyTasks, activeLocale, labels),
    [activeLocale, historyTasks, labels],
  );

  useEffect(() => {
    const saved = window.localStorage.getItem("tato-staff-share-locale");
    if (saved === "zh" || saved === "en") {
      setActiveLocale(saved);
      return;
    }

    const browserLanguage = window.navigator.language.toLowerCase();
    setActiveLocale(browserLanguage.startsWith("zh") ? "zh" : "en");
  }, []);

  function chooseLocale(nextLocale: Locale) {
    setActiveLocale(nextLocale);
    window.localStorage.setItem("tato-staff-share-locale", nextLocale);
  }

  function upsertTask(task: StaffShareTask) {
    setTasks((current) => {
      const index = current.findIndex((item) => item.id === task.id);
      if (index < 0) return [...current, task];
      const next = [...current];
      next[index] = task;
      return next;
    });
  }

  async function patchTask(task: StaffShareTask, body: Record<string, unknown>) {
    const response = await fetch(`/api/staff-share/${token}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(labels.failed);
      return null;
    }

    if (payload.unassigned) {
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setNotice(labels.saved);
      return null;
    }

    if (payload.task) {
      const next = normalizeTask(payload.task);
      upsertTask(next);
      setNotice(labels.saved);
      return next;
    }

    setNotice(labels.failed);
    return null;
  }

  async function toggleComplete(task: StaffShareTask) {
    await patchTask(task, { status: task.status === "done" ? "todo" : "done" });
  }

  async function unassignTask(task: StaffShareTask) {
    if (!window.confirm(labels.confirmUnassign)) return;
    await patchTask(task, { unassign: true });
  }

  async function deleteTask(task: StaffShareTask) {
    if (!window.confirm(labels.confirmDelete)) return;
    const response = await fetch(`/api/staff-share/${token}/tasks/${task.id}`, {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.task) {
      setNotice(labels.failed);
      return;
    }
    upsertTask(normalizeTask(payload.task));
    setNotice(labels.saved);
  }

  return (
    <main className="min-h-screen bg-neutral-100 text-neutral-950">
      <header className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-neutral-400">{labels.kicker}</p>
            <div className="flex shrink-0 overflow-hidden rounded-md border border-white/15 bg-white/5 p-0.5" aria-label={labels.language}>
              <button
                type="button"
                className={`min-h-7 px-2 text-xs font-semibold ${activeLocale === "en" ? "bg-white text-neutral-950" : "text-neutral-300"}`}
                aria-pressed={activeLocale === "en"}
                onClick={() => chooseLocale("en")}
              >
                EN
              </button>
              <button
                type="button"
                className={`min-h-7 px-2 text-xs font-semibold ${activeLocale === "zh" ? "bg-white text-neutral-950" : "text-neutral-300"}`}
                aria-pressed={activeLocale === "zh"}
                onClick={() => chooseLocale("zh")}
              >
                中文
              </button>
            </div>
          </div>
          <div className="mt-2 flex items-start gap-3">
            <span className="mt-1 h-3 w-3 rounded-full" style={{ backgroundColor: staff.color }} />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold">{staff.name}</h1>
              <p className="text-sm text-neutral-300">{staff.role || labels.subtitle}</p>
            </div>
          </div>
          {staff.pinnedMessage ? (
            <div className="mt-3 rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-neutral-100">
              {staff.pinnedMessage}
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md bg-white/10 px-3 py-2">
              <p className="text-neutral-400">{labels.active}</p>
              <p className="text-xl font-semibold">{activeTasks.length}</p>
            </div>
            <div className="rounded-md bg-white/10 px-3 py-2">
              <p className="text-neutral-400">{labels.history}</p>
              <p className="text-xl font-semibold">{historyTasks.length}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-3 py-4">
        {notice ? (
          <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm">
            {notice}
          </div>
        ) : null}

        <TaskSection title={labels.active} empty={labels.noTasks}>
          {activeTaskGroups.map((group) => (
            <TaskDateGroup key={group.key} label={group.label}>
              {group.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  labels={labels}
                  locale={activeLocale}
                  task={task}
                  onEdit={setEditingTask}
                  onComplete={toggleComplete}
                  onUnassign={unassignTask}
                  onDelete={deleteTask}
                />
              ))}
            </TaskDateGroup>
          ))}
        </TaskSection>

        <TaskSection title={labels.history} empty={labels.noTasks}>
          {historyTaskGroups.map((group) => (
            <TaskDateGroup key={group.key} label={group.label}>
              {group.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  labels={labels}
                  locale={activeLocale}
                  task={task}
                  onEdit={setEditingTask}
                  onComplete={toggleComplete}
                  onUnassign={unassignTask}
                  onDelete={deleteTask}
                />
              ))}
            </TaskDateGroup>
          ))}
        </TaskSection>
      </div>

      {editingTask ? (
        <EditTaskModal
          labels={labels}
          token={token}
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSaved={(task) => {
            upsertTask(task);
            setEditingTask(null);
            setNotice(labels.saved);
          }}
          onFailed={() => setNotice(labels.failed)}
        />
      ) : null}
    </main>
  );
}

function TaskSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-sm font-semibold text-neutral-600">{title}</h2>
      {hasChildren ? children : <div className="rounded-md bg-white px-4 py-6 text-sm text-neutral-500">{empty}</div>}
    </section>
  );
}

function TaskDateGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="px-1 text-xs font-semibold text-neutral-500">{label}</h3>
      {children}
    </div>
  );
}

function TaskCard({
  labels,
  locale,
  task,
  onEdit,
  onComplete,
  onUnassign,
  onDelete,
}: {
  labels: ReturnType<typeof copy>;
  locale: Locale;
  task: StaffShareTask;
  onEdit: (task: StaffShareTask) => void;
  onComplete: (task: StaffShareTask) => void;
  onUnassign: (task: StaffShareTask) => void;
  onDelete: (task: StaffShareTask) => void;
}) {
  const closed = task.status === "done" || task.status === "cancelled";
  const cancelled = task.status === "cancelled";
  return (
    <article className="rounded-md border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <DueBadge labels={labels} task={task} />
            <h3 className="min-w-0 flex-1 break-words text-base font-semibold leading-snug">{task.title}</h3>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {formatTaskDue(task.dueDatetime, locale, labels.noDue)}
            {task.timeWindow ? ` · ${task.timeWindow}` : ""}
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            {[getVehicleLabel(labels, task), getOrderLabel(labels, task)].filter(Boolean).join(" · ")}
          </p>
          {task.details ? (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-5 text-neutral-700">
              {task.details}
            </p>
          ) : null}
          <AttachmentStrip attachments={task.attachments} labels={labels} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {!closed ? (
          <button className="mobile-action min-h-10 flex-col gap-0.5 px-1 py-1 text-[11px] leading-tight border-neutral-300 bg-neutral-50 text-neutral-700" onClick={() => onUnassign(task)}>
            <RotateCcw className="h-4 w-4" />
            <span className="text-center">{labels.unassign}</span>
          </button>
        ) : null}
        {!cancelled ? (
          <>
            <button className="mobile-action min-h-10 flex-col gap-0.5 px-1 py-1 text-[11px] leading-tight border-amber-300 bg-amber-50 text-amber-800" onClick={() => onEdit(task)}>
              <Pencil className="h-4 w-4" />
              <span className="text-center">{labels.edit}</span>
            </button>
          </>
        ) : null}
        {task.status !== "cancelled" ? (
          <button className="mobile-action min-h-10 flex-col gap-0.5 px-1 py-1 text-[11px] leading-tight border-red-200 bg-red-50 text-red-700" onClick={() => onDelete(task)}>
            <Trash2 className="h-4 w-4" />
            <span className="text-center">{labels.delete}</span>
          </button>
        ) : null}
        {!cancelled ? (
          <button className="mobile-action min-h-10 flex-col gap-0.5 px-1 py-1 text-[11px] leading-tight border-emerald-300 bg-emerald-50 text-emerald-800" onClick={() => onComplete(task)}>
            {task.status === "done" ? <Circle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            <span className="text-center">{task.status === "done" ? labels.reopen : labels.complete}</span>
          </button>
        ) : null}
      </div>
    </article>
  );
}

function EditTaskModal({
  labels,
  token,
  task,
  onClose,
  onSaved,
  onFailed,
}: {
  labels: ReturnType<typeof copy>;
  token: string;
  task: StaffShareTask;
  onClose: () => void;
  onSaved: (task: StaffShareTask) => void;
  onFailed: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [date, setDate] = useState(task.dueDatetime ? toLocalDateInput(task.dueDatetime) : "");
  const [timeWindow, setTimeWindow] = useState(task.timeWindow ?? "");
  const [details, setDetails] = useState(task.details ?? "");
  const [attachments] = useState(task.attachments);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  async function uploadPhotos(taskId: string, files: File[]) {
    if (files.length === 0) return [];
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    const response = await fetch(`/api/staff-share/${token}/tasks/${taskId}/attachments`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.attachments)) throw new Error("UPLOAD_FAILED");
    return payload.attachments.map((attachment: StaffShareAttachment) => normalizeAttachment(attachment));
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`/api/staff-share/${token}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          dueDatetime: date,
          timeWindow,
          details,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.task) throw new Error("SAVE_FAILED");

      let savedTask = normalizeTask(payload.task);
      if (pendingFiles.length > 0) {
        const uploaded = await uploadPhotos(savedTask.id, pendingFiles);
        savedTask = { ...savedTask, attachments: [...savedTask.attachments, ...uploaded] };
      }
      onSaved(savedTask);
    } catch {
      onFailed();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50 sm:items-center sm:justify-center">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white p-4 shadow-2xl sm:max-w-lg sm:rounded-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{labels.edit}</h2>
          <button className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="share-label">{labels.title}</span>
            <input className="share-input" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="share-label">{labels.date}</span>
              <input className="share-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className="block">
              <span className="share-label">{labels.window}</span>
              <input className="share-input" value={timeWindow} onChange={(event) => setTimeWindow(event.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="share-label">{labels.details}</span>
            <textarea className="share-input min-h-28" value={details} onChange={(event) => setDetails(event.target.value)} />
          </label>
          <div>
            <span className="share-label">{labels.photos}</span>
            <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-3 py-4 text-sm text-neutral-600">
              <Upload className="h-5 w-5" />
              <span>{labels.uploadPhotos}</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []).filter(isPhotoFile);
                  setPendingFiles((current) => [...current, ...files]);
                  event.target.value = "";
                }}
              />
            </label>
            <PhotoGrid
              labels={labels}
              attachments={attachments}
              pendingFiles={pendingFiles}
              onRemovePending={(index) =>
                setPendingFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          </div>
        </div>
        <div className="sticky bottom-0 -mx-4 mt-4 grid grid-cols-2 gap-2 border-t border-neutral-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <button className="h-11 rounded-md border border-neutral-200 bg-white font-medium" onClick={onClose}>
            {labels.cancel}
          </button>
          <button className="h-11 rounded-md bg-neutral-950 font-medium text-white" disabled={saving} onClick={save}>
            {saving ? labels.saving : labels.save}
          </button>
        </div>
      </div>
    </div>
  );
}

function PhotoGrid({
  labels,
  attachments,
  pendingFiles,
  onRemovePending,
}: {
  labels: ReturnType<typeof copy>;
  attachments: StaffShareAttachment[];
  pendingFiles: File[];
  onRemovePending: (index: number) => void;
}) {
  if (attachments.length === 0 && pendingFiles.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-4 gap-2">
      {attachments.map((attachment) => (
        <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded border border-neutral-200 bg-neutral-100">
          <img src={attachment.url} alt={attachment.filename || labels.photos} className="h-full w-full object-cover" />
        </a>
      ))}
      {pendingFiles.map((file, index) => (
        <div key={`${file.name}-${index}`} className="relative aspect-square rounded border border-dashed border-neutral-300 bg-neutral-50 p-1">
          <div className="flex h-full items-center justify-center text-center text-[10px] text-neutral-500">
            <ImagePlus className="h-4 w-4" />
          </div>
          <button
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white"
            onClick={() => onRemovePending(index)}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}

function AttachmentStrip({
  attachments,
  labels,
}: {
  attachments: StaffShareAttachment[];
  labels: ReturnType<typeof copy>;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
      {attachments.map((attachment) => (
        <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="h-16 w-16 shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100">
          <img src={attachment.url} alt={attachment.filename || labels.photos} className="h-full w-full object-cover" />
        </a>
      ))}
    </div>
  );
}

function DueBadge({ labels, task }: { labels: ReturnType<typeof copy>; task: StaffShareTask }) {
  if (task.status === "done") {
    return <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">{labels.complete}</span>;
  }
  if (task.status === "cancelled") {
    return <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">{labels.delete}</span>;
  }
  const dayOffset = getTaskDueDayOffset(task.dueDatetime);
  if (dayOffset == null) return null;
  if (dayOffset < 0) return <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">{labels.overdue}</span>;
  if (dayOffset === 0) return <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">{labels.today}</span>;
  if (dayOffset === 1) return <span className="rounded bg-amber-300 px-2 py-0.5 text-xs font-semibold text-amber-950">{labels.tomorrow}</span>;
  return null;
}

function normalizeTask(task: StaffShareTask): StaffShareTask {
  return {
    ...task,
    dueDatetime: task.dueDatetime ? new Date(task.dueDatetime).toISOString() : null,
    completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
    attachments: (task.attachments ?? []).map(normalizeAttachment),
  };
}

function normalizeAttachment(attachment: StaffShareAttachment): StaffShareAttachment {
  return {
    ...attachment,
    uploadedAt: attachment.uploadedAt ? new Date(attachment.uploadedAt).toISOString() : new Date().toISOString(),
  };
}

function sortTasks(left: StaffShareTask, right: StaffShareTask) {
  if (left.sortOrder > 0 && right.sortOrder > 0 && left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  const leftTime = left.dueDatetime ? new Date(left.dueDatetime).getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right.dueDatetime ? new Date(right.dueDatetime).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.title.localeCompare(right.title);
}

function groupTasksByDate(
  tasks: StaffShareTask[],
  locale: Locale,
  labels: ReturnType<typeof copy>,
) {
  const groups = new Map<string, { key: string; label: string; tasks: StaffShareTask[]; order: number }>();

  for (const task of tasks) {
    const groupKey = task.dueDatetime ? localDateKey(new Date(task.dueDatetime)) : "no-due";
    const order = task.dueDatetime ? new Date(task.dueDatetime).getTime() : Number.MAX_SAFE_INTEGER;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.tasks.push(task);
      continue;
    }

    groups.set(groupKey, {
      key: groupKey,
      label: formatTaskGroupLabel(task.dueDatetime, locale, labels),
      tasks: [task],
      order,
    });
  }

  return Array.from(groups.values()).sort((left, right) => left.order - right.order);
}

function localDateKey(date: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTaskGroupLabel(
  value: string | null,
  locale: Locale,
  labels: ReturnType<typeof copy>,
) {
  if (!value) return labels.noDue;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return labels.noDue;
  const dayOffset = getTaskDueDayOffset(value);
  if (dayOffset === 0) return labels.today;
  if (dayOffset === 1) return labels.tomorrow;
  if (dayOffset === 2) return labels.dayAfterTomorrow;
  if (locale === "zh") return `${date.getMonth() + 1}/${date.getDate()}`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function getTaskDueDayOffset(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((dueDay.getTime() - today.getTime()) / 86400000);
}

function formatTaskDue(value: string | null, locale: Locale, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const dayOffset = getTaskDueDayOffset(value);
  if (locale === "zh") {
    if (dayOffset === 0) return "今天";
    if (dayOffset === 1) return "明天";
    if (dayOffset === 2) return "后天";
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  if (dayOffset === 0) return "Today";
  if (dayOffset === 1) return "Tomorrow";
  if (dayOffset === 2) return "Day after tomorrow";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function toLocalDateInput(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getVehicleLabel(labels: ReturnType<typeof copy>, task: StaffShareTask) {
  if (task.vehicle) return `${labels.vehicle}: ${task.vehicle.plateNumber} · ${task.vehicle.nickname}`;
  return task.vehicleLabel ? `${labels.vehicle}: ${task.vehicleLabel}` : null;
}

function getOrderLabel(labels: ReturnType<typeof copy>, task: StaffShareTask) {
  if (task.order) return `${labels.order}: ${task.order.renterName}`;
  return task.orderLabel ? `${labels.order}: ${task.orderLabel}` : null;
}

function isPhotoFile(file: File) {
  return file.type.startsWith("image/") || /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(file.name);
}
