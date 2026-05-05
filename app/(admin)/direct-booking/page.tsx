import Link from "next/link";
import { headers } from "next/headers";

import { saveVehicleDirectBookingAction } from "@/app/actions";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getBlockedBookingWindows } from "@/lib/direct-booking";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getAppUrl, getStripeSecretKey } from "@/lib/stripe";
import { formatDate } from "@/lib/utils";

export default async function DirectBookingPage() {
  const workspace = await requireCurrentWorkspace();
  const [headerStore, { locale, messages }, vehicles] = await Promise.all([
    headers(),
    getI18n(),
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
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-white/80 px-3 py-2.5 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
              {directMessages.enabledCount}
            </p>
            <p className="mt-1.5 text-[1.35rem] font-semibold text-[color:var(--ink)]">{enabledCount}</p>
          </div>
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-white/80 px-3 py-2.5 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
              {directMessages.readyCount}
            </p>
            <p className="mt-1.5 text-[1.35rem] font-semibold text-[color:var(--ink)]">{readyCount}</p>
          </div>
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-white/80 px-3 py-2.5 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
              {directMessages.stripeStatus}
            </p>
            <p className="mt-1.5 text-[1.35rem] font-semibold text-[color:var(--ink)]">
              {stripeReady ? directMessages.stripeReady : directMessages.stripeMissing}
            </p>
          </div>
        </div>
      </section>

      {vehicles.length === 0 ? (
        <section className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-4 py-5 text-[12px] text-[color:var(--ink-soft)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
          {directMessages.emptyState}
        </section>
      ) : null}

      <section className="grid gap-2.5 xl:grid-cols-2 2xl:grid-cols-3">
        {vehicles.map((vehicle) => {
          const shareUrl = `${appUrl}/reserve/${vehicle.id}`;
          const blockedWindows = getBlockedBookingWindows(vehicle.orders, 4);
          const hasDailyRate = (vehicle.bookingDailyRate ?? 0) > 0;
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
                          : "border border-slate-900/8 bg-slate-200 text-slate-700"
                      }`}
                    >
                      {isLive ? directMessages.liveLabel : directMessages.draftLabel}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[color:var(--ink-soft)]">
                    {vehicle.brand} {vehicle.model} · {vehicle.year} · {directMessages.ownerLabel}:{" "}
                    {vehicle.owner?.name ?? directMessages.noOwner}
                  </p>
                </div>
                <Link
                  href={shareUrl}
                  target="_blank"
                  className="inline-flex shrink-0 items-center rounded-full bg-[var(--ink)] px-3 py-1.5 text-[11px] font-medium text-white shadow-[0_16px_30px_-24px_rgba(17,19,24,0.8)] transition hover:translate-y-[-1px]"
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
                      placeholder="0.00"
                      className="w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] font-medium tabular-nums text-[color:var(--ink)]"
                    />
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
                  className="w-full rounded-full bg-[var(--ink)] px-3 py-2 text-[12px] font-medium text-white shadow-[0_16px_30px_-24px_rgba(17,19,24,0.8)] transition hover:translate-y-[-1px]"
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
