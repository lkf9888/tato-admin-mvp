"use client";

import { useEffect } from "react";

import { rememberOrder } from "@/components/remember-order";

/**
 * Notes every click on an element carrying `data-order-id` inside it as
 * a view of that order. Lets a server-rendered list (the dashboard's
 * rows, which may open Turo rather than a page here) feed "recently
 * viewed" without each row becoming a client component.
 */
export function OrderClickTracker({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={className}
      onClickCapture={(event) => {
        const row = (event.target as Element).closest<HTMLElement>("[data-order-id]");
        if (row?.dataset.orderId) rememberOrder(row.dataset.orderId);
      }}
    >
      {children}
    </div>
  );
}

/** Notes a view of this order when its page opens. */
export function RememberOrderView({ orderId }: { orderId: string }) {
  useEffect(() => {
    rememberOrder(orderId);
  }, [orderId]);
  return null;
}
