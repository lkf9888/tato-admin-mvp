import { ScrollIntoView } from "@/components/scroll-into-view";
import { updateLedgerPolicyAction } from "@/lib/account-settings-actions";
import type { getMessages } from "@/lib/i18n";

type Copy = ReturnType<typeof getMessages>["accountSettingsPage"];

/**
 * The revenue split every owner starts from: who keeps reimbursements,
 * service income and penalties. Workspace-wide, but it lives on an
 * owner's page, right under that owner's own exceptions -- the two are
 * one decision read at two levels, and it is here that someone setting
 * an owner up goes looking for it. Saving comes back to this page.
 */
export function OwnerLedgerDefaults({
  ownerId,
  values,
  saved,
  t,
}: {
  ownerId: string;
  values: { reimbursementShare: string; serviceShare: string; penaltyShare: string };
  saved: boolean;
  t: Copy;
}) {
  const rows = [
    { name: "reimbursementShare", value: values.reimbursementShare, title: t.ledgerReimbursementTitle, copy: t.ledgerReimbursementCopy },
    { name: "serviceShare", value: values.serviceShare, title: t.ledgerServiceTitle, copy: t.ledgerServiceCopy },
    { name: "penaltyShare", value: values.penaltyShare, title: t.ledgerPenaltyTitle, copy: t.ledgerPenaltyCopy },
  ] as const;

  return (
    <section id="ledger-defaults" className="card scroll-mt-20 space-y-3 p-6">
      <div>
        <h2 className="font-serif text-[1.05rem] text-[var(--ink)]">{t.ledgerTitle}</h2>
        <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-[var(--ink-soft)]">{t.ledgerCopy}</p>
      </div>
      {saved ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
          <ScrollIntoView />
          {t.ledgerSaved}
        </p>
      ) : null}
      <form action={updateLedgerPolicyAction} className="space-y-2">
        <input type="hidden" name="returnTo" value={`/owners/${ownerId}`} />
        {rows.map((row) => (
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
              className="h-9 shrink-0 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-[12px] font-medium text-[var(--ink)] outline-none sm:w-48"
            >
              <option value="OWNER">{t.ledgerOwner}</option>
              <option value="MANAGER">{t.ledgerManager}</option>
            </select>
          </div>
        ))}
        <p className="rounded-md border border-[var(--line)] bg-[var(--accent-soft)] px-3 py-2 text-[11.5px] leading-5 text-[var(--ink)]">
          {t.ledgerResyncNotice}
        </p>
        <button className="btn-primary" type="submit">
          {t.ledgerSave}
        </button>
      </form>
    </section>
  );
}
