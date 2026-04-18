import Link from "next/link";
import { headers } from "next/headers";

import { saveVehicleDirectBookingAction } from "@/app/actions";
import { getBlockedBookingWindows } from "@/lib/direct-booking";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getAppUrl, getStripeSecretKey } from "@/lib/stripe";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function DirectBookingPage() {
  const [headerStore, { locale, messages }, vehicles] = await Promise.all([
    headers(),
    getI18n(),
    prisma.vehicle.findMany({
      include: {
        owner: true,
        orders: {
          where: {
            status: {
              not: "cancelled",
            },
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
  const readyCount = vehicles.filter(
    (vehicle) => vehicle.directBookingEnabled && (vehicle.bookingDailyRate ?? 0) > 0,
  ).length;
  const stripeReady = Boolean(getStripeSecretKey());

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[2rem] border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.94),rgba(255,240,231,0.97))] p-6 shadow-[0_24px_60px_-42px_rgba(17,19,24,0.45)]">
        <p className="text-xs uppercase tracking-[0.32em] text-[color:var(--ink-soft)]">
          {directMessages.kicker}
        </p>
        <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-4xl">
            <h2 className="font-serif text-[2.3rem] leading-tight text-[color:var(--ink)]">
              {directMessages.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-[color:var(--ink-soft)]">
              {directMessages.copy}
            </p>
          </div>
          <div className="rounded-full border border-[rgba(17,19,24,0.08)] bg-white/78 px-4 py-2 text-xs text-[color:var(--ink-soft)] shadow-[0_12px_24px_-24px_rgba(17,19,24,0.55)]">
            {stripeReady ? directMessages.stripeReady : directMessages.stripeMissing}
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-[1.6rem] border border-[rgba(17,19,24,0.06)] bg-white/80 px-5 py-4 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
              {directMessages.enabledCount}
            </p>
            <p className="mt-3 text-[2rem] font-semibold text-[color:var(--ink)]">{enabledCount}</p>
          </div>
          <div className="rounded-[1.6rem] border border-[rgba(17,19,24,0.06)] bg-white/80 px-5 py-4 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
              {directMessages.readyCount}
            </p>
            <p className="mt-3 text-[2rem] font-semibold text-[color:var(--ink)]">{readyCount}</p>
          </div>
          <div className="rounded-[1.6rem] border border-[rgba(17,19,24,0.06)] bg-white/80 px-5 py-4 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
              {directMessages.stripeStatus}
            </p>
            <p className="mt-3 text-[2rem] font-semibold text-[color:var(--ink)]">
              {stripeReady ? directMessages.stripeReady : directMessages.stripeMissing}
            </p>
          </div>
        </div>
      </section>

      {vehicles.length === 0 ? (
        <section className="rounded-[2rem] border border-[color:var(--line)] bg-[rgba(255,251,245,0.88)] px-6 py-8 text-sm text-[color:var(--ink-soft)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
          {directMessages.emptyState}
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-2">
        {vehicles.map((vehicle) => {
          const shareUrl = `${appUrl}/reserve/${vehicle.id}`;
          const blockedWindows = getBlockedBookingWindows(vehicle.orders, 4);
          const hasDailyRate = (vehicle.bookingDailyRate ?? 0) > 0;

          return (
            <article
              key={vehicle.id}
              className="overflow-hidden rounded-[2rem] border border-[color:var(--line)] bg-[rgba(255,251,245,0.88)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]"
            >
              <div className="border-b border-[color:var(--line)] bg-[linear-gradient(180deg,rgba(255,252,247,0.98),rgba(255,244,236,0.96))] px-5 py-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-serif text-[2rem] leading-tight text-[color:var(--ink)]">
                        {vehicle.plateNumber} · {vehicle.nickname}
                      </h3>
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold tracking-[0.08em] ${
                          vehicle.directBookingEnabled && hasDailyRate
                            ? "border border-[rgba(255,107,87,0.18)] bg-[var(--accent-soft)] text-[var(--ink)]"
                            : "border border-slate-900/8 bg-slate-200 text-slate-700"
                        }`}
                      >
                        {vehicle.directBookingEnabled && hasDailyRate
                          ? directMessages.liveLabel
                          : directMessages.draftLabel}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[color:var(--ink-soft)]">
                      {vehicle.brand} {vehicle.model} · {vehicle.year}
                    </p>
                    <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
                      {directMessages.ownerLabel}: {vehicle.owner?.name ?? directMessages.noOwner}
                    </p>
                  </div>

                  <div className="rounded-[1.2rem] bg-white/80 px-4 py-3 text-right shadow-[0_12px_24px_-24px_rgba(17,19,24,0.5)]">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {directMessages.pricingSummary(
                        formatCurrency(vehicle.bookingDailyRate, locale),
                        formatCurrency(vehicle.bookingInsuranceFee, locale),
                      )}
                    </p>
                    <p className="mt-2 text-sm text-[color:var(--ink-soft)]">
                      {vehicle.directBookingEnabled && hasDailyRate
                        ? directMessages.shareHintEnabled
                        : directMessages.shareHintDraft}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 px-5 py-5 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-4">
                  <div className="rounded-[1.5rem] border border-[rgba(17,19,24,0.06)] bg-white/78 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                      {directMessages.shareLinkLabel}
                    </p>
                    <input
                      readOnly
                      value={shareUrl}
                      className="mt-3 w-full rounded-[1.15rem] border border-[color:var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--ink)]"
                    />
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Link
                        href={shareUrl}
                        target="_blank"
                        className="inline-flex items-center rounded-full bg-[var(--ink)] px-4 py-2.5 text-sm font-medium text-white shadow-[0_16px_30px_-24px_rgba(17,19,24,0.8)] transition hover:translate-y-[-1px]"
                        style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
                      >
                        {directMessages.openPreview}
                      </Link>
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border border-[rgba(17,19,24,0.06)] bg-white/78 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                      {directMessages.blockedDates}
                    </p>
                    {blockedWindows.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {blockedWindows.map((window) => (
                          <span
                            key={`${window.pickupDatetime.toISOString()}-${window.returnDatetime.toISOString()}`}
                            className="rounded-full border border-[rgba(17,19,24,0.08)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[color:var(--ink-soft)]"
                          >
                            {formatDate(window.pickupDatetime, locale)} - {formatDate(window.returnDatetime, locale)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-[color:var(--ink-soft)]">
                        {directMessages.blockedDatesEmpty}
                      </p>
                    )}
                  </div>
                </div>

                <form action={saveVehicleDirectBookingAction} className="space-y-4 rounded-[1.5rem] border border-[rgba(17,19,24,0.06)] bg-white/78 p-4">
                  <input type="hidden" name="id" value={vehicle.id} />

                  <label className="flex items-center justify-between gap-4 rounded-[1.2rem] border border-[color:var(--line)] bg-[var(--surface-muted)] px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-[color:var(--ink)]">
                        {directMessages.enableLabel}
                      </p>
                      {!hasDailyRate ? (
                        <p className="mt-1 text-xs text-[color:var(--ink-soft)]">
                          {directMessages.pricingMissing}
                        </p>
                      ) : null}
                    </div>
                    <input
                      type="checkbox"
                      name="directBookingEnabled"
                      defaultChecked={vehicle.directBookingEnabled}
                      className="h-5 w-5 rounded border-[color:var(--line)]"
                    />
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-[color:var(--ink)]">
                        {directMessages.rateLabel}
                      </span>
                      <input
                        name="bookingDailyRate"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={vehicle.bookingDailyRate ?? ""}
                        className="w-full rounded-[1.1rem] border border-[color:var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--ink)]"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-[color:var(--ink)]">
                        {directMessages.insuranceLabel}
                      </span>
                      <input
                        name="bookingInsuranceFee"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={vehicle.bookingInsuranceFee ?? ""}
                        className="w-full rounded-[1.1rem] border border-[color:var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--ink)]"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-[color:var(--ink)]">
                      {directMessages.introLabel}
                    </span>
                    <textarea
                      name="bookingIntro"
                      rows={4}
                      defaultValue={vehicle.bookingIntro ?? ""}
                      placeholder={directMessages.introPlaceholder}
                      className="w-full rounded-[1.2rem] border border-[color:var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[color:var(--ink)]"
                    />
                  </label>

                  <button
                    className="w-full rounded-full bg-[var(--ink)] px-4 py-3 text-sm font-medium text-white shadow-[0_16px_30px_-24px_rgba(17,19,24,0.8)] transition hover:translate-y-[-1px]"
                    style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
                  >
                    {directMessages.saveAction}
                  </button>
                </form>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
