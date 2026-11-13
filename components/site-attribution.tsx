"use client";

import { useEffect } from "react";

import { rememberAttribution } from "@/lib/site-attribution";

/** Keeps the landing page's ad parameters for checkout (lib/site-attribution.ts). */
export function SiteAttributionCapture() {
  useEffect(() => {
    rememberAttribution();
  }, []);
  return null;
}
