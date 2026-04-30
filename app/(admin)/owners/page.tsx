import { deleteOwnerAction, saveOwnerAction } from "@/app/actions";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";

export default async function OwnersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const workspace = await requireCurrentWorkspace();
  const [{ messages }, owners, params] = await Promise.all([
    getI18n(),
    prisma.owner.findMany({
      where: { workspaceId: workspace.id },
      include: { vehicles: true, shareLinks: true },
      orderBy: { createdAt: "desc" },
    }),
    searchParams,
  ]);

  const ownerMessages = messages.owners;

  return (
    <div className="space-y-4 lg:space-y-3.5">
      {params.error ? (
        <div className="rounded-lg bg-amber-50 px-5 py-4 text-sm text-amber-700">
          {ownerMessages.deleteError}
        </div>
      ) : null}

      {/* Same `<details>` collapse pattern as Orders / Vehicles —
       * the create form is rarely used per visit, so it shouldn't
       * occupy half the page height on a phone. */}
      <details className="group overflow-hidden rounded-lg border border-white/70 bg-white/90 shadow-sm">
        <summary className="tap-press flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500 sm:text-xs sm:tracking-[0.25em]">
            {ownerMessages.createKicker}
          </p>
          <span
            aria-hidden
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition group-open:rotate-45 group-open:bg-slate-950 group-open:text-white"
          >
            <span className="text-xl leading-none">+</span>
          </span>
        </summary>
        <form action={saveOwnerAction} className="grid gap-3 border-t border-slate-200 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5 md:grid-cols-2 xl:grid-cols-4">
          <input
            name="name"
            placeholder={ownerMessages.placeholders.name}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="phone"
            placeholder={ownerMessages.placeholders.phone}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="email"
            placeholder={ownerMessages.placeholders.email}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="companyName"
            placeholder={ownerMessages.placeholders.company}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="notes"
            placeholder={ownerMessages.placeholders.notes}
            className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 xl:col-span-4"
          />
          <button className="rounded-md bg-slate-950 px-4 py-3 font-medium text-white xl:col-span-1">
            {ownerMessages.addOwner}
          </button>
        </form>
      </details>

      <section className="grid gap-3 sm:gap-4 xl:grid-cols-2">
        {owners.map((owner) => (
          <article key={owner.id} className="rounded-lg border border-white/70 bg-white/90 p-4 shadow-sm sm:p-4 lg:p-5">
            <div className="flex flex-col gap-2.5 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <h3 className="font-serif text-[1.05rem] font-semibold leading-tight text-slate-950 sm:text-[1.3rem] lg:text-[1.4rem]">{owner.name}</h3>
                <p className="mt-1.5 text-[12px] leading-snug text-slate-500 sm:mt-2 sm:text-sm">
                  {owner.email || ownerMessages.noEmail} · {owner.phone || ownerMessages.noPhone}
                </p>
                <p className="mt-1 text-[12px] leading-snug text-slate-500 sm:text-sm">
                  {owner.companyName || ownerMessages.personalOwner} ·{" "}
                  {ownerMessages.vehicleCount(owner.vehicles.length)}
                </p>
              </div>
              <div className="self-start rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 sm:px-3 sm:text-xs">
                {ownerMessages.activeLinks(
                  owner.shareLinks.filter((shareLink) => shareLink.isActive).length,
                )}
              </div>
            </div>

            <details className="mt-4 rounded-lg bg-slate-50 px-4 py-3 sm:mt-5 sm:px-5 sm:py-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">
                {ownerMessages.editOwner}
              </summary>
              <form action={saveOwnerAction} className="mt-4 grid gap-3 md:grid-cols-2">
                <input type="hidden" name="id" value={owner.id} />
                <input
                  name="name"
                  defaultValue={owner.name}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                />
                <input
                  name="phone"
                  defaultValue={owner.phone ?? ""}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                />
                <input
                  name="email"
                  defaultValue={owner.email ?? ""}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                />
                <input
                  name="companyName"
                  defaultValue={owner.companyName ?? ""}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3"
                />
                <input
                  name="notes"
                  defaultValue={owner.notes ?? ""}
                  className="rounded-md border border-slate-200 bg-white px-4 py-3 md:col-span-2"
                />
                <button className="rounded-md bg-slate-950 px-4 py-3 font-medium text-white md:col-span-2">
                  {ownerMessages.saveChanges}
                </button>
              </form>
            </details>

            <div className="mt-4 text-sm text-slate-500">
              {ownerMessages.vehiclesPrefix}:{" "}
              {owner.vehicles.map((vehicle) => vehicle.nickname).join(", ") || ownerMessages.noVehicles}
            </div>

            <form action={deleteOwnerAction} className="mt-4">
              <input type="hidden" name="id" value={owner.id} />
              <button className="text-sm font-medium text-rose-600">
                {ownerMessages.deleteOwner}
              </button>
            </form>
          </article>
        ))}
      </section>
    </div>
  );
}
