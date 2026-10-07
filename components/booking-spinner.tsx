/**
 * The small turning ring the booking pages show while something is under
 * way -- a payment opening, a refund, a contract being filed -- so a wait
 * reads as work rather than as a page that has stopped. Takes its colour
 * from the text around it; still for people who asked for less motion.
 */
export function BookingSpinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent align-[-2px] motion-safe:animate-spin ${className}`}
    />
  );
}

/** A button label that turns into the spinner and a "working" word while `busy`. */
export function BusyLabel({ busy, idle, working }: { busy: boolean; idle: React.ReactNode; working: React.ReactNode }) {
  return busy ? (
    <span className="inline-flex items-center justify-center gap-2" role="status" aria-live="polite">
      <BookingSpinner />
      {working}
    </span>
  ) : (
    <>{idle}</>
  );
}
