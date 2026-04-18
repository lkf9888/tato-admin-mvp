"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import { getMessages, type Locale } from "@/lib/i18n";

type BillingSnapshot = {
  currentVehicleCount: number;
  freeVehicleSlots: number;
  bonusVehicleSlots: number;
  purchasedVehicleSlots: number;
  effectivePurchasedVehicleSlots: number;
  allowedVehicleCount: number;
  requiredPaidSlots: number;
  isOverLimit: boolean;
  billingBypassActive: boolean;
  stripeConfigured: boolean;
  status: string;
  currentPeriodEnd: string | null;
};

type PromotionCouponPayload = {
  kind: "promotion";
  code: string;
  description: string;
};

type FreeSlotCouponPayload = {
  kind: "free_slots";
  code: string;
  bonusVehicleSlots: number;
  description: string;
  snapshot: BillingSnapshot;
};

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatBillingStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export function BillingManagerPanel({
  locale,
  initialSnapshot,
  billingState,
  initialDesiredPaidVehicleSlots,
  projectedVehicleCount,
  additionalPaidSlotsNeeded,
  currentPeriodEndLabel,
}: {
  locale: Locale;
  initialSnapshot: BillingSnapshot;
  billingState: string | null;
  initialDesiredPaidVehicleSlots: number;
  projectedVehicleCount: number | null;
  additionalPaidSlotsNeeded: number | null;
  currentPeriodEndLabel: string | null;
}) {
  const messages = getMessages(locale);
  const billingMessages = messages.billingPage;
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [desiredPaidVehicleSlots, setDesiredPaidVehicleSlots] = useState(
    Math.max(1, initialDesiredPaidVehicleSlots),
  );
  const [couponCode, setCouponCode] = useState("");
  const [couponNotice, setCouponNotice] = useState("");
  const [couponError, setCouponError] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [billingNotice, setBillingNotice] = useState("");
  const [appliedPromotion, setAppliedPromotion] = useState<PromotionCouponPayload | null>(null);
  const [appliedFreeCoupon, setAppliedFreeCoupon] = useState<FreeSlotCouponPayload | null>(null);
  const [isCouponPending, startCouponTransition] = useTransition();
  const [isCheckoutPending, startCheckoutTransition] = useTransition();

  const desiredMonthlyPrice = useMemo(
    () => formatUsd(Math.max(0, desiredPaidVehicleSlots)),
    [desiredPaidVehicleSlots],
  );

  useEffect(() => {
    if (billingState === "success") {
      setBillingNotice(billingMessages.statusSuccess);
    } else if (billingState === "cancelled") {
      setBillingNotice(billingMessages.statusCancelled);
    } else if (billingState === "updated") {
      setBillingNotice(billingMessages.statusUpdated);
    }
  }, [billingMessages, billingState]);

  async function applyCoupon() {
    setCouponError("");
    setCouponNotice("");
    setCheckoutError("");

    const trimmedCode = couponCode.trim();
    if (!trimmedCode) {
      setCouponError(billingMessages.couponInvalid);
      return;
    }

    startCouponTransition(async () => {
      const response = await fetch("/api/billing/coupon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: trimmedCode,
        }),
      });

      const payload = (await response.json()) as
        | ({ error?: string } & PromotionCouponPayload)
        | ({ error?: string } & FreeSlotCouponPayload);

      if (!response.ok) {
        setCouponError(payload.error ?? billingMessages.couponInvalid);
        return;
      }

      if (payload.kind === "promotion") {
        setAppliedPromotion(payload);
        setAppliedFreeCoupon(null);
        setCouponNotice(billingMessages.couponAppliedDiscount(payload.code, payload.description));
        return;
      }

      setSnapshot(payload.snapshot);
      setAppliedFreeCoupon(payload);
      setAppliedPromotion(null);
      setCouponNotice(billingMessages.couponAppliedFreeSlots(payload.bonusVehicleSlots));
      setDesiredPaidVehicleSlots((current) =>
        Math.max(
          1,
          payload.snapshot.requiredPaidSlots || payload.snapshot.effectivePurchasedVehicleSlots || current,
        ),
      );
    });
  }

  async function startCheckout() {
    setCheckoutError("");
    setBillingNotice("");

    startCheckoutTransition(async () => {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          desiredPaidVehicleSlots,
          couponCode: (appliedPromotion?.code ?? couponCode.trim()) || undefined,
          returnPath: "/billing",
        }),
      });

      const payload = (await response.json()) as { error?: string; url?: string };
      if (!response.ok || !payload.url) {
        setCheckoutError(payload.error ?? billingMessages.checkoutError);
        return;
      }

      window.location.href = payload.url;
    });
  }

  return (
    <div className="space-y-6">
      {projectedVehicleCount && additionalPaidSlotsNeeded ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 shadow-sm">
          {billingMessages.projectedNotice(projectedVehicleCount, additionalPaidSlotsNeeded)}
        </section>
      ) : null}

      {billingNotice ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 shadow-sm">
          {billingNotice}
        </section>
      ) : null}

      {snapshot.billingBypassActive ? (
        <section className="rounded-lg border border-sky-200 bg-sky-50 px-5 py-4 text-sm text-sky-900 shadow-sm">
          {billingMessages.debugBypassNotice}
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <section className="rounded-lg border border-white/70 bg-white/90 p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
            {billingMessages.kicker}
          </p>
          <h3 className="mt-2 font-serif text-3xl text-slate-950">{billingMessages.title}</h3>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">{billingMessages.copy}</p>

          <div className="mt-6 rounded-lg bg-slate-50 p-4">
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-center justify-between">
                <span>{billingMessages.currentVehicles}</span>
                <span className="font-semibold text-slate-950">{snapshot.currentVehicleCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{billingMessages.freeIncluded}</span>
                <span className="font-semibold text-slate-950">{snapshot.freeVehicleSlots}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{billingMessages.couponBonus}</span>
                <span className="font-semibold text-slate-950">{snapshot.bonusVehicleSlots}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{billingMessages.paidSlots}</span>
                <span className="font-semibold text-slate-950">
                  {snapshot.effectivePurchasedVehicleSlots}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>{billingMessages.allowedTotal}</span>
                <span className="font-semibold text-slate-950">{snapshot.allowedVehicleCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{billingMessages.requiredRightNow}</span>
                <span className="font-semibold text-slate-950">{snapshot.requiredPaidSlots}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{billingMessages.subscriptionStatus}</span>
                <span className="font-semibold capitalize text-slate-950">
                  {formatBillingStatusLabel(snapshot.status)}
                </span>
              </div>
            </div>
            {currentPeriodEndLabel ? (
              <p className="mt-4 text-xs text-slate-500">{billingMessages.renewsAt(currentPeriodEndLabel)}</p>
            ) : null}
          </div>

          <Link
            href="/imports"
            className="mt-5 inline-flex items-center rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-900 hover:text-slate-950"
          >
            {billingMessages.backToImports}
          </Link>
        </section>

        <section className="space-y-6">
          <div className="rounded-lg border border-white/70 bg-white/90 p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
              {billingMessages.quantityKicker}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h3 className="font-serif text-3xl text-slate-950">{billingMessages.quantityTitle}</h3>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {billingMessages.suggestedTarget(snapshot.requiredPaidSlots)}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{billingMessages.quantityCopy}</p>

            <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,220px)_1fr] md:items-end">
              <label className="text-sm font-medium text-slate-700">
                {billingMessages.quantityLabel}
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={desiredPaidVehicleSlots}
                  onChange={(event) =>
                    setDesiredPaidVehicleSlots(
                      Math.max(1, Number.parseInt(event.target.value || "1", 10) || 1),
                    )
                  }
                  className="mt-2 w-full rounded-md border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-900"
                />
              </label>
              <div className="rounded-lg bg-slate-50 px-4 py-4 text-sm text-slate-700">
                <p className="font-medium text-slate-900">{billingMessages.quantityHint(desiredMonthlyPrice)}</p>
                {appliedPromotion ? (
                  <p className="mt-2 text-xs text-sky-700">
                    {billingMessages.promotionBadge}: {appliedPromotion.code}
                  </p>
                ) : null}
                {appliedFreeCoupon ? (
                  <p className="mt-2 text-xs text-emerald-700">
                    {billingMessages.freeBadge}: +{appliedFreeCoupon.bonusVehicleSlots}
                  </p>
                ) : null}
              </div>
            </div>

            {!snapshot.stripeConfigured ? (
              <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {billingMessages.stripeNotConfigured}
              </p>
            ) : null}

            {checkoutError ? (
              <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {checkoutError}
              </p>
            ) : null}

            <button
              type="button"
              onClick={startCheckout}
              disabled={!snapshot.stripeConfigured || isCheckoutPending}
              className="mt-5 inline-flex items-center rounded-md bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isCheckoutPending
                ? billingMessages.checkoutLoading
                : snapshot.purchasedVehicleSlots > 0
                  ? billingMessages.manageAction
                  : billingMessages.checkoutAction}
            </button>
          </div>

          <div className="rounded-lg border border-white/70 bg-white/90 p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
              {billingMessages.couponKicker}
            </p>
            <h3 className="mt-2 font-serif text-3xl text-slate-950">{billingMessages.couponTitle}</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">{billingMessages.couponCopy}</p>

            <label className="mt-5 block text-sm font-medium text-slate-700">
              {billingMessages.couponLabel}
              <input
                value={couponCode}
                onChange={(event) => {
                  setCouponCode(event.target.value);
                  setCouponError("");
                  setCouponNotice("");
                  setAppliedPromotion(null);
                }}
                placeholder={billingMessages.couponPlaceholder}
                className="mt-2 w-full rounded-md border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-900"
              />
            </label>

            {couponNotice ? (
              <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <p>{couponNotice}</p>
                {appliedFreeCoupon ? (
                  <p className="mt-1 text-xs text-emerald-800">
                    {billingMessages.couponAppliedFreeSlotsDetail}
                  </p>
                ) : null}
              </div>
            ) : null}

            {couponError ? (
              <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {couponError}
              </p>
            ) : null}

            <button
              type="button"
              onClick={applyCoupon}
              disabled={isCouponPending}
              className="mt-5 inline-flex items-center rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-900 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            >
              {isCouponPending ? billingMessages.applyingCoupon : billingMessages.applyCoupon}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
