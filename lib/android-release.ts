/**
 * The Android build currently offered for download.
 *
 * Written by `scripts/build-android-apk.sh`, which is the only thing
 * that should edit it -- the numbers here have to describe the file
 * actually sitting in `public/`, and a hand-edited version string that
 * disagrees with the binary is worse than no version string.
 *
 * Worth knowing before wondering why this rarely changes: the APK is a
 * WebView shell around tatocar.co, not a copy of the app. Deploying
 * the site updates what everyone sees inside it immediately, with no
 * new APK and nothing to reinstall. This file only moves when the
 * shell itself changes: its name, its icon, the URL it opens, or the
 * Android version it targets.
 *
 * It was a Trusted Web Activity until v0.72.0. A TWA is hosted by a
 * browser that supports Custom Tabs -- in practice Chrome -- so on a
 * device without one it degrades or does not start. A WebView is a
 * system component present on effectively every Android build.
 */
export const ANDROID_RELEASE = {
  /** Matches the web app's version at the time the shell was built. */
  version: "1.63.0",
  /** Android's own monotonic counter. Must only ever increase, or a
   *  device will refuse the upgrade. */
  versionCode: 74,
  builtAt: "2026-10-10",
  fileName: "tato.apk",
  /** Stable on purpose: "the latest APK" should always be the same
   *  URL, so a link written down once keeps working. */
  path: "/tato.apk",
  sizeBytes: 2579189,
  /** So a download can be checked against what was built here. */
  sha256: "29f65ea7d3ea2331dfc3044635696c2848646d0801956457a4fca091eee84435",
} as const;

export function formatBytes(bytes: number) {
  if (bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}
