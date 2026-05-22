"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Circle, Pencil, Plus, Trash2, UserPlus } from "lucide-react";

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
};

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
  vehicleId: "",
  orderId: "",
  title: "",
  details: "",
  dueDatetime: "",
  timeWindow: "",
  status: "todo" as StaffStatus,
  priority: "normal" as StaffPriority,
  category: "",
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
        due: "到期时间",
        window: "时间段",
        status: "状态",
        priority: "优先级",
        category: "类别",
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
        due: "Due time",
        window: "Time window",
        status: "Status",
        priority: "Priority",
        category: "Category",
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
  const [taskModal, setTaskModal] = useState<StaffTask | "new" | null>(null);

  const activeStaff = staff.filter((member) => member.isActive);
  const activeTasks = tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const completedTasks = tasks.filter((task) => task.status === "done" || task.status === "cancelled");
  const overdueTasks = activeTasks.filter((task) => task.dueDatetime && new Date(task.dueDatetime) < new Date());
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
          <button className="btn-primary" onClick={() => setTaskModal("new")}>
            <Plus className="h-4 w-4" />
            {c.addTask}
          </button>
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-3">
        <Metric label={c.activeTasks} value={activeTasks.length} />
        <Metric label={c.overdue} value={overdueTasks.length} warn={overdueTasks.length > 0} />
        <Metric label={c.completed} value={completedTasks.length} />
      </section>

      {notice ? (
        <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
          {notice}
        </div>
      ) : null}

      {activeStaff.length === 0 ? (
        <section className="card p-10 text-center text-sm text-neutral-500">{c.noStaff}</section>
      ) : (
        <section className="grid gap-3 xl:grid-cols-2">
          {activeStaff.map((member) => (
            <article key={member.id} className="card overflow-hidden">
              <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: member.color }} />
                    <h2 className="truncate text-base font-semibold">{member.name}</h2>
                  </div>
                  <p className="mt-1 truncate text-xs text-neutral-500">
                    {[member.role, member.phone, member.email].filter(Boolean).join(" · ") || c.staff}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setStaffModal(member)}>
                    <Pencil className="h-3.5 w-3.5" />
                    {c.edit}
                  </button>
                  <button className="btn-danger px-2 py-1 text-xs" onClick={() => deactivateStaff(member)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-600">
                <span className="font-medium text-neutral-900">{c.pinned}: </span>
                {member.pinnedMessage || c.noPinned}
              </div>
              <TaskList
                tasks={tasksByStaff.get(member.id) ?? []}
                locale={locale}
                copy={c}
                onEdit={setTaskModal}
                onComplete={(task) => quickStatus(task, task.status === "done" ? "todo" : "done")}
                onCancel={cancelTask}
              />
            </article>
          ))}
        </section>
      )}

      <section className="grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <article className="card overflow-hidden">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h2 className="text-base font-semibold">{c.unassigned}</h2>
            <p className="text-xs text-neutral-500">{c.unassignedHint}</p>
          </div>
          <TaskList
            tasks={unassignedTasks.sort(sortTasks)}
            locale={locale}
            copy={c}
            onEdit={setTaskModal}
            onComplete={(task) => quickStatus(task, "done")}
            onCancel={cancelTask}
          />
        </article>
        <article className="card overflow-hidden">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h2 className="text-base font-semibold">{c.history}</h2>
          </div>
          <TaskList
            tasks={completedTasks.sort(sortTasks).slice(0, 30)}
            locale={locale}
            copy={c}
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
          task={taskModal === "new" ? null : taskModal}
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

function Metric({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold", warn ? "text-red-700" : "text-neutral-950")}>
        {value}
      </p>
    </div>
  );
}

