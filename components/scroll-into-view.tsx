"use client";

import { useEffect, useRef } from "react";

/**
 * Brings its spot on the page into view once, when it appears. For a
 * form that saves with a redirect, which lands at the top of the page
 * with the confirmation far below.
 */
export function ScrollIntoView() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  return <span ref={ref} aria-hidden />;
}
