import "server-only";

import { Prisma, StaffTaskStatus } from "@prisma/client";

import { utcToZonedDate, utcToZonedTime, zonedDateTimeToUtc } from "@/lib/booking-time";
import { prisma } from "@/lib/prisma";
import { notifyStaffTaskChange } from "@/lib/staff-task-notifications";

/**
 * Staff tasks that belong to an order's pick-up or return, kept in step
 * with the order.
 *
 * Two jobs. Every return turns into a real task -- washing and readying
 * the car is work that happens after every trip, and work someone gets
 * paid for -- created a few days ahead, unassigned, for the schedule to
 * hand out. And every task tied to an order's pick-up or return, made
 * here or dragged onto a person by hand, follows that order: moved when
 * the trip moves, cancelled when the trip is cancelled or deleted.
 *
 * What the order does not decide is left alone: who the task is given
 * to, its notes, its photos, a manager's own cancel. A task already done
 * is history and is never touched.
 *
 * Runs from the order paths this session owns, right after the save,
 * and from `reconcileWorkspaceOrderTasks` -- on the schedule page and
 * every fifteen minutes -- for the orders that arrive any other way
 * (CSV, booking mail, the rental site).
 */

/** The categories the schedule already gives order tasks. */
export const ORDER_TASK_CATEGORY = {
  pickup: "order_pickup",
  return: "order_return",
} as const;

const ORDER_TASK_CATEGORIES = [ORDER_TASK_CATEGORY.pickup, ORDER_TASK_CATEGORY.return];

/**
 * How far ahead a return becomes a task: today and the next three days,
 * the same window the schedule's upcoming panel shows. Further out would
 * fill the unassigned list with trips months away.
 */
export const RETURN_TASK_HORIZON_DAYS = 3;

/** Task statuses an order change may still move or cancel. */
const OPEN_STATUSES: StaffTaskStatus[] = [StaffTaskStatus.todo, StaffTaskStatus.in_progress];

const taskInclude = {
  staff: true,
  vehicle: { select: { plateNumber: true, nickname: true } },
  order: { select: { renterName: true } },
} satisfies Prisma.StaffTaskInclude;

type OrderTask = Prisma.StaffTaskGetPayload<{ include: typeof taskInclude }>;

const orderSelect = {
  id: true,
  workspaceId: true,
  vehicleId: true,
  status: true,
  isArchived: true,
  renterName: true,
  pickupDatetime: true,
  returnDatetime: true,
  returnLocation: true,
  vehicle: { select: { plateNumber: true, nickname: true, pickupPassword: true } },
} satisfies Prisma.OrderSelect;

type TaskOrder = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

type SyncOptions = {
  /** For the staff link in a change notification. */
  origin?: string;
  /**
   * The order just came back -- restored from the trash, or un-cancelled.
   * Only then is a cancelled task reopened: otherwise a cancel is
   * someone's decision about the task, not about the order.
   */
  reinstate?: boolean;
};

/**
 * The due date the schedule stores for an order task: the local day at
 * noon UTC, which is what the schedule writes for a date-only task, so
 * it reads as the same day in Vancouver and in UTC.
 */
function taskDueDate(instant: Date) {
  return new Date(`${utcToZonedDate(instant)}T12:00:00.000Z`);
}

function vehicleLabel(vehicle: { plateNumber: string; nickname: string }) {
  return `${vehicle.plateNumber} · ${vehicle.nickname}`;
}

/** Same words the schedule uses when a return is dragged onto a person. */
function returnTaskTitle(order: Pick<TaskOrder, "renterName">, vehicle: { plateNumber: string; nickname: string }) {
  return `还车 · ${vehicleLabel(vehicle)} · ${order.renterName}`;
}

function returnTaskDetails(order: TaskOrder) {
  const lines: string[] = [];
  const location = order.returnLocation?.trim();
  if (location) lines.push(`还车地址: ${location}`);
  const password = order.vehicle.pickupPassword?.trim();
  if (password) lines.push(`取车密码: ${password}`);
  return lines.join("\n") || null;
}

function isOrderActive(order: Pick<TaskOrder, "isArchived" | "status">) {
  return !order.isArchived && order.status !== "cancelled";
}

/** Today's date and the end of the creation window, on the fleet's clock. */
function returnWindow(now = new Date()) {
  const today = utcToZonedDate(now);
  const start = zonedDateTimeToUtc(today, "00:00")!;
  const endDay = new Date(`${today}T12:00:00.000Z`);
  endDay.setUTCDate(endDay.getUTCDate() + RETURN_TASK_HORIZON_DAYS + 1);
  const end = zonedDateTimeToUtc(endDay.toISOString().slice(0, 10), "00:00")!;
  return { start, end };
}

