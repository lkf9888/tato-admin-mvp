import { CopyTextButton } from "@/components/copy-text-button";
import { couponState, type CouponState } from "@/lib/booking-coupons-server";
import { createCouponAction, voidCouponAction } from "@/lib/direct-booking-actions";
import { getMessages, type Locale } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/utils";

type CouponRow = {
  id: string;
  code: string;
  kind: string;
  value: number;
  note: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  reservedUntil: Date | null;
  redeemedAt: Date | null;
  redeemedOrderId: string | null;
  voidedAt: Date | null;
};

const FIELD =
  "w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] text-[color:var(--ink)]";

const STATE_TONE: Record<CouponState, string> = {
  available: "bg-[var(--ok-bg)] text-[color:var(--ok-fg)]",
  reserved: "bg-[var(--warn-bg)] text-[color:var(--warn-fg)]",
  redeemed: "bg-[var(--surface-muted)] text-[color:var(--ink-soft)]",
  expired: "bg-[var(--surface-muted)] text-[color:var(--ink-soft)]",
  voided: "bg-[var(--surface-muted)] text-[color:var(--ink-soft)]",
};

/** Single-use codes: make one, hand it out, see which were used. */
export function BookingCouponsPanel({
  locale,
  coupons,
  createdCode,
  error,
}: {
  locale: Locale;
  coupons: CouponRow[];
  createdCode: string | null;
  error: string | null;
}) {
  const copy = getMessages(locale).directBookingCoupons;
  const now = new Date();

  return (
    <section
      id="coupons"
      className="scroll-mt-20 rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]"
    >
      <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--ink-soft)]">{copy.kicker}</p>
      <h3 className="mt-1 text-[1.05rem] font-semibold text-[color:var(--ink)]">{copy.title}</h3>
      <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[color:var(--ink-soft)]">{copy.copy}</p>

      {createdCode ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[color:var(--ok-fg)]/20 bg-[var(--ok-bg)] px-3 py-2 text-[13px] text-[color:var(--ok-fg)]">
          {copy.created}
          <code className="rounded bg-white px-2 py-0.5 font-mono text-[14px] font-bold tracking-wider text-[color:var(--ink)]">
            {createdCode}
          </code>
          <CopyTextButton text={createdCode} label={copy.copy_} copiedLabel={copy.copied} />
        </div>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-md bg-[var(--bad-bg)] px-3 py-2 text-[12px] text-[color:var(--bad-fg)]">
          {copy.invalid}
        </p>
      ) : null}

      <form action={createCouponAction} className="mt-3 grid gap-2 sm:grid-cols-[9rem_8rem_10rem_minmax(0,1fr)_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">{copy.kindLabel}</span>
          <select name="kind" defaultValue="percent" className={FIELD}>
            <option value="percent">{copy.kindPercent}</option>
            <option value="amount">{copy.kindAmount}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">{copy.valueLabel}</span>
          <input name="value" type="number" min="0.01" step="0.01" required inputMode="decimal" className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">{copy.expiresLabel}</span>
          <input name="expiresOn" type="date" className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">{copy.noteLabel}</span>
          <input name="note" maxLength={120} placeholder={copy.notePlaceholder} className={FIELD} />
        </label>
        <button
          type="submit"
          className="rounded-md bg-[var(--ink)] px-4 py-2 text-[12px] font-medium text-white"
          style={{ backgroundColor: "var(--ink)", color: "var(--surface)" }}
        >
          {copy.generate}
        </button>
      </form>
      <p className="mt-1 text-[11px] leading-4 text-[color:var(--ink-soft)]">{copy.hint}</p>

      {coupons.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)]">
              <tr className="border-b border-[color:var(--line)]">
                <th className="py-1.5 pr-3">{copy.colCode}</th>
                <th className="py-1.5 pr-3">{copy.colDiscount}</th>
                <th className="py-1.5 pr-3">{copy.colState}</th>
                <th className="py-1.5 pr-3">{copy.colExpires}</th>
                <th className="py-1.5 pr-3">{copy.colNote}</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {coupons.map((coupon) => {
                const state = couponState(coupon, now);
                return (
                  <tr key={coupon.id} className="border-b border-[color:var(--line)] last:border-b-0">
                    <td className="py-1.5 pr-3">
                      <span className="font-mono font-semibold tracking-wider text-[color:var(--ink)]">
                        {coupon.code}
                      </span>
                      {state === "available" ? (
                        <CopyTextButton text={coupon.code} label={copy.copy_} copiedLabel={copy.copied} />
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {coupon.kind === "percent"
                        ? `${Number(coupon.value.toFixed(2))}%`
                        : formatCurrency(coupon.value, locale)}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATE_TONE[state]}`}>
                        {copy.states[state]}
                      </span>
                      {state === "redeemed" && coupon.redeemedOrderId ? (
                        <a
                          href={`/orders/${coupon.redeemedOrderId}`}
                          className="ml-1 text-[11px] text-[color:var(--ink-soft)] underline"
                        >
                          {copy.viewOrder}
                        </a>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-3 text-[color:var(--ink-soft)]">
                      {coupon.expiresAt ? formatDate(coupon.expiresAt, locale) : "—"}
                    </td>
                    <td className="max-w-[14rem] truncate py-1.5 pr-3 text-[color:var(--ink-soft)]">
                      {coupon.note ?? ""}
                    </td>
                    <td className="py-1.5 text-right">
                      {state === "available" || state === "reserved" ? (
                        <form action={voidCouponAction}>
                          <input type="hidden" name="id" value={coupon.id} />
                          <button type="submit" className="text-[11px] text-[color:var(--bad-fg)] hover:underline">
                            {copy.void}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