function TaskList({
  tasks,
  locale,
  copy,
  onEdit,
  onComplete,
  onCancel,
}: {
  tasks: StaffTask[];
  locale: Locale;
  copy: ReturnType<typeof getStaffScheduleCopy>;
  onEdit: (task: StaffTask) => void;
  onComplete: (task: StaffTask) => void;
  onCancel: (task: StaffTask) => void;
}) {
  if (tasks.length === 0) {
    return <div className="px-4 py-6 text-sm text-neutral-500">{copy.noTasks}</div>;
  }

  return (
    <div className="divide-y divide-neutral-200">
      {tasks.map((task) => (
        <div key={task.id} className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill task={task} copy={copy} />
                <PriorityPill task={task} copy={copy} />
                {task.category ? <span className="badge bg-neutral-100 text-neutral-600">{task.category}</span> : null}
              </div>
              <h3 className="mt-1 truncate text-sm font-semibold text-neutral-950">{task.title}</h3>
              <p className="mt-1 text-xs text-neutral-500">
                {task.dueDatetime ? formatDateTime(task.dueDatetime, locale) : copy.due}
                {task.timeWindow ? ` · ${task.timeWindow}` : ""}
              </p>
              <p className="mt-1 truncate text-xs text-neutral-500">
                {[task.vehicle ? `${task.vehicle.plateNumber} · ${task.vehicle.nickname}` : null, task.order?.renterName]
                  .filter(Boolean)
                  .join(" · ") || copy.none}
              </p>
              {task.details ? <p className="mt-1 text-xs text-neutral-600">{task.details}</p> : null}
            </div>
            <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
              <button className="btn-secondary px-2 py-1 text-xs" onClick={() => onEdit(task)}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button className="btn-secondary px-2 py-1 text-xs" onClick={() => onComplete(task)}>
                {task.status === "done" ? <Circle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {task.status === "done" ? copy.reopen : copy.complete}
              </button>
              {task.status !== "cancelled" ? (
                <button className="btn-danger px-2 py-1 text-xs" onClick={() => onCancel(task)}>
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

function StatusPill({ task, copy }: { task: StaffTask; copy: ReturnType<typeof getStaffScheduleCopy> }) {
  const styles = {
    todo: "bg-neutral-100 text-neutral-700",
    in_progress: "bg-blue-50 text-blue-700",
    done: "bg-emerald-50 text-emerald-700",
    cancelled: "bg-rose-50 text-rose-700",
  };
  return <span className={cn("badge", styles[task.status])}>{copy.statusLabels[task.status]}</span>;
}

function PriorityPill({ task, copy }: { task: StaffTask; copy: ReturnType<typeof getStaffScheduleCopy> }) {
  const styles = {
    low: "bg-neutral-100 text-neutral-500",
    normal: "bg-neutral-100 text-neutral-700",
    high: "bg-amber-50 text-amber-700",
  };
  return <span className={cn("badge", styles[task.priority])}>{copy.priorityLabels[task.priority]}</span>;
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
  staff,
  vehicles,
  orders,
  onClose,
  onSaved,
}: {
  locale: Locale;
  copy: ReturnType<typeof getStaffScheduleCopy>;
  task: StaffTask | null;
  staff: StaffMember[];
  vehicles: VehicleOption[];
  orders: OrderOption[];
  onClose: () => void;
  onSaved: (task: StaffTask) => void;
}) {
  const [form, setForm] = useState(task ? taskToForm(task) : defaultTaskForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const response = await fetch(task ? `/api/staff-schedule/tasks/${task.id}` : "/api/staff-schedule/tasks", {
      method: task ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok || !payload.task) {
      setError(copy.failed);
      return;
    }
    onSaved(normalizeTask(payload.task));
  }

  return (
    <Modal title={task ? copy.edit : copy.addTask} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={copy.taskTitle}>
          <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy.staff}>
            <select className="input" value={form.staffId} onChange={(event) => setForm({ ...form, staffId: event.target.value })}>
              <option value="">{copy.unassigned}</option>
              {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </Field>
          <Field label={copy.vehicle}>
            <select className="input" value={form.vehicleId} onChange={(event) => setForm({ ...form, vehicleId: event.target.value })}>
              <option value="">{copy.none}</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.plateNumber} · {vehicle.nickname} · {vehicle.brand} {vehicle.model} {vehicle.year}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={copy.order}>
          <select className="input" value={form.orderId} onChange={(event) => setForm({ ...form, orderId: event.target.value })}>
            <option value="">{copy.none}</option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.vehicleLabel} · {order.renterName} · {formatDateTime(order.pickupDatetime, locale)}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy.due}>
            <input className="input" type="datetime-local" value={form.dueDatetime} onChange={(event) => setForm({ ...form, dueDatetime: event.target.value })} />
          </Field>
          <Field label={copy.window}>
            <input className="input" value={form.timeWindow} onChange={(event) => setForm({ ...form, timeWindow: event.target.value })} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={copy.status}>
            <select className="input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as StaffStatus })}>
              {(["todo", "in_progress", "done", "cancelled"] as StaffStatus[]).map((status) => (
                <option key={status} value={status}>{copy.statusLabels[status]}</option>
              ))}
            </select>
          </Field>
          <Field label={copy.priority}>
            <select className="input" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as StaffPriority })}>
              {(["low", "normal", "high"] as StaffPriority[]).map((priority) => (
                <option key={priority} value={priority}>{copy.priorityLabels[priority]}</option>
              ))}
            </select>
          </Field>
          <Field label={copy.category}>
            <input className="input" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
          </Field>
        </div>
        <Field label={copy.taskDetails}>
          <textarea className="input min-h-24" value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} />
        </Field>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button className="btn-primary w-full" disabled={saving}>{copy.save}</button>
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

function normalizeTask(raw: StaffTask): StaffTask {
  return {
    ...raw,
    dueDatetime: raw.dueDatetime ? new Date(raw.dueDatetime).toISOString() : null,
    completedAt: raw.completedAt ? new Date(raw.completedAt).toISOString() : null,
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

function taskToForm(task: StaffTask) {
  return {
    staffId: task.staffId ?? "",
    vehicleId: task.vehicleId ?? "",
    orderId: task.orderId ?? "",
    title: task.title,
    details: task.details ?? "",
    dueDatetime: task.dueDatetime ? toLocalDatetimeInput(task.dueDatetime) : "",
    timeWindow: task.timeWindow ?? "",
    status: task.status,
    priority: task.priority,
    category: task.category ?? "",
  };
}

function toLocalDatetimeInput(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