async function hasActiveStaff(workspaceId: string) {
  const count = await prisma.staffMember.count({ where: { workspaceId, isActive: true } });
  return count > 0;
}

/**
 * Bring one order's tasks in line with it. Returns how many tasks were
 * created or changed.
 */
async function applyOrder(
  order: TaskOrder,
  tasks: OrderTask[],
  context: { suppressed: boolean; createReturn: boolean; options: SyncOptions },
) {
  let changed = 0;
  const active = isOrderActive(order);

  for (const task of tasks) {
    if (task.status === StaffTaskStatus.done) continue;

    if (!active) {
      if (task.status === StaffTaskStatus.cancelled) continue;
      const updated = await prisma.staffTask.update({
        where: { id: task.id },
        data: { status: StaffTaskStatus.cancelled },
        include: taskInclude,
      });
      changed += 1;
      if (updated.staffId) await notifyStaffTaskChange(updated, "removed", context.options.origin);
      continue;
    }

    const reopen = task.status === StaffTaskStatus.cancelled && context.options.reinstate;
    if (task.status === StaffTaskStatus.cancelled && !reopen) continue;

    const moment = task.category === ORDER_TASK_CATEGORY.pickup ? order.pickupDatetime : order.returnDatetime;
    const dueDatetime = taskDueDate(moment);
    const timeWindow = utcToZonedTime(moment);
    const vehicleMoved = task.vehicleId !== order.vehicleId;
    const dateMoved = task.dueDatetime?.toISOString().slice(0, 10) !== dueDatetime.toISOString().slice(0, 10);
    const timeMoved = (task.timeWindow ?? "") !== timeWindow;
    if (!vehicleMoved && !dateMoved && !timeMoved && !reopen) continue;

    // A title still reading the way it was generated follows the car; one
    // a manager rewrote is theirs.
    const data: Prisma.StaffTaskUncheckedUpdateInput = {
      vehicleId: order.vehicleId,
      dueDatetime,
      timeWindow,
    };
    if (
      vehicleMoved &&
      task.category === ORDER_TASK_CATEGORY.return &&
      task.vehicle &&
      task.title === returnTaskTitle(order, task.vehicle)
    ) {
      data.title = returnTaskTitle(order, order.vehicle);
    }
    if (reopen) {
      data.status = StaffTaskStatus.todo;
      data.completedAt = null;
    }

    const updated = await prisma.staffTask.update({
      where: { id: task.id },
      data,
      include: taskInclude,
    });
    changed += 1;
    if (updated.staffId) await notifyStaffTaskChange(updated, "updated", context.options.origin);
  }

  const hasReturnTask = tasks.some((task) => task.category === ORDER_TASK_CATEGORY.return);
  if (active && context.createReturn && !hasReturnTask && !context.suppressed) {
    const { start, end } = returnWindow();
    if (order.returnDatetime >= start && order.returnDatetime < end) {
      try {
        await prisma.staffTask.create({
          data: {
            // Fixed per order, so a page load and the scheduled run that
            // land at the same moment cannot both create one.
            id: `${order.id}_return`,
            workspaceId: order.workspaceId,
            vehicleId: order.vehicleId,
            orderId: order.id,
            title: returnTaskTitle(order, order.vehicle),
            details: returnTaskDetails(order),
            dueDatetime: taskDueDate(order.returnDatetime),
            timeWindow: utcToZonedTime(order.returnDatetime),
            category: ORDER_TASK_CATEGORY.return,
            status: StaffTaskStatus.todo,
            // Zero sorts by due date on the schedule; a position comes
            // from being dragged.
            sortOrder: 0,
          },
        });
        changed += 1;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }
  }

  return changed;
}

/** One order, right after it was saved. */
export async function syncOrderStaffTasks(orderId: string, options: SyncOptions = {}) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: orderSelect });
  if (!order?.workspaceId) return 0;

  const [tasks, suppression, staffed] = await Promise.all([
    prisma.staffTask.findMany({
      where: { workspaceId: order.workspaceId, orderId, category: { in: ORDER_TASK_CATEGORIES } },
      include: taskInclude,
    }),
    prisma.staffTaskSuppression.findUnique({
      where: { orderId_category: { orderId, category: ORDER_TASK_CATEGORY.return } },
    }),
    hasActiveStaff(order.workspaceId),
  ]);

  return applyOrder(order, tasks, { suppressed: Boolean(suppression), createReturn: staffed, options });
}

