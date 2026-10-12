"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  GripVertical,
  ImagePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from "lucide-react";

import {
  type MobileAction,
  MobileActionSheet,
  MobileIconButton,
  MobileMoreMenu,
  MobilePageHeader,
  MobileSheet,
} from "@/components/mobile-chrome";
import type { Locale } from "@/lib/i18n";
import { compressImageFiles } from "@/lib/client-image-compression";
import { findSameDayPickups } from "@/lib/staff-same-day";
import {
  STAFF_TASK_TEMPLATE_VARIABLES,
  normalizeStaffTaskNotificationTemplate,
  type StaffTaskNotificationTemplate,
} from "@/lib/staff-task-notification-template";
import { cn, formatDateTime } from "@/lib/utils";
import { SEARCH_FIELD_PROPS } from "@/lib/search-field-props";

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
  miniProgramCode: string | null;
  /** The notification hub's code for this person's channel. What a
   *  staff member types into the mini program to start receiving. */
  bindCode?: string | null;
  channelSubscribers?: number;
  channelRemaining?: number;
  wechatOpenId: string | null;
  wechatNotificationEnabled: boolean;
};

type StaffTask = {
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
  complained: boolean;
};

/**
 * What the task cards need to know beyond the task itself: whether the
 * same car is picked up again later that day (the turnaround is urgent),
 * and how to flip the guest-complaint tag from a row that has no edit
 * button. Context rather than props through three lists.
 */
type TaskFlags = {
  sameDayPickups: Map<string, { time: string; renterName: string }>;
  toggleComplaint: (task: StaffTask) => void;
};

