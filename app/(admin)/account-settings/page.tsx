import Link from "next/link";

import {
  updateAccountEmailAction,
  updateAccountPasswordAction,
  updateAccountProfileAction,
  updateLedgerPolicyAction,
  updateStripePayoutBindingAction,
} from "@/lib/account-settings-actions";
import { requireCurrentAdminContext } from "@/lib/auth";
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
  const [{ messages }, { user, workspace }, params] = await Promise.all([
    getI18n(),
    requireCurrentAdminContext(),
    searchParams,
  ]);

  const t = messages.accountSettingsPage;
  const connectSnapshot = await getWorkspaceConnectSnapshot(workspace.id);
  const connectStatus = summarizeConnectStatus(connectSnapshot);
  const isStripeConfigured = isStripeConnectConfigured();
  const notice = getAccountSettingsNotice(params.account, t);

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
      <header className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-3 sm:px-4">
        <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--ink-soft)]">
          {t.kicker}
        </p>
        <div className="mt-1 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="font-serif text-[1.35rem] leading-tight text-[var(--ink)] sm:text-[1.6rem]">
              {t.title}
            </h1>
            <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-[var(--ink-soft)]">
              {t.copy}
            </p>
          </div>
          <div className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[12px] text-[var(--ink-soft)]">
            {workspace.name} · {user.email}
          </div>
        </div>
      </header>

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

        <SettingsCard title={t.loginTitle} copy={t.loginCopy}>
          <form action={updateAccountEmailAction} className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--ink-soft)]">
                {t.emailLabel}
              </span>
              <input
                name="email"
                type="email"
                defaultValue={user.email}
                required
                maxLength={160}
                autoComplete="email"
                className="input"
              />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--ink-soft)]">
                {t.currentPasswordLabel}
              </span>
              <input
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
                className="input"
              />
            </label>
            <div className="sm:col-span-2">
              <button className="btn-primary" type="submit">
                {t.saveEmail}
              </button>
            </div>
          </form>
        </SettingsCard>

        <SettingsCard title={t.passwordTitle} copy={t.passwordCopy}>
          <form action={updateAccountPasswordAction} className="grid gap-3 sm:grid-cols-3">
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--ink-soft)]">
                {t.currentPasswordLabel}
              </span>
              <input
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
                className="input"
              />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--ink-soft)]">
                {t.newPasswordLabel}
              </span>
              <input
                name="newPassword"
                type="password"
                minLength={8}
                maxLength={128}
                required
                autoComplete="new-password"
                className="input"
              />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--ink-soft)]">
                {t.confirmPasswordLabel}
              </span>
              <input
                name="confirmPassword"
                type="password"
                minLength={8}
                maxLength={128}
                required
                autoComplete="new-password"
                className="input"
              />
            </label>
            <div className="sm:col-span-3">
              <button className="btn-primary" type="submit">
                {t.savePassword}
              </button>
            </div>
          </form>
        </SettingsCard>

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
      </div>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-3 sm:px-4">
        <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--ink-soft)]">
          {t.optionalTitle}
        </p>
        <p className="mt-1.5 text-[12px] leading-5 text-[var(--ink-soft)]">{t.optionalCopy}</p>
        <ul className="mt-3 grid gap-2 text-[12px] text-[var(--ink)] md:grid-cols-2">
          {t.optionalItems.map((item) => (
            <li key={item} className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
          {t.ledgerTitle}
        </p>
        <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-[var(--ink-soft)]">
          {t.ledgerCopy}
        </p>

        <form action={updateLedgerPolicyAction} className="mt-3 space-y-2">
          {(
            [
              {
                name: "reimbursementShare",
                value: workspace.reimbursementShare,
                title: t.ledgerReimbursementTitle,
                copy: t.ledgerReimbursementCopy,
              },
              {
                name: "serviceShare",
                value: workspace.serviceShare,
                title: t.ledgerServiceTitle,
                copy: t.ledgerServiceCopy,
              },
              {
                name: "penaltyShare",
                value: workspace.penaltyShare,
                title: t.ledgerPenaltyTitle,
                copy: t.ledgerPenaltyCopy,
              },
            ] as const
          ).map((row) => (
            <div
              key={row.name}
              className="flex flex-col gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--ink)]">{row.title}</p>
                <p className="mt-0.5 text-[11.5px] leading-5 text-[var(--ink-soft)]">{row.copy}</p>
              </div>
              <select
                name={row.name}
                defaultValue={row.value}
                className="h-9 shrink-0 rounded-md border border-[var(--line)] bg-white px-3 text-[12px] font-medium text-[var(--ink)] outline-none sm:w-48"
              >
                <option value="OWNER">{t.ledgerOwner}</option>
                <option value="MANAGER">{t.ledgerManager}</option>
              </select>
            </div>
          ))}

          <p className="rounded-md border border-[var(--line)] bg-[var(--accent-soft)] px-3 py-2 text-[11.5px] leading-5 text-[var(--ink)]">
            {t.ledgerResyncNotice}
          </p>

          <button className="h-9 rounded-full bg-[var(--ink)] px-4 text-[12px] font-semibold text-white transition hover:bg-[#2a2f3a]">
            {t.ledgerSave}
          </button>
        </form>
      </section>
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
    email_saved: t.saved.email,
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
