import { unlockShareLinkAction } from "@/app/actions";
import { OwnerPublicShareView } from "@/components/owner-public-share-view";
import { hasShareAccess } from "@/lib/auth";
import { getMessages, getStatusLabel, resolveLocale, type Locale } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getDisplayOrderNote, getOrderNetEarning } from "@/lib/utils";

type ShareTab = "ledger" | "statements" | "calendar";

function resolveShareTab(value?: string | null): ShareTab {
  if (value === "statements" || value === "calendar") return value;
  return "ledger";
}

function shareMessagesFor(locale: Locale) {
  return getMessages(locale).sharePage;
}

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; tab?: string; lang?: string }>;
}) {
  const [{ token }, query, fallbackI18n] = await Promise.all([params, searchParams, getI18n()]);
  const locale = query.lang ? resolveLocale(query.lang) : fallbackI18n.locale;
  const messages = query.lang ? getMessages(locale) : fallbackI18n.messages;
  const shareMessages = shareMessagesFor(locale);

  const shareLink = await prisma.shareLink.findUnique({
    where: { token },
    include: {
      // The owner's agreement is with this company, so its name is what
      // belongs on their statement -- not the software's.
      workspace: { select: { name: true } },
      owner: {
        include: {
          vehicles: {
            orderBy: [{ plateNumber: "asc" }, { nickname: "asc" }],
            include: {
              orders: {
                where: {
                  isArchived: false,
                  status: {
                    not: "cancelled",
                  },
                  ownerLedgerSyncedAt: {
                    not: null,
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!shareLink || !shareLink.isActive) {
    return (
      <main className="min-h-screen bg-[var(--page)] px-4 py-10">
        <div className="mx-auto max-w-xl rounded-lg bg-white p-8">
          <h1 className="font-serif text-4xl text-[var(--ink)]">{shareMessages.unavailableTitle}</h1>
          <p className="mt-4 text-sm text-[var(--ink-mid)]">{shareMessages.unavailableCopy}</p>
        </div>
      </main>
    );
  }

  if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
    return (
      <main className="min-h-screen bg-[var(--page)] px-4 py-10">
        <div className="mx-auto max-w-xl rounded-lg bg-white p-8">
          <h1 className="font-serif text-4xl text-[var(--ink)]">{shareMessages.expiredTitle}</h1>
          <p className="mt-4 text-sm text-[var(--ink-mid)]">{shareMessages.expiredCopy}</p>
        </div>
      </main>
    );
  }

  const unlocked = shareLink.passwordHash
    ? await hasShareAccess(token, shareLink.passwordHash)
    : true;

  if (shareLink.passwordHash && !unlocked) {
    return (
      <main className="min-h-screen bg-[var(--page)] px-4 py-10">
        <div className="mx-auto max-w-xl rounded-lg bg-white p-8">
          <p className="text-xs uppercase tracking-[0.35em] text-[var(--ink-soft)]">
            {shareMessages.ownerCalendarKicker}
          </p>
          <h1 className="mt-3 font-serif text-4xl text-[var(--ink)]">{shareLink.owner.name}</h1>
          <p className="mt-3 text-sm text-[var(--ink-mid)]">{shareMessages.passwordProtectedCopy}</p>

          <form action={unlockShareLinkAction} className="mt-8 space-y-4">
            <input type="hidden" name="token" value={token} />
            <input
              name="password"
              type="password"
              placeholder={shareMessages.sharePassword}
              className="w-full rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 outline-none"
            />
            {query.error === "throttled" ? (
              <p className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {shareMessages.tooManyAttempts}
              </p>
            ) : query.error ? (
              <p className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {shareMessages.incorrectPassword}
              </p>
            ) : null}
            <button className="w-full rounded-md bg-[var(--ink)] px-4 py-3 font-medium text-white">
              {shareMessages.unlockCalendar}
            </button>
          </form>
        </div>
      </main>
    );
  }

  const ledgerItems = await prisma.ownerLedgerItem.findMany({
    where: {
      workspaceId: shareLink.workspaceId,
      ownerId: shareLink.owner.id,
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    include: {
      receipts: { orderBy: { uploadedAt: "asc" } },
      vehicle: {
        select: {
          id: true,
          plateNumber: true,
          nickname: true,
        },
      },
      order: {
        select: {
          id: true,
          renterName: true,
          pickupDatetime: true,
          returnDatetime: true,
        },
      },
    },
  });

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
      depositAmount: order.depositAmount,
      pickupLocation: order.pickupLocation,
      returnLocation: order.returnLocation,
      paymentMethod: order.paymentMethod,
      contractNumber: order.contractNumber,
      externalOrderId: order.externalOrderId,
      ownerLedgerSyncedAt: order.ownerLedgerSyncedAt?.toISOString() ?? null,
      notes:
        shareLink.visibility === "privacy"
          ? messages.calendar.bookingLabel(getStatusLabel(order.source, locale))
          : getDisplayOrderNote(order.notes, order.source),
      createdBy: order.createdBy,
    })),
  );

  return (
    <OwnerPublicShareView
      locale={locale}
      owner={{ id: shareLink.owner.id, name: shareLink.owner.name }}
      vehicles={vehicles.map((vehicle) => ({
        id: vehicle.id,
        label: vehicle.nickname,
        plateNumber: vehicle.plateNumber,
        secondaryLabel: `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
      }))}
      ledgerItems={ledgerItems.map((item) => ({
        id: item.id,
        kind: item.kind,
        amount: item.amount,
        occurredAt: item.occurredAt.toISOString(),
        createdAt: item.createdAt.toISOString(),
        note: item.note,
        isAuto: item.isAuto,
        receipts: item.receipts.map((receipt) => ({
          id: receipt.id,
          url: `/api/share/${token}/ledger/${item.id}/receipts/file?receiptId=${receipt.id}`,
          filename: receipt.filename,
          contentType: receipt.contentType,
          size: receipt.size,
          uploadedAt: receipt.uploadedAt.toISOString(),
        })),
        vehicle: item.vehicle,
        order: item.order
          ? {
              id: item.order.id,
              renterName: item.order.renterName,
              pickupDatetime: item.order.pickupDatetime.toISOString(),
              returnDatetime: item.order.returnDatetime.toISOString(),
            }
          : null,
      }))}
      calendarOrders={orders}
      activeTab={resolveShareTab(query.tab)}
      operatorName={shareLink.workspace?.name?.trim() || "TATO"}
      maskSensitive={shareLink.visibility === "privacy"}
    />
  );
}
