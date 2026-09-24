"use client";

import { useEffect } from "react";

import { sendConversionEvents, type SiteConversion } from "@/lib/site-conversion";

type Gtag = (...args: unknown[]) => void;

/**
 * Report a paid booking to Google, once.
 *
 * Waits for `gtag` rather than queueing onto `dataLayer` directly: the
 * shell's inline script defines it and configures the site's tags in
 * the same breath, so once it exists the events have somewhere to go.
 * An event queued before its tag is configured is the kind that
 * vanishes without an error.
 *
 * Google already de-duplicates on `transaction_id`; the session-storage
 * mark only saves a reload from sending the hit at all.
 */
export function SiteConversionReporter({
  conversion,
  measurementId,
  adsSendTo,
}: {
  conversion: SiteConversion;
  measurementId: string | null;
  adsSendTo: string | null;
}) {
  useEffect(() => {
    const mark = `tato-conversion:${conversion.transactionId}`;
    try {
      if (window.sessionStorage.getItem(mark)) return;
    } catch {
      // Storage blocked: Google's own de-duplication still holds.
    }

    let attempts = 0;
    const timer = window.setInterval(() => {
      const gtag = (window as unknown as { gtag?: Gtag }).gtag;
      attempts += 1;
      if (typeof gtag !== "function") {
        if (attempts > 50) window.clearInterval(timer);
        return;
      }
      window.clearInterval(timer);

      sendConversionEvents(gtag, conversion, measurementId, adsSendTo);
      try {
        window.sessionStorage.setItem(mark, "1");
      } catch {
        // See above.
      }
    }, 200);

    return () => window.clearInterval(timer);
  }, [conversion, measurementId, adsSendTo]);

  return null;
}
