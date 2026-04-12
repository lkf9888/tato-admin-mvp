import { unlockShareLinkAction } from "@/app/actions";
import { CalendarView } from "@/components/calendar-view";
import { hasShareAccess } from "@/lib/auth";
import { getStatusLabel } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getDisplayOrderNote, getOrderNetEarning } from "@/lib/utils";

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ token }, query, { locale, messages }] = await Promise.all([params, searchParams, getI18n()]);
  const shareMessages = messages.sharePage;

  const shareLink = await prisma.shareLink.findUnique({
    where: { token },
    include: {
      owner: {
        include: {
          vehicles: {
            include: {
              orders: true,
            },
          },
        },
      },
    },
  });

  if (!shareLink || !shareLink.isActive) {
    return (
      <main className="min-h-screen bg-[var(--page)] px-4 py-10">
        <div className="mx-auto max-w-xl rounded-[2rem] bg-white p-8 shadow-sm">
          <h1 className="font-serif text-4xl text-slate-950">{shareMessages.unavailableTitle}</h1>
          <p className="mt-4 text-sm text-slate-600">{shareMessages.unavailableCopy}</p>
        </div>
      </main>
    );
  }

  if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
    return (
      <main className="min-h-screen bg-[var(--page)] px-4 py-10">
        <div className="mx-auto max-w-xl rounded-[2rem] bg-white p-8 shadow-sm">
          <h1 className="font-serif text-4xl text-slate-950">{shareMessages.expiredTitle}</h1>
          <p className="mt-4 text-sm text-slate-600">{shareMessages.expiredCopy}</p>
        </div>
      </main>
    );
  }

  const unlocked = shareLink.passwordHash ? await hasShareAccess(token) : true;

  if (shareLink.passwordHash && !unlocked) {
    return (
      <main className="min-h-screen bg-[var(--page)] px-4 py-10">
        <div className="mx-auto max-w-xl rounded-[2rem] bg-white p-8 shadow-sm">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">
            {shareMessages.ownerCalendarKicker}
          </p>
          <h1 className="mt-3 font-serif text-4xl text-slate-950">{shareLink.owner.name}</h1>
          <p className="mt-3 text-sm text-slate-600">{shareMessages.passwordProtectedCopy}</p>

          <form action={unlockShareLinkAction} className="mt-8 space-y-4">
            <input type="hidden" name="token" value={token} />
            <input
              name="password"
              type="password"
              placeholder={shareMessages.sharePassword}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none"
            />
            {query.error ? (
              <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {shareMessages.incorrectPassword}
              </p>
            ) : null}
            <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 font-medium text-white">
              {shareMessages.unlockCalendar}
            </button>
          </form>
        </div>
      </main>
    );
  }

  const vehicles = [...shareLink.owner.vehicles].sort((left, right) =>
    left.plateNumber.localeCompare(right.plateNumber),
  );
  const orders = vehicles.flatMap((vehicle) =>
    vehicle.orders.map((order) => ({
      id: order.id,
      source: order.source,
      status: order.status,
      hasConflict: order.hasConflict,
      vehicleId: vehicle.id,
      vehicleName: vehicle.nickname,
      vehiclePlateNumber: vehicle.plateNumber,
      ownerId: shareLink.owner.id,
      ownerName: shareLink.owner.name,
      renterName: order.renterName,
      renterPhone: order.renterPhone,
      pickupDatetime: order.pickupDatetime.toISOString(),
      returnDatetime: order.returnDatetime.toISOString(),
      totalPrice: getOrderNetEarning(order.sourceMetadata, order.totalPrice),
      notes:
        shareLink.visibility === "privacy"
          ? messages.calendar.bookingLabel(getStatusLabel(order.source, locale))
          : getDisplayOrderNote(order.notes, order.source),
    })),
  );

  return (
    <main className="min-h-screen bg-[var(--page)] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <section className="overflow-hidden rounded-[2rem] border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.92),rgba(255,244,236,0.96))] px-6 py-8 shadow-[0_24px_60px_-42px_rgba(17,19,24,0.45)]">
          <p className="text-xs uppercase tracking-[0.35em] text-[color:var(--ink-soft)]">
            {shareMessages.readOnlyKicker}
          </p>
          <h1 className="mt-3 font-serif text-5xl text-[color:var(--ink)]">{shareLink.owner.name}</h1>
          <p className="mt-3 max-w-3xl text-sm text-[color:var(--ink-soft)]">{shareMessages.readOnlyCopy}</p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm text-[color:var(--ink-soft)]">
            {vehicles.map((vehicle) => (
              <span key={vehicle.id} className="rounded-full bg-white/76 px-4 py-2 shadow-[0_12px_28px_-24px_rgba(17,19,24,0.45)]">
                {vehicle.nickname}
              </span>
            ))}
          </div>
        </section>

        <CalendarView
          locale={locale}
          readOnly
          maskSensitive={shareLink.visibility === "privacy"}
          vehicleOptions={vehicles.map((vehicle) => ({
            id: vehicle.id,
            label: vehicle.nickname,
            plateNumber: vehicle.plateNumber,
            secondaryLabel: `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
            ownerId: shareLink.owner.id,
            ownerName: shareLink.owner.name,
          }))}
          ownerOptions={[{ id: shareLink.owner.id, label: shareLink.owner.name }]}
          orders={orders}
        />
      </div>
    </main>
  );
}
