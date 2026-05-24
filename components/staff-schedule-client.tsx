"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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
  sortOrder: number;
  shareToken: string | null;
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
  sortOrder: number;
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
  pickupLocation: string | null;
  returnLocation: string | null;
  vehicleId: string;
  vehicleLabel: string;
};

type OrderEventKind = "pickup" | "return";

type OrderEvent = {
  id: string;
  orderId: string;
  vehicleId: string;
  kind: OrderEventKind;
  category: string;
  renterName: string;
  vehicleLabel: string;
  datetime: string;
  location: string | null;
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
        upcomingOrders: "近期送还车订单",
        upcomingOrdersHint: "显示今天和未来 3 天的送车、还车。拖到员工卡片，或输入员工姓名分配。",
        noUpcomingOrders: "未来 3 天没有送车或还车订单。",
        pickup: "送车",
        returnCar: "还车",
        deliveryAddress: "送车地址",
        returnAddress: "还车地址",
        assignStaff: "输入员工分配",
        orderTaskExists: "这个订单动作已经有未完成任务，已移动到新的员工名下。",
        history: "已完成 / 已取消",
        historySearch: "搜索已完成任务",
        historySearchPlaceholder: "搜索任务标题、说明、车辆、订单...",
        previousPage: "上一页",
        nextPage: "下一页",
        pageStatus: (current: number, total: number) => `第 ${current} / ${total} 页`,
        viewArchivedStaff: "查看过去员工",
        hideArchivedStaff: "隐藏过去员工",
        archivedStaffTitle: "过去员工",
        archivedStaffHint: "已 Archive 的员工和他们保留的历史任务。",
        noArchivedStaff: "暂无过去员工",
        archived: "Archived",
        noStaff: "还没有员工。先新增员工，再分配任务。",
        noTasks: "暂无任务",
        todayBadge: "今天",
        tomorrowBadge: "明天",
        dayAfterTomorrow: "后天",
        showHistory: "展开",
        hideHistory: "折叠",
        historyCount: (count: number) => `${count} 条记录`,
        copyShareLink: "复制链接",
        shareCopied: "员工任务链接已复制。",
        shareUnavailable: "链接还没有生成，请刷新页面后再试。",
        pinned: "员工备注",
        noPinned: "暂无固定备注",
        edit: "编辑",
        complete: "完成",
        reopen: "重开",
        cancel: "取消",
        deleteStaff: "停用这个员工？现有任务会保留。",
        archiveStaff: "Archive",
        deleteTask: "删除这个任务？删除后不会进入已完成/已取消区。",
        permanentDelete: "彻底删除",
        permanentDeleteTask: "彻底删除这个历史任务？此操作不能撤销。",
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
        upcomingOrders: "Upcoming deliveries / returns",
        upcomingOrdersHint: "Today and the next 3 days. Drag to a staff card, or type a staff name to assign.",
        noUpcomingOrders: "No deliveries or returns in the next 3 days.",
        pickup: "Delivery",
        returnCar: "Return",
        deliveryAddress: "Delivery address",
        returnAddress: "Return address",
        assignStaff: "Type staff to assign",
        orderTaskExists: "This order action already had an open task, so it was moved to the selected staff member.",
        history: "Completed / cancelled",
        historySearch: "Search completed tasks",
        historySearchPlaceholder: "Search title, details, vehicle, order...",
        previousPage: "Previous",
        nextPage: "Next",
        pageStatus: (current: number, total: number) => `Page ${current} / ${total}`,
        viewArchivedStaff: "Archived staff",
        hideArchivedStaff: "Hide archived staff",
        archivedStaffTitle: "Archived staff",
        archivedStaffHint: "Archived staff and their retained task history.",
        noArchivedStaff: "No archived staff",
        archived: "Archived",
        noStaff: "No staff yet. Add staff, then assign work.",
        noTasks: "No tasks",
        todayBadge: "Today",
        tomorrowBadge: "Tomorrow",
        dayAfterTomorrow: "Day after tomorrow",
        showHistory: "Expand",
        hideHistory: "Collapse",
        historyCount: (count: number) => `${count} record${count === 1 ? "" : "s"}`,
        copyShareLink: "Copy link",
        shareCopied: "Staff task link copied.",
        shareUnavailable: "The link is not ready yet. Refresh and try again.",
        pinned: "Pinned note",
        noPinned: "No pinned note",
        edit: "Edit",
        complete: "Complete",
        reopen: "Reopen",
        cancel: "Cancel",
        deleteStaff: "Deactivate this staff member? Existing tasks stay visible.",
        archiveStaff: "Archive",
        deleteTask: "Delete this task? It will not be shown in completed / cancelled.",
        permanentDelete: "Delete permanently",
        permanentDeleteTask: "Permanently delete this history task? This cannot be undone.",
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
  upcomingOrders,
}: {
  locale: Locale;
  initialStaff: StaffMember[];
  initialTasks: StaffTask[];
  vehicles: VehicleOption[];
  orders: OrderOption[];
  upcomingOrders: OrderOption[];
}) {
  const c = getStaffScheduleCopy(locale);
  const [staff, setStaff] = useState(initialStaff);
  const [tasks, setTasks] = useState(initialTasks);
  const [notice, setNotice] = useState<string | null>(null);
  const [staffModal, setStaffModal] = useState<StaffMember | "new" | null>(null);
  const [taskModal, setTaskModal] = useState<TaskModalState>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOrderEvent, setDragOrderEvent] = useState<OrderEvent | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [dragStaffId, setDragStaffId] = useState<string | null>(null);
  const [dragOverStaffId, setDragOverStaffId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [showArchivedStaff, setShowArchivedStaff] = useState(false);
  const [upcomingOrdersCollapsed, setUpcomingOrdersCollapsed] = useState(false);

  const activeStaff = useMemo(() => staff.filter((member) => member.isActive).sort(sortStaffMembers), [staff]);
  const archivedStaff = useMemo(() => staff.filter((member) => !member.isActive).sort(sortStaffMembers), [staff]);
  const activeTasks = useMemo(
    () => tasks.filter((task) => task.status !== "done" && task.status !== "cancelled"),
    [tasks],
  );
  const completedTasks = useMemo(
    () => tasks.filter((task) => task.status === "done"),
    [tasks],
  );
  const unassignedTasks = activeTasks.filter((task) => !task.staffId);
  const assignedOrderEventKeys = useMemo(
    () =>
      new Set(
        tasks
          .filter((task) => task.status !== "cancelled" && task.orderId && task.category)
          .map((task) => buildOrderEventKey(task.orderId!, task.category!)),
      ),
    [tasks],
  );
  const upcomingOrderEvents = useMemo(
    () =>
      buildUpcomingOrderEvents(upcomingOrders).filter(
        (orderEvent) => !assignedOrderEventKeys.has(buildOrderEventKey(orderEvent.orderId, orderEvent.category)),
      ),
    [assignedOrderEventKeys, upcomingOrders],
  );
  const visibleCompletedTasks = useMemo(
    () => completedTasks.filter((task) => taskMatchesSearch(task, historySearch)),
    [completedTasks, historySearch],
  );
  const historyPageSize = 10;
  const historyPageCount = Math.max(1, Math.ceil(visibleCompletedTasks.length / historyPageSize));
  const normalizedHistoryPage = Math.min(historyPage, historyPageCount);
  const pagedCompletedTasks = useMemo(
    () =>
      visibleCompletedTasks
        .slice()
        .sort(sortTasks)
        .slice((normalizedHistoryPage - 1) * historyPageSize, normalizedHistoryPage * historyPageSize),
    [normalizedHistoryPage, visibleCompletedTasks],
  );

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
  const tasksByArchivedStaff = useMemo(() => {
    const map = new Map<string, StaffTask[]>();
    for (const member of archivedStaff) map.set(member.id, []);
    for (const task of tasks) {
      if (!task.staffId || !map.has(task.staffId)) continue;
      map.get(task.staffId)!.push(task);
    }
    for (const list of map.values()) list.sort(sortTasks);
    return map;
  }, [archivedStaff, tasks]);

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

  async function persistTaskOrder(updates: Map<string, Partial<StaffTask>>, movedTaskId: string, staffId: string | null) {
    const responses = await Promise.all(
      Array.from(updates.entries()).map(([taskId, update]) => {
        const body: Record<string, string | number> = { sortOrder: update.sortOrder ?? 0 };
        if (taskId === movedTaskId) {
          body.staffId = staffId ?? "";
          body.staffLabel = "";
        }
        return fetch(`/api/staff-schedule/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }),
    );

    if (responses.some((response) => !response.ok)) {
      setNotice(c.failed);
      return;
    }
    setNotice(c.created);
  }

  async function moveTaskToPosition(taskId: string, staffId: string | null, targetTaskId: string | null = null) {
    const movingTask = tasks.find((task) => task.id === taskId);
    if (!movingTask || movingTask.id === targetTaskId) return;

    const sourceStaffId = movingTask.staffId ?? null;
    const targetStaffId = staffId ?? null;
    const assignedStaff = targetStaffId
      ? activeStaff.find((member) => member.id === targetStaffId) ?? null
      : null;
    const sameGroup = sourceStaffId === targetStaffId;
    const targetGroup = activeTasks
      .filter((task) => task.id !== taskId && (task.staffId ?? null) === targetStaffId)
      .sort(sortTasks);
    const targetIndex = targetTaskId
      ? targetGroup.findIndex((task) => task.id === targetTaskId)
      : -1;
    const nextMovingTask: StaffTask = {
      ...movingTask,
      staffId: targetStaffId,
      staffLabel: null,
      staff: assignedStaff,
    };
    const nextTargetGroup = [...targetGroup];
    nextTargetGroup.splice(targetIndex >= 0 ? targetIndex : nextTargetGroup.length, 0, nextMovingTask);

    const updates = new Map<string, Partial<StaffTask>>();
    nextTargetGroup.forEach((task, index) => {
      updates.set(task.id, {
        sortOrder: (index + 1) * 1000,
        ...(task.id === taskId ? { staffId: targetStaffId, staffLabel: null, staff: assignedStaff } : {}),
      });
    });

    if (!sameGroup) {
      activeTasks
        .filter((task) => task.id !== taskId && (task.staffId ?? null) === sourceStaffId)
        .sort(sortTasks)
        .forEach((task, index) => {
          updates.set(task.id, { sortOrder: (index + 1) * 1000 });
        });
    }

    setTasks((current) =>
      current.map((task) => {
        const update = updates.get(task.id);
        return update ? { ...task, ...update } : task;
      }),
    );
    await persistTaskOrder(updates, taskId, targetStaffId);
  }

  function handleTaskDrop(staffId: string | null) {
    if (!dragTaskId) return;
    void moveTaskToPosition(dragTaskId, staffId);
    setDragTaskId(null);
    setDragOverTarget(null);
    setDragOverTaskId(null);
  }

  async function createTaskFromOrderEvent(orderEvent: OrderEvent, staffId: string | null) {
    const existingTask = activeTasks.find(
      (task) =>
        task.orderId === orderEvent.orderId &&
        task.category === orderEvent.category &&
        task.status !== "done" &&
        task.status !== "cancelled",
    );

    if (existingTask) {
      await moveTaskToPosition(existingTask.id, staffId);
      setNotice(c.orderTaskExists);
      return;
    }

    const staffMember = staffId ? activeStaff.find((member) => member.id === staffId) : null;
    const targetSortOrder =
      (activeTasks.filter((task) => (task.staffId ?? null) === (staffId ?? null)).length + 1) * 1000;
    const response = await fetch("/api/staff-schedule/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staffId: staffId ?? "",
        staffLabel: "",
        vehicleId: orderEvent.vehicleId,
        vehicleLabel: "",
        orderId: orderEvent.orderId,
        orderLabel: "",
        title: buildOrderEventTaskTitle(orderEvent, c),
        details: buildOrderEventTaskDetails(orderEvent, c),
        dueDatetime: toLocalDateInput(orderEvent.datetime),
        timeWindow: formatOrderEventTime(orderEvent.datetime, locale),
        category: orderEvent.category,
        sortOrder: targetSortOrder,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.task) {
      setNotice(c.failed);
      return;
    }

    upsertTask(normalizeTask(payload.task));
    setNotice(
      staffMember ? `${c.created} · ${staffMember.name}` : c.created,
    );
  }

  function handleOrderEventDrop(staffId: string | null) {
    if (!dragOrderEvent) return;
    void createTaskFromOrderEvent(dragOrderEvent, staffId);
    clearDragState();
  }

  async function reorderStaff(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;

    const fromIndex = activeStaff.findIndex((member) => member.id === draggedId);
    const toIndex = activeStaff.findIndex((member) => member.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;

    const ordered = [...activeStaff];
    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, moved);
    const updates = new Map(
      ordered.map((member, index) => [member.id, { ...member, sortOrder: (index + 1) * 1000 }]),
    );

    setStaff((current) =>
      current.map((member) => {
        const update = updates.get(member.id);
        return update ? { ...member, sortOrder: update.sortOrder } : member;
      }),
    );

    const responses = await Promise.all(
      ordered.map((member) =>
        fetch(`/api/staff-schedule/staff/${member.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: updates.get(member.id)?.sortOrder ?? member.sortOrder }),
        }),
      ),
    );

    setNotice(responses.some((response) => !response.ok) ? c.failed : c.created);
  }

  function clearDragState() {
    setDragTaskId(null);
    setDragOrderEvent(null);
    setDragOverTarget(null);
    setDragOverTaskId(null);
    setDragStaffId(null);
    setDragOverStaffId(null);
  }

  function staffShareHref(member: StaffMember) {
    return member.shareToken ? `/staff-share/${member.shareToken}` : "";
  }

  async function copyStaffShareLink(member: StaffMember) {
    const href = staffShareHref(member);
    if (!href) {
      setNotice(c.shareUnavailable);
      return;
    }

    const url = `${window.location.origin}${href}`;
    await navigator.clipboard.writeText(url);
    setNotice(c.shareCopied);
  }

  async function deleteTask(task: StaffTask, permanent = false) {
    if (!window.confirm(permanent ? c.permanentDeleteTask : c.deleteTask)) return;
    const response = await fetch(`/api/staff-schedule/tasks/${task.id}`, { method: "DELETE" });
    if (!response.ok) {
      setNotice(c.failed);
      return;
    }
    setTasks((current) => current.filter((item) => item.id !== task.id));
    setNotice(c.created);
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
          <button className="btn-secondary min-h-11 px-4 py-2 text-sm" onClick={() => setShowArchivedStaff((open) => !open)}>
            {showArchivedStaff ? c.hideArchivedStaff : c.viewArchivedStaff}
          </button>
          <button className="btn-secondary min-h-11 px-4 py-2 text-sm" onClick={() => setStaffModal("new")}>
            <UserPlus className="h-4 w-4" />
            {c.addStaff}
          </button>
        </div>
      </section>

      <p className="text-xs text-neutral-500">{c.dragHint}</p>

      {notice ? (
        <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
          {notice}
        </div>
      ) : null}

      <div
        className={cn(
          "grid gap-3 xl:items-start",
          upcomingOrdersCollapsed
            ? "xl:grid-cols-[3.25rem_minmax(0,1fr)]"
            : "xl:grid-cols-[18rem_minmax(0,1fr)]",
        )}
      >
        <UpcomingOrderPanel
          copy={c}
          locale={locale}
          orderEvents={upcomingOrderEvents}
          staff={activeStaff}
          collapsed={upcomingOrdersCollapsed}
          onToggleCollapsed={() => setUpcomingOrdersCollapsed((collapsed) => !collapsed)}
          onDragStart={(orderEvent) => {
            setDragOrderEvent(orderEvent);
            setDragTaskId(null);
            setDragStaffId(null);
          }}
          onDragEnd={clearDragState}
          onAssign={(orderEvent, staffId) => createTaskFromOrderEvent(orderEvent, staffId)}
        />

        <div className="min-w-0 space-y-2.5">
          {activeStaff.length === 0 ? (
            <section className="card p-10 text-center text-sm text-neutral-500">{c.noStaff}</section>
          ) : (
            <section className="grid gap-2.5 2xl:grid-cols-2">
          {activeStaff.map((member) => (
            <article
              key={member.id}
              onDragOver={(event) => {
                event.preventDefault();
                if (dragStaffId) {
                  setDragOverStaffId(member.id);
                  return;
                }
                setDragOverTarget(member.id);
              }}
              onDragLeave={() => {
                setDragOverTarget((current) => (current === member.id ? null : current));
                setDragOverStaffId((current) => (current === member.id ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragOrderEvent) {
                  handleOrderEventDrop(member.id);
                  return;
                }
                if (dragStaffId) {
                  void reorderStaff(dragStaffId, member.id);
                  clearDragState();
                  return;
                }
                handleTaskDrop(member.id);
              }}
              className={cn(
                "card overflow-hidden transition",
                dragOverTarget === member.id || dragOverStaffId === member.id
                  ? "border-neutral-900"
                  : "",
              )}
              style={{ backgroundColor: colorWithAlpha(member.color, 0.5) }}
            >
              <div className="flex flex-col gap-2 border-b border-neutral-200 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", `staff:${member.id}`);
                        setDragStaffId(member.id);
                        setDragTaskId(null);
                      }}
                      onDragEnd={clearDragState}
                      className="cursor-grab text-neutral-300 active:cursor-grabbing"
                      aria-label={c.staff}
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: member.color }} />
                    <h2 className="truncate text-base font-semibold">{member.name}</h2>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {[member.role, member.phone, member.email].filter(Boolean).join(" · ") || c.staff}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
                  <button className="btn-secondary min-h-7 px-2 py-1 text-[11px]" onClick={() => setTaskModal({ kind: "new", staffId: member.id })}>
                    <Plus className="h-3 w-3" />
                    {c.addTask}
                  </button>
                  {member.shareToken ? (
                    <>
                      <button className="btn-secondary min-h-7 px-2 py-1 text-[11px]" onClick={() => copyStaffShareLink(member)}>
                        {c.copyShareLink}
                      </button>
                    </>
                  ) : null}
                  <button className="btn-secondary min-h-7 border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100" onClick={() => setStaffModal(member)}>
                    <Pencil className="h-3 w-3" />
                    {c.edit}
                  </button>
                </div>
              </div>
              <div className="border-b border-neutral-200 bg-white/35 px-3 py-1.5 text-xs text-neutral-700">
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
                  clearDragState();
                }}
                dragOverTaskId={dragOverTaskId}
                onDragOverTask={setDragOverTaskId}
                onDropOnTask={(targetTaskId) => {
                  if (!dragTaskId) return;
                  void moveTaskToPosition(dragTaskId, member.id, targetTaskId);
                  clearDragState();
                }}
                onEdit={setTaskModal}
                onComplete={(task) => quickStatus(task, task.status === "done" ? "todo" : "done")}
                onCancel={(task) => deleteTask(task)}
              />
            </article>
          ))}
            </section>
          )}

          {showArchivedStaff ? (
            <ArchivedStaffPanel
              copy={c}
              locale={locale}
              members={archivedStaff}
              tasksByStaff={tasksByArchivedStaff}
            />
          ) : null}

          <section className="grid gap-2.5 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <article
          onDragOver={(event) => {
            if (dragStaffId) return;
            event.preventDefault();
            setDragOverTarget("unassigned");
          }}
          onDragLeave={() => setDragOverTarget((current) => (current === "unassigned" ? null : current))}
          onDrop={(event) => {
            if (dragStaffId) return;
            event.preventDefault();
            if (dragOrderEvent) {
              handleOrderEventDrop(null);
              return;
            }
            handleTaskDrop(null);
          }}
          className={cn(
            "card overflow-hidden transition",
            dragOverTarget === "unassigned" ? "border-neutral-900 bg-neutral-50" : "",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-3 py-2.5">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{c.unassigned}</h2>
              <p className="text-xs text-neutral-500">{c.unassignedHint}</p>
            </div>
            <button className="btn-primary min-h-7 shrink-0 px-2 py-1 text-[11px]" onClick={() => setTaskModal({ kind: "new" })}>
              <Plus className="h-3 w-3" />
              {c.addTask}
            </button>
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
              clearDragState();
            }}
            dragOverTaskId={dragOverTaskId}
            onDragOverTask={setDragOverTaskId}
            onDropOnTask={(targetTaskId) => {
              if (!dragTaskId) return;
              void moveTaskToPosition(dragTaskId, null, targetTaskId);
              clearDragState();
            }}
            onEdit={setTaskModal}
            onComplete={(task) => quickStatus(task, "done")}
            onCancel={(task) => deleteTask(task)}
          />
        </article>
        <article className="card overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2.5 text-left"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <h2 className="text-base font-semibold">{c.history}</h2>
            <span className="text-xs font-medium text-neutral-500">
              {historyOpen ? c.hideHistory : c.showHistory} · {c.historyCount(completedTasks.length)}
            </span>
          </button>
          {historyOpen ? (
            <>
              <div className="border-b border-neutral-200 px-3 py-2">
                <label className="block">
                  <span className="sr-only">{c.historySearch}</span>
                  <input
                    className="input h-8 px-2 py-1 text-xs"
                    type="search"
                    value={historySearch}
                    placeholder={c.historySearchPlaceholder}
                    onChange={(event) => {
                      setHistorySearch(event.target.value);
                      setHistoryPage(1);
                    }}
                  />
                </label>
              </div>
              <TaskList
                tasks={pagedCompletedTasks}
                locale={locale}
                copy={c}
                dragTaskId={dragTaskId}
                onDragStart={setDragTaskId}
                onDragEnd={clearDragState}
                onEdit={setTaskModal}
                onComplete={(task) => quickStatus(task, "todo")}
                onCancel={(task) => deleteTask(task, true)}
                showCompleteAction={false}
                deleteLabel={c.permanentDelete}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 px-3 py-2">
                <button
                  type="button"
                  className="btn-secondary min-h-8 px-2 py-1 text-[11px]"
                  disabled={normalizedHistoryPage <= 1}
                  onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                >
                  {c.previousPage}
                </button>
                <span className="text-xs font-medium text-neutral-500">
                  {c.pageStatus(normalizedHistoryPage, historyPageCount)}
                </span>
                <button
                  type="button"
                  className="btn-secondary min-h-8 px-2 py-1 text-[11px]"
                  disabled={normalizedHistoryPage >= historyPageCount}
                  onClick={() => setHistoryPage((page) => Math.min(historyPageCount, page + 1))}
                >
                  {c.nextPage}
                </button>
              </div>
            </>
          ) : (
            <div className="px-3 py-4 text-sm text-neutral-500">{c.historyCount(completedTasks.length)}</div>
          )}
        </article>
          </section>
        </div>
      </div>

      {staffModal ? (
        <StaffModal
          locale={locale}
          copy={c}
          staff={staffModal === "new" ? null : staffModal}
          onClose={() => setStaffModal(null)}
          onSaved={(member) => {
            upsertStaff(normalizeStaff(member));
            setNotice(c.created);
            setStaffModal(null);
          }}
          onArchived={(member) => {
            upsertStaff(normalizeStaff(member));
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

function UpcomingOrderPanel({
  copy,
  locale,
  orderEvents,
  staff,
  collapsed,
  onToggleCollapsed,
  onDragStart,
  onDragEnd,
  onAssign,
}: {
  copy: ReturnType<typeof getStaffScheduleCopy>;
  locale: Locale;
  orderEvents: OrderEvent[];
  staff: StaffMember[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDragStart: (orderEvent: OrderEvent) => void;
  onDragEnd: () => void;
  onAssign: (orderEvent: OrderEvent, staffId: string) => void;
}) {
  const groups = groupOrderEventsByDay(orderEvents, locale, copy);

  if (collapsed) {
    return (
      <section className="card overflow-hidden xl:sticky xl:top-4">
        <div className="flex items-center justify-between gap-2 px-3 py-2 xl:hidden">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{copy.upcomingOrders}</h2>
            <p className="text-xs text-neutral-500">{orderEvents.length}</p>
          </div>
          <button className="btn-secondary min-h-7 min-w-7 px-1 py-1 text-[11px]" onClick={onToggleCollapsed}>
            <ChevronRight className="h-3.5 w-3.5" />
            {copy.showHistory}
          </button>
        </div>
        <button
          type="button"
          className="hidden min-h-[14rem] w-full flex-col items-center gap-3 px-2 py-3 text-center text-neutral-700 transition hover:bg-neutral-50 xl:flex"
          onClick={onToggleCollapsed}
          aria-label={copy.showHistory}
        >
          <ChevronRight className="h-4 w-4" />
          <span className="text-xs font-semibold [writing-mode:vertical-rl]">{copy.upcomingOrders}</span>
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold">{orderEvents.length}</span>
        </button>
      </section>
    );
  }

  return (
    <section className="card overflow-hidden xl:sticky xl:top-4">
      <div className="flex items-start justify-between gap-2 border-b border-neutral-200 px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{copy.upcomingOrders}</h2>
          <p className="line-clamp-2 text-[11px] leading-4 text-neutral-500">{copy.upcomingOrdersHint}</p>
        </div>
        <button className="btn-secondary min-h-7 min-w-7 shrink-0 px-1 py-1 text-[11px]" onClick={onToggleCollapsed}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>
      {orderEvents.length === 0 ? (
        <div className="px-3 py-3 text-xs text-neutral-500">{copy.noUpcomingOrders}</div>
      ) : (
        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto">
          {groups.map((group) => (
            <div key={group.key} className="min-w-0 border-b border-neutral-100 last:border-b-0">
              <div className="bg-neutral-50 px-2.5 py-1.5 text-[11px] font-semibold text-neutral-600">
                {group.label}
              </div>
              <div className="space-y-1.5 p-1.5">
                {group.events.length > 0 ? (
                  group.events.map((orderEvent) => (
                    <OrderEventCard
                      key={orderEvent.id}
                      copy={copy}
                      locale={locale}
                      orderEvent={orderEvent}
                      staff={staff}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onAssign={onAssign}
                    />
                  ))
                ) : (
                  <div className="px-2 py-4 text-xs text-neutral-400">{copy.noTasks}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OrderEventCard({
  copy,
  locale,
  orderEvent,
  staff,
  onDragStart,
  onDragEnd,
  onAssign,
}: {
  copy: ReturnType<typeof getStaffScheduleCopy>;
  locale: Locale;
  orderEvent: OrderEvent;
  staff: StaffMember[];
  onDragStart: (orderEvent: OrderEvent) => void;
  onDragEnd: () => void;
  onAssign: (orderEvent: OrderEvent, staffId: string) => void;
}) {
  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", `order:${orderEvent.id}`);
        onDragStart(orderEvent);
      }}
      onDragEnd={onDragEnd}
      className="cursor-grab border border-neutral-200 bg-neutral-50 p-1.5 active:cursor-grabbing"
    >
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold leading-3",
                orderEvent.kind === "pickup"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-emerald-100 text-emerald-800",
              )}
            >
              {orderEvent.kind === "pickup" ? copy.pickup : copy.returnCar}
            </span>
            <span className="shrink-0 text-[10px] font-semibold text-neutral-600">
              {formatOrderEventTime(orderEvent.datetime, locale)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] font-semibold leading-4 text-neutral-950">
            {orderEvent.vehicleLabel} · {orderEvent.renterName}
          </p>
          {orderEvent.location ? (
            <p className="mt-0.5 truncate text-[10px] leading-3 text-neutral-500">
              {getOrderEventAddressLabel(orderEvent, copy)}: {orderEvent.location}
            </p>
          ) : null}
        </div>
        <OrderAssignInput
          copy={copy}
          staff={staff}
          onAssign={(staffId) => onAssign(orderEvent, staffId)}
        />
      </div>
    </article>
  );
}

function OrderAssignInput({
  copy,
  staff,
  onAssign,
}: {
  copy: ReturnType<typeof getStaffScheduleCopy>;
  staff: StaffMember[];
  onAssign: (staffId: string) => void;
}) {
  const [value, setValue] = useState("");
  const [listId] = useState(() => `order-assign-${Math.random().toString(36).slice(2)}`);
  const options = useMemo(() => staff.map((member) => ({ id: member.id, label: member.name })), [staff]);

  return (
    <div className="w-[7.25rem] shrink-0">
      <input
        className="input h-7 px-1.5 py-1 text-[11px]"
        list={listId}
        value={value}
        placeholder={copy.assignStaff}
        onChange={(event) => {
          const nextValue = event.target.value;
          setValue(nextValue);
          const match = findComboMatch(options, nextValue);
          if (!match) return;
          onAssign(match.id);
          setValue("");
        }}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.id} value={option.label} />
        ))}
      </datalist>
    </div>
  );
}

function TaskList({
  tasks,
  locale,
  copy,
  dragTaskId,
  dragOverTaskId,
  onDragStart,
  onDragEnd,
  onDragOverTask,
  onDropOnTask,
  onEdit,
  onComplete,
  onCancel,
  showCompleteAction = true,
  deleteLabel,
}: {
  tasks: StaffTask[];
  locale: Locale;
  copy: ReturnType<typeof getStaffScheduleCopy>;
  dragTaskId: string | null;
  dragOverTaskId?: string | null;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onDragOverTask?: (taskId: string | null) => void;
  onDropOnTask?: (targetTaskId: string) => void;
  onEdit: (task: StaffTask) => void;
  onComplete: (task: StaffTask) => void;
  onCancel: (task: StaffTask) => void;
  showCompleteAction?: boolean;
  deleteLabel?: string;
}) {
  if (tasks.length === 0) {
    return <div className="px-3 py-4 text-sm text-neutral-500">{copy.noTasks}</div>;
  }

  return (
    <div className="divide-y divide-neutral-200">
      {tasks.map((task) => (
        <TaskListItem
          key={task.id}
          task={task}
          locale={locale}
          copy={copy}
          dragTaskId={dragTaskId}
          dragOverTaskId={dragOverTaskId}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOverTask={onDragOverTask}
          onDropOnTask={onDropOnTask}
          onEdit={onEdit}
          onComplete={onComplete}
          onCancel={onCancel}
          showCompleteAction={showCompleteAction}
          deleteLabel={deleteLabel}
        />
      ))}
    </div>
  );
}

function TaskListItem({
  task,
  locale,
  copy,
  dragTaskId,
  dragOverTaskId,
  onDragStart,
  onDragEnd,
  onDragOverTask,
  onDropOnTask,
  onEdit,
  onComplete,
  onCancel,
  showCompleteAction,
  deleteLabel,
}: {
  task: StaffTask;
  locale: Locale;
  copy: ReturnType<typeof getStaffScheduleCopy>;
  dragTaskId: string | null;
  dragOverTaskId?: string | null;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onDragOverTask?: (taskId: string | null) => void;
  onDropOnTask?: (targetTaskId: string) => void;
  onEdit: (task: StaffTask) => void;
  onComplete: (task: StaffTask) => void;
  onCancel: (task: StaffTask) => void;
  showCompleteAction: boolean;
  deleteLabel?: string;
}) {
  const contextText = getTaskContextText(task, copy);
  const detailsText = getTaskDetailsText(task);

  return (
    <div
      draggable={task.status !== "done" && task.status !== "cancelled"}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!dragTaskId || dragTaskId === task.id || !onDropOnTask) return;
        event.preventDefault();
        event.stopPropagation();
        onDragOverTask?.(task.id);
      }}
      onDragLeave={() => {
        onDragOverTask?.(null);
      }}
      onDrop={(event) => {
        if (!dragTaskId || dragTaskId === task.id || !onDropOnTask) return;
        event.preventDefault();
        event.stopPropagation();
        onDropOnTask(task.id);
      }}
      className={cn(
        "px-3 py-2 transition",
        task.status !== "done" && task.status !== "cancelled" ? "cursor-grab active:cursor-grabbing" : "",
        dragTaskId === task.id ? "bg-neutral-50 opacity-60" : "",
        dragOverTaskId === task.id ? "bg-amber-50" : "",
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
              ) : task.status !== "done" && task.status !== "cancelled" && isTaskDueTomorrow(task.dueDatetime) ? (
                <span className="shrink-0 rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-amber-950">
                  {copy.tomorrowBadge}
                </span>
              ) : null}
              <GripVertical className="h-4 w-4 shrink-0 text-neutral-300" />
              {task.attachments.length > 0 ? (
                <span className="badge bg-neutral-100 text-neutral-600">
                  <ImagePlus className="h-3 w-3" />
                  {task.attachments.length}
                </span>
              ) : null}
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-950">
                {getDisplayTaskTitle(task, copy)}
              </h3>
            </div>
            <p className="mt-0.5 text-xs leading-4 text-neutral-500">
              {formatTaskDue(task.dueDatetime, locale, copy.noDue)}
              {task.timeWindow ? ` · ${task.timeWindow}` : ""}
            </p>
            {contextText ? (
              <p className="mt-0.5 truncate text-xs leading-4 text-neutral-500">{contextText}</p>
            ) : null}
            {detailsText ? (
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-neutral-600">{detailsText}</p>
            ) : null}
          </div>
          <TaskAttachmentStrip attachments={task.attachments} copy={copy} />
        </div>
        <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
          <button className="btn-secondary min-h-7 min-w-7 border-amber-300 bg-amber-50 px-1 py-1 text-[11px] text-amber-800 hover:bg-amber-100" onClick={() => onEdit(task)}>
            <Pencil className="h-3 w-3" />
          </button>
          {showCompleteAction ? (
            <button className="btn-secondary min-h-7 border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800 hover:bg-emerald-100" onClick={() => onComplete(task)}>
              {task.status === "done" ? <Circle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
              {task.status === "done" ? copy.reopen : copy.complete}
            </button>
          ) : null}
          <button className="btn-danger min-h-7 min-w-7 px-1 py-1 text-[11px]" onClick={() => onCancel(task)}>
            <Trash2 className="h-3 w-3" />
            {deleteLabel ? <span>{deleteLabel}</span> : null}
          </button>
        </div>
      </div>
    </div>
  );
}

function ArchivedStaffPanel({
  copy,
  locale,
  members,
  tasksByStaff,
}: {
  copy: ReturnType<typeof getStaffScheduleCopy>;
  locale: Locale;
  members: StaffMember[];
  tasksByStaff: Map<string, StaffTask[]>;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-neutral-200 px-3 py-2.5">
        <h2 className="text-base font-semibold">{copy.archivedStaffTitle}</h2>
        <p className="text-xs text-neutral-500">{copy.archivedStaffHint}</p>
      </div>
      {members.length === 0 ? (
        <div className="px-3 py-4 text-sm text-neutral-500">{copy.noArchivedStaff}</div>
      ) : (
        <div className="divide-y divide-neutral-200">
          {members.map((member) => (
            <article key={member.id} className="px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: member.color }} />
                    <h3 className="truncate text-sm font-semibold text-neutral-950">{member.name}</h3>
                    <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600">
                      {copy.archived}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {[member.role, member.phone, member.email].filter(Boolean).join(" · ") || copy.staff}
                  </p>
                </div>
                <span className="text-xs text-neutral-500">
                  {copy.historyCount(tasksByStaff.get(member.id)?.length ?? 0)}
                </span>
              </div>
              <ArchivedTaskList
                copy={copy}
                locale={locale}
                tasks={tasksByStaff.get(member.id) ?? []}
              />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ArchivedTaskList({
  copy,
  locale,
  tasks,
}: {
  copy: ReturnType<typeof getStaffScheduleCopy>;
  locale: Locale;
  tasks: StaffTask[];
}) {
  if (tasks.length === 0) {
    return <div className="mt-2 text-sm text-neutral-500">{copy.noTasks}</div>;
  }

  return (
    <div className="mt-2 divide-y divide-neutral-100 border-t border-neutral-100">
      {tasks.map((task) => (
        <ArchivedTaskRow key={task.id} copy={copy} locale={locale} task={task} />
      ))}
    </div>
  );
}

function ArchivedTaskRow({
  copy,
  locale,
  task,
}: {
  copy: ReturnType<typeof getStaffScheduleCopy>;
  locale: Locale;
  task: StaffTask;
}) {
  const contextText = getTaskContextText(task, copy);
  const detailsText = getTaskDetailsText(task);

  return (
    <div className="py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600">
              {copy.statusLabels[task.status]}
            </span>
            <p className="truncate text-sm font-semibold text-neutral-900">{getDisplayTaskTitle(task, copy)}</p>
          </div>
          <p className="mt-0.5 text-xs leading-4 text-neutral-500">
            {formatTaskDue(task.dueDatetime, locale, copy.noDue)}
            {task.timeWindow ? ` · ${task.timeWindow}` : ""}
          </p>
          {contextText ? <p className="mt-0.5 truncate text-xs leading-4 text-neutral-500">{contextText}</p> : null}
          {detailsText ? <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-neutral-600">{detailsText}</p> : null}
        </div>
        <TaskAttachmentStrip attachments={task.attachments} copy={copy} />
      </div>
    </div>
  );
}

function StaffModal({
  copy,
  staff,
  onClose,
  onSaved,
  onArchived,
}: {
  locale: Locale;
  copy: ReturnType<typeof getStaffScheduleCopy>;
  staff: StaffMember | null;
  onClose: () => void;
  onSaved: (staff: StaffMember) => void;
  onArchived: (staff: StaffMember) => void;
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

  async function archiveStaff() {
    if (!staff || !window.confirm(copy.deleteStaff)) return;
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/staff-schedule/staff/${staff.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok || !payload.staff) {
      setError(copy.failed);
      return;
    }
    onArchived(payload.staff);
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
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {staff ? (
            <button type="button" className="btn-danger min-h-10 px-3 py-2 text-sm" disabled={saving} onClick={archiveStaff}>
              {copy.archiveStaff}
            </button>
          ) : (
            <span />
          )}
          <button className="btn-primary min-h-10 px-4 py-2 text-sm" disabled={saving}>{copy.save}</button>
        </div>
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

function buildUpcomingOrderEvents(orders: OrderOption[]) {
  return orders
    .flatMap<OrderEvent>((order) => [
      {
        id: `${order.id}-pickup`,
        orderId: order.id,
        vehicleId: order.vehicleId,
        kind: "pickup",
        category: "order_pickup",
        renterName: order.renterName,
        vehicleLabel: order.vehicleLabel,
        datetime: order.pickupDatetime,
        location: order.pickupLocation,
      },
      {
        id: `${order.id}-return`,
        orderId: order.id,
        vehicleId: order.vehicleId,
        kind: "return",
        category: "order_return",
        renterName: order.renterName,
        vehicleLabel: order.vehicleLabel,
        datetime: order.returnDatetime,
        location: order.returnLocation,
      },
    ])
    .filter((orderEvent) => {
      const offset = getLocalDayOffset(orderEvent.datetime);
      return offset >= 0 && offset <= 3;
    })
    .sort((left, right) => new Date(left.datetime).getTime() - new Date(right.datetime).getTime());
}

function groupOrderEventsByDay(
  orderEvents: OrderEvent[],
  locale: Locale,
  copy: ReturnType<typeof getStaffScheduleCopy>,
) {
  const groups = Array.from({ length: 4 }, (_, offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
    return {
      key: localDayKey(date),
      label: formatRelativeDayLabel(offset, date.toISOString(), locale, copy),
      events: [] as OrderEvent[],
    };
  });
  const groupMap = new Map(groups.map((group) => [group.key, group]));

  for (const orderEvent of orderEvents) {
    const group = groupMap.get(localDayKey(new Date(orderEvent.datetime)));
    if (group) group.events.push(orderEvent);
  }

  return groups;
}

function localDayKey(date: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getLocalDayOffset(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function formatRelativeDayLabel(
  offset: number,
  value: string,
  locale: Locale,
  copy: ReturnType<typeof getStaffScheduleCopy>,
) {
  const date = new Date(value);
  const dateLabel = locale === "zh"
    ? `${date.getMonth() + 1}/${date.getDate()}`
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);

  if (offset === 0) return `${copy.todayBadge} ${dateLabel}`;
  if (offset === 1) return `${copy.tomorrowBadge} ${dateLabel}`;
  if (offset === 2) return `${copy.dayAfterTomorrow} ${dateLabel}`;

  return dateLabel;
}

function buildOrderEventKey(orderId: string, category: string) {
  return `${orderId}:${category}`;
}

function getOrderEventAddressLabel(
  orderEvent: Pick<OrderEvent, "kind">,
  copy: ReturnType<typeof getStaffScheduleCopy>,
) {
  return orderEvent.kind === "pickup" ? copy.deliveryAddress : copy.returnAddress;
}

function buildOrderEventTaskDetails(
  orderEvent: OrderEvent,
  copy: ReturnType<typeof getStaffScheduleCopy>,
) {
  const location = orderEvent.location?.trim();
  if (!location) return "";
  return `${getOrderEventAddressLabel(orderEvent, copy)}: ${location}`;
}

function colorWithAlpha(color: string, alpha: number) {
  const fallback = `rgba(255, 255, 255, ${alpha})`;
  const trimmed = color.trim();
  if (!trimmed) return fallback;

  const hex = trimmed.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const expanded =
      hex.length === 3
        ? hex
            .split("")
            .map((part) => part + part)
            .join("")
        : hex;
    const value = Number.parseInt(expanded, 16);
    const red = (value >> 16) & 255;
    const green = (value >> 8) & 255;
    const blue = value & 255;
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  const rgb = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const [red, green, blue] = rgb[1].split(",").map((part) => Number(part.trim()));
    if ([red, green, blue].every((part) => Number.isFinite(part))) {
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }
  }

  return `color-mix(in srgb, ${trimmed} ${Math.round(alpha * 100)}%, transparent)`;
}

function isOrderEventTask(task: StaffTask) {
  return task.category === "order_pickup" || task.category === "order_return";
}

function getTaskContextText(task: StaffTask, copy: ReturnType<typeof getStaffScheduleCopy>) {
  if (isOrderEventTask(task)) return "";

  return (
    [
      task.staffLabel ? `${copy.staff}: ${task.staffLabel}` : null,
      getTaskVehicleLabel(task),
      getTaskOrderLabel(task),
    ]
      .filter(Boolean)
      .join(" · ") || copy.none
  );
}

function getTaskDetailsText(task: StaffTask) {
  const details = task.details?.trim();
  if (!details) return "";

  const duplicateContext = [getTaskVehicleLabel(task), getTaskOrderLabel(task)].filter(Boolean).join(" · ");
  if (duplicateContext && details === duplicateContext) return "";

  return details;
}

function getDisplayTaskTitle(task: StaffTask, copy: ReturnType<typeof getStaffScheduleCopy>) {
  if (task.category !== "order_pickup") return task.title;
  return task.title.replace(/^(取车|Pickup|Delivery)(\s*·\s*)/i, `${copy.pickup}$2`);
}

function formatOrderEventTime(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function buildOrderEventTaskTitle(
  orderEvent: OrderEvent,
  copy: ReturnType<typeof getStaffScheduleCopy>,
) {
  const action = orderEvent.kind === "pickup" ? copy.pickup : copy.returnCar;
  return `${action} · ${orderEvent.vehicleLabel} · ${orderEvent.renterName}`;
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

function taskMatchesSearch(task: StaffTask, search: string) {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) return true;

  return [
    task.title,
    task.details,
    task.staffLabel,
    task.vehicleLabel,
    task.orderLabel,
    task.vehicle?.plateNumber,
    task.vehicle?.nickname,
    task.order?.renterName,
    task.timeWindow,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedSearch));
}

function formatTaskDue(value: string | null, locale: Locale, fallback: string) {
  if (!value) return fallback;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const dayOffset = getTaskDueDayOffset(value);

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

function getTaskDueDayOffset(value: string | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((dueDay.getTime() - today.getTime()) / 86400000);
}

function isTaskDueToday(value: string | null) {
  return getTaskDueDayOffset(value) === 0;
}

function isTaskDueTomorrow(value: string | null) {
  return getTaskDueDayOffset(value) === 1;
}

function formatFileSize(size: number | null) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeTask(raw: StaffTask): StaffTask {
  return {
    ...raw,
    sortOrder: raw.sortOrder ?? 0,
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

function normalizeStaff(raw: StaffMember): StaffMember {
  return {
    ...raw,
    sortOrder: raw.sortOrder ?? 0,
  };
}

function sortTasks(left: StaffTask, right: StaffTask) {
  if (left.sortOrder > 0 && right.sortOrder > 0 && left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  const leftTime = left.dueDatetime ? new Date(left.dueDatetime).getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right.dueDatetime ? new Date(right.dueDatetime).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.title.localeCompare(right.title);
}

function sortStaffMembers(left: StaffMember, right: StaffMember) {
  return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
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
