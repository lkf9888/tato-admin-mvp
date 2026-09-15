import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

/**
 * Digital Asset Links: this site vouching for the Android app.
 *
 * The APK is a Trusted Web Activity -- a Chrome window with no browser
 * chrome, pointed at this origin. Chrome only drops the URL bar if the
 * site it is showing says, here, that it trusts the app requesting it.
 * Without this file the app still works and still installs; it just
 * runs with an address bar pinned to the top, which is the difference
 * between something that looks like an app and something that looks
 * like a bookmark.
 *
 * The fingerprint is the SHA-256 of the certificate the APK is signed
 * with. It is public by construction -- anyone holding the APK can
 * read it out of the signature -- so it is committed rather than kept
 * in an env var. The private key it corresponds to is not in this
 * repository and never should be.
 *
 * If the signing key is ever replaced, this fingerprint has to be
 * replaced with it, or the URL bar comes back with no other symptom.
 */
const SHA256_CERT_FINGERPRINT =
  "1C:F8:69:87:E1:46:02:C7:12:91:1C:99:11:85:05:B4:71:3F:C7:BD:56:1B:07:4D:3C:D4:6F:64:0B:BD:B0:FB";

export async function GET() {
  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "co.tatocar.app",
          sha256_cert_fingerprints: [SHA256_CERT_FINGERPRINT],
        },
      },
    ],
    {
      headers: {
        // Chrome fetches this itself, from its own network stack rather
        // than the page's, so it is not subject to the page's CORS --
        // but it is cached, and a wrong answer cached is a URL bar that
        // will not go away for a day. An hour is long enough to avoid
        // hammering and short enough to fix a mistake the same morning.
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
