import { ChevronRight, History, Trash2 } from "lucide-react";
import Link from "next/link";

import { AccountLoginSecurity } from "@/components/account-login-security";
import { AppInstallGuide } from "@/components/app-install-guide";
import { NotificationSettings } from "@/components/notification-settings";
import { ScrollToHash } from "@/components/scroll-to-hash";
import {
  updateAccountProfileAction,
  updateStripePayoutBindingAction,
} from "@/lib/account-settings-actions";
import { ANDROID_RELEASE, formatBytes } from "@/lib/android-release";
import { TeamSettings } from "@/components/team-settings";
import { ASSIGNABLE_SECTIONS, canManageTeam, canOpenPath, parsePageAccess, parseVehicleScope } from "@/lib/access";
import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listTeam } from "@/lib/team";
import { getMessages } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import {
  getWorkspaceConnectSnapshot,
  isStripeConnectConfigured,
  summarizeConnectStatus,
} from "@/lib/stripe-connect";

type AccountSettingsCopy = ReturnType<typeof getMessages>["accountSettingsPage"];

export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const [{ locale, messages }, { user, workspace }, params] = await Promise.all([
    getI18n(),
    requireCurrentAdminContext(),
    searchParams,
  ]);

  const t = messages.accountSettingsPage;
  const isOwner = canManageTeam(user);
  const team = isOwner ? await listTeam(workspace.id) : null;
  const teamVehicles = team
    ? await prisma.vehicle.findMany({
        where: { workspaceId: workspace.id, isArchived: false },
        orderBy: { nickname: "asc" },
        select: { id: true, nickname: true, plateNumber: true },
      })
    : [];
  const navLabels: Record<string, string> = {
    "/dashboard": messages.shell.nav.dashboard,
    "/assistant": messages.shell.nav.assistant,
    "/messages": messages.shell.nav.guestMessages,
    "/updates": messages.shell.nav.turoUpdates,
    "/calendar": messages.shell.nav.calendar,
    "/orders": messages.shell.nav.orders,
    "/imports": messages.shell.nav.imports,
    "/vehicles": messages.shell.nav.vehicles,
    "/vehicle-roi": messages.shell.nav.vehicleRoi,
    "/owners": messages.shell.nav.owners,
    "/direct-booking": messages.shell.nav.directBooking,
    "/staff-schedule": messages.shell.nav.staffSchedule,
    "/contracts": messages.shell.nav.contracts,
    "/inspections": messages.shell.nav.inspections,
    "/photos": messages.shell.nav.photos,
    "/documents": messages.shell.nav.documents,
    "/activity": messages.shell.nav.activity,
    "/trash": messages.shell.nav.trash,
    "/invoices": messages.shell.nav.invoices,
  };
  const appBase = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "").replace(/\/$/, "");
  const connectSnapshot = await getWorkspaceConnectSnapshot(workspace.id);
  const connectStatus = summarizeConnectStatus(connectSnapshot);
  const isStripeConfigured = isStripeConnectConfigured();
  const notice = getAccountSettingsNotice(params.account, t);
  const records = [
    { href: "/activity", title: messages.shell.nav.activity, copy: t.activityCopy, Icon: History },
    { href: "/trash", title: messages.shell.nav.trash, copy: t.trashCopy, Icon: Trash2 },
  ].filter((record) => canOpenPath(user, record.href));

  const statusLabel =
    connectStatus === "active"
      ? t.stripeActive
      : connectStatus === "restricted"
        ? t.stripeRestricted
        : connectStatus === "pending"
          ? t.stripePending
          : t.stripeNoAccount;

  return (
    <div className="space-y-3">
      {/* The page is named in the sidebar; which account this is, is not. */}
      <h1 className="sr-only">{t.title}</h1>
      <p className="text-[12px] text-[var(--ink-soft)]">
        {workspace.name} · {user.email}
      </p>

      {notice ? (
        <section
          className={`rounded-lg border px-3 py-2 text-[12px] ${
            notice.tone === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {notice.copy}
        </section>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-2">
        <SettingsCard title={t.profileTitle} copy={t.profileCopy}>
          <form action={updateAccountProfileAction} className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--ink-soft)]">
                {t.companyNameLabel}
              </span>
              <input
                name="companyName"
                defaultValue={workspace.name}
                required
                maxLength={120}
                className="input"
              />
              {/* Said out loud, because this field reaches further
                  than its label suggests -- it is the name printed on
                  every owner statement. */}
              <span className="mt-1 block text-[11px] leading-4 text-[var(--ink-soft)]">
                {t.companyNameHint}
              </span>
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--ink-soft)]">
                {t.displayNameLabel}
              </span>
              <input
                name="displayName"
                defaultValue={user.name}
                required
                maxLength={80}
                className="input"
              />
            </label>
            <div className="sm:col-span-2">
              <button className="btn-primary" type="submit">
                {t.saveProfile}
              </button>
            </div>
          </form>
        </SettingsCard>

        <AccountLoginSecurity currentEmail={user.email} locale={locale} />

        {isOwner ? (
        <SettingsCard title={t.stripeTitle} copy={t.stripeCopy}>
          <div className="mb-3 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[12px] text-[var(--ink-soft)]">
            {isStripeConfigured ? t.stripeConfigured : t.stripeNotConfigured}
          </div>
          <dl className="mb-3 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
            <StatusItem label={t.stripeStatusLabel} value={statusLabel} />
            <StatusItem label={t.statusAccountId} value={connectSnapshot.accountId ?? "—"} mono />
            <StatusItem
              label={t.statusCharges}
              value={connectSnapshot.chargesEnabled ? t.enabled : t.disabled}
            />
            <StatusItem
              label={t.statusPayouts}
              value={connectSnapshot.payoutsEnabled ? t.enabled : t.disabled}
            />
          </dl>
          <form action={updateStripePayoutBindingAction} className="grid gap-3 sm:grid-cols-[1fr_150px]">
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--ink-soft)]">
                {t.stripeAccountLabel}
              </span>
              <input
                name="stripeConnectAccountId"
                defaultValue={connectSnapshot.accountId ?? ""}
                placeholder={t.stripeAccountPlaceholder}
                className="input font-mono"
              />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--ink-soft)]">
                {t.stripeCountryLabel}
              </span>
              <select
                name="stripeConnectCountry"
                defaultValue={connectSnapshot.country ?? "CA"}
                className="input"
              >
                <option value="CA">Canada</option>
                <option value="US">United States</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-[12px] text-[var(--ink-soft)] sm:col-span-2">
              <input
                type="checkbox"
                name="clearStripeConnect"
                className="h-4 w-4 rounded border-[var(--line)]"
              />
              <span>{t.stripeClearLabel}</span>
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button className="btn-primary" type="submit">
                {t.saveStripe}
              </button>
              <Link href="/payouts" className="btn-secondary">
                {t.payoutsLink}
              </Link>
            </div>
          </form>
        </SettingsCard>
        ) : null}
      </div>

      <NotificationSettings locale={locale} />
      <ScrollToHash />

      {team ? (
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
          <h2 className="text-[1rem] font-semibold text-[var(--ink)]">{t.team.title}</h2>
          <p className="mb-3 mt-1.5 max-w-3xl text-[12px] leading-5 text-[var(--ink-soft)]">{t.team.copy}</p>
          <TeamSettings
            locale={locale}
            currentUserId={user.id}
            members={team.members.map((member) => ({
              id: member.id,
              name: member.name,
              email: member.email,
              role: member.role,
              pageAccess: parsePageAccess(member.pageAccess),
              vehicleScope: parseVehicleScope(member.vehicleScope),
            }))}
            invites={team.invites.map((invite) => ({
              id: invite.id,
              email: invite.email,
              name: invite.name,
              role: invite.role,
              expiresAt: invite.expiresAt.toISOString(),
              acceptUrl: `${appBase}/invite/${invite.token}`,
            }))}
            pages={ASSIGNABLE_SECTIONS.map((key) => ({ key, label: navLabels[key] ?? key }))}
            vehicles={teamVehicles.map((vehicle) => ({
              id: vehicle.id,
              label: vehicle.plateNumber ? `${vehicle.nickname} · ${vehicle.plateNumber}` : vehicle.nickname,
            }))}
          />
        </section>
      ) : null}


      {/* The activity log and the trash: looked at when something has
          gone wrong, not every day, so they left the sidebar for here. */}
      {records.length > 0 ? (
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
          <h2 className="text-[1rem] font-semibold text-[var(--ink)]">{t.recordsTitle}</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {records.map((record) => (
              <li key={record.href}>
                <Link
                  href={record.href}
                  className="tap-press flex items-center gap-3 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2.5 transition hover:border-[var(--ink-soft)]"
                >
                  <record.Icon className="h-5 w-5 shrink-0 text-[var(--ink-soft)]" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-[var(--ink)]">{record.title}</span>
                    <span className="block text-[11.5px] leading-5 text-[var(--ink-soft)]">{record.copy}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ink-soft)]" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
        <h2 className="text-[1rem] font-semibold text-[var(--ink)]">{t.apiAccessTitle}</h2>
        <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-[var(--ink-soft)]">{t.apiAccessCopy}</p>
        <Link href="/agent#api" className="btn-secondary mt-3 inline-flex">
          {t.apiAccessLink}
        </Link>
      </section>

      <AppInstallGuide
        locale={locale}
        android={
          ANDROID_RELEASE.sizeBytes > 0
            ? {
                path: ANDROID_RELEASE.path,
                fileName: ANDROID_RELEASE.fileName,
                meta: t.androidMeta(ANDROID_RELEASE.version, formatBytes(ANDROID_RELEASE.sizeBytes), ANDROID_RELEASE.builtAt),
              }
            : null
        }
      />
    </div>
  );
}

function SettingsCard({
  title,
  copy,
  children,
}: {
  title: string;
  copy: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-3 sm:px-4">
      <h2 className="text-[1rem] font-semibold text-[var(--ink)]">{title}</h2>
      <p className="mt-1.5 text-[12px] leading-5 text-[var(--ink-soft)]">{copy}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function StatusItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-2">
      <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">{label}</dt>
      <dd className={`mt-1 truncate text-[12px] font-medium text-[var(--ink)] ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function getAccountSettingsNotice(status: string | undefined, t: AccountSettingsCopy) {
  if (!status) return null;
  const successMap: Record<string, string> = {
    profile_saved: t.saved.profile,
    password_saved: t.saved.password,
    stripe_saved: t.saved.stripe,
    stripe_cleared: t.saved.stripeCleared,
    ledger_policy_saved: t.ledgerSaved,
  };
  const errorMap: Record<string, string> = {
    invalid: t.errors.invalid,
    bad_password: t.errors.badPassword,
    email_in_use: t.errors.emailInUse,
    password_mismatch: t.errors.passwordMismatch,
    stripe_invalid: t.errors.stripeInvalid,
    stripe_in_use: t.errors.stripeInUse,
    stripe_missing: t.errors.stripeMissing,
  };
  if (successMap[status]) {
    return { tone: "success" as const, copy: successMap[status] };
  }
  if (errorMap[status]) {
    return { tone: "error" as const, copy: errorMap[status] };
  }
  return null;
}
