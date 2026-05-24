"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  GripVertical,
  ImagePlus,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";

import type { Locale } from "@/lib/i18n";
import { cn, formatDateTime } from "@/lib/utils";

type StaffStatus = "todo" | "in_progress" | "done" | "cancelled";
type StaffPriority = "low" | "normal" | "high";

type StaffMember = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string | null;
  color: string;
  notes: string | null;
  pinnedMessage: string | null;
  isActive: boolean;
};

type StaffTask = {
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
  status: StaffStatus;
  priority: StaffPriority;
  category: string | null;
  completedAt: string | null;
  staff: StaffMember | null;
  vehicle: { id: string; plateNumber: string; nickname: string } | null;
  order: {
    id: string;
    renterName: string;
    pickupDatetime: string;
    returnDatetime: string;
  } | null;
  attachments: TaskAttachment[];
};

type TaskAttachment = {
  id: string;
  filename: string | null;
  contentType: string | null;
  size: number | null;
  uploadedAt: string;
  url: string;
};

type TaskModalState =
  | StaffTask
  | {
      kind: "new";
      staffId?: string;
    }
  | null;

type VehicleOption = {
  id: string;
  plateNumber: string;
  nickname: string;
  brand: string;
  model: string;
  year: number;
};

type OrderOption = {
  id: string;
  renterName: string;
  pickupDatetime: string;
  returnDatetime: string;
  vehicleLabel: string;
};

const defaultStaffForm = {
  name: "",
  phone: "",
  email: "",
  role: "",
  color: "#171717",
  notes: "",
  pinnedMessage: "",
};

const defaultTaskForm = {
  staffId: "",
  staffLabel: "",
  staffInput: "",
  vehicleId: "",
  vehicleLabel: "",
  vehicleInput: "",
  orderId: "",
  orderLabel: "",
  orderInput: "",
  title: "",
  details: "",
  dueDatetime: "",
  timeWindow: "",
};

function getStaffScheduleCopy(locale: Locale) {
  return locale === "zh"
    ? {
        kicker: "团队",
        title: "线下员工排班",
        subtitle: "把接送车、洗车、验车、维修、文件处理等线下工作分配给员工，并关联车辆或订单。",
        addStaff: "新增员工",
        addTask: "新增任务",
        activeTasks: "进行中任务",
        overdue: "逾期",
        completed: "已完成",
        unassigned: "未分配",
        unassignedHint: "还没有指定员工的任务会先停在这里。",
        history: "已完成 / 已取消",
        noStaff: "还没有员工。先新增员工，再分配任务。",
        noTasks: "暂无任务",
        todayBadge: "今天",
        pinned: "员工备注",
        noPinned: "暂无固定备注",
        edit: "编辑",
        complete: "完成",
        reopen: "重开",
        cancel: "取消",
        deleteStaff: "停用这个员工？现有任务会保留。",
        deleteTask: "取消这个任务？",
        save: "保存",
        close: "关闭",
        dragHint: "拖拽任务到员工卡片即可分配",
        dropToAssign: "松手分配到这里",
        staffName: "姓名",
        phone: "电话",
        email: "邮箱",
        role: "岗位",
        color: "颜色",
        notes: "备注",
        pinnedMessage: "固定提醒",
        taskTitle: "任务标题",
        taskDetails: "任务说明",
        staff: "员工",
        vehicle: "车辆",
        order: "关联订单",
        due: "到期",
        noDue: "无到期",
        window: "时间段",
        status: "状态",
        priority: "优先级",
        category: "类别",
        photos: "任务照片",
        uploadPhotos: "点击或拖拽上传照片",
        pendingPhotos: "保存任务后上传",
        removePhoto: "移除照片",
        customHint: "可搜索，也可直接输入自定义文字。",
        none: "不关联",
        created: "已保存",
        failed: "保存失败，请稍后再试。",
        statusLabels: {
          todo: "待办",
          in_progress: "进行中",
          done: "已完成",
          cancelled: "已取消",
        },
        priorityLabels: {
          low: "低",
          normal: "普通",
          high: "高",
        },
      }
    : {
        kicker: "Team",
        title: "Offline staff schedule",
        subtitle:
          "Assign handoffs, washes, inspections, repairs, document work, and other offline tasks to staff with vehicle and order context.",
        addStaff: "Add staff",
        addTask: "Add task",
        activeTasks: "Active tasks",
        overdue: "Overdue",
        completed: "Completed",
        unassigned: "Unassigned",
        unassignedHint: "Tasks without a staff owner wait here.",
        history: "Completed / cancelled",
        noStaff: "No staff yet. Add staff, then assign work.",
        noTasks: "No tasks",
        todayBadge: "Today",
        pinned: "Pinned note",
        noPinned: "No pinned note",
        edit: "Edit",
        complete: "Complete",
        reopen: "Reopen",
        cancel: "Cancel",
        deleteStaff: "Deactivate this staff member? Existing tasks stay visible.",
        deleteTask: "Cancel this task?",
        save: "Save",
        close: "Close",
        dragHint: "Drag a task card onto a staff card to assign it",
        dropToAssign: "Drop to assign here",
        staffName: "Name",
        phone: "Phone",
        email: "Email",
        role: "Role",
        color: "Color",
        notes: "Notes",
        pinnedMessage: "Pinned reminder",
        taskTitle: "Task title",
        taskDetails: "Task details",
        staff: "Staff",
        vehicle: "Vehicle",
        order: "Related order",
        due: "Due",
        noDue: "No due date",
        window: "Time window",
        status: "Status",
        priority: "Priority",
        category: "Category",
        photos: "Task photos",
        uploadPhotos: "Click or drag photos here",
        pendingPhotos: "Uploads after saving",
        removePhoto: "Remove photo",
        customHint: "Search existing records or type custom text.",
        none: "None",
        created: "Saved",
        failed: "Could not save. Please try again.",
        statusLabels: {
          todo: "To do",
          in_progress: "In progress",
          done: "Done",
          cancelled: "Cancelled",
        },
        priorityLabels: {
          low: "Low",
          normal: "Normal",
          high: "High",
        },
      };
}

