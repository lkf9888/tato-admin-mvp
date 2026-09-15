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
  version: "0.73.0",
  /** Android's own monotonic counter. Must only ever increase, or a
   *  device will refuse the upgrade. */
  versionCode: 73,
  builtAt: "2026-09-15",
  fileName: "tato.apk",
  /** Stable on purpose: "the latest APK" should always be the same
   *  URL, so a link written down once keeps working. */
  path: "/tato.apk",
  sizeBytes: 2575093,
  /** So a download can be checked against what was built here. */
  sha256: "b0b25fb59e6573b9e19b0bb4314bd940ad8af48c060aaec8c0bd23af8b670020",
} as const;

export function formatBytes(bytes: number) {
  if (bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}