const TaskFlagsContext = createContext<TaskFlags>({
  sameDayPickups: new Map(),
  toggleComplaint: () => {},
});

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
  pickupPassword: string | null;
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
  pickupPassword: string | null;
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
        title: "线下员工排班",
        addStaff: "新增员工",
        notificationTemplates: "通知模板",
        payouts: "员工结算",
        notificationTemplateTitle: "任务通知模板",
        notificationTemplateHint:
          "用于 admin 创建、修改、删除员工任务时发送的 email 和短信。可以使用下方变量。",
        emailSubjectTemplate: "Email 标题",
        emailBodyTemplate: "Email 内容",
        smsBodyTemplate: "短信内容",
        templateVariables: "可用变量",
        templateSaved: "通知模板已保存",
        addTask: "任务",
        activeTasks: "进行中任务",
        overdue: "逾期",
        completed: "已完成",
        unassigned: "未分配",
        unassignedHint: "还没有指定员工的任务会先停在这里。",
        upcomingOrders: "近期送还车订单",
        upcomingOrdersHint: "显示今天和未来 3 天的送车、还车。拖到员工卡片，或下拉选择员工分配。",
        noUpcomingOrders: "未来 3 天没有送车或还车订单。",
        pickup: "送车",
        returnCar: "还车",
        deliveryAddress: "送车地址",
        returnAddress: "还车地址",
        pickupPassword: "取车密码",
        assignStaff: "选择员工",
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
        miniProgramCode: "小程序 Code",
        bindCode: "绑定码",
        channelNobody: "没人绑定",
        channelSubscribers: (count: number) => `${count} 人已绑定`,
        channelRemaining: (count: number) => `还能收 ${count} 条`,
        channelEmpty: "提醒已用完，让员工打开小程序重新授权",
        bindCodeCopied: "绑定码已复制。",
        copyFailed: "复制失败，请手动选中复制。",
        wechatBound: "已绑定微信",
        wechatNotBound: "未绑定微信",
        wechatNotifyOn: "微信提醒已开启",
        wechatNotifyOff: "微信提醒未开启",
        shareUnavailable: "链接还没有生成，请刷新页面后再试。",
        staffInfo: "Code / 员工备注",
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
        compressingPhotos: "正在压缩图片...",
        pendingPhotos: "保存任务后上传",
        removePhoto: "移除照片",
        addSubtask: "+子任务",
        subtaskPlaceholder: "输入子任务...",
        subtaskPromoteHint: "可拖拽到员工卡片变成正常任务",
        customHint: "可搜索，也可直接输入自定义文字。",
        none: "不关联",
        created: "已保存",
        failed: "保存失败，请稍后再试。",
        mobile: {
          more: "更多",
          newTask: "新增任务",
          overdue: "逾期",
          unassigned: "待分配",
          items: (n: number) => `${n} 项`,
          assign: "分配",
          assignTitle: "分配给谁？",
          notifyAfter: "分配后通知员工（短信 / 小程序）",
          confirmAssign: (name: string) => `分配给 ${name}`,
          pickOne: "先选一位员工",
          kindSend: "送",
          kindReturn: "还",
          kindTodo: "事",
          dayCount: (n: number) => (n ? `这天 ${n} 项` : "这天没有任务"),
          free: "前后空闲",
          conflict: (time: string, what: string) => `${time} 在${what}，时间太近`,
          nothing: "这天没有任务。",
          overdueBy: (n: number) => `逾期 ${n} 天`,
          markDone: "标记完成",
          markOpen: "改回未完成",
          taskActions: "子任务、编辑、删除",
          addSubtask: "添加子任务",
          subtaskPrompt: "子任务内容",
          delete: "删除",
        },
        complained: "客人投诉",
        markComplained: "客人投诉了这次工作",
        sameDayPickup: (time: string) => `当天 ${time} 再取车`,
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
        title: "Offline staff schedule",
        addStaff: "Add staff",
        notificationTemplates: "Templates",
        payouts: "Staff pay",
        notificationTemplateTitle: "Task notification templates",
        notificationTemplateHint:
          "Used when admins create, update, remove, or delete staff tasks. You can use the variables below.",
        emailSubjectTemplate: "Email subject",
        emailBodyTemplate: "Email body",
        smsBodyTemplate: "SMS body",
        templateVariables: "Variables",
        templateSaved: "Notification templates saved",
        addTask: "Task",
        activeTasks: "Active tasks",
        overdue: "Overdue",
        completed: "Completed",
        unassigned: "Unassigned",
        unassignedHint: "Tasks without a staff owner wait here.",
        upcomingOrders: "Upcoming deliveries / returns",
        upcomingOrdersHint: "Today and the next 3 days. Drag to a staff card, or choose a staff member to assign.",
        noUpcomingOrders: "No deliveries or returns in the next 3 days.",
        pickup: "Delivery",
        returnCar: "Return",
        deliveryAddress: "Delivery address",
        returnAddress: "Return address",
        pickupPassword: "Pickup password",
        assignStaff: "Choose staff",
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
        miniProgramCode: "Mini Program Code",
        bindCode: "Bind code",
        channelNobody: "Nobody bound",
        channelSubscribers: (count: number) => `${count} bound`,
        channelRemaining: (count: number) => `${count} message${count === 1 ? "" : "s"} left`,
        channelEmpty: "Out of reminders — ask them to reopen the mini program",
        bindCodeCopied: "Bind code copied.",
        copyFailed: "Copy failed — select the text and copy it manually.",
        wechatBound: "WeChat bound",
        wechatNotBound: "WeChat not bound",
        wechatNotifyOn: "WeChat alerts on",
        wechatNotifyOff: "WeChat alerts off",
        shareUnavailable: "The link is not ready yet. Refresh and try again.",
        staffInfo: "Code / staff note",
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
        compressingPhotos: "Compressing photos...",
        pendingPhotos: "Uploads after saving",
        removePhoto: "Remove photo",
        addSubtask: "+ Subtask",
        subtaskPlaceholder: "Type a subtask...",
        subtaskPromoteHint: "Drag to a staff card to make it a normal task",
        customHint: "Search existing records or type custom text.",
        none: "None",
        created: "Saved",
        failed: "Could not save. Please try again.",
        mobile: {
          more: "More",
          newTask: "New task",
          overdue: "Overdue",
          unassigned: "To assign",
          items: (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`,
          assign: "Assign",
          assignTitle: "Who takes it?",
          notifyAfter: "Notify them once assigned (SMS / mini program)",
          confirmAssign: (name: string) => `Assign to ${name}`,
          pickOne: "Pick someone first",
          kindSend: "Out",
          kindReturn: "Back",
          kindTodo: "Job",
          dayCount: (n: number) => (n ? `${n} that day` : "Nothing that day"),
          free: "Free around then",
          conflict: (time: string, what: string) => `At ${what} at ${time}: too close`,
          nothing: "Nothing scheduled this day.",
          overdueBy: (n: number) => `${n} ${n === 1 ? "day" : "days"} overdue`,
          markDone: "Mark done",
          markOpen: "Mark not done",
          taskActions: "Subtask, edit, delete",
          addSubtask: "Add a subtask",
          subtaskPrompt: "Subtask",
          delete: "Delete",
        },
        complained: "Guest complaint",
        markComplained: "A guest complained about this job",
        sameDayPickup: (time: string) => `Out again ${time}`,
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
  initialNotificationTemplate,
}: {
  locale: Locale;
  initialStaff: StaffMember[];
  initialTasks: StaffTask[];
  vehicles: VehicleOption[];
  orders: OrderOption[];
  upcomingOrders: OrderOption[];
  initialNotificationTemplate: StaffTaskNotificationTemplate;
}) {
  const c = getStaffScheduleCopy(locale);
  const searchParams = useSearchParams();
  const [staff, setStaff] = useState(initialStaff);
  const [tasks, setTasks] = useState(initialTasks);
  const [notificationTemplate, setNotificationTemplate] = useState(() =>
    normalizeStaffTaskNotificationTemplate(initialNotificationTemplate),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [staffModal, setStaffModal] = useState<StaffMember | "new" | null>(null);
  const [taskModal, setTaskModal] = useState<TaskModalState>(null);
  const [notificationTemplateOpen, setNotificationTemplateOpen] = useState(false);
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
  const [openStaffInfoIds, setOpenStaffInfoIds] = useState<Set<string>>(() => new Set());

  const activeStaff = useMemo(() => staff.filter((member) => member.isActive).sort(sortStaffMembers), [staff]);
  const archivedStaff = useMemo(() => staff.filter((member) => !member.isActive).sort(sortStaffMembers), [staff]);
  const activeTasks = useMemo(
    () => tasks.filter((task) => task.status !== "done" && task.status !== "cancelled"),
    [tasks],
  );
  const rootActiveTasks = useMemo(
    () => activeTasks.filter((task) => !task.parentTaskId),
    [activeTasks],
  );
  const completedTasks = useMemo(
    () => tasks.filter((task) => task.status === "done" && !task.parentTaskId),
    [tasks],
  );
  const unassignedTasks = rootActiveTasks.filter((task) => !task.staffId);
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, StaffTask[]>();
    for (const task of tasks) {
      if (!task.parentTaskId || task.status === "cancelled") continue;
      const list = map.get(task.parentTaskId) ?? [];
      list.push(task);
      map.set(task.parentTaskId, list);
    }
    for (const list of map.values()) list.sort(sortTasks);
    return map;
  }, [tasks]);
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
    for (const task of rootActiveTasks) {
      if (!task.staffId || !map.has(task.staffId)) continue;
      map.get(task.staffId)!.push(task);
    }
    for (const list of map.values()) list.sort(sortTasks);
    return map;
  }, [activeStaff, rootActiveTasks]);
  const tasksByArchivedStaff = useMemo(() => {
    const map = new Map<string, StaffTask[]>();
    for (const member of archivedStaff) map.set(member.id, []);
    for (const task of tasks) {
      if (task.parentTaskId) continue;
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

  async function toggleComplaint(task: StaffTask) {
    const response = await fetch(`/api/staff-schedule/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ complained: !task.complained }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.task) {
      setNotice(c.failed);
      return;
    }
    upsertTask(normalizeTask(payload.task));
  }

  // A car coming back and going out again the same day: the job between
  // the two cannot slip. Read from the orders the page already has
  // (yesterday to five days out), which covers every task the schedule
  // is about to hand out.
  const sameDayPickups = useMemo(() => {
    const found = findSameDayPickups(tasks, upcomingOrders, toLocalDateInput);
    const map = new Map<string, { time: string; renterName: string }>();
    for (const [taskId, pickup] of found) {
      map.set(taskId, { time: formatOrderEventTime(pickup.pickupDatetime, locale), renterName: pickup.renterName });
    }
    return map;
  }, [locale, tasks, upcomingOrders]);

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

  async function persistTaskOrder(
    updates: Map<string, Partial<StaffTask>>,
    movedTaskId: string,
    staffId: string | null,
    notify = true,
  ) {
    const responses = await Promise.all(
      Array.from(updates.entries()).map(([taskId, update]) => {
        const body: Record<string, string | number | boolean> = { sortOrder: update.sortOrder ?? 0 };
        if (taskId === movedTaskId) {
          body.staffId = staffId ?? "";
          body.staffLabel = "";
          body.parentTaskId = "";
          if (!notify) body.notify = false;
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

  async function moveTaskToPosition(
    taskId: string,
    staffId: string | null,
    targetTaskId: string | null = null,
    notify = true,
  ) {
    const movingTask = tasks.find((task) => task.id === taskId);
    if (!movingTask || movingTask.id === targetTaskId) return;

    const sourceStaffId = movingTask.staffId ?? null;
    const targetStaffId = staffId ?? null;
    const assignedStaff = targetStaffId
      ? activeStaff.find((member) => member.id === targetStaffId) ?? null
      : null;
    const sameGroup = sourceStaffId === targetStaffId;
    const targetGroup = rootActiveTasks
      .filter((task) => task.id !== taskId && (task.staffId ?? null) === targetStaffId)
      .sort(sortTasks);
    const targetIndex = targetTaskId
      ? targetGroup.findIndex((task) => task.id === targetTaskId)
      : -1;
    const nextMovingTask: StaffTask = {
      ...movingTask,
      staffId: targetStaffId,
      parentTaskId: null,
      staffLabel: null,
      staff: assignedStaff,
    };
    const nextTargetGroup = [...targetGroup];
    nextTargetGroup.splice(targetIndex >= 0 ? targetIndex : nextTargetGroup.length, 0, nextMovingTask);

    const updates = new Map<string, Partial<StaffTask>>();
    nextTargetGroup.forEach((task, index) => {
      updates.set(task.id, {
        sortOrder: (index + 1) * 1000,
        ...(task.id === taskId
          ? { staffId: targetStaffId, parentTaskId: null, staffLabel: null, staff: assignedStaff }
          : {}),
      });
    });

    if (!sameGroup) {
      rootActiveTasks
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
    await persistTaskOrder(updates, taskId, targetStaffId, notify);
  }

  function handleTaskDrop(staffId: string | null) {
    if (!dragTaskId) return;
    void moveTaskToPosition(dragTaskId, staffId);
    setDragTaskId(null);
    setDragOverTarget(null);
    setDragOverTaskId(null);
  }

  async function createTaskFromOrderEvent(orderEvent: OrderEvent, staffId: string | null, notify = true) {
    const existingTask = rootActiveTasks.find(
      (task) =>
        task.orderId === orderEvent.orderId &&
        task.category === orderEvent.category &&
        task.status !== "done" &&
        task.status !== "cancelled",
    );

    if (existingTask) {
      await moveTaskToPosition(existingTask.id, staffId, null, notify);
      setNotice(c.orderTaskExists);
      return;
    }

    const staffMember = staffId ? activeStaff.find((member) => member.id === staffId) : null;
    const targetSortOrder =
      (rootActiveTasks.filter((task) => (task.staffId ?? null) === (staffId ?? null)).length + 1) * 1000;
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
        ...(notify ? {} : { notify: false }),
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
    try {
      await navigator.clipboard.writeText(url);
      setNotice(c.shareCopied);
    } catch {
      setNotice(c.copyFailed);
    }
  }

  async function copyBindCode(member: StaffMember) {
    if (!member.bindCode) return;
    try {
      await navigator.clipboard.writeText(member.bindCode);
      setNotice(c.bindCodeCopied);
    } catch {
      // The code is on screen and selectable, so say so rather than
      // failing into the console where nobody is looking.
      setNotice(c.copyFailed);
    }
  }

  function toggleStaffInfo(memberId: string) {
    setOpenStaffInfoIds((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
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

  async function uploadTaskPhotos(task: StaffTask, files: File[]) {
    const photoFiles = files.filter(isPhotoFile);
    if (photoFiles.length === 0) return;

    try {
      const uploaded = await uploadStaffTaskPhotos(task.id, photoFiles);
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? normalizeTask({ ...item, attachments: [...item.attachments, ...uploaded] })
            : item,
        ),
      );
      setNotice(c.created);
    } catch {
      setNotice(c.failed);
    }
  }

  async function createSubtask(parentTask: StaffTask, title: string) {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const siblingCount = subtasksByParent.get(parentTask.id)?.length ?? 0;
    const response = await fetch("/api/staff-schedule/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentTaskId: parentTask.id,
        staffId: parentTask.staffId ?? "",
        staffLabel: "",
        vehicleId: parentTask.vehicleId ?? "",
        vehicleLabel: parentTask.vehicleId ? "" : parentTask.vehicleLabel ?? "",
        orderId: parentTask.orderId ?? "",
        orderLabel: parentTask.orderId ? "" : parentTask.orderLabel ?? "",
        title: trimmedTitle,
        details: "",
        dueDatetime: parentTask.dueDatetime ? toLocalDateInput(parentTask.dueDatetime) : "",
        timeWindow: parentTask.timeWindow ?? "",
        sortOrder: (siblingCount + 1) * 1000,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.task) {
      setNotice(c.failed);
      return;
    }

    upsertTask(normalizeTask(payload.task));
    setNotice(c.created);
  }

  return (
    <TaskFlagsContext.Provider value={{ sameDayPickups, toggleComplaint: (task) => void toggleComplaint(task) }}>
    <div className="staff-schedule-surface mx-auto max-w-7xl space-y-4">
      <h1 className="sr-only">{c.title}</h1>
      <StaffScheduleMobile
        c={c}
        locale={locale}
        staff={activeStaff}
        tasks={tasks}
        orderEvents={upcomingOrderEvents}
        initialAssignTaskId={searchParams.get("assign")}
        moreActions={[
          { label: c.payouts, href: "/staff-schedule/payouts" },
          { label: c.notificationTemplates, onClick: () => setNotificationTemplateOpen(true) },
          { label: showArchivedStaff ? c.hideArchivedStaff : c.viewArchivedStaff, onClick: () => setShowArchivedStaff((open) => !open) },
          { label: c.addStaff, onClick: () => setStaffModal("new") },
        ]}
        archivedPanel={
          showArchivedStaff ? (
            <ArchivedStaffPanel copy={c} locale={locale} members={archivedStaff} tasksByStaff={tasksByArchivedStaff} />
          ) : null
        }
        onNewTask={() => setTaskModal({ kind: "new" })}
        onEdit={setTaskModal}
        onDelete={(task) => void deleteTask(task)}
        onToggleDone={(task) => void quickStatus(task, task.status === "done" ? "todo" : "done")}
        onAddSubtask={(task, title) => void createSubtask(task, title)}
        onAssignTask={(taskId, staffId, notify) => void moveTaskToPosition(taskId, staffId, null, notify)}
        onAssignEvent={(event, staffId, notify) => void createTaskFromOrderEvent(event, staffId, notify)}
      />
      {/* The desktop's board: drag jobs onto people. A phone has its own
          view above; drag-and-drop does not work under a thumb. */}
      <section className="flex flex-col gap-3 max-sm:hidden sm:flex-row sm:items-end sm:justify-end">
        <div className="flex flex-wrap gap-2">
          <Link href="/staff-schedule/payouts" className="btn-secondary min-h-11 px-4 py-2 text-sm">
            <Wallet className="h-4 w-4" />
            {c.payouts}
          </Link>
          <button className="btn-secondary min-h-11 px-4 py-2 text-sm" onClick={() => setNotificationTemplateOpen(true)}>
            <Bell className="h-4 w-4" />
            {c.notificationTemplates}
          </button>
          <button className="btn-secondary min-h-11 px-4 py-2 text-sm" onClick={() => setShowArchivedStaff((open) => !open)}>
            {showArchivedStaff ? c.hideArchivedStaff : c.viewArchivedStaff}
          </button>
          <button className="btn-secondary min-h-11 px-4 py-2 text-sm" onClick={() => setStaffModal("new")}>
            <UserPlus className="h-4 w-4" />
            {c.addStaff}
          </button>
        </div>
      </section>

      <p className="text-xs text-[var(--ink-soft)] max-sm:hidden">{c.dragHint}</p>

      {notice ? (
        <div className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink-mid)]">
          {notice}
        </div>
      ) : null}

      <div
        className={cn(
          "grid gap-3 max-sm:hidden xl:items-start",
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
            <section className="card p-10 text-center text-sm text-[var(--ink-soft)]">{c.noStaff}</section>
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
              <div className="flex flex-col gap-2 border-b border-[var(--line)] px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
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
                    <h2 className="min-w-0 truncate text-base font-semibold">{member.name}</h2>
                    <button
                      type="button"
                      className="btn-secondary h-6 w-6 shrink-0 border-amber-300 bg-amber-50 p-0 text-amber-800 hover:bg-amber-100"
                      onClick={() => setStaffModal(member)}
                      aria-label={c.edit}
                      title={c.edit}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[var(--ink-soft)]">
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
                </div>
              </div>
              <div className="border-b border-[var(--line)] bg-white/35">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs font-semibold text-[var(--ink)]"
                  onClick={() => toggleStaffInfo(member.id)}
                  aria-expanded={openStaffInfoIds.has(member.id)}
                >
                  <span>{c.staffInfo}</span>
                  <span className="text-[11px] font-medium text-[var(--ink-soft)]">
                    {openStaffInfoIds.has(member.id) ? c.hideHistory : c.showHistory}
                  </span>
                </button>
                {openStaffInfoIds.has(member.id) ? (
                  <div className="space-y-1 border-t border-[var(--line)] bg-white/45 px-3 py-2 text-[11px] leading-5 text-[var(--ink-mid)]">
                    {member.bindCode ? (
                      <p>
                        <span className="font-semibold text-[var(--ink)]">{c.bindCode}: </span>
                        <button
                          type="button"
                          onClick={() => copyBindCode(member)}
                          className="font-mono tracking-[0.18em] text-[var(--ink)] underline decoration-dotted underline-offset-2"
                        >
                          {member.bindCode}
                        </button>
                        <span className="mx-1.5 text-neutral-300">·</span>
                        <span>
                          {member.channelSubscribers
                            ? c.channelSubscribers(member.channelSubscribers)
                            : c.channelNobody}
                        </span>
                        {member.channelSubscribers ? (
                          <>
                            <span className="mx-1.5 text-neutral-300">·</span>
                            <span
                              className={
                                member.channelRemaining
                                  ? undefined
                                  : "font-semibold text-[var(--danger,#dc2626)]"
                              }
                            >
                              {member.channelRemaining
                                ? c.channelRemaining(member.channelRemaining)
                                : c.channelEmpty}
                            </span>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    {member.miniProgramCode ? (
                      <p>
                        <span className="font-semibold text-[var(--ink)]">{c.miniProgramCode}: </span>
                        <span className="font-mono tracking-[0.18em] text-[var(--ink)]">{member.miniProgramCode}</span>
                        <span className="mx-1.5 text-neutral-300">·</span>
                        <span>{member.wechatOpenId ? c.wechatBound : c.wechatNotBound}</span>
                        <span className="mx-1.5 text-neutral-300">·</span>
                        <span>{member.wechatNotificationEnabled ? c.wechatNotifyOn : c.wechatNotifyOff}</span>
                      </p>
                    ) : null}
                    <p>
                      <span className="font-semibold text-[var(--ink)]">{c.pinned}: </span>
                      {member.pinnedMessage || c.noPinned}
                    </p>
                  </div>
                ) : null}
              </div>
              {dragOverTarget === member.id ? (
                <div className="border-b border-[var(--line)] bg-[var(--ink)] px-4 py-2 text-xs font-medium text-white">
                  {c.dropToAssign}
                </div>
              ) : null}
              <TaskList
                tasks={tasksByStaff.get(member.id) ?? []}
                subtasksByParent={subtasksByParent}
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
                onAddSubtask={createSubtask}
                onUploadPhotos={uploadTaskPhotos}
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
            dragOverTarget === "unassigned" ? "border-neutral-900 bg-[var(--surface-muted)]" : "",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-3 py-2.5">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{c.unassigned}</h2>
              <p className="text-xs text-[var(--ink-soft)]">{c.unassignedHint}</p>
            </div>
            <button className="btn-primary min-h-7 shrink-0 px-2 py-1 text-[11px]" onClick={() => setTaskModal({ kind: "new" })}>
              <Plus className="h-3 w-3" />
              {c.addTask}
            </button>
          </div>
          {dragOverTarget === "unassigned" ? (
            <div className="border-b border-[var(--line)] bg-[var(--ink)] px-4 py-2 text-xs font-medium text-white">
              {c.dropToAssign}
            </div>
          ) : null}
          <TaskList
            tasks={unassignedTasks.sort(sortTasks)}
            subtasksByParent={subtasksByParent}
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
            onAddSubtask={createSubtask}
            onUploadPhotos={uploadTaskPhotos}
          />
        </article>
        <article className="card overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 border-b border-[var(--line)] px-3 py-2.5 text-left"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <h2 className="text-base font-semibold">{c.history}</h2>
            <span className="text-xs font-medium text-[var(--ink-soft)]">
              {historyOpen ? c.hideHistory : c.showHistory} · {c.historyCount(completedTasks.length)}
            </span>
          </button>
          {historyOpen ? (
            <>
              <div className="border-b border-[var(--line)] px-3 py-2">
                <label className="block">
                  <span className="sr-only">{c.historySearch}</span>
                  <input
                    className="input h-8 px-2 py-1 text-xs"
                    type="search"
                    {...SEARCH_FIELD_PROPS}
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
                subtasksByParent={subtasksByParent}
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
                onAddSubtask={createSubtask}
                onUploadPhotos={uploadTaskPhotos}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-3 py-2">
                <button
                  type="button"
                  className="btn-secondary min-h-8 px-2 py-1 text-[11px]"
                  disabled={normalizedHistoryPage <= 1}
                  onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                >
                  {c.previousPage}
                </button>
                <span className="text-xs font-medium text-[var(--ink-soft)]">
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
            <div className="px-3 py-4 text-sm text-[var(--ink-soft)]">{c.historyCount(completedTasks.length)}</div>
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

      {notificationTemplateOpen ? (
        <NotificationTemplateModal
          copy={c}
          template={notificationTemplate}
          onClose={() => setNotificationTemplateOpen(false)}
          onSaved={(template) => {
            setNotificationTemplate(normalizeStaffTaskNotificationTemplate(template));
            setNotice(c.templateSaved);
            setNotificationTemplateOpen(false);
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
    </TaskFlagsContext.Provider>
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
            <p className="text-xs text-[var(--ink-soft)]">{orderEvents.length}</p>
          </div>
          <button className="btn-secondary min-h-7 min-w-7 px-1 py-1 text-[11px]" onClick={onToggleCollapsed}>
            <ChevronRight className="h-3.5 w-3.5" />
            {copy.showHistory}
          </button>
        </div>
        <button
          type="button"
          className="hidden min-h-[14rem] w-full flex-col items-center gap-3 px-2 py-3 text-center text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)] xl:flex"
          onClick={onToggleCollapsed}
          aria-label={copy.showHistory}
        >
          <ChevronRight className="h-4 w-4" />
          <span className="text-xs font-semibold [writing-mode:vertical-rl]">{copy.upcomingOrders}</span>
          <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[11px] font-semibold">{orderEvents.length}</span>
        </button>
      </section>
    );
  }

  return (
    <section className="card overflow-hidden xl:sticky xl:top-4">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{copy.upcomingOrders}</h2>
          <p className="line-clamp-2 text-[11px] leading-4 text-[var(--ink-soft)]">{copy.upcomingOrdersHint}</p>
        </div>
        <button className="btn-secondary min-h-7 min-w-7 shrink-0 px-1 py-1 text-[11px]" onClick={onToggleCollapsed}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>
      {orderEvents.length === 0 ? (
        <div className="px-3 py-3 text-xs text-[var(--ink-soft)]">{copy.noUpcomingOrders}</div>
      ) : (
        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto">
          {groups.map((group) => (
            <div key={group.key} className="min-w-0 border-b border-[var(--line)] last:border-b-0">
              <div className="bg-[var(--surface-muted)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--ink-mid)]">
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
                  <div className="px-2 py-4 text-xs text-[var(--ink-soft)]">{copy.noTasks}</div>
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
      className="cursor-grab border border-[var(--line)] bg-[var(--surface-muted)] p-1.5 active:cursor-grabbing"
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
            <span className="shrink-0 text-[10px] font-semibold text-[var(--ink-mid)]">
              {formatOrderEventTime(orderEvent.datetime, locale)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] font-semibold leading-4 text-[var(--ink)]">
            {orderEvent.vehicleLabel} · {orderEvent.renterName}
          </p>
          {orderEvent.location ? (
            <p className="mt-0.5 truncate text-[10px] leading-3 text-[var(--ink-soft)]">
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
  return (
    <div className="w-[7.25rem] shrink-0">
      <select
        className="input h-7 px-1.5 py-1 text-[11px]"
        defaultValue=""
        disabled={staff.length === 0}
        aria-label={copy.assignStaff}
        onChange={(event) => {
          const staffId = event.target.value;
          if (!staffId) return;
          onAssign(staffId);
          event.currentTarget.value = "";
        }}
      >
        <option value="">{copy.assignStaff}</option>
        {staff.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function TaskList({
  tasks,
  subtasksByParent,
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
  onAddSubtask,
  onUploadPhotos,
  showCompleteAction = true,
  deleteLabel,
}: {
  tasks: StaffTask[];
  subtasksByParent: Map<string, StaffTask[]>;
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
  onAddSubtask: (parentTask: StaffTask, title: string) => void;
  onUploadPhotos: (task: StaffTask, files: File[]) => void;
  showCompleteAction?: boolean;
  deleteLabel?: string;
}) {
  if (tasks.length === 0) {
    return <div className="px-3 py-4 text-sm text-[var(--ink-soft)]">{copy.noTasks}</div>;
  }

  return (
    <div className="divide-y divide-[var(--line)]">
      {tasks.map((task) => (
        <TaskListItem
          key={task.id}
          task={task}
          subtasks={subtasksByParent.get(task.id) ?? []}
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
          onAddSubtask={onAddSubtask}
          onUploadPhotos={onUploadPhotos}
          showCompleteAction={showCompleteAction}
          deleteLabel={deleteLabel}
        />
      ))}
    </div>
  );
}

function TaskListItem({
  task,
  subtasks,
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
  onAddSubtask,
  onUploadPhotos,
  showCompleteAction,
  deleteLabel,
}: {
  task: StaffTask;
  subtasks: StaffTask[];
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
  onAddSubtask: (parentTask: StaffTask, title: string) => void;
  onUploadPhotos: (task: StaffTask, files: File[]) => void;
  showCompleteAction: boolean;
  deleteLabel?: string;
}) {
  const contextText = getTaskContextText(task, copy);
  const detailsText = getTaskDetailsText(task);
  const sameDayPickup = useContext(TaskFlagsContext).sameDayPickups.get(task.id);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const canAddSubtask = task.status !== "done" && task.status !== "cancelled" && showCompleteAction;

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
        dragTaskId === task.id ? "bg-[var(--surface-muted)] opacity-60" : "",
        dragOverTaskId === task.id ? "bg-amber-50" : "",
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <GripVertical className="h-4 w-4 shrink-0 text-neutral-300" />
              {task.status !== "done" && task.status !== "cancelled" && isTaskOverdue(task.dueDatetime) ? (
                <span className="shrink-0 rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-white">
                  Due
                </span>
              ) : task.status !== "done" && task.status !== "cancelled" && isTaskDueToday(task.dueDatetime) ? (
                <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-white">
                  {copy.todayBadge}
                </span>
              ) : task.status !== "done" && task.status !== "cancelled" && isTaskDueTomorrow(task.dueDatetime) ? (
                <span className="shrink-0 rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-amber-950">
                  {copy.tomorrowBadge}
                </span>
              ) : null}
              {sameDayPickup ? (
                <span
                  className="shrink-0 rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-white"
                  title={sameDayPickup.renterName}
                >
                  {copy.sameDayPickup(sameDayPickup.time)}
                </span>
              ) : null}
              {task.complained ? (
                <span className="shrink-0 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-red-700">
                  {copy.complained}
                </span>
              ) : null}
              {task.attachments.length > 0 ? (
                <span className="badge bg-[var(--surface-muted)] text-[var(--ink-mid)]">
                  <ImagePlus className="h-3 w-3" />
                  {task.attachments.length}
                </span>
              ) : null}
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]">
                {getDisplayTaskTitle(task, copy)}
              </h3>
            </div>
            <p className="mt-0.5 text-xs leading-4 text-[var(--ink-soft)]">
              {formatTaskDue(task.dueDatetime, locale, copy.noDue)}
              {task.timeWindow ? ` · ${task.timeWindow}` : ""}
            </p>
            {contextText ? (
              <p className="mt-0.5 truncate text-xs leading-4 text-[var(--ink-soft)]">{contextText}</p>
            ) : null}
            {detailsText ? (
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-[var(--ink-mid)]">{detailsText}</p>
            ) : null}
          </div>
          <TaskAttachmentStrip attachments={task.attachments} copy={copy} />
        </div>
        <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
          {canAddSubtask && !isAddingSubtask ? (
            <button
              className="btn-secondary min-h-7 px-2 py-1 text-[11px] text-[var(--ink-mid)]"
              type="button"
              onClick={() => setIsAddingSubtask(true)}
            >
              {copy.addSubtask}
            </button>
          ) : null}
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
      <SubtaskList
        parentTask={task}
        subtasks={subtasks}
        locale={locale}
        copy={copy}
        dragTaskId={dragTaskId}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onEdit={onEdit}
        onComplete={onComplete}
        onCancel={onCancel}
        onUploadPhotos={onUploadPhotos}
      />
      {canAddSubtask && isAddingSubtask ? (
        <form
          className="mt-2 flex items-center gap-1.5 pl-7"
          onSubmit={(event) => {
            event.preventDefault();
            const nextTitle = subtaskTitle.trim();
            if (!nextTitle) return;
            onAddSubtask(task, nextTitle);
            setSubtaskTitle("");
            setIsAddingSubtask(false);
          }}
        >
          <input
            className="input h-7 flex-1 px-2 py-1 text-[11px]"
            value={subtaskTitle}
            placeholder={copy.subtaskPlaceholder}
            onChange={(event) => setSubtaskTitle(event.target.value)}
            autoFocus
          />
          <button className="btn-secondary min-h-7 px-2 py-1 text-[11px]" type="submit">
            {copy.save}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function SubtaskList({
  parentTask,
  subtasks,
  locale,
  copy,
  dragTaskId,
  onDragStart,
  onDragEnd,
  onEdit,
  onComplete,
  onCancel,
  onUploadPhotos,
}: {
  parentTask: StaffTask;
  subtasks: StaffTask[];
  locale: Locale;
  copy: ReturnType<typeof getStaffScheduleCopy>;
  dragTaskId: string | null;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onEdit: (task: StaffTask) => void;
  onComplete: (task: StaffTask) => void;
  onCancel: (task: StaffTask) => void;
  onUploadPhotos: (task: StaffTask, files: File[]) => void;
}) {
  if (subtasks.length === 0) return null;

  return (
    <div className="mt-2 space-y-1 pl-7">
      {subtasks.map((subtask) => {
        const closed = subtask.status === "done" || subtask.status === "cancelled";
        return (
          <div
            key={subtask.id}
            draggable={!closed}
            onDragStart={(event) => {
              if (closed) return;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", subtask.id);
              onDragStart(subtask.id);
            }}
            onDragEnd={onDragEnd}
            className={cn(
              "border border-[var(--line)] bg-white/60 px-2 py-1.5 text-[11px] transition",
              !closed ? "cursor-grab active:cursor-grabbing" : "opacity-70",
              dragTaskId === subtask.id ? "bg-[var(--surface-muted)] opacity-60" : "",
            )}
          >
            <div className="flex items-start gap-2">
              <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-300" />
              <div className="min-w-0 flex-1">
                <p className={cn("break-words font-medium leading-4 text-[var(--ink)]", closed ? "line-through" : "")}>
                  {subtask.title}
                </p>
                <p className="mt-0.5 text-[10px] leading-3 text-[var(--ink-soft)]">
                  {formatTaskDue(subtask.dueDatetime ?? parentTask.dueDatetime, locale, copy.noDue)}
                  {subtask.timeWindow ? ` · ${subtask.timeWindow}` : ""}
                </p>
                <p className="mt-0.5 text-[10px] leading-3 text-[var(--ink-soft)]">{copy.subtaskPromoteHint}</p>
                <TaskAttachmentStrip attachments={subtask.attachments} copy={copy} compact />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <label className="btn-secondary flex min-h-6 min-w-6 cursor-pointer items-center justify-center border-sky-300 bg-sky-50 px-1 py-1 text-sky-800 hover:bg-sky-100">
                  <ImagePlus className="h-3 w-3" />
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
                <button
                  className="btn-secondary min-h-6 min-w-6 border-amber-300 bg-amber-50 px-1 py-1 text-amber-800 hover:bg-amber-100"
                  onClick={() => onEdit(subtask)}
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  className="btn-secondary min-h-6 min-w-6 border-emerald-300 bg-emerald-50 px-1 py-1 text-emerald-800 hover:bg-emerald-100"
                  onClick={() => onComplete(subtask)}
                >
                  {subtask.status === "done" ? <Circle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                </button>
                <button className="btn-danger min-h-6 min-w-6 px-1 py-1" onClick={() => onCancel(subtask)}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
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
      <div className="border-b border-[var(--line)] px-3 py-2.5">
        <h2 className="text-base font-semibold">{copy.archivedStaffTitle}</h2>
        <p className="text-xs text-[var(--ink-soft)]">{copy.archivedStaffHint}</p>
      </div>
      {members.length === 0 ? (
        <div className="px-3 py-4 text-sm text-[var(--ink-soft)]">{copy.noArchivedStaff}</div>
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {members.map((member) => (
            <article key={member.id} className="px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: member.color }} />
                    <h3 className="truncate text-sm font-semibold text-[var(--ink)]">{member.name}</h3>
                    <span className="shrink-0 rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ink-mid)]">
                      {copy.archived}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[var(--ink-soft)]">
                    {[member.role, member.phone, member.email].filter(Boolean).join(" · ") || copy.staff}
                  </p>
                </div>
                <span className="text-xs text-[var(--ink-soft)]">
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
    return <div className="mt-2 text-sm text-[var(--ink-soft)]">{copy.noTasks}</div>;
  }

  return (
    <div className="mt-2 divide-y divide-[var(--line)] border-t border-[var(--line)]">
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
  const { toggleComplaint } = useContext(TaskFlagsContext);

  return (
    <div className="py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ink-mid)]">
              {copy.statusLabels[task.status]}
            </span>
            <p className="truncate text-sm font-semibold text-[var(--ink)]">{getDisplayTaskTitle(task, copy)}</p>
            {task.status === "done" ? (
              <button
                type="button"
                onClick={() => toggleComplaint(task)}
                aria-pressed={task.complained}
                title={copy.markComplained}
                className={cn(
                  "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-4",
                  task.complained
                    ? "border-red-300 bg-red-50 text-red-700"
                    : "border-dashed border-[var(--line)] text-[var(--ink-soft)] hover:text-red-700",
                )}
              >
                {copy.complained}
              </button>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs leading-4 text-[var(--ink-soft)]">
            {formatTaskDue(task.dueDatetime, locale, copy.noDue)}
            {task.timeWindow ? ` · ${task.timeWindow}` : ""}
          </p>
          {contextText ? <p className="mt-0.5 truncate text-xs leading-4 text-[var(--ink-soft)]">{contextText}</p> : null}
          {detailsText ? <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-[var(--ink-mid)]">{detailsText}</p> : null}
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
        {staff?.bindCode ? (
          <div className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--ink-mid)]">
            <div>
              <p className="text-xs font-semibold text-[var(--ink-soft)]">{copy.bindCode}</p>
              <p className="font-mono text-base font-semibold tracking-[0.22em] text-[var(--ink)]">{staff.bindCode}</p>
            </div>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              {staff.channelSubscribers
                ? copy.channelSubscribers(staff.channelSubscribers)
                : copy.channelNobody}
              {staff.channelSubscribers ? (
                <>
                  {" · "}
                  <span className={staff.channelRemaining ? undefined : "font-semibold text-[#dc2626]"}>
                    {staff.channelRemaining
                      ? copy.channelRemaining(staff.channelRemaining)
                      : copy.channelEmpty}
                  </span>
                </>
              ) : null}
            </p>
          </div>
        ) : null}
        {staff?.miniProgramCode ? (
          <div className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--ink-mid)]">
            <div>
              <p className="text-xs font-semibold text-[var(--ink-soft)]">{copy.miniProgramCode}</p>
              <p className="font-mono text-base font-semibold tracking-[0.22em] text-[var(--ink)]">{staff.miniProgramCode}</p>
            </div>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              {staff.wechatOpenId ? copy.wechatBound : copy.wechatNotBound} ·{" "}
              {staff.wechatNotificationEnabled ? copy.wechatNotifyOn : copy.wechatNotifyOff}
            </p>
          </div>
        ) : null}
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

function NotificationTemplateModal({
  copy,
  template,
  onClose,
  onSaved,
}: {
  copy: ReturnType<typeof getStaffScheduleCopy>;
  template: StaffTaskNotificationTemplate;
  onClose: () => void;
  onSaved: (template: StaffTaskNotificationTemplate) => void;
}) {
  const [form, setForm] = useState(() => normalizeStaffTaskNotificationTemplate(template));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/staff-schedule/notification-template", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.template) {
        setError(copy.failed);
        return;
      }
      onSaved(normalizeStaffTaskNotificationTemplate(payload.template));
    } catch {
      setError(copy.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={copy.notificationTemplateTitle} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm leading-5 text-[var(--ink-soft)]">{copy.notificationTemplateHint}</p>
        <Field label={copy.emailSubjectTemplate}>
          <input
            className="input"
            value={form.emailSubjectTemplate}
            onChange={(event) => setForm({ ...form, emailSubjectTemplate: event.target.value })}
          />
        </Field>
        <Field label={copy.emailBodyTemplate}>
          <textarea
            className="input min-h-52 resize-y font-mono text-sm leading-5"
            value={form.emailBodyTemplate}
            onChange={(event) => setForm({ ...form, emailBodyTemplate: event.target.value })}
          />
        </Field>
        <Field label={copy.smsBodyTemplate}>
          <textarea
            className="input min-h-36 resize-y font-mono text-sm leading-5"
            value={form.smsBodyTemplate}
            onChange={(event) => setForm({ ...form, smsBodyTemplate: event.target.value })}
          />
        </Field>
        <div className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
          <p className="text-xs font-semibold text-[var(--ink-soft)]">{copy.templateVariables}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {STAFF_TASK_TEMPLATE_VARIABLES.map((variable) => (
              <span
                key={variable}
                className="border border-[var(--line)] bg-white px-2 py-1 font-mono text-[11px] text-[var(--ink-mid)]"
              >
                {`{${variable}}`}
              </span>
            ))}
          </div>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary min-h-10 px-4 py-2 text-sm" onClick={onClose}>
            {copy.cancel}
          </button>
          <button className="btn-primary min-h-10 px-4 py-2 text-sm" disabled={saving}>
            {copy.save}
          </button>
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
  const [complained, setComplained] = useState(task?.complained ?? false);
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
    return uploadStaffTaskPhotos(taskId, files);
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
      ...(task?.parentTaskId && form.staffId !== (task.staffId ?? "") ? { parentTaskId: "" } : {}),
      ...(task ? { complained } : {}),
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

        {task ? (
          <label className="flex items-center gap-2 text-sm text-[var(--ink-mid)]">
            <input
              type="checkbox"
              checked={complained}
              onChange={(event) => setComplained(event.target.checked)}
              className="h-4 w-4"
            />
            {copy.markComplained}
          </label>
        ) : null}

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
              isDraggingPhotos ? "border-neutral-900 bg-[var(--surface-muted)]" : "border-[var(--line-strong)] bg-white",
            )}
          >
            <ImagePlus className="h-5 w-5 text-[var(--ink-soft)]" />
            <span className="font-medium text-[var(--ink)]">
              {uploading ? copy.compressingPhotos : copy.uploadPhotos}
            </span>
            {!task && pendingFiles.length > 0 ? (
              <span className="text-xs text-[var(--ink-soft)]">
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
      <button className="staff-modal-backdrop absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[88vh] w-[min(42rem,calc(100vw-2rem))] overflow-y-auto rounded-lg bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
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
        {...SEARCH_FIELD_PROPS}
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
      <p className="mt-1 text-[11px] leading-4 text-[var(--ink-soft)]">{hint}</p>
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
        <div key={attachment.id} className="group relative overflow-hidden border border-[var(--line)] bg-[var(--surface-muted)]">
          <div className="aspect-[4/3] bg-[var(--surface-muted)]">
            <img
              src={attachment.url}
              alt={attachment.filename || copy.photos}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 px-2 py-1.5">
            <p className="truncate text-[11px] font-medium text-[var(--ink-mid)]">
              {attachment.filename || copy.photos}
            </p>
            <p className="text-[10px] text-[var(--ink-soft)]">{formatFileSize(attachment.size)}</p>
          </div>
          {taskId ? (
            <button
              type="button"
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center border border-[var(--line)] bg-white text-[var(--ink-mid)]"
              aria-label={copy.removePhoto}
              onClick={() => onDeleteUploaded(attachment)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ))}
      {pendingFiles.map((file, index) => (
        <div key={`${file.name}-${index}`} className="relative border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] p-3">
          <div className="flex min-h-20 flex-col items-center justify-center gap-2 text-center text-xs text-[var(--ink-mid)]">
            <ImagePlus className="h-5 w-5 text-[var(--ink-soft)]" />
            <span className="line-clamp-2 break-all font-medium text-[var(--ink)]">{file.name}</span>
            <span>{copy.pendingPhotos}</span>
          </div>
          <button
            type="button"
            className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center border border-[var(--line)] bg-white text-[var(--ink-mid)]"
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
  compact = false,
}: {
  attachments: TaskAttachment[];
  copy: ReturnType<typeof getStaffScheduleCopy>;
  compact?: boolean;
}) {
  if (attachments.length === 0) return null;

  const visibleAttachments = attachments.length > 3 ? attachments.slice(0, 2) : attachments.slice(0, 3);
  const hiddenCount = attachments.length - visibleAttachments.length;

  return (
    <div className={cn("flex w-full shrink-0 flex-wrap gap-1.5", compact ? "mt-1" : "sm:w-[10.125rem] sm:justify-end")}>
      {visibleAttachments.map((attachment) => (
        <div
          key={attachment.id}
          className={cn("overflow-hidden border border-[var(--line)] bg-[var(--surface-muted)]", compact ? "h-8 w-8" : "h-12 w-12")}
        >
          <img
            src={attachment.url}
            alt={attachment.filename || copy.photos}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ))}
      {hiddenCount > 0 ? (
        <div
          className={cn(
            "flex items-center justify-center border border-[var(--line)] bg-[var(--surface-muted)] text-xs font-semibold text-[var(--ink-mid)]",
            compact ? "h-8 w-8" : "h-12 w-12",
          )}
        >
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
        pickupPassword: order.pickupPassword,
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
        pickupPassword: order.pickupPassword,
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
  const lines: string[] = [];
  const location = orderEvent.location?.trim();
  if (location) lines.push(`${getOrderEventAddressLabel(orderEvent, copy)}: ${location}`);

  const pickupPassword = orderEvent.pickupPassword?.trim();
  if (pickupPassword) lines.push(`${copy.pickupPassword}: ${pickupPassword}`);

  return lines.join("\n");
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
  if (task.category === "order_pickup") {
    return task.title.replace(/^(取车|Pickup|Delivery)(\s*·\s*)/i, `${copy.pickup}$2`);
  }
  // Return tasks the order sync creates are titled in Chinese on the
  // server, which has no reader's language to go by.
  if (task.category === "order_return") {
    return task.title.replace(/^(还车|Return)(\s*·\s*)/i, `${copy.returnCar}$2`);
  }
  return task.title;
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

async function uploadStaffTaskPhotos(taskId: string, files: File[]) {
  if (files.length === 0) return [];

  const formData = new FormData();
  const uploadFiles = await compressImageFiles(files);
  for (const file of uploadFiles) {
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

function isTaskOverdue(value: string | null) {
  const offset = getTaskDueDayOffset(value);
  return offset != null && offset < 0;
}

function formatFileSize(size: number | null) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeTask(raw: StaffTask): StaffTask {
  return {
    ...raw,
    parentTaskId: raw.parentTaskId ?? null,
    sortOrder: raw.sortOrder ?? 0,
    complained: Boolean(raw.complained),
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
    dueDatetime: toLocalDateInput(new Date().toISOString()),
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

// ---- The schedule on a phone -----------------------------------------

type ScheduleCopy = ReturnType<typeof getStaffScheduleCopy>;

/** A task's day, as the desktop reads it: an order task by its handover,
 *  anything else by its due date. */
function mobileTaskDay(task: StaffTask) {
  if (task.category === "order_pickup" && task.order) return new Date(task.order.pickupDatetime);
  if (task.category === "order_return" && task.order) return new Date(task.order.returnDatetime);
  return task.dueDatetime ? new Date(task.dueDatetime) : null;
}

/** Minutes after midnight the task happens at, when it says. */
function mobileTaskMinutes(task: StaffTask) {
  if (isOrderEventTask(task) && task.order) {
    const at = mobileTaskDay(task)!;
    return at.getHours() * 60 + at.getMinutes();
  }
  const match = task.timeWindow?.match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function mobileDayOffset(date: Date | null) {
  if (!date) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((day.getTime() - today.getTime()) / 86400000);
}

const hhmmFromMinutes = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

type AssignTarget =
  | { type: "task"; task: StaffTask }
  | { type: "event"; event: OrderEvent };

/**
 * The staff schedule on a phone. Dragging, which the desktop is built
 * on, does not work under a thumb, so here each unassigned job has an
 * Assign button that opens the staff list -- each person with how much
 * they have that day and a warning when another of their jobs is too
 * close in time -- and each person's jobs are rows: a circle to tick
 * one done, and ⋯ for the rest. A strip at the top moves between
 * overdue, today and the days after.
 */
function StaffScheduleMobile({
  c,
  locale,
  staff,
  tasks,
  orderEvents,
  initialAssignTaskId,
  moreActions,
  archivedPanel,
  onNewTask,
  onEdit,
  onDelete,
  onToggleDone,
  onAddSubtask,
  onAssignTask,
  onAssignEvent,
}: {
  c: ScheduleCopy;
  locale: Locale;
  staff: StaffMember[];
  tasks: StaffTask[];
  orderEvents: OrderEvent[];
  initialAssignTaskId: string | null;
  moreActions: MobileAction[];
  archivedPanel: React.ReactNode;
  onNewTask: () => void;
  onEdit: (task: StaffTask) => void;
  onDelete: (task: StaffTask) => void;
  onToggleDone: (task: StaffTask) => void;
  onAddSubtask: (task: StaffTask, title: string) => void;
  onAssignTask: (taskId: string, staffId: string, notify: boolean) => void;
  onAssignEvent: (event: OrderEvent, staffId: string, notify: boolean) => void;
}) {
  const m = c.mobile;
  const [selected, setSelected] = useState<"overdue" | number>(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [assign, setAssign] = useState<AssignTarget | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [actionsFor, setActionsFor] = useState<StaffTask | null>(null);

  // Arriving from the calendar's card (?assign=<task>): open that task.
  useEffect(() => {
    if (!initialAssignTaskId) return;
    const task = tasks.find((item) => item.id === initialAssignTaskId);
    if (!task) return;
    const offset = mobileDayOffset(mobileTaskDay(task));
    if (offset != null && offset >= 0 && offset < 5) setSelected(offset);
    setAssign({ type: "task", task });
    setAssignee(task.staffId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAssignTaskId]);

  const roots = tasks.filter((task) => !task.parentTaskId && task.status !== "cancelled");
  const open = roots.filter((task) => task.status !== "done");
  const overdue = open.filter((task) => {
    const offset = mobileDayOffset(mobileTaskDay(task));
    return offset != null && offset < 0;
  });
  const onDay = (offset: number) =>
    roots.filter((task) => mobileDayOffset(mobileTaskDay(task)) === offset);
  const eventsOnDay = (offset: number) =>
    orderEvents.filter((event) => mobileDayOffset(new Date(event.datetime)) === offset);

  const dayTasks = selected === "overdue" ? overdue : onDay(selected);
  const dayEvents = selected === "overdue" ? [] : eventsOnDay(selected);
  const byTime = (a: StaffTask, b: StaffTask) =>
    (mobileTaskMinutes(a) ?? 24 * 60) - (mobileTaskMinutes(b) ?? 24 * 60) || sortTasks(a, b);
  const unassignedTasks = dayTasks.filter((task) => !task.staffId && task.status !== "done").sort(byTime);

  const days = [0, 1, 2, 3, 4].map((offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const label =
      offset === 0
        ? `${c.todayBadge} ${date.getMonth() + 1}/${date.getDate()}`
        : offset === 1
          ? c.tomorrowBadge
          : new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { weekday: "short" }).format(date);
    const count = onDay(offset).filter((task) => task.status !== "done").length + eventsOnDay(offset).length;
    return { offset, label, count };
  });

  const kind = (category: string | null) =>
    category === "order_pickup"
      ? { label: m.kindSend, tone: "bg-[var(--brand-soft)] text-[var(--brand)]" }
      : category === "order_return"
        ? { label: m.kindReturn, tone: "bg-amber-100 text-amber-800" }
        : { label: m.kindTodo, tone: "bg-[var(--surface-muted)] text-[var(--ink-mid)]" };
  const shortTitle = (task: StaffTask) =>
    getDisplayTaskTitle(task, c).replace(/^(送车|还车|取车|Pickup|Delivery|Return)\s*·\s*/i, "");
  const timeText = (task: StaffTask) => {
    const minutes = mobileTaskMinutes(task);
    if (selected === "overdue") {
      const day = mobileTaskDay(task);
      return day ? `${day.getMonth() + 1}/${day.getDate()}${minutes != null ? ` ${hhmmFromMinutes(minutes)}` : ""}` : "";
    }
    return minutes != null ? hhmmFromMinutes(minutes) : task.timeWindow || "";
  };

  // What each person already has on the assignment's day, and the job
  // of theirs nearest in time when it is within an hour and a half.
  const assignDay =
    assign?.type === "event"
      ? new Date(assign.event.datetime)
      : assign
        ? mobileTaskDay(assign.task)
        : null;
  const assignMinutes =
    assign?.type === "event"
      ? new Date(assign.event.datetime).getHours() * 60 + new Date(assign.event.datetime).getMinutes()
      : assign
        ? mobileTaskMinutes(assign.task)
        : null;
  const assignOffset = mobileDayOffset(assignDay);
  const staffNote = (member: StaffMember) => {
    const theirs = open.filter(
      (task) =>
        task.staffId === member.id &&
        (assign?.type !== "task" || task.id !== assign.task.id) &&
        assignOffset != null &&
        mobileDayOffset(mobileTaskDay(task)) === assignOffset,
    );
    const count = m.dayCount(theirs.length);
    if (assignMinutes == null) return { text: count, warn: false };
    const clash = theirs
      .map((task) => ({ task, minutes: mobileTaskMinutes(task) }))
      .filter((item): item is { task: StaffTask; minutes: number } => item.minutes != null)
      .sort((a, b) => Math.abs(a.minutes - assignMinutes) - Math.abs(b.minutes - assignMinutes))[0];
    if (clash && Math.abs(clash.minutes - assignMinutes) < 90) {
      const where =
        (clash.task.category === "order_return" ? c.returnCar : clash.task.category === "order_pickup" ? c.pickup : "") +
        (clash.task.vehicle?.plateNumber ? ` ${clash.task.vehicle.plateNumber}` : "");
      return { text: `${count} · ${m.conflict(hhmmFromMinutes(clash.minutes), where || shortTitle(clash.task))}`, warn: true };
    }
    return { text: theirs.length ? `${count} · ${m.free}` : count, warn: false };
  };

  const openAssign = (target: AssignTarget) => {
    setAssign(target);
    setAssignee(target.type === "task" ? target.task.staffId : null);
    setNotify(true);
  };
  const confirmAssign = () => {
    if (!assign || !assignee) return;
    if (assign.type === "task") onAssignTask(assign.task.id, assignee, notify);
    else onAssignEvent(assign.event, assignee, notify);
    setAssign(null);
  };

  const rowBase = "flex min-h-[56px] items-center gap-2.5 border-b border-[var(--line)] bg-[var(--surface)] py-2 pl-3.5 pr-1.5";

  const unassignedRow = (content: { key: string; kind: ReturnType<typeof kind>; title: string; sub: string; onAssign: () => void }) => (
    <li key={content.key} className={rowBase}>
      <span className={cn("shrink-0 rounded px-1.5 py-px text-[10.5px] font-bold", content.kind.tone)}>
        {content.kind.label}
      </span>
      <span className="min-w-0 flex-1 leading-[1.3]">
        <span className="block truncate text-[13px] font-semibold text-[var(--ink)]">{content.title}</span>
        {content.sub ? <span className="block truncate text-[11.5px] text-[var(--ink-soft)]">{content.sub}</span> : null}
      </span>
      <button
        type="button"
        onClick={content.onAssign}
        className="tap-compact hit-area mr-2 h-[30px] shrink-0 rounded-lg border border-[var(--brand)] px-3 text-[12px] font-semibold text-[var(--brand)]"
      >
        {m.assign}
      </button>
    </li>
  );

  const taskRow = (task: StaffTask) => {
    const done = task.status === "done";
    const k = kind(task.category);
    const late = !done && (mobileDayOffset(mobileTaskDay(task)) ?? 0) < 0;
    const sub = late
      ? m.overdueBy(-(mobileDayOffset(mobileTaskDay(task)) ?? 0))
      : [getTaskDetailsText(task), task.vehicle?.plateNumber].filter(Boolean).join(" · ");
    return (
      <li key={task.id} className={cn(rowBase, done && "opacity-50")}>
        <button
          type="button"
          onClick={() => onToggleDone(task)}
          aria-label={done ? m.markOpen : m.markDone}
          aria-pressed={done}
          className={cn(
            "tap-compact hit-area flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.6px]",
            done ? "border-emerald-700 bg-emerald-700 text-white" : "border-[var(--line-strong)] bg-[var(--surface)]",
          )}
        >
          {done ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> : null}
        </button>
        <span className="min-w-0 flex-1 leading-[1.3]">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("shrink-0 rounded px-1.5 py-px text-[10.5px] font-bold", k.tone)}>{k.label}</span>
            <span className={cn("truncate text-[13px] font-semibold text-[var(--ink)]", done && "line-through")}>
              {[timeText(task), shortTitle(task)].filter(Boolean).join(" · ")}
            </span>
          </span>
          {sub ? (
            <span className={cn("mt-0.5 block truncate text-[11.5px]", late ? "text-[var(--bad-fg)]" : "text-[var(--ink-soft)]")}>
              {sub}
            </span>
          ) : null}
        </span>
        <MobileIconButton label={m.taskActions} onClick={() => setActionsFor(task)} className="h-8 w-8 text-[var(--ink-soft)]">
          <MoreHorizontal className="h-[17px] w-[17px]" aria-hidden />
        </MobileIconButton>
      </li>
    );
  };

  const groupHeader = (key: string, avatar: React.ReactNode, name: string, note: string, isOpen: boolean) => (
    <button
      type="button"
      onClick={() =>
        setCollapsed((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        })
      }
      aria-expanded={isOpen}
      className="tap-compact flex h-11 w-full items-center gap-2.5 border-b border-[var(--line)] bg-[var(--surface-muted)] px-3.5 text-left text-[13px]"
    >
      {avatar}
      <b className="text-[var(--ink)]">{name}</b>
      <span className="flex-1 text-[var(--ink-soft)]">· {note}</span>
      <ChevronDown className={cn("h-4 w-4 text-[var(--ink-soft)] transition", isOpen && "rotate-180")} aria-hidden />
    </button>
  );

  const unassignedCount = unassignedTasks.length + dayEvents.length;

  return (
    <div className="-mx-2.5 -mt-3 sm:hidden">
      <MobilePageHeader
        actions={
          <>
            <MobileIconButton label={m.newTask} onClick={onNewTask}>
              <Plus className="h-5 w-5" strokeWidth={2} aria-hidden />
            </MobileIconButton>
            <MobileMoreMenu label={m.more} cancelLabel={c.cancel} actions={moreActions} />
          </>
        }
      />

      <div className="flex gap-1.5 overflow-x-auto border-b border-[var(--line)] bg-[var(--surface)] px-3.5 pb-2.5 pt-1 [scrollbar-width:none]">
        {overdue.length > 0 ? (
          <button
            type="button"
            onClick={() => setSelected("overdue")}
            aria-pressed={selected === "overdue"}
            className={cn(
              "tap-compact flex h-[46px] min-w-[52px] shrink-0 flex-col items-center justify-center rounded-[10px] border px-1.5 leading-[1.2]",
              selected === "overdue"
                ? "border-[var(--bad-fg)] bg-[var(--bad-fg)] text-white"
                : "border-rose-200 bg-rose-50 text-[var(--bad-fg)]",
            )}
          >
            <span className="text-[11px] font-semibold">{m.overdue}</span>
            <span className="text-[14px] font-bold">{overdue.length}</span>
          </button>
        ) : null}
        {days.map((day) => (
          <button
            key={day.offset}
            type="button"
            onClick={() => setSelected(day.offset)}
            aria-pressed={selected === day.offset}
            className={cn(
              "tap-compact flex h-[46px] min-w-[52px] shrink-0 flex-col items-center justify-center rounded-[10px] border px-1.5 leading-[1.2]",
              selected === day.offset
                ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]"
                : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]",
            )}
          >
            <span className="whitespace-nowrap text-[11px] opacity-80">{day.label}</span>
            <span className="text-[14px] font-bold">{day.count}</span>
          </button>
        ))}
      </div>

      {unassignedCount > 0 ? (
        <section>
          <div className="flex h-11 items-center gap-2 border-b border-[var(--line)] bg-[var(--surface-muted)] px-3.5 text-[13px]">
            <b className="text-[var(--ink)]">{m.unassigned}</b>
            <span className="text-[var(--ink-soft)]">· {m.items(unassignedCount)}</span>
          </div>
          <ul>
            {dayEvents
              .slice()
              .sort((a, b) => a.datetime.localeCompare(b.datetime))
              .map((event) =>
                unassignedRow({
                  key: event.id,
                  kind: kind(event.category),
                  title: `${formatOrderEventTime(event.datetime, locale)} · ${event.vehicleLabel} · ${event.renterName}`,
                  sub: event.location ?? "",
                  onAssign: () => openAssign({ type: "event", event }),
                }),
              )}
            {unassignedTasks.map((task) =>
              unassignedRow({
                key: task.id,
                kind: kind(task.category),
                title: [timeText(task), shortTitle(task)].filter(Boolean).join(" · "),
                sub: [getTaskDetailsText(task), task.vehicle?.plateNumber].filter(Boolean).join(" · "),
                onAssign: () => openAssign({ type: "task", task }),
              }),
            )}
          </ul>
        </section>
      ) : null}

      {staff.map((member) => {
        const theirs = dayTasks.filter((task) => task.staffId === member.id).sort(byTime);
        const isOpen = theirs.length > 0 && !collapsed.has(member.id);
        return (
          <section key={member.id}>
            {groupHeader(
              member.id,
              <span
                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
                style={{ backgroundColor: member.color }}
              >
                {member.name.trim().slice(0, 1).toUpperCase()}
              </span>,
              member.name,
              theirs.length ? m.items(theirs.length) : m.dayCount(0),
              isOpen,
            )}
            {isOpen ? <ul>{theirs.map(taskRow)}</ul> : null}
          </section>
        );
      })}

      {dayTasks.length === 0 && dayEvents.length === 0 ? (
        <p className="bg-[var(--surface)] px-3.5 py-6 text-center text-[13px] text-[var(--ink-soft)]">{m.nothing}</p>
      ) : null}

      {archivedPanel ? <div className="p-2.5">{archivedPanel}</div> : null}

      <MobileActionSheet
        open={actionsFor !== null}
        onClose={() => setActionsFor(null)}
        cancelLabel={c.cancel}
        title={actionsFor ? shortTitle(actionsFor) : undefined}
        actions={
          actionsFor
            ? [
                {
                  label: m.addSubtask,
                  onClick: () => {
                    const title = window.prompt(m.subtaskPrompt);
                    if (title?.trim()) onAddSubtask(actionsFor, title);
                  },
                },
                { label: c.edit, onClick: () => onEdit(actionsFor) },
                { label: actionsFor.status === "done" ? m.markOpen : m.markDone, onClick: () => onToggleDone(actionsFor) },
                { label: m.delete, danger: true, onClick: () => onDelete(actionsFor) },
              ]
            : []
        }
      />

      <MobileSheet open={assign !== null} onClose={() => setAssign(null)} label={m.assignTitle} closeLabel={c.cancel}>
        {assign ? (
          <div className="pb-1">
            <h2 className="text-[17px] font-bold text-[var(--ink)]">{m.assignTitle}</h2>
            <div className="mt-2.5 flex items-center gap-2.5 rounded-[10px] bg-[var(--surface-muted)] px-3 py-2.5">
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-px text-[10.5px] font-bold",
                  kind(assign.type === "event" ? assign.event.category : assign.task.category).tone,
                )}
              >
                {kind(assign.type === "event" ? assign.event.category : assign.task.category).label}
              </span>
              <span className="min-w-0 leading-[1.35]">
                <span className="block truncate text-[13px] font-semibold text-[var(--ink)]">
                  {assign.type === "event"
                    ? `${formatOrderEventTime(assign.event.datetime, locale)} · ${assign.event.vehicleLabel} · ${assign.event.renterName}`
                    : [timeText(assign.task), shortTitle(assign.task)].filter(Boolean).join(" · ")}
                </span>
                <span className="block truncate text-[11.5px] text-[var(--ink-soft)]">
                  {assign.type === "event" ? assign.event.location : getTaskDetailsText(assign.task)}
                </span>
              </span>
            </div>
            <ul className="mt-1.5" role="radiogroup" aria-label={m.assignTitle}>
              {staff.map((member) => {
                const note = staffNote(member);
                const chosen = assignee === member.id;
                return (
                  <li key={member.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => setAssignee(member.id)}
                      className="tap-compact flex h-[54px] w-full items-center gap-3 border-b border-[var(--line)] px-1 text-left"
                    >
                      <span
                        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                        style={{ backgroundColor: member.color }}
                      >
                        {member.name.trim().slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 leading-[1.3]">
                        <span className="block text-[14px] font-semibold text-[var(--ink)]">{member.name}</span>
                        <span
                          className={cn(
                            "block truncate text-[11.5px]",
                            note.warn ? "text-amber-700" : "text-[var(--ink-soft)]",
                          )}
                        >
                          {note.text}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          "h-5 w-5 shrink-0 rounded-full border-[1.6px] border-[var(--line-strong)]",
                          chosen && "border-[6px] border-[var(--brand)]",
                        )}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
            <label className="mt-3 flex items-center justify-between gap-3 text-[13px] text-[var(--ink)]">
              <span>{m.notifyAfter}</span>
              <input
                type="checkbox"
                role="switch"
                checked={notify}
                onChange={(event) => setNotify(event.target.checked)}
                className="tap-compact h-[26px] w-[42px] shrink-0 cursor-pointer appearance-none rounded-full bg-[var(--line-strong)] transition before:block before:h-5 before:w-5 before:translate-x-[3px] before:translate-y-[3px] before:rounded-full before:bg-white before:transition checked:bg-[var(--brand)] checked:before:translate-x-[19px]"
              />
            </label>
            <div className="mt-3.5 flex gap-2">
              <button
                type="button"
                onClick={() => setAssign(null)}
                className="tap-compact h-[42px] flex-1 rounded-[10px] border border-[var(--line-strong)] text-[14px] font-semibold text-[var(--ink)]"
              >
                {c.cancel}
              </button>
              <button
                type="button"
                onClick={confirmAssign}
                disabled={!assignee}
                className="tap-compact h-[42px] flex-[2] rounded-[10px] bg-[var(--brand)] text-[14px] font-semibold text-white disabled:opacity-40"
              >
                {assignee
                  ? m.confirmAssign(staff.find((member) => member.id === assignee)?.name ?? "")
                  : m.pickOne}
              </button>
            </div>
          </div>
        ) : null}
      </MobileSheet>
    </div>
  );
}