/**
 * Every order in one workspace whose tasks could be out of step: returns
 * inside the creation window that have no task yet, and every open task
 * tied to an order. A workspace with no active staff has nobody to give
 * a task to, so nothing is created there.
 */
export async function reconcileWorkspaceOrderTasks(workspaceId: string, options: SyncOptions = {}) {
  const staffed = await hasActiveStaff(workspaceId);
  const { start, end } = returnWindow();

  const [openTasks, windowOrders] = await Promise.all([
    prisma.staffTask.findMany({
      where: {
        workspaceId,
        orderId: { not: null },
        category: { in: ORDER_TASK_CATEGORIES },
        status: { in: OPEN_STATUSES },
      },
      include: taskInclude,
    }),
    staffed
      ? prisma.order.findMany({
          where: {
            workspaceId,
            isArchived: false,
            status: { not: "cancelled" },
            returnDatetime: { gte: start, lt: end },
          },
          select: orderSelect,
        })
      : Promise.resolve([] as TaskOrder[]),
  ]);

  const orderIds = new Set<string>([
    ...openTasks.map((task) => task.orderId!),
    ...windowOrders.map((order) => order.id),
  ]);
  if (orderIds.size === 0) return { orders: 0, changed: 0 };

  const ids = [...orderIds];
  const [orders, allTasks, suppressions] = await Promise.all([
    prisma.order.findMany({ where: { id: { in: ids }, workspaceId }, select: orderSelect }),
    // Every status, so a return already done or cancelled is not created twice.
    prisma.staffTask.findMany({
      where: { workspaceId, orderId: { in: ids }, category: { in: ORDER_TASK_CATEGORIES } },
      include: taskInclude,
    }),
    prisma.staffTaskSuppression.findMany({
      where: { workspaceId, orderId: { in: ids }, category: ORDER_TASK_CATEGORY.return },
      select: { orderId: true },
    }),
  ]);

  const suppressed = new Set(suppressions.map((row) => row.orderId));
  const tasksByOrder = new Map<string, OrderTask[]>();
  for (const task of allTasks) {
    const list = tasksByOrder.get(task.orderId!) ?? [];
    list.push(task);
    tasksByOrder.set(task.orderId!, list);
  }

  let changed = 0;
  for (const order of orders) {
    changed += await applyOrder(order, tasksByOrder.get(order.id) ?? [], {
      suppressed: suppressed.has(order.id),
      createReturn: staffed,
      options,
    });
  }
  return { orders: orders.length, changed };
}

/** The scheduled run: every workspace that has staff or open order tasks. */
export async function reconcileAllOrderTasks(options: SyncOptions = {}) {
  const [staffed, withTasks] = await Promise.all([
    prisma.staffMember.findMany({
      where: { isActive: true, workspaceId: { not: null } },
      select: { workspaceId: true },
      distinct: ["workspaceId"],
    }),
    prisma.staffTask.findMany({
      where: {
        workspaceId: { not: null },
        orderId: { not: null },
        category: { in: ORDER_TASK_CATEGORIES },
        status: { in: OPEN_STATUSES },
      },
      select: { workspaceId: true },
      distinct: ["workspaceId"],
    }),
  ]);
  const workspaceIds = new Set(
    [...staffed, ...withTasks].map((row) => row.workspaceId).filter((id): id is string => Boolean(id)),
  );

  let changed = 0;
  for (const workspaceId of workspaceIds) {
    changed += (await reconcileWorkspaceOrderTasks(workspaceId, options)).changed;
  }
  return { workspaces: workspaceIds.size, changed };
}

/**
 * A return task someone deleted stays deleted: recorded here so the next
 * sync does not make it again. Pick-up tasks are only ever made by hand,
 * so there is nothing to hold back for them.
 */
export async function suppressDeletedOrderTask(task: {
  workspaceId: string | null;
  orderId: string | null;
  category: string | null;
}) {
  if (!task.workspaceId || !task.orderId || task.category !== ORDER_TASK_CATEGORY.return) return;
  await prisma.staffTaskSuppression.upsert({
    where: { orderId_category: { orderId: task.orderId, category: task.category } },
    update: {},
    create: { workspaceId: task.workspaceId, orderId: task.orderId, category: task.category },
  });
}
