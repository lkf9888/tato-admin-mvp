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
    <div className="space-y-6">
      {params.error ? (
        <div className="rounded-lg bg-amber-50 px-5 py-4 text-sm text-amber-700">
          {ownerMessages.deleteError}
        </div>
      ) : null}

      <section className="rounded-lg border border-white/70 bg-white/90 p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
          {ownerMessages.createKicker}
        </p>
        <form action={saveOwnerAction} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        {owners.map((owner) => (
          <article key={owner.id} className="rounded-lg border border-white/70 bg-white/90 p-6 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="font-serif text-3xl text-slate-950">{owner.name}</h3>
                <p className="mt-2 text-sm text-slate-500">
                  {owner.email || ownerMessages.noEmail} · {owner.phone || ownerMessages.noPhone}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {owner.companyName || ownerMessages.personalOwner} ·{" "}
                  {ownerMessages.vehicleCount(owner.vehicles.length)}
                </p>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {ownerMessages.activeLinks(
                  owner.shareLinks.filter((shareLink) => shareLink.isActive).length,
                )}
              </div>
            </div>

            <details className="mt-5 rounded-lg bg-slate-50 px-5 py-4">
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
