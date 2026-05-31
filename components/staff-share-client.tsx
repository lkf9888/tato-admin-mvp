"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Circle,
  ImagePlus,
  Pencil,
  RotateCcw,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { Locale } from "@/lib/i18n";
import { compressImageFiles } from "@/lib/client-image-compression";

type StaffTaskStatus = "todo" | "in_progress" | "done" | "cancelled";

const HISTORY_PAGE_SIZE = 10;

export type StaffShareTask = {
  id: string;
  staffId: string | null;
  parentTaskId: string | null;
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
  miniProgramCode: string | null;
  pinnedMessage: string | null;
};

function copy(locale: Locale) {
  return locale === "zh"
    ? {
        kicker: "我的任务",
        subtitle: "只显示分配给你的任务",
        active: "待处理",
        history: "已完成 / 已取消",
        historySummary: (count: number) => `已完成 / 已取消 · ${count} 条`,
        showHistory: "展开",
        hideHistory: "收起",
        previousPage: "上一页",
        nextPage: "下一页",
        pageStatus: (page: number, total: number) => `${page} / ${total}`,
        noTasks: "暂无任务",
        today: "今天",
        tomorrow: "明天",
        dayAfterTomorrow: "后天",
        overdue: "逾期",
        noDue: "无到期",
        complete: "完成",
        reopen: "重开",
        edit: "编辑",
        delivery: "送车",
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
        compressingPhotos: "正在压缩图片...",
        addPhotos: "添加照片",
        saved: "已保存",
        failed: "操作失败，请稍后再试。",
        vehicle: "车辆",
        order: "订单",
        language: "语言",
        staffInfo: "Code / 员工备注",
        miniProgramCode: "小程序 Code",
        pinned: "员工备注",
        noPinned: "暂无员工备注",
      }
    : {
        kicker: "My tasks",
        subtitle: "Only tasks assigned to you are shown",
        active: "Open",
        history: "Done / cancelled",
        historySummary: (count: number) => `Done / cancelled · ${count}`,
        showHistory: "Show",
        hideHistory: "Hide",
        previousPage: "Previous",
        nextPage: "Next",
        pageStatus: (page: number, total: number) => `${page} / ${total}`,
        noTasks: "No tasks",
        today: "Today",
        tomorrow: "Tomorrow",
        dayAfterTomorrow: "Day after tomorrow",
        overdue: "Overdue",
        noDue: "No due date",
        complete: "Complete",
        reopen: "Reopen",
        edit: "Edit",
        delivery: "Delivery",
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
        compressingPhotos: "Compressing photos...",
        addPhotos: "Add photos",
        saved: "Saved",
        failed: "Something went wrong. Please try again.",
        vehicle: "Vehicle",
        order: "Order",
        language: "Language",
        staffInfo: "Code / staff note",
        miniProgramCode: "Mini Program Code",
        pinned: "Staff note",
        noPinned: "No staff note",
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
  const [previewImage, setPreviewImage] = useState<StaffShareAttachment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [staffInfoOpen, setStaffInfoOpen] = useState(false);
  const activeTasks = useMemo(
    () =>
      tasks
        .filter((task) => !task.parentTaskId && task.status !== "done" && task.status !== "cancelled")
        .sort(sortTasks),
    [tasks],
  );
  const historyTasks = useMemo(
    () =>
      tasks
        .filter((task) => !task.parentTaskId && (task.status === "done" || task.status === "cancelled"))
        .sort(sortHistoryTasks),
    [tasks],
  );
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, StaffShareTask[]>();
    for (const task of tasks) {
      if (!task.parentTaskId || task.status === "cancelled") continue;
      const list = map.get(task.parentTaskId) ?? [];
      list.push(task);
      map.set(task.parentTaskId, list);
    }
    for (const list of map.values()) list.sort(sortTasks);
    return map;
  }, [tasks]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const historyPageCount = Math.max(1, Math.ceil(historyTasks.length / HISTORY_PAGE_SIZE));
  const pagedHistoryTasks = useMemo(() => {
    const startIndex = (historyPage - 1) * HISTORY_PAGE_SIZE;
    return historyTasks.slice(startIndex, startIndex + HISTORY_PAGE_SIZE);
  }, [historyPage, historyTasks]);
  const activeTaskGroups = useMemo(
    () => groupTasksByDate(activeTasks, activeLocale, labels),
    [activeLocale, activeTasks, labels],
  );
  const historyTaskGroups = useMemo(
    () => groupTasksByDate(pagedHistoryTasks, activeLocale, labels, "desc"),
    [activeLocale, labels, pagedHistoryTasks],
  );

  useEffect(() => {
    setHistoryPage((current) => Math.min(current, historyPageCount));
  }, [historyPageCount]);

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

  async function uploadTaskPhotos(task: StaffShareTask, files: File[]) {
    const photoFiles = files.filter(isPhotoFile);
    if (photoFiles.length === 0) return;

    const formData = new FormData();
    const uploadFiles = await compressImageFiles(photoFiles);
    uploadFiles.forEach((file) => formData.append("files", file));

    const response = await fetch(`/api/staff-share/${token}/tasks/${task.id}/attachments`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.attachments)) {
      setNotice(labels.failed);
      return;
    }

    const uploaded = payload.attachments.map((attachment: StaffShareAttachment) => normalizeAttachment(attachment));
    setTasks((current) =>
      current.map((item) =>
        item.id === task.id ? normalizeTask({ ...item, attachments: [...item.attachments, ...uploaded] }) : item,
      ),
    );
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
          {staff.miniProgramCode || staff.pinnedMessage ? (
            <div className="mt-3 overflow-hidden rounded-md border border-white/10 bg-white/10 text-sm text-neutral-100">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                onClick={() => setStaffInfoOpen((open) => !open)}
                aria-expanded={staffInfoOpen}
              >
                <span className="font-semibold">{labels.staffInfo}</span>
                <span className="text-xs font-semibold text-neutral-300">
                  {staffInfoOpen ? labels.hideHistory : labels.showHistory}
                </span>
              </button>
              {staffInfoOpen ? (
                <div className="space-y-1 border-t border-white/10 px-3 py-2 text-xs leading-5 text-neutral-200">
                  {staff.miniProgramCode ? (
                    <p>
                      <span className="font-semibold text-white">{labels.miniProgramCode}: </span>
                      <span className="font-mono tracking-[0.18em] text-white">{staff.miniProgramCode}</span>
                    </p>
                  ) : null}
                  <p>
                    <span className="font-semibold text-white">{labels.pinned}: </span>
                    {staff.pinnedMessage || labels.noPinned}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-3 py-4">
        {notice ? (
          <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm">
            {notice}
          </div>
        ) : null}

        {activeTaskGroups.length === 0 && historyTasks.length === 0 ? (
          <div className="rounded-md bg-white px-4 py-6 text-sm text-neutral-500">{labels.noTasks}</div>
        ) : null}

        {activeTaskGroups.map((group) => (
          <TaskDateGroup key={`active-${group.key}`} label={group.label}>
            {group.tasks.map((task) => (
              <TaskCard
                key={task.id}
                labels={labels}
                locale={activeLocale}
                task={task}
                subtasks={subtasksByParent.get(task.id) ?? []}
                onEdit={setEditingTask}
                onComplete={toggleComplete}
                onUnassign={unassignTask}
                onUploadPhotos={uploadTaskPhotos}
                onPreviewImage={setPreviewImage}
              />
            ))}
          </TaskDateGroup>
        ))}

        {historyTasks.length > 0 ? (
          <section className="rounded-md border border-neutral-200 bg-white shadow-sm">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
              onClick={() => setHistoryOpen((current) => !current)}
              aria-expanded={historyOpen}
            >
              <span>
                <span className="block text-sm font-semibold text-neutral-900">
                  {labels.historySummary(historyTasks.length)}
                </span>
                {!historyOpen ? (
                  <span className="mt-0.5 block text-xs text-neutral-500">
                    {labels.showHistory}
                  </span>
                ) : null}
              </span>
              <span className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-700">
                {historyOpen ? labels.hideHistory : labels.showHistory}
              </span>
            </button>

            {historyOpen ? (
              <div className="space-y-3 border-t border-neutral-200 bg-neutral-50/70 px-2 py-3">
                {historyTaskGroups.map((group) => (
                  <TaskDateGroup key={`history-${group.key}`} label={group.label}>
                    {group.tasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        labels={labels}
                        locale={activeLocale}
                        task={task}
                        subtasks={subtasksByParent.get(task.id) ?? []}
                        onEdit={setEditingTask}
                        onComplete={toggleComplete}
                        onUnassign={unassignTask}
                        onUploadPhotos={uploadTaskPhotos}
                        onPreviewImage={setPreviewImage}
                      />
                    ))}
                  </TaskDateGroup>
                ))}

                {historyPageCount > 1 ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-2 py-2">
                    <button
                      type="button"
                      className="min-h-9 rounded-md border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 disabled:opacity-40"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
                    >
                      {labels.previousPage}
                    </button>
                    <span className="text-xs font-semibold text-neutral-500">
                      {labels.pageStatus(historyPage, historyPageCount)}
                    </span>
                    <button
                      type="button"
                      className="min-h-9 rounded-md border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 disabled:opacity-40"
                      disabled={historyPage >= historyPageCount}
                      onClick={() => setHistoryPage((current) => Math.min(historyPageCount, current + 1))}
                    >
                      {labels.nextPage}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
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
          onPreviewImage={setPreviewImage}
        />
      ) : null}
      {previewImage ? (
        <ImagePreviewModal
          labels={labels}
          attachment={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      ) : null}
    </main>
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
  subtasks,
  onEdit,
  onComplete,
  onUnassign,
  onUploadPhotos,
  onPreviewImage,
}: {
  labels: ReturnType<typeof copy>;
  locale: Locale;
  task: StaffShareTask;
  subtasks: StaffShareTask[];
  onEdit: (task: StaffShareTask) => void;
  onComplete: (task: StaffShareTask) => void;
  onUnassign: (task: StaffShareTask) => void;
  onUploadPhotos: (task: StaffShareTask, files: File[]) => void;
  onPreviewImage: (attachment: StaffShareAttachment) => void;
}) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const closed = task.status === "done" || task.status === "cancelled";
  const cancelled = task.status === "cancelled";
  return (
    <article className="rounded-md border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <DueBadge labels={labels} task={task} />
            <h3 className="min-w-0 flex-1 break-words text-base font-semibold leading-snug">
              {getDisplayTaskTitle(task, labels)}
            </h3>
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
          <AttachmentStrip attachments={task.attachments} labels={labels} onPreview={onPreviewImage} />
          <StaffShareSubtasks
            labels={labels}
            locale={locale}
            subtasks={subtasks}
            onEdit={onEdit}
            onComplete={onComplete}
            onUnassign={onUnassign}
            onUploadPhotos={onUploadPhotos}
            onPreviewImage={onPreviewImage}
          />
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
        {!cancelled ? (
          <>
            <button className="mobile-action min-h-10 flex-col gap-0.5 px-1 py-1 text-[11px] leading-tight border-sky-300 bg-sky-50 text-sky-800" onClick={() => uploadInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              <span className="text-center">{labels.uploadPhotos}</span>
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                onUploadPhotos(task, Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </>
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

function StaffShareSubtasks({
  labels,
  locale,
  subtasks,
  onEdit,
  onComplete,
  onUnassign,
  onUploadPhotos,
  onPreviewImage,
}: {
  labels: ReturnType<typeof copy>;
  locale: Locale;
  subtasks: StaffShareTask[];
  onEdit: (task: StaffShareTask) => void;
  onComplete: (task: StaffShareTask) => void;
  onUnassign: (task: StaffShareTask) => void;
  onUploadPhotos: (task: StaffShareTask, files: File[]) => void;
  onPreviewImage: (attachment: StaffShareAttachment) => void;
}) {
  if (subtasks.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {subtasks.map((subtask) => {
        const closed = subtask.status === "done" || subtask.status === "cancelled";
        return (
          <div key={subtask.id} className="rounded border border-neutral-200 bg-neutral-50 px-2 py-2">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
              <div className="min-w-0 flex-1">
                <p className={`break-words text-xs font-semibold leading-4 text-neutral-800 ${closed ? "line-through" : ""}`}>
                  {subtask.title}
                </p>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  {formatTaskDue(subtask.dueDatetime, locale, labels.noDue)}
                  {subtask.timeWindow ? ` · ${subtask.timeWindow}` : ""}
                </p>
                <AttachmentStrip attachments={subtask.attachments} labels={labels} onPreview={onPreviewImage} compact />
              </div>
            </div>
            {subtask.status !== "cancelled" ? (
              <div className="mt-2 grid grid-cols-4 gap-1">
                {!closed ? (
                  <button className="mobile-action !min-h-7 flex-col !gap-0.5 !px-0.5 !py-0.5 !text-[9px] leading-tight border-neutral-300 bg-white text-neutral-700" onClick={() => onUnassign(subtask)}>
                    <RotateCcw className="h-3 w-3" />
                    {labels.unassign}
                  </button>
                ) : null}
                <button className="mobile-action !min-h-7 flex-col !gap-0.5 !px-0.5 !py-0.5 !text-[9px] leading-tight border-amber-300 bg-amber-50 text-amber-800" onClick={() => onEdit(subtask)}>
                  <Pencil className="h-3 w-3" />
                  {labels.edit}
                </button>
                <label className="mobile-action flex !min-h-7 cursor-pointer flex-col items-center justify-center !gap-0.5 !px-0.5 !py-0.5 !text-[9px] leading-tight border-sky-300 bg-sky-50 text-sky-800">
                  <Upload className="h-3 w-3" />
                  {labels.uploadPhotos}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      onUploadPhotos(subtask, Array.from(event.target.files ?? []));
                      event.target.value = "";
                    }}
                  />
                </label>
                <button className="mobile-action !min-h-7 flex-col !gap-0.5 !px-0.5 !py-0.5 !text-[9px] leading-tight border-emerald-300 bg-emerald-50 text-emerald-800" onClick={() => onComplete(subtask)}>
                  {subtask.status === "done" ? <Circle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                  {subtask.status === "done" ? labels.reopen : labels.complete}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function EditTaskModal({
  labels,
  token,
  task,
  onClose,
  onSaved,
  onFailed,
  onPreviewImage,
}: {
  labels: ReturnType<typeof copy>;
  token: string;
  task: StaffShareTask;
  onClose: () => void;
  onSaved: (task: StaffShareTask) => void;
  onFailed: () => void;
  onPreviewImage: (attachment: StaffShareAttachment) => void;
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
    const uploadFiles = await compressImageFiles(files);
    uploadFiles.forEach((file) => formData.append("files", file));
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
              onPreview={onPreviewImage}
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
  onPreview,
}: {
  labels: ReturnType<typeof copy>;
  attachments: StaffShareAttachment[];
  pendingFiles: File[];
  onRemovePending: (index: number) => void;
  onPreview: (attachment: StaffShareAttachment) => void;
}) {
  if (attachments.length === 0 && pendingFiles.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-4 gap-2">
      {attachments.map((attachment) => (
        <button
          key={attachment.id}
          type="button"
          onClick={() => onPreview(attachment)}
          className="aspect-square overflow-hidden rounded border border-neutral-200 bg-neutral-100"
        >
          <img src={attachment.url} alt={attachment.filename || labels.photos} className="h-full w-full object-cover" />
        </button>
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
  onPreview,
  compact = false,
}: {
  attachments: StaffShareAttachment[];
  labels: ReturnType<typeof copy>;
  onPreview: (attachment: StaffShareAttachment) => void;
  compact?: boolean;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className={`${compact ? "mt-2 gap-1.5" : "mt-3 gap-2"} flex overflow-x-auto pb-1`}>
      {attachments.map((attachment) => (
        <button
          key={attachment.id}
          type="button"
          onClick={() => onPreview(attachment)}
          className={`${compact ? "h-10 w-10" : "h-16 w-16"} shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100`}
        >
          <img src={attachment.url} alt={attachment.filename || labels.photos} className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}

function ImagePreviewModal({
  labels,
  attachment,
  onClose,
}: {
  labels: ReturnType<typeof copy>;
  attachment: StaffShareAttachment;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 text-white">
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="min-w-0 truncate text-sm font-medium">{attachment.filename || labels.photos}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="flex h-9 min-w-9 items-center justify-center rounded-md border border-white/20 bg-white/10 px-2 text-sm"
            onClick={() => setScale((current) => Math.max(0.5, Number((current - 0.25).toFixed(2))))}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="h-9 rounded-md border border-white/20 bg-white/10 px-2 text-xs font-semibold"
            onClick={() => setScale(1)}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            className="flex h-9 min-w-9 items-center justify-center rounded-md border border-white/20 bg-white/10 px-2 text-sm"
            onClick={() => setScale((current) => Math.min(4, Number((current + 0.25).toFixed(2))))}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-9 min-w-9 items-center justify-center rounded-md border border-white/20 bg-white/10 px-2 text-sm"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div
        className="flex-1 overflow-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={onClose}
      >
        <div className="flex min-h-full items-center justify-center">
          <img
            src={attachment.url}
            alt={attachment.filename || labels.photos}
            className="max-h-[82vh] max-w-full object-contain transition-transform"
            style={{ transform: `scale(${scale})` }}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      </div>
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
    parentTaskId: task.parentTaskId ?? null,
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

function sortHistoryTasks(left: StaffShareTask, right: StaffShareTask) {
  const leftTime = getHistorySortTime(left);
  const rightTime = getHistorySortTime(right);
  if (leftTime !== rightTime) return rightTime - leftTime;
  return left.title.localeCompare(right.title);
}

function getHistorySortTime(task: StaffShareTask) {
  const value = task.completedAt ?? task.dueDatetime;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function groupTasksByDate(
  tasks: StaffShareTask[],
  locale: Locale,
  labels: ReturnType<typeof copy>,
  direction: "asc" | "desc" = "asc",
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

  return Array.from(groups.values()).sort((left, right) =>
    direction === "desc" ? right.order - left.order : left.order - right.order,
  );
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

function getDisplayTaskTitle(task: StaffShareTask, labels: ReturnType<typeof copy>) {
  if (task.category !== "order_pickup") return task.title;
  return task.title.replace(/^(取车|Pickup|Delivery)(\s*·\s*)/i, `${labels.delivery}$2`);
}

function isPhotoFile(file: File) {
  return file.type.startsWith("image/") || /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(file.name);
}
