"use client";

import { useEffect, useRef } from "react";

const CHECK_INTERVAL_MS = 60_000;
const MIN_MANUAL_CHECK_GAP_MS = 15_000;

export function SessionExpiryRedirect() {
  const lastCheckAtRef = useRef(0);
  const checkingRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function checkSession(force = false) {
      const now = Date.now();
      if (!force && now - lastCheckAtRef.current < MIN_MANUAL_CHECK_GAP_MS) return;
      if (checkingRef.current) return;

      checkingRef.current = true;
      lastCheckAtRef.current = now;

      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });

        if (!mounted) return;
        if (response.status === 401) {
          window.location.replace("/login?expired=1");
        }
      } catch {
        // Network hiccups should not kick an authenticated user out.
      } finally {
        checkingRef.current = false;
      }
    }

    const interval = window.setInterval(() => {
      void checkSession(true);
    }, CHECK_INTERVAL_MS);

    const handleFocus = () => {
      void checkSession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkSession();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void checkSession(true);

    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
