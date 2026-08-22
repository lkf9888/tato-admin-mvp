"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button that says what it is doing.
 *
 * Server actions submit silently: the request goes, the data lands,
 * the page re-renders with the same values it already had, and nothing
 * on screen ever acknowledges the click. That is indistinguishable
 * from a dead button — which is exactly how the fee-sharing save was
 * reported, and it had been saving correctly the whole time.
 *
 * `useFormStatus` only reports pending for the form it sits inside, so
 * this has to be a child of the form rather than part of the panel
 * that renders it.
 */
export function ActionSubmitButton({
  label,
  pendingLabel,
  savedLabel,
  className = "btn-primary",
}: {
  label: string;
  pendingLabel: string;
  savedLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const [justSaved, setJustSaved] = useState(false);
  const wasPending = useRef(false);

  useEffect(() => {
    // The falling edge of `pending` is the completion signal — the
    // action itself returns nothing to react to.
    if (wasPending.current && !pending) {
      setJustSaved(true);
      const timer = setTimeout(() => setJustSaved(false), 2500);
      return () => clearTimeout(timer);
    }
    wasPending.current = pending;
  }, [pending]);

  return (
    <span className="inline-flex items-center gap-2">
      <button type="submit" disabled={pending} className={className}>
        {pending ? pendingLabel : label}
      </button>
      {justSaved ? (
        <span className="text-[12px] font-semibold text-emerald-700">{savedLabel}</span>
      ) : null}
    </span>
  );
}
