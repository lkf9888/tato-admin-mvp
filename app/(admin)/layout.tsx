import { AppShell } from "@/components/app-shell";
import { requireAdminAuth } from "@/lib/auth";
import { getI18n, getLocalePreference } from "@/lib/i18n-server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminAuth();
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
    >
      {children}
    </AppShell>
  );
}
