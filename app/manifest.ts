import type { MetadataRoute } from "next";

/**
 * PWA manifest. Tells iOS / Android / desktop browsers how to display
 * the app when the user adds it to their home screen.
 *
 * - `display: "standalone"` strips the browser chrome on launch from the
 *   home screen icon, so the app feels like a native client.
 * - `theme_color` colors the OS status bar (Android) and the title bar
 *   (desktop PWA install).
 * - `start_url` is what loads when the user taps the icon. We send
 *   them to /dashboard rather than `/` so an authenticated user lands
 *   on something useful, and an unauthenticated user gets bounced to
 *   /login by middleware automatically.
 *
 * Icons are drawn on request from `components/brand-mark.tsx`:
 * `app/app-icon.png` (the whole "tato") for installs, `app/apple-icon.tsx`
 * for iOS. `app/icon.tsx` is the one-letter favicon and is left out of
 * the manifest on purpose -- a launcher would show a lone "t".
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TATO — Turo fleet operations",
    short_name: "TATO",
    description:
      "Manage your Turo fleet, calendar, orders, and bookings from one workspace.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#15171C",
    categories: ["business", "productivity"],
    lang: "en",
    icons: [
      // The whole "tato": installs and launchers show it large. One
      // 512 PNG serves every size; launchers scale it down.
      {
        src: "/app-icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/app-icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
