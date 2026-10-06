/**
 * A car that comes back and goes out again on the same day.
 *
 * The job between those two trips -- washing, charging, readying the car
 * -- has hours, not a day, and is the one to flag. For every open task
 * tied to a car (other than a pick-up itself), this finds the first
 * pick-up of another trip on that car on the task's own day.
 *
 * No `server-only`: the staff schedule runs it in the browser over the
 * orders it already has, and the staff link runs it on the server. The
 * caller says what "the same day" means by passing the day of an
 * instant -- the browser's local date there, the fleet's clock here --
 * which is the only part that differs.
 */

export type SameDayTask = {
  id: string;
  status: string;
  category: string | null;
  vehicleId: string | null;
  orderId: string | null;
  /** ISO string. */
  dueDatetime: string | null;
};

export type SameDayOrder = {
  id: string;
  vehicleId: string;
  /** ISO string. */
  pickupDatetime: string;
  renterName: string;
};

export type SameDayPickup = { pickupDatetime: string; renterName: string };

export function findSameDayPickups(
  tasks: SameDayTask[],
  orders: SameDayOrder[],
  dayOf: (iso: string) => string,
) {
  const result = new Map<string, SameDayPickup>();
  for (const task of tasks) {
    if (task.status === "done" || task.status === "cancelled") continue;
    if (!task.vehicleId || !task.dueDatetime || task.category === "order_pickup") continue;
    const day = dayOf(task.dueDatetime);
    const next = orders
      .filter(
        (order) =>
          order.vehicleId === task.vehicleId &&
          order.id !== task.orderId &&
          dayOf(order.pickupDatetime) === day,
      )
      .sort((left, right) => left.pickupDatetime.localeCompare(right.pickupDatetime))[0];
    if (next) result.set(task.id, { pickupDatetime: next.pickupDatetime, renterName: next.renterName });
  }
  return result;
}
