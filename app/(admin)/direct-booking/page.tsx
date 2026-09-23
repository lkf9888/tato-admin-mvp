import Link from "next/link";
import { headers } from "next/headers";

import {
  saveBookingPolicyAction,
  saveVehicleDirectBookingAction,
} from "@/app/actions";
import { normalizeBookingPolicy } from "@/lib/booking-policy";
import { resolveVehicleDailyRate } from "@/lib/vehicle-pricing";
import { formatCurrency } from "@/lib/utils";
import { DirectBookingEmailEditor } from "@/components/direct-booking-email-editor";
import { normalizeDirectBookingEmailTemplate } from "@/lib/direct-booking-email-template";
import { isEmailConfigured } from "@/lib/email";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getBlockedBookingWindows } from "@/lib/direct-booking";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getAppUrl, getStripeSecretKey } from "@/lib/stripe";
import { formatDate } from "@/lib/utils";

export default async function DirectBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ emailSaved?: string; policySaved?: string }>;
}) {
  const workspace = await requireCurrentWorkspace();
  const bookableFrom = new Date();
  bookableFrom.setDate(bookableFrom.getDate() - 1);
  const [query, headerStore, { locale, messages }, emailTemplate, savedPolicy, vehicles] =
    await Promise.all([
    searchParams,
    headers(),
    getI18n(),
    prisma.directBookingEmailTemplate.findUnique({ where: { workspaceId: workspace.id } }),
    prisma.bookingPricingPolicy.findUnique({ where: { workspaceId: workspace.id } }),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      include: {
        owner: true,
        orders: {
          where: {
            isArchived: false,
            status: {
              not: "cancelled",
            },
            // Only trips that can still block a booking. This page
            // feeds `getBlockedBookingWindows`, which asks "when is
            // this car unavailable" -- a question about now and
            // ahead. It was loading every trip since 2016 to answer
            // it, which is where 1.6 MB of this page came from.
            // A day of slack on the near side keeps a trip that ends
            // today from disappearing mid-afternoon.
            returnDatetime: { gte: bookableFrom },
          },
          orderBy: {
            pickupDatetime: "asc",
          },
        },
      },
      orderBy: { plateNumber: "asc" },
    }),
  ]);

  const directMessages = messages.directBookingPage;
  const fleetPolicy = normalizeBookingPolicy(savedPolicy);
  const forwardedHost = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const forwardedProto = headerStore.get("x-forwarded-proto");
  const protocol =
    forwardedProto ??
    (forwardedHost?.includes("localhost") || forwardedHost?.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const requestOrigin = forwardedHost ? `${protocol}://${forwardedHost}` : undefined;
  const appUrl = requestOrigin?.replace(/\/$/, "") ?? getAppUrl();
  const enabledCount = vehicles.filter((vehicle) => vehicle.directBookingEnabled).length;
  const rates = new Map(
    vehicles.map((vehicle) => [vehicle.id, resolveVehicleDailyRate(vehicle, fleetPolicy)]),
  );
  const readyCount = vehicles.filter(
    (vehicle) => vehicle.directBookingEnabled && (rates.get(vehicle.id)?.dailyRate ?? 0) > 0,
  ).length;
  const stripeReady = Boolean(getStripeSecretKey());

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.94),rgba(255,240,231,0.97))] p-3 shadow-[0_20px_48px_-40px_rgba(17,19,24,0.45)] sm:p-4">
        <p className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--ink-soft)]">
          {directMessages.kicker}
        </p>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-4xl">
            <h2 className="font-serif text-[1.25rem] leading-tight text-[color:var(--ink)] sm:text-[1.45rem]">
              {directMessages.title}
            </h2>
            <p className="mt-2 text-[12px] leading-5 text-[color:var(--ink-soft)]">
              {directMessages.copy}
            </p>
          </div>
          <div className="rounded-full border border-[rgba(17,19,24,0.08)] bg-white/78 px-3 py-1.5 text-[11px] text-[color:var(--ink-soft)] shadow-[0_12px_24px_-24px_rgba(17,19,24,0.55)]">
            {stripeReady ? directMessages.stripeReady : directMessages.stripeMissing}
          </div>
        </div>

        <div className="mt-3 grid gap-2.5 md:grid-cols-3">
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-[var(--surface)] px-3 py-2.5 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
              {directMessages.enabledCount}
            </p>
            <p className="mt-1.5 text-[1.35rem] font-semibold text-[color:var(--ink)]">{enabledCount}</p>
          </div>
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-[var(--surface)] px-3 py-2.5 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
              {directMessages.readyCount}
            </p>
            <p className="mt-1.5 text-[1.35rem] font-semibold text-[color:var(--ink)]">{readyCount}</p>
          </div>
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-[var(--surface)] px-3 py-2.5 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
              {directMessages.stripeStatus}
            </p>
            <p className="mt-1.5 text-[1.35rem] font-semibold text-[color:var(--ink)]">
              {stripeReady ? directMessages.stripeReady : directMessages.stripeMissing}
            </p>
          </div>
        </div>
      </section>

      <form
        action={saveBookingPolicyAction}
        className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--ink-soft)]">
              {directMessages.policyKicker}
            </p>
            <h3 className="mt-1 text-[1.05rem] font-semibold text-[color:var(--ink)]">
              {directMessages.policyTitle}
            </h3>
            <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[color:var(--ink-soft)]">
              {directMessages.policyCopy}
            </p>
          </div>
          {query.policySaved ? (
            <span className="rounded-md bg-[var(--ok-bg)] px-2.5 py-1 text-[11px] text-[color:var(--ok-fg)]">
              {directMessages.policySavedNotice}
            </span>
          ) : null}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            {
              name: "weeklyDiscountPercent",
              label: directMessages.policyWeeklyLabel,
              hint: directMessages.policyWeeklyHint,
              value: fleetPolicy.weeklyDiscountPercent,
              step: "0.1",
            },
            {
              name: "minimumRentalDays",
              label: directMessages.policyMinDaysLabel,
              hint: directMessages.policyMinDaysHint,
              value: fleetPolicy.minimumRentalDays,
              step: "1",
            },
            {
              name: "dailyKmAllowance",
              label: directMessages.policyKmLabel,
              hint: directMessages.policyKmHint,
              value: fleetPolicy.dailyKmAllowance,
              step: "1",
            },
            {
              name: "extraKmRate",
              label: directMessages.policyExtraKmLabel,
              hint: directMessages.policyExtraKmHint,
              value: fleetPolicy.extraKmRate,
              step: "0.01",
            },
            {
              name: "suggestedRateMultiplier",
              label: directMessages.policyMultiplierLabel,
              hint: directMessages.policyMultiplierHint,
              value: fleetPolicy.suggestedRateMultiplier,
              step: "0.05",
            },
          ].map((field) => (
            <label key={field.name} className="block min-w-0">
              <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">
                {field.label}
              </span>
              <input
                name={field.name}
                type="number"
                min="0"
                step={field.step}
                inputMode="decimal"
                defaultValue={field.value}
                className="w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] font-medium tabular-nums text-[color:var(--ink)]"
              />
              <span className="mt-1 block text-[11px] leading-4 text-[color:var(--ink-soft)]">
                {field.hint}
              </span>
            </label>
          ))}
        </div>

        <button
          type="submit"
          className="mt-3 rounded-md bg-[var(--ink)] px-4 py-2 text-[12px] font-medium text-white"
          style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
        >
          {directMessages.policySaveAction}
        </button>
      </form>

      <DirectBookingEmailEditor
        locale={locale}
        initialEnabled={emailTemplate?.isEnabled ?? true}
        initialSubject={normalizeDirectBookingEmailTemplate(emailTemplate).subjectTemplate}
        initialBody={normalizeDirectBookingEmailTemplate(emailTemplate).bodyTemplate}
        emailConfigured={isEmailConfigured()}
        saved={Boolean(query.emailSaved)}
      />

      {vehicles.length === 0 ? (
        <section className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-4 py-5 text-[12px] text-[color:var(--ink-soft)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
          {directMessages.emptyState}
        </section>
      ) : null}

      <section className="grid gap-2.5 xl:grid-cols-2 2xl:grid-cols-3">
        {vehicles.map((vehicle) => {
          const shareUrl = `${appUrl}/reserve/${vehicle.id}`;
          const blockedWindows = getBlockedBookingWindows(vehicle.orders, 4);
          const rate = rates.get(vehicle.id);
          const hasDailyRate = (rate?.dailyRate ?? 0) > 0;
          const isLive = vehicle.directBookingEnabled && hasDailyRate;

          return (
            <article
              key={vehicle.id}
              className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]"
            >
              <header className="flex flex-wrap items-start justify-between gap-2 border-b border-[color:var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,247,247,0.96))] px-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="font-serif text-[1.05rem] leading-tight text-[color:var(--ink)]">
                      {vehicle.plateNumber} · {vehicle.nickname}
                    </h3>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.08em] ${
                        isLive
                          ? "border border-[rgba(89,60,251,0.18)] bg-[var(--accent-soft)] text-[var(--ink)]"
                          : "border border-[var(--ink)]/8 bg-[var(--accent-soft-strong)] text-[var(--ink-mid)]"
                      }`}
                    >
                      {isLive ? directMessages.liveLabel : directMessages.draftLabel}
                    </span>
                    {rate?.source === "suggested" ? (
                      <span className="inline-flex rounded-full border border-[rgba(89,60,251,0.18)] bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[color:var(--ink)]">
                        {directMessages.aiPricedBadge}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] text-[color:var(--ink-soft)]">
                    {vehicle.brand} {vehicle.model} · {vehicle.year} · {directMessages.ownerLabel}:{" "}
                    {vehicle.owner?.name ?? directMessages.noOwner}
                  </p>
                </div>
                <Link
                  href={shareUrl}
                  target="_blank"
                  className="inline-flex shrink-0 items-center rounded-md bg-[var(--ink)] px-3 py-1.5 text-[11px] font-medium text-white shadow-[0_16px_30px_-24px_rgba(17,19,24,0.8)] transition hover:translate-y-[-1px]"
                  style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
                >
                  {directMessages.openPreview}
                </Link>
              </header>

              <div className="flex items-center gap-2 border-b border-[color:var(--line)] bg-white/50 px-3 py-2">
                <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                  {directMessages.shareLinkLabel}
                </span>
                <input
                  readOnly
                  value={shareUrl}
                  className="min-w-0 flex-1 truncate rounded-md bg-transparent px-2 py-1 text-xs text-[color:var(--ink)] outline-none"
                />
              </div>

              <form action={saveVehicleDirectBookingAction} className="space-y-3 px-3 py-3">
                <input type="hidden" name="id" value={vehicle.id} />

                <label className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-[color:var(--ink)]">
                      {directMessages.enableLabel}
                    </p>
                    {!hasDailyRate ? (
                      <p className="mt-0.5 text-[11px] text-[color:var(--ink-soft)]">
                        {directMessages.pricingMissing}
                      </p>
                    ) : null}
                  </div>
                  <input
                    type="checkbox"
                    name="directBookingEnabled"
                    defaultChecked={vehicle.directBookingEnabled}
                    className="h-4 w-4 shrink-0 rounded border-[color:var(--line)]"
                  />
                </label>

                <div className="rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2.5">
                  <p className="text-[11px] font-medium text-[color:var(--ink)]">
                    {directMessages.vehicleOverrideTitle}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[color:var(--ink-soft)]">
                    {directMessages.vehicleOverrideHint}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
                    {[
                      {
                        name: "bookingWeeklyDiscountPercent",
                        label: directMessages.policyWeeklyLabel,
                        value: vehicle.bookingWeeklyDiscountPercent,
                        fleet: fleetPolicy.weeklyDiscountPercent,
                        step: "0.1",
                      },
                      {
                        name: "bookingMinimumRentalDays",
                        label: directMessages.policyMinDaysLabel,
                        value: vehicle.bookingMinimumRentalDays,
                        fleet: fleetPolicy.minimumRentalDays,
                        step: "1",
                      },
                      {
                        name: "bookingDailyKmAllowance",
                        label: directMessages.policyKmLabel,
                        value: vehicle.bookingDailyKmAllowance,
                        fleet: fleetPolicy.dailyKmAllowance,
                        step: "1",
                      },
                      {
                        name: "bookingExtraKmRate",
                        label: directMessages.policyExtraKmLabel,
                        value: vehicle.bookingExtraKmRate,
                        fleet: fleetPolicy.extraKmRate,
                        step: "0.01",
                      },
                    ].map((field) => (
                      <label key={field.name} className="block min-w-0">
                        <span className="mb-1 block text-[10px] text-[color:var(--ink-soft)]">
                          {field.label}
                        </span>
                        <input
                          name={field.name}
                          type="number"
                          min="0"
                          step={field.step}
                          inputMode="decimal"
                          defaultValue={field.value ?? ""}
                          placeholder={directMessages.inheritPlaceholder(String(field.fleet))}
                          className="w-full rounded-md border border-[color:var(--line)] bg-white px-2 py-1.5 text-[12px] tabular-nums text-[color:var(--ink)]"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="block min-w-0">
                    <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">
                      {directMessages.rateLabel}
                    </span>
                    <input
                      name="bookingDailyRate"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      defaultValue={vehicle.bookingDailyRate ?? ""}
                      placeholder={
                        rate?.suggestedDailyRate ? String(rate.suggestedDailyRate) : "0.00"
                      }
                      className="w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] font-medium tabular-nums text-[color:var(--ink)]"
                    />
                    <span className="mt-1 block text-[10px] leading-4 text-[color:var(--ink-soft)]">
                      {!rate?.suggestedDailyRate
                        ? directMessages.rateHintNoModel
                        : rate.source === "manual"
                          ? directMessages.rateHintManual(
                              formatCurrency(rate.suggestedDailyRate, locale),
                            )
                          : directMessages.rateHintAuto(
                              formatCurrency(rate.suggestedDailyRate, locale),
                              formatCurrency(rate.suggestion?.dailyRate ?? 0, locale),
                            )}
                    </span>
                  </label>

                  <label className="block min-w-0">
                    <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">
                      {directMessages.insuranceLabel}
                    </span>
                    <input
                      name="bookingInsuranceFee"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      defaultValue={vehicle.bookingInsuranceFee ?? ""}
                      placeholder="0.00"
                      className="w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] font-medium tabular-nums text-[color:var(--ink)]"
                    />
                  </label>

                  <label className="block min-w-0">
                    <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">
                      {directMessages.depositLabel}
                    </span>
                    <input
                      name="bookingDepositAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      defaultValue={vehicle.bookingDepositAmount ?? ""}
                      placeholder="0.00"
                      className="w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] font-medium tabular-nums text-[color:var(--ink)]"
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">
                      {directMessages.taxNameLabel}
                    </span>
                    <input
                      name="bookingTaxName"
                      defaultValue={vehicle.bookingTaxName ?? ""}
                      placeholder="GST / PST / HST"
                      className="w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] font-medium text-[color:var(--ink)]"
                    />
                  </label>

                  <label className="block min-w-0">
                    <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">
                      {directMessages.taxRateLabel}
                    </span>
                    <input
                      name="bookingTaxRate"
                      type="number"
                      min="0"
                      max="100"
                      step="0.001"
                      inputMode="decimal"
                      defaultValue={vehicle.bookingTaxRate ?? ""}
                      placeholder="0"
                      className="w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] font-medium tabular-nums text-[color:var(--ink)]"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">
                    {directMessages.introLabel}
                  </span>
                  <textarea
                    name="bookingIntro"
                    rows={2}
                    defaultValue={vehicle.bookingIntro ?? ""}
                    placeholder={directMessages.introPlaceholder}
                    className="w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[12px] leading-5 text-[color:var(--ink)]"
                  />
                </label>

                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                    {directMessages.blockedDates}
                  </p>
                  {blockedWindows.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {blockedWindows.map((window) => (
                        <span
                          key={`${window.pickupDatetime.toISOString()}-${window.returnDatetime.toISOString()}`}
                          className="rounded-full border border-[rgba(17,19,24,0.08)] bg-[var(--surface-muted)] px-2 py-0.5 text-[10.5px] text-[color:var(--ink-soft)]"
                        >
                          {formatDate(window.pickupDatetime, locale)} - {formatDate(window.returnDatetime, locale)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-[color:var(--ink-soft)]">
                      {directMessages.blockedDatesEmpty}
                    </p>
                  )}
                </div>

                <button
                  className="w-full rounded-md bg-[var(--ink)] px-3 py-2 text-[12px] font-medium text-white shadow-[0_16px_30px_-24px_rgba(17,19,24,0.8)] transition hover:translate-y-[-1px]"
                  style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
                >
                  {directMessages.saveAction}
                </button>
              </form>
            </article>
          );
        })}
      </section>
    </div>
  );
}
