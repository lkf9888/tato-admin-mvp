import { DeleteShareLinkButton } from "@/components/delete-share-link-button";
import { StatusBadge } from "@/components/status-badge";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getShareVisibilityOptions } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/utils";

export default async function ShareLinksPage() {
  const workspace = await requireCurrentWorkspace();
  const [{ locale, messages }, owners, shareLinks] = await Promise.all([
    getI18n(),
    prisma.owner.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { name: "asc" },
    }),
    prisma.shareLink.findMany({
      where: { workspaceId: workspace.id },
      include: { owner: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const shareLinkMessages = messages.shareLinks;
  const shareVisibilityOptions = getShareVisibilityOptions(locale);

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-white/70 bg-white/90 p-3 shadow-sm sm:p-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
          {shareLinkMessages.createKicker}
        </p>
        <form action="/api/share-links/create" method="post" className="mt-3 grid gap-2 text-[12px] md:grid-cols-2 xl:grid-cols-4">
          <select name="ownerId" className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
          <select
            name="visibility"
            defaultValue="standard"
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
          >
            {shareVisibilityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            name="password"
            placeholder={shareLinkMessages.optionalPassword}
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
          />
          <input
            name="expiresAt"
            type="datetime-local"
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
          />
          <button className="rounded-md bg-slate-950 px-3 py-2 font-medium text-white xl:col-span-1">
            {shareLinkMessages.generateLink}
          </button>
        </form>
      </section>

      <section className="grid gap-2.5 xl:grid-cols-2 2xl:grid-cols-3">
        {shareLinks.map((shareLink) => (
          <article key={shareLink.id} className="rounded-lg border border-white/70 bg-white/90 p-3 shadow-sm sm:p-3.5">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <h3 className="font-serif text-[0.95rem] font-semibold text-slate-950 sm:text-[1.05rem]">{shareLink.owner.name}</h3>
                <p className="mt-1 break-all text-[11px] text-slate-500">
                  {shareLinkMessages.tokenPrefix}: {shareLink.token}
                </p>
                <p className="mt-0.5 break-all text-[11px] text-slate-500">
                  {shareLinkMessages.urlPrefix}: /share/{shareLink.token} ·{" "}
                  {shareLinkMessages.createdAt(formatDateTime(shareLink.createdAt, locale))}
                </p>
                <p className="mt-0.5 break-words text-[11px] text-slate-500">
                  {shareLink.passwordHash
                    ? shareLinkMessages.passwordProtected
                    : shareLinkMessages.noPassword}{" "}
                  ·{" "}
                  {shareLink.expiresAt
                    ? shareLinkMessages.expiresAt(formatDateTime(shareLink.expiresAt, locale))
                    : shareLinkMessages.noExpiry}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <StatusBadge value={shareLink.visibility} locale={locale} />
                <StatusBadge value={shareLink.isActive ? "available" : "inactive"} locale={locale} />
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-2 md:flex-row">
              <a
                href={`/share/${shareLink.token}`}
                className="rounded-md border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-700"
              >
                {shareLinkMessages.openSharePage}
              </a>
              {shareLink.isActive ? (
                <form action="/api/share-links/revoke" method="post">
                  <input type="hidden" name="id" value={shareLink.id} />
                  <button className="rounded-md border border-rose-200 px-3 py-2 text-[12px] font-medium text-rose-600">
                    {shareLinkMessages.revokeLink}
                  </button>
                </form>
              ) : null}
              <DeleteShareLinkButton
                id={shareLink.id}
                deleteLabel={shareLinkMessages.deleteLink}
                confirmTitle={shareLinkMessages.deleteLinkConfirmTitle}
                confirmDescription={shareLinkMessages.deleteLinkConfirmDescription}
                confirmYesLabel={shareLinkMessages.confirmYes}
                confirmNoLabel={shareLinkMessages.confirmNo}
              />
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
