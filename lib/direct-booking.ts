import { OrderStatus, type Order } from "@prisma/client";

import { orderRangesOverlap } from "@/lib/orders";

type BookingOrderLike = Pick<Order, "pickupDatetime" | "returnDatetime" | "status">;
export type DateOnlyBookingWindow = {
  pickupDate: string;
  returnDate: string;
};

export function dateOnlyToUtcMidday(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

export function dateToDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function isDateOnlyRangeValid(pickupDate: string, returnDate: string) {
  const pickup = dateOnlyToUtcMidday(pickupDate);
  const dropoff = dateOnlyToUtcMidday(returnDate);

  if (Number.isNaN(pickup.getTime()) || Number.isNaN(dropoff.getTime())) {
    return false;
  }

  return dropoff > pickup;
}

export function getDirectBookingDays(pickupDate: string, returnDate: string) {
  if (!isDateOnlyRangeValid(pickupDate, returnDate)) {
    return 0;
  }

  const pickup = dateOnlyToUtcMidday(pickupDate);
  const dropoff = dateOnlyToUtcMidday(returnDate);
  return Math.max(0, Math.round((dropoff.getTime() - pickup.getTime()) / 86_400_000));
}

export function getDirectBookingQuote(input: {
  pickupDate: string;
  returnDate: string;
  bookingDailyRate: number;
  bookingInsuranceFee?: number | null;
  bookingDepositAmount?: number | null;
  includeInsurance?: boolean;
}) {
  const days = getDirectBookingDays(input.pickupDate, input.returnDate);
  const baseAmount = days * input.bookingDailyRate;
  const insuranceFeePerDay = input.includeInsurance ? input.bookingInsuranceFee ?? 0 : 0;
  const insuranceAmount = days * insuranceFeePerDay;
  const depositAmount = input.bookingDepositAmount ?? 0;

  return {
    days,
    baseAmount,
    insuranceAmount,
    depositAmount,
    totalAmount: baseAmount + insuranceAmount + depositAmount,
  };
}

export function hasVehicleBookingConflict(
  orders: BookingOrderLike[],
  pickupDate: string,
  returnDate: string,
) {
  if (!isDateOnlyRangeValid(pickupDate, returnDate)) {
    return false;
  }

  const pickup = dateOnlyToUtcMidday(pickupDate);
  const dropoff = dateOnlyToUtcMidday(returnDate);

  return orders.some((order) => {
    if (order.status === OrderStatus.cancelled) {
      return false;
    }

    return orderRangesOverlap(pickup, dropoff, order.pickupDatetime, order.returnDatetime);
  });
}

export function hasDateOnlyBookingConflict(
  windows: DateOnlyBookingWindow[],
  pickupDate: string,
  returnDate: string,
) {
  if (!isDateOnlyRangeValid(pickupDate, returnDate)) {
    return false;
  }

  const pickup = dateOnlyToUtcMidday(pickupDate);
  const dropoff = dateOnlyToUtcMidday(returnDate);

  return windows.some((window) =>
    orderRangesOverlap(
      pickup,
      dropoff,
      dateOnlyToUtcMidday(window.pickupDate),
      dateOnlyToUtcMidday(window.returnDate),
    ),
  );
}

export function getDateOnlyBookingWindows(orders: BookingOrderLike[]) {
  const today = dateOnlyToUtcMidday(dateToDateOnly(new Date()));

  return orders
    .filter(
      (order) =>
        order.status !== OrderStatus.cancelled &&
        order.returnDatetime.getTime() > today.getTime(),
    )
    .sort((left, right) => left.pickupDatetime.getTime() - right.pickupDatetime.getTime())
    .map((order) => ({
      pickupDate: dateToDateOnly(order.pickupDatetime),
      returnDate: dateToDateOnly(order.returnDatetime),
    }));
}

export function expandBlockedBookingDates(windows: DateOnlyBookingWindow[]) {
  const dates = new Set<string>();

  windows.forEach((window) => {
    if (!isDateOnlyRangeValid(window.pickupDate, window.returnDate)) {
      return;
    }

    let cursor = dateOnlyToUtcMidday(window.pickupDate);
    const dropoff = dateOnlyToUtcMidday(window.returnDate);

    while (cursor.getTime() < dropoff.getTime()) {
      dates.add(dateToDateOnly(cursor));
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
  });

  return dates;
}

export function getBlockedBookingWindows(
  orders: BookingOrderLike[],
  limit = 6,
) {
  return orders
    .filter((order) => order.status !== OrderStatus.cancelled)
    .sort((left, right) => left.pickupDatetime.getTime() - right.pickupDatetime.getTime())
    .slice(0, limit)
    .map((order) => ({
      pickupDatetime: order.pickupDatetime,
      returnDatetime: order.returnDatetime,
    }));
}
