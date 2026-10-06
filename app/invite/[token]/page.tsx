import { InviteAcceptForm } from "@/components/invite-accept-form";
import { getI18n } from "@/lib/i18n-server";
import { findOpenInvite } from "@/lib/team";

export const dynamic = "force-dynamic";
export const metadata = { title: "TATO", robots: { index: false, follow: false } };

/** Where a team invitation lands: set a name and password, and you are in. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, { locale }] = await Promise.all([params, getI18n()]);
  const open = await findOpenInvite(token);
  const zh = locale !== "en";
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface-muted)] p-4 text-[var(--ink)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--line)] bg-white p-6 shadow-sm">
        {open ? (
          <>
            <h1 className="text-xl font-semibold">{zh ? `加入 ${open.workspace.name}` : `Join ${open.workspace.name}`}</h1>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              {zh ? `${open.invite.createdBy} 邀请 ${open.invite.email} 加入团队。设置密码后就能登录。` : `${open.invite.createdBy} invited ${open.invite.email} to the team. Set a password to sign in.`}
            </p>
            <InviteAcceptForm token={token} defaultName={open.invite.name ?? ""} locale={locale} />
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">{zh ? "邀请已失效" : "This invitation has expired"}</h1>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              {zh ? "链接已过期、已被使用或已被撤回。请向邀请你的人要一个新的。" : "The link has expired, was already used, or was withdrawn. Ask for a new one."}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
