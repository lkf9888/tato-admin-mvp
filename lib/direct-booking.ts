import { OrderStatus, type Order } from "@prisma/client";

import { orderRangesOverlap } from "@/lib/orders";

type BookingOrderLike = Pick<Order, "pickupDatetime" | "returnDatetime" | "status">;

export function dateOnlyToUtcMidday(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
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
  includeInsurance?: boolean;
}) {
  const days = getDirectBookingDays(input.pickupDate, input.returnDate);
  const baseAmount = days * input.bookingDailyRate;
  const insuranceFeePerDay = input.includeInsurance ? input.bookingInsuranceFee ?? 0 : 0;
  const insuranceAmount = days * insuranceFeePerDay;

  return {
    days,
    baseAmount,
    insuranceAmount,
    totalAmount: baseAmount + insuranceAmount,
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
