import { AppShell } from "@/components/app-shell";
import { requireCurrentAdminUser } from "@/lib/auth";
import { getI18n, getLocalePreference } from "@/lib/i18n-server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Switch from `requireAdminAuth` (cookie-only) to
  // `requireCurrentAdminUser` (cookie + DB lookup) because the new
  // ContactButton needs the user's name + email to prefill the
  // feedback modal's "From" row. The redirect-on-missing semantics
  // are identical, just one extra round-trip on each admin page —
  // which the dashboard already does anyway via the same helper.
  const user = await requireCurrentAdminUser();
  const [{ locale, messages }, localePreference] = await Promise.all([
    getI18n(),
    getLocalePreference(),
  ]);

  return (
    <AppShell
      locale={locale}
      localePreference={localePreference}
      title={messages.adminLayout.title}
      description={messages.adminLayout.description}
      currentUserName={user.name}
      currentUserEmail={user.email}
    >
      {children}
    </AppShell>
  );
}
