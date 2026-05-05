import {
  assignOwnerVehiclesAction,
  createShareLinkAction,
  deleteOwnerAction,
  saveOwnerAction,
} from "@/app/actions";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";

export default async function OwnersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const workspace = await requireCurrentWorkspace();
  const [{ messages }, owners, allVehicles, params] = await Promise.all([
    getI18n(),
    prisma.owner.findMany({
      where: { workspaceId: workspace.id },
      include: {
        vehicles: { orderBy: [{ plateNumber: "asc" }, { nickname: "asc" }] },
        shareLinks: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      include: { owner: true },
      orderBy: [{ plateNumber: "asc" }, { nickname: "asc" }],
    }),
    searchParams,
  ]);

  const ownerMessages = messages.owners;

  return (
    <div className="space-y-2.5">
      {params.error ? (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-[12px] text-amber-700">
          {ownerMessages.deleteError}
        </div>
      ) : null}

      {/* Same `<details>` collapse pattern as Orders / Vehicles —
       * the create form is rarely used per visit, so it shouldn't
       * occupy half the page height on a phone. */}
      <details className="group overflow-hidden rounded-lg border border-white/70 bg-white/90 shadow-sm">
        <summary className="tap-press flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-3 sm:px-4 sm:py-3.5">
          <p className="text-[9px] uppercase tracking-[0.22em] text-slate-500 sm:text-[10px] sm:tracking-[0.24em]">
            {ownerMessages.createKicker}
          </p>
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition group-open:rotate-45 group-open:bg-slate-950 group-open:text-white"
          >
            <span className="text-lg leading-none">+</span>
          </span>
        </summary>
        <form action={saveOwnerAction} className="grid gap-2 border-t border-slate-200 px-3 py-3 text-[12px] sm:gap-2.5 sm:px-4 sm:py-3.5 md:grid-cols-2 xl:grid-cols-4">
          <input
            name="name"
            placeholder={ownerMessages.placeholders.name}
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
          />
          <input
            name="phone"
            placeholder={ownerMessages.placeholders.phone}
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
          />
          <input
            name="email"
            placeholder={ownerMessages.placeholders.email}
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
          />
          <input
            name="companyName"
            placeholder={ownerMessages.placeholders.company}
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
          />
          <input
            name="notes"
            placeholder={ownerMessages.placeholders.notes}
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 xl:col-span-4"
          />
          <button className="rounded-md bg-slate-950 px-3 py-2 font-medium text-white xl:col-span-1">
            {ownerMessages.addOwner}
          </button>
        </form>
      </details>

      <section className="grid gap-2.5 sm:gap-3 xl:grid-cols-2 2xl:grid-cols-3">
        {owners.map((owner) => {
          const activeShareLinks = owner.shareLinks.filter((shareLink) => shareLink.isActive);

          return (
            <article key={owner.id} className="rounded-lg border border-white/70 bg-white/90 p-3 shadow-sm sm:p-3.5">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <h3 className="font-serif text-[0.95rem] font-semibold leading-tight text-slate-950 sm:text-[1.05rem] lg:text-[1.1rem]">{owner.name}</h3>
                <p className="mt-1 text-[11px] leading-snug text-slate-500 sm:text-[12px]">
                  {owner.email || ownerMessages.noEmail} · {owner.phone || ownerMessages.noPhone}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-500 sm:text-[12px]">
                  {owner.companyName || ownerMessages.personalOwner} ·{" "}
                  {ownerMessages.vehicleCount(owner.vehicles.length)}
                </p>
              </div>
              <div className="self-start rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {ownerMessages.activeLinks(
                  owner.shareLinks.filter((shareLink) => shareLink.isActive).length,
                )}
              </div>
            </div>

            <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5">
              <summary className="cursor-pointer text-[12px] font-medium text-slate-700">
                {ownerMessages.editOwner}
              </summary>
              <form action={saveOwnerAction} className="mt-3 grid gap-2 text-[12px] md:grid-cols-2">
                <input type="hidden" name="id" value={owner.id} />
                <input
                  name="name"
                  defaultValue={owner.name}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2"
                />
                <input
                  name="phone"
                  defaultValue={owner.phone ?? ""}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2"
                />
                <input
                  name="email"
                  defaultValue={owner.email ?? ""}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2"
                />
                <input
                  name="companyName"
                  defaultValue={owner.companyName ?? ""}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2"
                />
                <input
                  name="notes"
                  defaultValue={owner.notes ?? ""}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 md:col-span-2"
                />
                <button className="rounded-md bg-slate-950 px-3 py-2 font-medium text-white md:col-span-2">
                  {ownerMessages.saveChanges}
                </button>
              </form>

              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="flex flex-col gap-1">
                  <p className="text-[12px] font-semibold text-slate-800">
                    {ownerMessages.vehicleAssignmentTitle}
                  </p>
                  <p className="text-[11px] leading-4 text-slate-500">
                    {ownerMessages.vehicleAssignmentHint}
                  </p>
                </div>

                <form action={assignOwnerVehiclesAction} className="mt-2.5 space-y-2.5">
                  <input type="hidden" name="ownerId" value={owner.id} />
                  {allVehicles.length === 0 ? (
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-500">
                      {ownerMessages.noVehicles}
                    </div>
                  ) : (
                    <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-md border border-slate-200 bg-white p-2">
                      {allVehicles.map((vehicle) => {
                        const assignedElsewhere = vehicle.ownerId && vehicle.ownerId !== owner.id;

                        return (
                          <label
                            key={vehicle.id}
                            className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-700"
                          >
                            <input
                              type="checkbox"
                              name="vehicleIds"
                              value={vehicle.id}
                              defaultChecked={vehicle.ownerId === owner.id}
                              className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                            />
                            <span className="min-w-0">
                              <span className="block font-semibold text-slate-900">
                                {vehicle.plateNumber} · {vehicle.nickname}
                              </span>
                              <span className="block text-[10.5px] text-slate-500">
                                {vehicle.brand} {vehicle.model} {vehicle.year}
                                {assignedElsewhere && vehicle.owner
                                  ? ` · ${ownerMessages.assignedTo(vehicle.owner.name)}`
                                  : ""}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <button className="rounded-md bg-slate-950 px-3 py-2 text-[12px] font-medium text-white">
                    {ownerMessages.saveVehicleAssignments}
                  </button>
                </form>
              </div>

              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="flex flex-col gap-1">
                  <p className="text-[12px] font-semibold text-slate-800">
                    {ownerMessages.shareLinkTitle}
                  </p>
                  <p className="text-[11px] leading-4 text-slate-500">
                    {ownerMessages.shareLinkHint}
                  </p>
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {activeShareLinks.length > 0 ? (
                    activeShareLinks.map((shareLink) => (
                      <a
                        key={shareLink.id}
                        href={`/share/${shareLink.token}`}
                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700"
                      >
                        {ownerMessages.openShareLink}
                      </a>
                    ))
                  ) : (
                    <p className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-500">
                      {ownerMessages.noShareLinks}
                    </p>
                  )}
                </div>

                <form action={createShareLinkAction} className="mt-2.5">
                  <input type="hidden" name="ownerId" value={owner.id} />
                  <input type="hidden" name="visibility" value="standard" />
                  <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700">
                    {ownerMessages.createShareLink}
                  </button>
                </form>
              </div>
            </details>

            <div className="mt-3 text-[12px] text-slate-500">
              {ownerMessages.vehiclesPrefix}:{" "}
              {owner.vehicles.map((vehicle) => vehicle.nickname).join(", ") || ownerMessages.noVehicles}
            </div>

            <form action={deleteOwnerAction} className="mt-3">
              <input type="hidden" name="id" value={owner.id} />
              <button className="text-[12px] font-medium text-rose-600">
                {ownerMessages.deleteOwner}
              </button>
            </form>
          </article>
          );
        })}
      </section>
    </div>
  );
}
