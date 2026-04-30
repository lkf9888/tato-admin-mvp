import { PublicBookingPanel } from "@/components/public-booking-panel";
import { getBlockedBookingWindows, getDateOnlyBookingWindows } from "@/lib/direct-booking";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getStripeSecretKey } from "@/lib/stripe";
import { getWorkspaceConnectSnapshot } from "@/lib/stripe-connect";
import { formatCurrency, formatDate } from "@/lib/utils";

function addDays(value: Date, amount: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function toDateInputValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

export default async function ReserveVehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const [{ vehicleId }, query, { locale, messages }] = await Promise.all([
    params,
    searchParams,
    getI18n(),
  ]);

  const reserveMessages = messages.reservePage;
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
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
  });

  if (!vehicle || !vehicle.directBookingEnabled || (vehicle.bookingDailyRate ?? 0) <= 0) {
    return (
      <main className="min-h-screen bg-[var(--page)] px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-4xl rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.92)] p-10 shadow-[0_30px_90px_rgba(17,19,24,0.08)]">
          <p className="text-[11px] uppercase tracking-[0.34em] text-[var(--ink-soft)]">
            {reserveMessages.heroKicker}
          </p>
          <h1 className="mt-4 font-serif text-[3.6rem] leading-none text-[var(--ink)]">
            {reserveMessages.unavailableTitle}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--ink-soft)]">
            {reserveMessages.unavailableCopy}
          </p>
        </div>
      </main>
    );
  }

  const blockedWindows = getBlockedBookingWindows(vehicle.orders, 6);
  const blockedDateWindows = getDateOnlyBookingWindows(vehicle.orders);
  const stripeReady = Boolean(getStripeSecretKey());
  const connectSnapshot = vehicle.workspaceId
    ? await getWorkspaceConnectSnapshot(vehicle.workspaceId)
    : null;
  const hostPayoutsReady = Boolean(
    connectSnapshot?.accountId && connectSnapshot.chargesEnabled,
  );
  const today = new Date();
  const defaultPickupDate = toDateInputValue(addDays(today, 1));
  const defaultReturnDate = toDateInputValue(addDays(today, 4));
  const checkoutState =
    query.checkout === "success" || query.checkout === "cancelled" || query.checkout === "error"
      ? query.checkout
      : "idle";

  return (
    <main className="min-h-screen bg-[var(--page)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[90rem] space-y-6">
        <section className="overflow-hidden rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.92)] shadow-[0_30px_90px_rgba(17,19,24,0.08)] lg:grid lg:grid-cols-[1.08fr_0.92fr]">
          <div className="relative overflow-hidden bg-[#111318] px-7 py-8 text-white sm:px-10 sm:py-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(255,127,102,0.22),transparent_28%),radial-gradient(circle_at_88%_12%,rgba(53,110,88,0.28),transparent_30%),linear-gradient(180deg,#171a20_0%,#12141a_58%,#090b12_100%)]" />
            <div className="relative">
              <p className="text-[11px] uppercase tracking-[0.42em] text-white/58">
                {reserveMessages.heroKicker}
              </p>
              <h1 className="mt-5 max-w-4xl font-serif text-[3.5rem] leading-[0.96] tracking-[-0.06em] sm:text-[4.4rem]">
                {vehicle.nickname}
              </h1>
              <p className="mt-3 text-sm uppercase tracking-[0.24em] text-white/56">
                {vehicle.plateNumber} · {vehicle.brand} {vehicle.model} {vehicle.year}
              </p>
              <p className="mt-8 max-w-2xl text-[15px] leading-7 text-white/76">
                {vehicle.bookingIntro?.trim() || reserveMessages.introFallback}
              </p>

              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/52">
                    {reserveMessages.rateLabel}
                  </p>
                  <p className="mt-3 text-[1.8rem] font-semibold text-white">
                    {formatCurrency(vehicle.bookingDailyRate, locale)}
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/52">
                    {reserveMessages.insuranceLabel}
                  </p>
                  <p className="mt-3 text-[1.8rem] font-semibold text-white">
                    {formatCurrency(vehicle.bookingInsuranceFee, locale)}
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/52">
                    {reserveMessages.depositLabel}
                  </p>
                  <p className="mt-3 text-[1.8rem] font-semibold text-white">
                    {formatCurrency(vehicle.bookingDepositAmount, locale)}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-4 backdrop-blur sm:max-w-sm">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/52">
                  {reserveMessages.ownerLabel}
                </p>
                <p className="mt-3 text-lg font-semibold text-white">
                  {vehicle.owner?.name ?? "TATO"}
                </p>
              </div>

              <div className="mt-10">
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/48">
                  {reserveMessages.blockedDates}
                </p>
                {blockedWindows.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {blockedWindows.map((window) => (
                      <span
                        key={`${window.pickupDatetime.toISOString()}-${window.returnDatetime.toISOString()}`}
                        className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-white/72"
                      >
                        {formatDate(window.pickupDatetime, locale)} - {formatDate(window.returnDatetime, locale)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-white/64">{reserveMessages.blockedDatesEmpty}</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-[rgba(255,255,255,0.68)] p-5 sm:p-7 lg:p-8">
            <PublicBookingPanel
              locale={locale}
              vehicleId={vehicle.id}
              bookingDailyRate={vehicle.bookingDailyRate ?? 0}
              bookingInsuranceFee={vehicle.bookingInsuranceFee ?? 0}
              bookingDepositAmount={vehicle.bookingDepositAmount ?? 0}
              blockedDateWindows={blockedDateWindows}
              stripeReady={stripeReady}
              hostPayoutsReady={hostPayoutsReady}
              defaultPickupDate={defaultPickupDate}
              defaultReturnDate={defaultReturnDate}
              checkoutState={checkoutState}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
