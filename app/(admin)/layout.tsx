import { AppShell } from "@/components/app-shell";
import { requireAdminAuth } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminAuth();
  const { locale, messages } = await getI18n();

  return (
    <AppShell
      locale={locale}
      title={messages.adminLayout.title}
      description={messages.adminLayout.description}
    >
      {children}
    </AppShell>
  );
}
