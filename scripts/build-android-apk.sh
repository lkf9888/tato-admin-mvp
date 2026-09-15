#!/bin/bash
set -euo pipefail

# Build, sign and publish the Android APK.
#
# The app is a Trusted Web Activity: a thin Android shell that opens
# tatocar.co with no browser chrome. It is not a copy of the site, so
# this script is NOT part of shipping a web change -- deploying the
# site updates what everyone sees inside the app immediately. Run this
# only when the shell itself changes: its name, its icon, the URL it
# opens, or the Android version it targets.
#
#   scripts/build-android-apk.sh [versionName] [versionCode]
#
# Both default to the values already in android/app/build.gradle.
#
# Requirements, all of which this checks for:
#   - JDK 21. Not 26: Gradle 8.11 rejects class file major version 70
#     with an error that names neither Java nor the version you need.
#   - Android SDK with build-tools and platform 36.
#   - android-signing/tato-release.keystore, which is gitignored and
#     exists only on the machine that made it. Losing it means a future
#     APK can no longer upgrade an installed one -- Android refuses an
#     update signed by a different key, so every user would have to
#     uninstall first. Back that directory up.

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$REPO/android"
KEYSTORE="$REPO/android-signing/tato-release.keystore"
CREDENTIALS="$REPO/android-signing/keystore-credentials.txt"
JAVA_HOME_21="${JAVA_HOME_21:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
SDK="${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}"

fail() { echo "error: $*" >&2; exit 1; }

[ -d "$ANDROID_DIR" ] || fail "no android/ project at $ANDROID_DIR"
[ -f "$KEYSTORE" ] || fail "no keystore at $KEYSTORE — it is gitignored, so a fresh clone will not have it"
[ -f "$CREDENTIALS" ] || fail "no keystore credentials at $CREDENTIALS"
[ -x "$JAVA_HOME_21/bin/java" ] || fail "no JDK 21 at $JAVA_HOME_21 (brew install openjdk@21)"
[ -d "$SDK" ] || fail "no Android SDK at $SDK"

# Newest build-tools wins; apksigner and zipalign both live there.
BUILD_TOOLS="$(ls -1 "$SDK/build-tools" | sort -V | tail -1)"
APKSIGNER="$SDK/build-tools/$BUILD_TOOLS/apksigner"
ZIPALIGN="$SDK/build-tools/$BUILD_TOOLS/zipalign"
[ -x "$APKSIGNER" ] || fail "no apksigner in build-tools $BUILD_TOOLS"

VERSION_NAME="${1:-}"
VERSION_CODE="${2:-}"
GRADLE_FILE="$ANDROID_DIR/app/build.gradle"

if [ -n "$VERSION_NAME" ]; then
  # `versionCode` must only ever increase or a device refuses the
  # upgrade, so it is set explicitly rather than derived from a string.
  [ -n "$VERSION_CODE" ] || fail "a versionName needs a versionCode with it"
  /usr/bin/sed -i '' -E "s/versionCode [0-9]+/versionCode $VERSION_CODE/" "$GRADLE_FILE"
  /usr/bin/sed -i '' -E "s/versionName \"[^\"]*\"/versionName \"$VERSION_NAME\"/" "$GRADLE_FILE"
fi

VERSION_NAME="$(grep -oE 'versionName "[^"]*"' "$GRADLE_FILE" | head -1 | sed -E 's/versionName "([^"]*)"/\1/')"
VERSION_CODE="$(grep -oE 'versionCode [0-9]+' "$GRADLE_FILE" | head -1 | awk '{print $2}')"
echo "building TATO $VERSION_NAME (code $VERSION_CODE)"

export JAVA_HOME="$JAVA_HOME_21"
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"

cd "$ANDROID_DIR"
./gradlew assembleRelease --no-daemon -q

UNSIGNED="$(find "$ANDROID_DIR/app/build/outputs/apk/release" -name "*.apk" | head -1)"
[ -n "$UNSIGNED" ] || fail "gradle produced no apk"

STOREPASS="$(grep '^storepass=' "$CREDENTIALS" | cut -d= -f2)"
ALIAS="$(grep '^alias=' "$CREDENTIALS" | cut -d= -f2)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# zipalign before signing, not after: apksigner's v2+ signatures cover
# the whole file, and realigning afterwards would invalidate them.
"$ZIPALIGN" -f -p 4 "$UNSIGNED" "$WORK/aligned.apk"
"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias "$ALIAS" \
  --ks-pass "pass:$STOREPASS" \
  --key-pass "pass:$STOREPASS" \
  --out "$WORK/tato.apk" \
  "$WORK/aligned.apk"
"$APKSIGNER" verify --print-certs "$WORK/tato.apk" > "$WORK/verify.txt"
grep -q "SHA-256 digest" "$WORK/verify.txt" || fail "signature did not verify"

mkdir -p "$REPO/public"
cp "$WORK/tato.apk" "$REPO/public/tato.apk"

SIZE="$(stat -f%z "$REPO/public/tato.apk")"
SHA="$(shasum -a 256 "$REPO/public/tato.apk" | awk '{print $1}')"
BUILT_AT="$(date +%Y-%m-%d)"

# The metadata the settings page reads. Rewritten here so the version,
# size and hash always describe the file that was just copied.
/usr/bin/sed -i '' \
  -e "s/  version: \"[^\"]*\"/  version: \"$VERSION_NAME\"/" \
  -e "s/  versionCode: [0-9]*/  versionCode: $VERSION_CODE/" \
  -e "s/  builtAt: \"[^\"]*\"/  builtAt: \"$BUILT_AT\"/" \
  -e "s/  sizeBytes: [0-9]*/  sizeBytes: $SIZE/" \
  -e "s/  sha256: \"[^\"]*\"/  sha256: \"$SHA\"/" \
  "$REPO/lib/android-release.ts"

echo
echo "public/tato.apk  $VERSION_NAME (code $VERSION_CODE)  $((SIZE / 1024)) KB"
echo "sha256 $SHA"
grep -A1 "Signer #1 certificate SHA-256 digest" "$WORK/verify.txt" | head -2
echo
echo "If the signing certificate above changed, update the fingerprint in"
echo "app/.well-known/assetlinks.json/route.ts or the app will show a URL bar."
