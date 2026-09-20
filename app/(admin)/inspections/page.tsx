import Link from "next/link";

import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { outstandingInspections, shotFlags, type DueState } from "@/lib/inspection-review";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The condition-photo review page.
 *
 * Two lists, and the order matters. What is *missing* goes first: a trip whose
 * 24-hour window is closing with no photographs is money leaving the building,
 * and it is invisible unless something puts it on a screen. The archive of what
 * was shot comes second -- it is only consulted when there is already a dispute.
 */
export default async function InspectionsPage() {
  const workspace = await requireCurrentWorkspace();
  const [{ messages, locale }, due, sessions] = await Promise.all([
    getI18n(),
    outstandingInspections(workspace.id),
    prisma.inspectionSession.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: {
        vehicle: { select: { plateNumber: true, nickname: true } },
        shots: { where: { accepted: true } },
      },
    }),
  ]);
  const t = messages.inspections;

  const stateLabel: Record<DueState, string> = {
    expired: t.dueExpired,
    due: t.dueNow,
    upcoming: t.dueUpcoming,
  };
  const stateStyle: Record<DueState, string> = {
    expired: "bg-red-50 text-red-700 ring-red-200",
    due: "bg-amber-50 text-amber-800 ring-amber-200",
    upcoming: "bg-slate-50 text-slate-600 ring-slate-200",
  };

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">{t.title}</h1>
        <p className="max-w-3xl text-sm text-slate-600">{t.subtitle}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-900">{t.dueTitle}</h2>
        {due.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">{t.dueEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {due.map((item) => {
              const hours = Math.abs(Math.round(item.hoursLeft));
              return (
                <li
                  key={`${item.orderId}-${item.kind}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4"
                >
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${stateStyle[item.state]}`}
                  >
                    {stateLabel[item.state]}
                  </span>
                  <span className="font-medium text-slate-900">{item.plateNumber}</span>
                  <span className="text-sm text-slate-600">
                    {item.kind === "checkout" ? t.checkout : t.checkin} · {formatDateTime(item.moment, locale)}
                  </span>
                  <span className="text-sm text-slate-500">{item.renterName}</span>
                  <span className="ml-auto text-sm font-medium text-slate-700">
                    {item.state === "expired"
                      ? t.hoursOver.replace("{hours}", String(hours))
                      : t.hoursLeft.replace("{hours}", String(hours))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {due.some((item) => item.state === "expired") ? (
          <p className="text-xs text-red-700">{t.expiredHelp}</p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-900">{t.sessionsTitle}</h2>
        {sessions.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">{t.sessionsEmpty}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t.vehicle}</th>
                  <th className="px-4 py-3">{t.when}</th>
                  <th className="px-4 py-3">{t.staff}</th>
                  <th className="px-4 py-3">{t.shots}</th>
                  <th className="px-4 py-3">{t.status}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.map((session) => {
                  const expected = (session.expectedSlotIds as string[]) ?? [];
                  // Counted from the stored rows rather than from a column, so
                  // the number on screen is the number of files that exist.
                  const flagged = session.shots.filter((shot) => shotFlags(shot).length > 0).length;
                  return (
                    <tr key={session.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {session.vehicle?.plateNumber ?? session.vehicleLabel}
                        </div>
                        <div className="text-xs text-slate-500">
                          {session.kind === "checkout" ? t.checkout : t.checkin}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatDateTime(session.startedAt, locale)}</td>
                      <td className="px-4 py-3 text-slate-600">{session.staffLabel}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {session.shots.length} / {expected.length}
                      </td>
                      <td className="px-4 py-3">
                        {!session.completedAt ? (
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                            {t.incomplete}
                          </span>
                        ) : flagged > 0 ? (
                          <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-800 ring-1 ring-inset ring-orange-200">
                            {flagged}
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
                            {t.flagsNone}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/inspections/${session.id}`}
                          className="text-sm font-medium text-blue-600 hover:underline"
                        >
                          {t.openSession}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
