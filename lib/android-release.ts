/**
 * The Android build currently offered for download.
 *
 * Written by `scripts/build-android-apk.sh`, which is the only thing
 * that should edit it -- the numbers here have to describe the file
 * actually sitting in `public/`, and a hand-edited version string that
 * disagrees with the binary is worse than no version string.
 *
 * Worth knowing before wondering why this rarely changes: the APK is a
 * Trusted Web Activity -- a thin Android shell around tatocar.co, not
 * a copy of the app. Deploying the site updates what everyone sees
 * inside it immediately, with no new APK and nothing to reinstall.
 * This file only moves when the shell itself changes: its name, its
 * icon, the URL it opens, or the Android version it targets.
 */
export const ANDROID_RELEASE = {
  /** Matches the web app's version at the time the shell was built. */
  version: "0.71.0",
  /** Android's own monotonic counter. Must only ever increase, or a
   *  device will refuse the upgrade. */
  versionCode: 71,
  builtAt: "2026-09-15",
  fileName: "tato.apk",
  /** Stable on purpose: "the latest APK" should always be the same
   *  URL, so a link written down once keeps working. */
  path: "/tato.apk",
  sizeBytes: 904661,
  /** So a download can be checked against what was built here. */
  sha256: "8194282e089b96a72168bf8ee19b972ee2d2743018f2e740d5cdb1df6dcaafda",
} as const;

export function formatBytes(bytes: number) {
  if (bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}