export function StaffScheduleClient({
  locale,
  initialStaff,
  initialTasks,
  vehicles,
  orders,
}: {
  locale: Locale;
  initialStaff: StaffMember[];
  initialTasks: StaffTask[];
  vehicles: VehicleOption[];
  orders: OrderOption[];
}) {
  const c = getStaffScheduleCopy(locale);
  const [staff, setStaff] = useState(initialStaff);
  const [tasks, setTasks] = useState(initialTasks);
  const [notice, setNotice] = useState<string | null>(null);
  const [staffModal, setStaffModal] = useState<StaffMember | "new" | null>(null);
  const [taskModal, setTaskModal] = useState<TaskModalState>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const activeStaff = staff.filter((member) => member.isActive);
  const activeTasks = tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const completedTasks = tasks.filter((task) => task.status === "done" || task.status === "cancelled");
  const unassignedTasks = activeTasks.filter((task) => !task.staffId);

  const tasksByStaff = useMemo(() => {
    const map = new Map<string, StaffTask[]>();
    for (const member of activeStaff) map.set(member.id, []);
    for (const task of activeTasks) {
      if (!task.staffId || !map.has(task.staffId)) continue;
      map.get(task.staffId)!.push(task);
    }
    for (const list of map.values()) list.sort(sortTasks);
    return map;
  }, [activeStaff, activeTasks]);

  function upsertStaff(next: StaffMember) {
    setStaff((current) => {
      const index = current.findIndex((member) => member.id === next.id);
      if (index < 0) return [...current, next];
      const copyList = [...current];
      copyList[index] = next;
      return copyList;
    });
  }

  function upsertTask(next: StaffTask) {
    setTasks((current) => {
      const index = current.findIndex((task) => task.id === next.id);
      if (index < 0) return [...current, next];
      const copyList = [...current];
      copyList[index] = next;
      return copyList;
    });
  }

  async function quickStatus(task: StaffTask, status: StaffStatus) {
    const response = await fetch(`/api/staff-schedule/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.task) {
      setNotice(c.failed);
      return;
    }
    upsertTask(normalizeTask(payload.task));
  }

  async function assignTaskToStaff(taskId: string, staffId: string | null) {
    const response = await fetch(`/api/staff-schedule/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffId: staffId ?? "", staffLabel: "" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.task) {
      setNotice(c.failed);
      return;
    }
    upsertTask(normalizeTask(payload.task));
    setNotice(c.created);
  }

  function handleTaskDrop(staffId: string | null) {
    if (!dragTaskId) return;
    void assignTaskToStaff(dragTaskId, staffId);
    setDragTaskId(null);
    setDragOverTarget(null);
  }

  async function cancelTask(task: StaffTask) {
    if (!window.confirm(c.deleteTask)) return;
    await quickStatus(task, "cancelled");
  }

  async function deactivateStaff(member: StaffMember) {
    if (!window.confirm(c.deleteStaff)) return;
    const response = await fetch(`/api/staff-schedule/staff/${member.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.staff) {
      setNotice(c.failed);
      return;
    }
    upsertStaff(payload.staff);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold text-neutral-400">{c.kicker}</p>
          <h1 className="text-2xl font-semibold text-neutral-950">{c.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-neutral-500">{c.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => setStaffModal("new")}>
            <UserPlus className="h-4 w-4" />
            {c.addStaff}
          </button>
          <button className="btn-primary" onClick={() => setTaskModal({ kind: "new" })}>
            <Plus className="h-4 w-4" />
            {c.addTask}
          </button>
        </div>
      </section>

      <p className="text-xs text-neutral-500">{c.dragHint}</p>

      {notice ? (
        <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
          {notice}
        </div>
      ) : null}

      {activeStaff.length === 0 ? (
        <section className="card p-10 text-center text-sm text-neutral-500">{c.noStaff}</section>
      ) : (
        <section className="grid gap-2.5 xl:grid-cols-2">
          {activeStaff.map((member) => (
            <article
              key={member.id}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOverTarget(member.id);
              }}
              onDragLeave={() => setDragOverTarget((current) => (current === member.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                handleTaskDrop(member.id);
              }}
              className={cn(
                "card overflow-hidden transition",
                dragOverTarget === member.id ? "border-neutral-900 bg-neutral-50" : "",
              )}
            >
              <div className="flex flex-col gap-2 border-b border-neutral-200 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: member.color }} />
                    <h2 className="truncate text-base font-semibold">{member.name}</h2>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {[member.role, member.phone, member.email].filter(Boolean).join(" · ") || c.staff}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
                  <button className="btn-secondary min-h-8 px-2.5 py-1.5 text-xs" onClick={() => setTaskModal({ kind: "new", staffId: member.id })}>
                    <Plus className="h-3.5 w-3.5" />
                    {c.addTask}
                  </button>
                  <button className="btn-secondary min-h-8 border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 hover:bg-amber-100" onClick={() => setStaffModal(member)}>
                    <Pencil className="h-3.5 w-3.5" />
                    {c.edit}
                  </button>
                  <button className="btn-danger min-h-8 min-w-8 px-1.5 py-1.5 text-xs" onClick={() => deactivateStaff(member)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600">
                <span className="font-medium text-neutral-900">{c.pinned}: </span>
                {member.pinnedMessage || c.noPinned}
              </div>
              {dragOverTarget === member.id ? (
                <div className="border-b border-neutral-200 bg-neutral-950 px-4 py-2 text-xs font-medium text-white">
                  {c.dropToAssign}
                </div>
              ) : null}
              <TaskList
                tasks={tasksByStaff.get(member.id) ?? []}
                locale={locale}
                copy={c}
                dragTaskId={dragTaskId}
                onDragStart={setDragTaskId}
                onDragEnd={() => {
                  setDragTaskId(null);
                  setDragOverTarget(null);
                }}
                onEdit={setTaskModal}
                onComplete={(task) => quickStatus(task, task.status === "done" ? "todo" : "done")}
                onCancel={cancelTask}
              />
            </article>
          ))}
        </section>
      )}

      <section className="grid gap-2.5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <article
          onDragOver={(event) => {
            event.preventDefault();
            setDragOverTarget("unassigned");
          }}
          onDragLeave={() => setDragOverTarget((current) => (current === "unassigned" ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            handleTaskDrop(null);
          }}
          className={cn(
            "card overflow-hidden transition",
            dragOverTarget === "unassigned" ? "border-neutral-900 bg-neutral-50" : "",
          )}
        >
          <div className="border-b border-neutral-200 px-3 py-2.5">
            <h2 className="text-base font-semibold">{c.unassigned}</h2>
            <p className="text-xs text-neutral-500">{c.unassignedHint}</p>
          </div>
          {dragOverTarget === "unassigned" ? (
            <div className="border-b border-neutral-200 bg-neutral-950 px-4 py-2 text-xs font-medium text-white">
              {c.dropToAssign}
            </div>
          ) : null}
          <TaskList
            tasks={unassignedTasks.sort(sortTasks)}
            locale={locale}
            copy={c}
            dragTaskId={dragTaskId}
            onDragStart={setDragTaskId}
            onDragEnd={() => {
              setDragTaskId(null);
              setDragOverTarget(null);
            }}
            onEdit={setTaskModal}
            onComplete={(task) => quickStatus(task, "done")}
            onCancel={cancelTask}
          />
        </article>
        <article className="card overflow-hidden">
          <div className="border-b border-neutral-200 px-3 py-2.5">
            <h2 className="text-base font-semibold">{c.history}</h2>
          </div>
          <TaskList
            tasks={completedTasks.sort(sortTasks).slice(0, 30)}
            locale={locale}
            copy={c}
            dragTaskId={dragTaskId}
            onDragStart={setDragTaskId}
            onDragEnd={() => {
              setDragTaskId(null);
              setDragOverTarget(null);
            }}
            onEdit={setTaskModal}
            onComplete={(task) => quickStatus(task, "todo")}
            onCancel={cancelTask}
          />
        </article>
      </section>

      {staffModal ? (
        <StaffModal
          locale={locale}
          copy={c}
          staff={staffModal === "new" ? null : staffModal}
          onClose={() => setStaffModal(null)}
          onSaved={(member) => {
            upsertStaff(member);
            setNotice(c.created);
            setStaffModal(null);
          }}
        />
      ) : null}

      {taskModal ? (
        <TaskModal
          locale={locale}
          copy={c}
          task={isNewTaskModal(taskModal) ? null : taskModal}
          initialStaffId={isNewTaskModal(taskModal) ? taskModal.staffId : undefined}
          staff={activeStaff}
          vehicles={vehicles}
          orders={orders}
          onClose={() => setTaskModal(null)}
          onSaved={(task) => {
            upsertTask(task);
            setNotice(c.created);
            setTaskModal(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TaskList({
  tasks,
  locale,
  copy,
  dragTaskId,
  onDragStart,
  onDragEnd,
  onEdit,
  onComplete,
  onCancel,
}: {
  tasks: StaffTask[];
  locale: Locale;
  copy: ReturnType<typeof getStaffScheduleCopy>;
  dragTaskId: string | null;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onEdit: (task: StaffTask) => void;
  onComplete: (task: StaffTask) => void;
  onCancel: (task: StaffTask) => void;
}) {
  if (tasks.length === 0) {
    return <div className="px-3 py-4 text-sm text-neutral-500">{copy.noTasks}</div>;
  }

  return (
    <div className="divide-y divide-neutral-200">
      {tasks.map((task) => (
        <div
          key={task.id}
          draggable={task.status !== "done" && task.status !== "cancelled"}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", task.id);
            onDragStart(task.id);
          }}
          onDragEnd={onDragEnd}
          className={cn(
            "px-3 py-2 transition",
            task.status !== "done" && task.status !== "cancelled" ? "cursor-grab active:cursor-grabbing" : "",
            dragTaskId === task.id ? "bg-neutral-50 opacity-60" : "",
          )}
        >
          <div className="flex items-start justify-between gap-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  {task.status !== "done" && task.status !== "cancelled" && isTaskDueToday(task.dueDatetime) ? (
                    <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-white">
                      {copy.todayBadge}
                    </span>
                  ) : null}
                  <GripVertical className="h-4 w-4 shrink-0 text-neutral-300" />
                  {task.attachments.length > 0 ? (
                    <span className="badge bg-neutral-100 text-neutral-600">
                      <ImagePlus className="h-3 w-3" />
                      {task.attachments.length}
                    </span>
                  ) : null}
                  <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-950">{task.title}</h3>
                </div>
                <p className="mt-0.5 text-xs leading-4 text-neutral-500">
                  {formatTaskDue(task.dueDatetime, locale, copy.noDue)}
                  {task.timeWindow ? ` · ${task.timeWindow}` : ""}
                </p>
                <p className="mt-0.5 truncate text-xs leading-4 text-neutral-500">
                  {[
                    task.staffLabel ? `${copy.staff}: ${task.staffLabel}` : null,
                    getTaskVehicleLabel(task),
                    getTaskOrderLabel(task),
                  ]
                    .filter(Boolean)
                    .join(" · ") || copy.none}
                </p>
                {task.details ? <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-neutral-600">{task.details}</p> : null}
              </div>
              <TaskAttachmentStrip attachments={task.attachments} copy={copy} />
            </div>
            <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
              <button className="btn-secondary min-h-8 min-w-8 border-amber-300 bg-amber-50 px-1.5 py-1.5 text-xs text-amber-800 hover:bg-amber-100" onClick={() => onEdit(task)}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button className="btn-secondary min-h-8 border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800 hover:bg-emerald-100" onClick={() => onComplete(task)}>
                {task.status === "done" ? <Circle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {task.status === "done" ? copy.reopen : copy.complete}
              </button>
              {task.status !== "cancelled" ? (
                <button className="btn-danger min-h-8 min-w-8 px-1.5 py-1.5 text-xs" onClick={() => onCancel(task)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StaffModal({
  copy,
  staff,
  onClose,
  onSaved,
}: {
  locale: Locale;
  copy: ReturnType<typeof getStaffScheduleCopy>;
  staff: StaffMember | null;
  onClose: () => void;
  onSaved: (staff: StaffMember) => void;
}) {
  const [form, setForm] = useState(staff ? staffToForm(staff) : defaultStaffForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const response = await fetch(staff ? `/api/staff-schedule/staff/${staff.id}` : "/api/staff-schedule/staff", {
      method: staff ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok || !payload.staff) {
      setError(copy.failed);
      return;
    }
    onSaved(payload.staff);
  }

  return (
    <Modal title={staff ? copy.edit : copy.addStaff} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={copy.staffName}>
          <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy.phone}>
            <input className="input" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </Field>
          <Field label={copy.email}>
            <input className="input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field label={copy.role}>
            <input className="input" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} />
          </Field>
          <Field label={copy.color}>
            <input className="input h-10" type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} />
          </Field>
        </div>
        <Field label={copy.pinnedMessage}>
          <input className="input" value={form.pinnedMessage} onChange={(event) => setForm({ ...form, pinnedMessage: event.target.value })} />
        </Field>
        <Field label={copy.notes}>
          <textarea className="input min-h-24" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </Field>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button className="btn-primary w-full" disabled={saving}>{copy.save}</button>
      </form>
    </Modal>
  );
}

function TaskModal({
  locale,
  copy,
  task,
  initialStaffId,
  staff,
  vehicles,
  orders,
  onClose,
  onSaved,
}: {
  locale: Locale;
  copy: ReturnType<typeof getStaffScheduleCopy>;
  task: StaffTask | null;
  initialStaffId?: string;
  staff: StaffMember[];
  vehicles: VehicleOption[];
  orders: OrderOption[];
  onClose: () => void;
  onSaved: (task: StaffTask) => void;
}) {
  const staffOptions = useMemo(
    () => staff.map((member) => ({ id: member.id, label: member.name })),
    [staff],
  );
  const vehicleOptions = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        id: vehicle.id,
        label: `${vehicle.plateNumber} · ${vehicle.nickname} · ${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
      })),
    [vehicles],
  );
  const orderOptions = useMemo(
    () =>
      orders.map((order) => ({
        id: order.id,
        label: `${order.vehicleLabel} · ${order.renterName} · ${formatDateTime(order.pickupDatetime, locale)}`,
      })),
    [locale, orders],
  );
  const [form, setForm] = useState(() =>
    task
      ? taskToForm(task, staffOptions, vehicleOptions, orderOptions)
      : taskFormWithInitialStaff(initialStaffId, staffOptions),
  );
  const [attachments, setAttachments] = useState<TaskAttachment[]>(task?.attachments ?? []);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDraggingPhotos, setIsDraggingPhotos] = useState(false);

  function setStaffInput(value: string) {
    const match = findComboMatch(staffOptions, value);
    setForm((current) => ({
      ...current,
      staffInput: value,
      staffId: match?.id ?? "",
      staffLabel: match ? "" : value,
    }));
  }

  function setVehicleInput(value: string) {
    const match = findComboMatch(vehicleOptions, value);
    setForm((current) => ({
      ...current,
      vehicleInput: value,
      vehicleId: match?.id ?? "",
      vehicleLabel: match ? "" : value,
    }));
  }

  function setOrderInput(value: string) {
    const match = findComboMatch(orderOptions, value);
    setForm((current) => ({
      ...current,
      orderInput: value,
      orderId: match?.id ?? "",
      orderLabel: match ? "" : value,
    }));
  }

  async function uploadTaskPhotos(taskId: string, files: File[]) {
    if (files.length === 0) return [];

    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    const response = await fetch(`/api/staff-schedule/tasks/${taskId}/attachments`, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.attachments)) {
      throw new Error("UPLOAD_FAILED");
    }

    return payload.attachments.map((attachment: TaskAttachment) =>
      normalizeTaskAttachment(taskId, attachment),
    );
  }

  async function acceptPhotoFiles(files: FileList | File[]) {
    const nextFiles = Array.from(files).filter(isPhotoFile);
    if (nextFiles.length === 0) return;

    if (!task) {
      setPendingFiles((current) => [...current, ...nextFiles]);
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadTaskPhotos(task.id, nextFiles);
      setAttachments((current) => [...current, ...uploaded]);
    } catch {
      setError(copy.failed);
    } finally {
      setUploading(false);
    }
  }

  async function deleteUploadedAttachment(attachment: TaskAttachment) {
    if (!task) return;

    const response = await fetch(`/api/staff-schedule/tasks/${task.id}/attachments/${attachment.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError(copy.failed);
      return;
    }
    setAttachments((current) => current.filter((item) => item.id !== attachment.id));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const requestBody = {
      staffId: form.staffId,
      staffLabel: form.staffId ? "" : form.staffLabel,
      vehicleId: form.vehicleId,
      vehicleLabel: form.vehicleId ? "" : form.vehicleLabel,
      orderId: form.orderId,
      orderLabel: form.orderId ? "" : form.orderLabel,
      title: form.title,
      details: form.details,
      dueDatetime: form.dueDatetime,
      timeWindow: form.timeWindow,
    };

    try {
      const response = await fetch(task ? `/api/staff-schedule/tasks/${task.id}` : "/api/staff-schedule/tasks", {
        method: task ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.task) {
        setError(copy.failed);
        return;
      }

      let savedTask = normalizeTask(payload.task);
      if (pendingFiles.length > 0) {
        const uploaded = await uploadTaskPhotos(savedTask.id, pendingFiles);
        savedTask = normalizeTask({
          ...savedTask,
          attachments: [...savedTask.attachments, ...uploaded],
        });
      }

      onSaved(savedTask);
    } catch {
      setError(copy.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={task ? copy.edit : copy.addTask} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={copy.taskTitle}>
          <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <SearchTextField
            label={copy.staff}
            value={form.staffInput}
            options={staffOptions}
            placeholder={copy.unassigned}
            hint={copy.customHint}
            onChange={setStaffInput}
          />
          <SearchTextField
            label={copy.vehicle}
            value={form.vehicleInput}
            options={vehicleOptions}
            placeholder={copy.none}
            hint={copy.customHint}
            onChange={setVehicleInput}
          />
        </div>
        <SearchTextField
          label={copy.order}
          value={form.orderInput}
          options={orderOptions}
          placeholder={copy.none}
          hint={copy.customHint}
          onChange={setOrderInput}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy.due}>
            <input className="input" type="date" value={form.dueDatetime} onChange={(event) => setForm({ ...form, dueDatetime: event.target.value })} />
          </Field>
          <Field label={copy.window}>
            <input className="input" value={form.timeWindow} onChange={(event) => setForm({ ...form, timeWindow: event.target.value })} />
          </Field>
        </div>
        <Field label={copy.taskDetails}>
          <textarea className="input min-h-24" value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} />
        </Field>

        <div>
          <span className="label">{copy.photos}</span>
          <label
            onDragOver={(event) => {
              event.preventDefault();
              setIsDraggingPhotos(true);
            }}
            onDragLeave={() => setIsDraggingPhotos(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDraggingPhotos(false);
              void acceptPhotoFiles(event.dataTransfer.files);
            }}
            className={cn(
              "flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-4 text-center text-sm transition",
              isDraggingPhotos ? "border-neutral-900 bg-neutral-50" : "border-neutral-300 bg-white",
            )}
          >
            <ImagePlus className="h-5 w-5 text-neutral-500" />
            <span className="font-medium text-neutral-800">
              {uploading ? `${copy.save}...` : copy.uploadPhotos}
            </span>
            {!task && pendingFiles.length > 0 ? (
              <span className="text-xs text-neutral-500">
                {pendingFiles.length} · {copy.pendingPhotos}
              </span>
            ) : null}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) {
                  void acceptPhotoFiles(event.target.files);
                  event.target.value = "";
                }
              }}
            />
          </label>
          <TaskPhotoGrid
            taskId={task?.id ?? null}
            attachments={attachments}
            pendingFiles={pendingFiles}
            copy={copy}
            onDeleteUploaded={deleteUploadedAttachment}
            onDeletePending={(index) =>
              setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
            }
          />
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button className="btn-primary w-full" disabled={saving || uploading}>{copy.save}</button>
      </form>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative max-h-[88vh] w-[min(42rem,calc(100vw-2rem))] overflow-y-auto rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-secondary px-2 py-1 text-xs" onClick={onClose}>×</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

type ComboOption = {
  id: string;
  label: string;
};

function SearchTextField({
  label,
  value,
  options,
  placeholder,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  options: ComboOption[];
  placeholder: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  const [listId] = useState(() => `task-combo-${Math.random().toString(36).slice(2)}`);

  return (
    <Field label={label}>
      <input
        className="input"
        type="search"
        list={listId}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.id} value={option.label} />
        ))}
      </datalist>
      <p className="mt-1 text-[11px] leading-4 text-neutral-500">{hint}</p>
    </Field>
  );
}

function TaskPhotoGrid({
  taskId,
  attachments,
  pendingFiles,
  copy,
  onDeleteUploaded,
  onDeletePending,
}: {
  taskId: string | null;
  attachments: TaskAttachment[];
  pendingFiles: File[];
  copy: ReturnType<typeof getStaffScheduleCopy>;
  onDeleteUploaded: (attachment: TaskAttachment) => void;
  onDeletePending: (index: number) => void;
}) {
  if (attachments.length === 0 && pendingFiles.length === 0) return null;

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="group relative overflow-hidden border border-neutral-200 bg-neutral-50">
          <div className="aspect-[4/3] bg-neutral-100">
            <img
              src={attachment.url}
              alt={attachment.filename || copy.photos}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 px-2 py-1.5">
            <p className="truncate text-[11px] font-medium text-neutral-700">
              {attachment.filename || copy.photos}
            </p>
            <p className="text-[10px] text-neutral-500">{formatFileSize(attachment.size)}</p>
          </div>
          {taskId ? (
            <button
              type="button"
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center border border-neutral-200 bg-white text-neutral-700 shadow-sm"
              aria-label={copy.removePhoto}
              onClick={() => onDeleteUploaded(attachment)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ))}
      {pendingFiles.map((file, index) => (
        <div key={`${file.name}-${index}`} className="relative border border-dashed border-neutral-300 bg-neutral-50 p-3">
          <div className="flex min-h-20 flex-col items-center justify-center gap-2 text-center text-xs text-neutral-600">
            <ImagePlus className="h-5 w-5 text-neutral-400" />
            <span className="line-clamp-2 break-all font-medium text-neutral-800">{file.name}</span>
            <span>{copy.pendingPhotos}</span>
          </div>
          <button
            type="button"
            className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center border border-neutral-200 bg-white text-neutral-700 shadow-sm"
            aria-label={copy.removePhoto}
            onClick={() => onDeletePending(index)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function TaskAttachmentStrip({
  attachments,
  copy,
}: {
  attachments: TaskAttachment[];
  copy: ReturnType<typeof getStaffScheduleCopy>;
}) {
  if (attachments.length === 0) return null;

  const visibleAttachments = attachments.length > 3 ? attachments.slice(0, 2) : attachments.slice(0, 3);
  const hiddenCount = attachments.length - visibleAttachments.length;

  return (
    <div className="flex w-full shrink-0 flex-wrap gap-1.5 sm:w-[10.125rem] sm:justify-end">
      {visibleAttachments.map((attachment) => (
        <div key={attachment.id} className="h-12 w-12 overflow-hidden border border-neutral-200 bg-neutral-100">
          <img
            src={attachment.url}
            alt={attachment.filename || copy.photos}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ))}
      {hiddenCount > 0 ? (
        <div className="flex h-12 w-12 items-center justify-center border border-neutral-200 bg-neutral-50 text-xs font-semibold text-neutral-600">
          +{hiddenCount}
        </div>
      ) : null}
    </div>
  );
}

function normalizeComboText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function findComboMatch(options: ComboOption[], value: string) {
  const normalized = normalizeComboText(value);
  if (!normalized) return null;
  return options.find((option) => normalizeComboText(option.label) === normalized) ?? null;
}

function isPhotoFile(file: File) {
  return file.type.startsWith("image/") || /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(file.name);
}

function normalizeTaskAttachment(taskId: string, raw: TaskAttachment): TaskAttachment {
  return {
    id: raw.id,
    filename: raw.filename ?? null,
    contentType: raw.contentType ?? null,
    size: raw.size ?? null,
    uploadedAt: raw.uploadedAt ? new Date(raw.uploadedAt).toISOString() : new Date().toISOString(),
    url: raw.url || `/api/staff-schedule/tasks/${taskId}/attachments/file?attachmentId=${raw.id}`,
  };
}

function getTaskVehicleLabel(task: StaffTask) {
  if (task.vehicle) return `${task.vehicle.plateNumber} · ${task.vehicle.nickname}`;
  return task.vehicleLabel;
}

function getTaskOrderLabel(task: StaffTask) {
  if (task.order) return task.order.renterName;
  return task.orderLabel;
}

function formatTaskDue(value: string | null, locale: Locale, fallback: string) {
  if (!value) return fallback;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOffset = Math.round((dueDay.getTime() - today.getTime()) / 86400000);

  if (locale === "zh") {
    if (dayOffset === 0) return "今天";
    if (dayOffset === 1) return "明天";
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  if (dayOffset === 0) return "Today";
  if (dayOffset === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function isTaskDueToday(value: string | null) {
  if (!value) return false;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatFileSize(size: number | null) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeTask(raw: StaffTask): StaffTask {
  return {
    ...raw,
    dueDatetime: raw.dueDatetime ? new Date(raw.dueDatetime).toISOString() : null,
    completedAt: raw.completedAt ? new Date(raw.completedAt).toISOString() : null,
    attachments: (raw.attachments ?? []).map((attachment) => normalizeTaskAttachment(raw.id, attachment)),
    order: raw.order
      ? {
          ...raw.order,
          pickupDatetime: new Date(raw.order.pickupDatetime).toISOString(),
          returnDatetime: new Date(raw.order.returnDatetime).toISOString(),
        }
      : null,
  };
}

function sortTasks(left: StaffTask, right: StaffTask) {
  const leftTime = left.dueDatetime ? new Date(left.dueDatetime).getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right.dueDatetime ? new Date(right.dueDatetime).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.title.localeCompare(right.title);
}

function staffToForm(staff: StaffMember) {
  return {
    name: staff.name,
    phone: staff.phone ?? "",
    email: staff.email ?? "",
    role: staff.role ?? "",
    color: staff.color,
    notes: staff.notes ?? "",
    pinnedMessage: staff.pinnedMessage ?? "",
  };
}

function isNewTaskModal(value: TaskModalState): value is Extract<TaskModalState, { kind: "new" }> {
  return Boolean(value && typeof value === "object" && "kind" in value);
}

function taskFormWithInitialStaff(initialStaffId: string | undefined, staffOptions: ComboOption[]) {
  const staffOption = initialStaffId ? staffOptions.find((option) => option.id === initialStaffId) : null;

  return {
    ...defaultTaskForm,
    staffId: staffOption?.id ?? "",
    staffInput: staffOption?.label ?? "",
    staffLabel: "",
  };
}

function taskToForm(
  task: StaffTask,
  staffOptions: ComboOption[],
  vehicleOptions: ComboOption[],
  orderOptions: ComboOption[],
) {
  const staffOption = task.staffId ? staffOptions.find((option) => option.id === task.staffId) : null;
  const vehicleOption = task.vehicleId ? vehicleOptions.find((option) => option.id === task.vehicleId) : null;
  const orderOption = task.orderId ? orderOptions.find((option) => option.id === task.orderId) : null;

  return {
    staffId: task.staffId ?? "",
    staffLabel: task.staffLabel ?? "",
    staffInput: staffOption?.label ?? task.staffLabel ?? "",
    vehicleId: task.vehicleId ?? "",
    vehicleLabel: task.vehicleLabel ?? "",
    vehicleInput: vehicleOption?.label ?? task.vehicleLabel ?? "",
    orderId: task.orderId ?? "",
    orderLabel: task.orderLabel ?? "",
    orderInput: orderOption?.label ?? task.orderLabel ?? "",
    title: task.title,
    details: task.details ?? "",
    dueDatetime: task.dueDatetime ? toLocalDateInput(task.dueDatetime) : "",
    timeWindow: task.timeWindow ?? "",
  };
}

function toLocalDateInput(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
