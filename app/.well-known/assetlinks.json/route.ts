import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

/**
 * Digital Asset Links: this site vouching for the Android app.
 *
 * What it buys, now that the app is a WebView rather than a Trusted
 * Web Activity, is App Links: Android fetches this file, checks the
 * signing certificate against the app claiming tatocar.co, and if they
 * match, a tapped link to the site opens the app instead of a browser.
 *
 * Nothing breaks without it. Verification simply fails and links fall
 * back to the browser, which is also what happens on a device where
 * the app is not installed -- so the failure mode is "the old
 * behaviour", not an error.
 *
 * The fingerprint is the SHA-256 of the certificate the APK is signed
 * with. It is public by construction -- anyone holding the APK can
 * read it out of the signature -- so it is committed rather than kept
 * in an env var. The private key it corresponds to is not in this
 * repository and never should be.
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
        // Android fetches this at install time and re-checks
        // periodically, on its own network stack rather than the
        // page's. Cached for an hour: long enough to avoid hammering,
        // short enough that a wrong answer can be fixed the same
        // morning rather than waiting out a day-long TTL.
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
