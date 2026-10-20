"use client";

import { useEffect } from "react";

/**
 * Brings the section named in the address into view once the page has
 * rendered: `/account-settings#notifications` from the messages page's
 * bell. Next does not scroll there itself on a client-side navigation,
 * so a link to a section would otherwise land at the top.
 */
export function ScrollToHash() {
  useEffect(() => {
    // Read the hash a frame later: on a client-side navigation the
    // router writes the new address after the page's own effects run.
    const frame = requestAnimationFrame(() => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return null;
}
