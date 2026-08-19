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
    <div className="space-y-3">
      {projectedVehicleCount && additionalPaidSlotsNeeded ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
          {billingMessages.projectedNotice(projectedVehicleCount, additionalPaidSlotsNeeded)}
        </section>
      ) : null}

      {billingNotice ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-900">
          {billingNotice}
        </section>
      ) : null}

      {snapshot.billingBypassActive ? (
        <section className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-[12px] text-sky-900">
          {billingMessages.debugBypassNotice}
        </section>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[0.92fr_1.08fr]">
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
            {billingMessages.kicker}
          </p>
          <h3 className="mt-1 font-serif text-[1.15rem] text-[var(--ink)]">{billingMessages.title}</h3>
          <p className="mt-2 max-w-xl text-[12px] leading-5 text-[var(--ink-mid)]">{billingMessages.copy}</p>

          <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3">
            <div className="space-y-2 text-[12px] text-[var(--ink-mid)]">
              <div className="flex items-center justify-between">
                <span>{billingMessages.currentVehicles}</span>
                <span className="font-semibold text-[var(--ink)]">{snapshot.currentVehicleCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{billingMessages.freeIncluded}</span>
                <span className="font-semibold text-[var(--ink)]">{snapshot.freeVehicleSlots}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{billingMessages.couponBonus}</span>
                <span className="font-semibold text-[var(--ink)]">{snapshot.bonusVehicleSlots}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{billingMessages.paidSlots}</span>
                <span className="font-semibold text-[var(--ink)]">
                  {snapshot.effectivePurchasedVehicleSlots}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>{billingMessages.allowedTotal}</span>
                <span className="font-semibold text-[var(--ink)]">{snapshot.allowedVehicleCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{billingMessages.requiredRightNow}</span>
                <span className="font-semibold text-[var(--ink)]">{snapshot.requiredPaidSlots}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{billingMessages.subscriptionStatus}</span>
                <span className="font-semibold capitalize text-[var(--ink)]">
                  {formatBillingStatusLabel(snapshot.status)}
                </span>
              </div>
            </div>
            {currentPeriodEndLabel ? (
              <p className="mt-3 text-[11px] text-[var(--ink-soft)]">{billingMessages.renewsAt(currentPeriodEndLabel)}</p>
            ) : null}
          </div>

          <Link
            href="/imports"
            className="mt-3 inline-flex items-center rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[12px] font-medium text-[var(--ink-mid)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
          >
            {billingMessages.backToImports}
          </Link>
        </section>

        <section className="space-y-3">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
              {billingMessages.quantityKicker}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <h3 className="font-serif text-[1.15rem] text-[var(--ink)]">{billingMessages.quantityTitle}</h3>
              <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-mid)]">
                {billingMessages.suggestedTarget(snapshot.requiredPaidSlots)}
              </span>
            </div>
            <p className="mt-2 text-[12px] leading-5 text-[var(--ink-mid)]">{billingMessages.quantityCopy}</p>

            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,180px)_1fr] md:items-end">
              <label className="text-[12px] font-medium text-[var(--ink-mid)]">
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
                  className="mt-1.5 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[13px] text-[var(--ink)] outline-none transition focus:border-[var(--ink)]"
                />
              </label>
              <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2.5 text-[12px] text-[var(--ink-mid)]">
                <p className="font-medium text-[var(--ink)]">{billingMessages.quantityHint(desiredMonthlyPrice)}</p>
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
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                {billingMessages.stripeNotConfigured}
              </p>
            ) : null}

            {checkoutError ? (
              <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                {checkoutError}
              </p>
            ) : null}

            <button
              type="button"
              onClick={startCheckout}
              disabled={!snapshot.stripeConfigured || isCheckoutPending}
              className="mt-3 inline-flex items-center rounded-md bg-[var(--ink)] px-4 py-2 text-[12px] font-medium text-white transition hover:bg-[var(--ink)] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isCheckoutPending
                ? billingMessages.checkoutLoading
                : snapshot.purchasedVehicleSlots > 0
                  ? billingMessages.manageAction
                  : billingMessages.checkoutAction}
            </button>
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
              {billingMessages.couponKicker}
            </p>
            <h3 className="mt-1 font-serif text-[1.15rem] text-[var(--ink)]">{billingMessages.couponTitle}</h3>
            <p className="mt-2 text-[12px] leading-5 text-[var(--ink-mid)]">{billingMessages.couponCopy}</p>

            <div className="mt-3 rounded-md border border-[var(--accent)]/20 bg-[var(--accent-soft)]/60 px-3 py-2 text-[12px] text-[var(--ink-mid)]">
              <p className="font-medium text-[var(--ink)]">{billingMessages.welcomeCouponHintTitle}</p>
              <p className="mt-1 leading-5">
                {billingMessages.welcomeCouponHintBefore}
                <code className="mx-1 rounded bg-white px-1.5 py-0.5 font-mono text-xs text-[var(--ink)]">
                  3MONTHFREE
                </code>
                {billingMessages.welcomeCouponHintAfter}
              </p>
            </div>

            <label className="mt-3 block text-[12px] font-medium text-[var(--ink-mid)]">
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
                className="mt-1.5 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[13px] text-[var(--ink)] outline-none transition focus:border-[var(--ink)]"
              />
            </label>

            {couponNotice ? (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
                <p>{couponNotice}</p>
                {appliedFreeCoupon ? (
                  <p className="mt-1 text-xs text-emerald-800">
                    {billingMessages.couponAppliedFreeSlotsDetail}
                  </p>
                ) : null}
              </div>
            ) : null}

            {couponError ? (
              <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                {couponError}
              </p>
            ) : null}

            <button
              type="button"
              onClick={applyCoupon}
              disabled={isCouponPending}
              className="mt-3 inline-flex items-center rounded-md border border-[var(--line)] bg-white px-4 py-2 text-[12px] font-medium text-[var(--ink-mid)] transition hover:border-[var(--ink)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:text-[var(--ink-soft)]"
            >
              {isCouponPending ? billingMessages.applyingCoupon : billingMessages.applyCoupon}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
