import { DeleteShareLinkButton } from "@/components/delete-share-link-button";
import { StatusBadge } from "@/components/status-badge";
import { getShareVisibilityOptions } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/utils";

export default async function ShareLinksPage() {
  const [{ locale, messages }, owners, shareLinks] = await Promise.all([
    getI18n(),
    prisma.owner.findMany({
      orderBy: { name: "asc" },
    }),
    prisma.shareLink.findMany({
      include: { owner: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const shareLinkMessages = messages.shareLinks;
  const shareVisibilityOptions = getShareVisibilityOptions(locale);

  return (
    <div className="space-y-6">
      <section className="rounded-[1.75rem] border border-white/70 bg-white/90 p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
          {shareLinkMessages.createKicker}
        </p>
        <form action="/api/share-links/create" method="post" className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <select name="ownerId" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
          <select
            name="visibility"
            defaultValue="standard"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
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
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <input
            name="expiresAt"
            type="datetime-local"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <button className="rounded-2xl bg-slate-950 px-4 py-3 font-medium text-white xl:col-span-1">
            {shareLinkMessages.generateLink}
          </button>
        </form>
      </section>

      <section className="space-y-4">
        {shareLinks.map((shareLink) => (
          <article key={shareLink.id} className="rounded-[1.75rem] border border-white/70 bg-white/90 p-6 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="font-serif text-3xl text-slate-950">{shareLink.owner.name}</h3>
                <p className="mt-2 text-sm text-slate-500">
                  {shareLinkMessages.tokenPrefix}: {shareLink.token}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {shareLinkMessages.urlPrefix}: /share/{shareLink.token} ·{" "}
                  {shareLinkMessages.createdAt(formatDateTime(shareLink.createdAt, locale))}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {shareLink.passwordHash
                    ? shareLinkMessages.passwordProtected
                    : shareLinkMessages.noPassword}{" "}
                  ·{" "}
                  {shareLink.expiresAt
                    ? shareLinkMessages.expiresAt(formatDateTime(shareLink.expiresAt, locale))
                    : shareLinkMessages.noExpiry}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge value={shareLink.visibility} locale={locale} />
                <StatusBadge value={shareLink.isActive ? "available" : "inactive"} locale={locale} />
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 md:flex-row">
              <a
                href={`/share/${shareLink.token}`}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
              >
                {shareLinkMessages.openSharePage}
              </a>
              {shareLink.isActive ? (
                <form action="/api/share-links/revoke" method="post">
                  <input type="hidden" name="id" value={shareLink.id} />
                  <button className="rounded-2xl border border-rose-200 px-4 py-3 text-sm font-medium text-rose-600">
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
