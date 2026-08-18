import { AssistantAlertsPanel } from "@/components/assistant-alerts-panel";
import { AssistantChat } from "@/components/assistant-chat";
import { TuroInboxPanel } from "@/components/turo-inbox-panel";
import { listActiveAlerts } from "@/lib/assistant-alerts";
import { requireCurrentAdminContext } from "@/lib/auth";
import { isGmailInboxConfigured } from "@/lib/gmail-inbox";
import { getI18n } from "@/lib/i18n-server";
import { isKimiConfigured } from "@/lib/kimi";
import { prisma } from "@/lib/prisma";

export default async function AssistantPage() {
  const [{ locale, messages }, { workspace, user }] = await Promise.all([
    getI18n(),
    requireCurrentAdminContext(),
  ]);

  const t = messages.assistantPage;

  // Resume the operator's most recent conversation rather than opening
  // a blank one every visit — an assistant you have to re-brief on each
  // page load is a worse tool than one that remembers this morning.
  const [thread, inboundEmails, alerts] = await Promise.all([
    prisma.assistantThread.findFirst({
      where: { workspaceId: workspace.id, userId: user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        messages: { orderBy: { createdAt: "asc" }, take: 40 },
      },
    }),
    prisma.inboundEmail.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { receivedAt: "desc" },
      take: 30,
      select: {
        id: true,
        kind: true,
        subject: true,
        fromName: true,
        receivedAt: true,
        parsed: true,
        acknowledgedAt: true,
        orderId: true,
      },
    }),
    listActiveAlerts(workspace.id),
  ]);

  return (
    <div className="space-y-3">
      <header className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-3 shadow-sm sm:px-4">
        <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--ink-soft)]">{t.kicker}</p>
        <h1 className="mt-1 font-serif text-[1.35rem] leading-tight text-[var(--ink)] sm:text-[1.6rem]">
          {t.title}
        </h1>
        <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-[var(--ink-soft)]">{t.copy}</p>
      </header>

      <AssistantAlertsPanel
        locale={locale}
        initialAlerts={alerts.map((alert) => ({
          id: alert.id,
          severity: alert.severity,
          title: alert.title,
          body: alert.body,
          href: alert.href,
          acknowledged: alert.acknowledgedAt != null,
          updatedAt: alert.updatedAt.toISOString(),
        }))}
      />

      <div className="grid gap-3 xl:grid-cols-[1.35fr_0.65fr]">
        <AssistantChat
          locale={locale}
          configured={isKimiConfigured()}
          initialThreadId={thread?.id ?? null}
          initialMessages={(thread?.messages ?? []).map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt.toISOString(),
          }))}
        />

        <TuroInboxPanel
          locale={locale}
          configured={isGmailInboxConfigured()}
          emails={inboundEmails.map((email) => ({
            id: email.id,
            kind: email.kind,
            subject: email.subject,
            fromName: email.fromName,
            receivedAt: email.receivedAt.toISOString(),
            acknowledged: email.acknowledgedAt != null,
            orderId: email.orderId,
            summary: (() => {
              if (!email.parsed) return null;
              try {
                const parsed = JSON.parse(email.parsed) as {
                  summary?: string;
                  needsAction?: boolean;
                };
                return {
                  text: parsed.summary ?? null,
                  needsAction: parsed.needsAction === true,
                };
              } catch {
                return null;
              }
            })(),
          }))}
        />
      </div>
    </div>
  );
}
