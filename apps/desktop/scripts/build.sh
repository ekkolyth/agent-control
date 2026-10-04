#!/usr/bin/env bash
# Build, sign, notarize, and staple Agent Control.app. Runs on macOS only.
#   CODESIGN_IDENTITY    "Developer ID Application: …" (security find-identity -v -p codesigning)
#   APPLE_API_KEY_PATH   App Store Connect API key (.p8) used by notarytool
#   APPLE_API_KEY_ID     that key's id
#   APPLE_API_ISSUER_ID  that key's issuer id
set -euo pipefail

: "${CODESIGN_IDENTITY:?set CODESIGN_IDENTITY to your Developer ID Application identity}"
: "${APPLE_API_KEY_PATH:?set APPLE_API_KEY_PATH to the App Store Connect API key (.p8)}"
: "${APPLE_API_KEY_ID:?set APPLE_API_KEY_ID}"
: "${APPLE_API_ISSUER_ID:?set APPLE_API_ISSUER_ID}"

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"
BUILD_DIR="$DESKTOP_DIR/build"
APP="$BUILD_DIR/Agent Control.app"
SERVER_BIN="$REPO_ROOT/apps/server/dist/agent-control-server"
VERSION="$(jq -r .version "$DESKTOP_DIR/package.json")"
NOTARY_AUTH=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER_ID")

(cd "$REPO_ROOT" && bun run --filter @agent-control/server build)

cd "$DESKTOP_DIR"
swift test
RELEASE_FLAGS=(-c release --arch arm64)
swift build "${RELEASE_FLAGS[@]}"
SWIFT_BIN="$(swift build "${RELEASE_FLAGS[@]}" --show-bin-path)/AgentControl"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp Resources/Info.plist "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP/Contents/Info.plist"
cp "$SWIFT_BIN" "$APP/Contents/MacOS/Agent Control"
cp "$SERVER_BIN" "$APP/Contents/MacOS/agent-control-server"

# inside-out: the nested binary is sealed before the bundle that contains it
codesign --force --options runtime --timestamp \
  --entitlements entitlements.plist \
  --sign "$CODESIGN_IDENTITY" "$APP/Contents/MacOS/agent-control-server"
codesign --force --options runtime --timestamp \
  --sign "$CODESIGN_IDENTITY" "$APP"
codesign --verify --strict --verbose=2 "$APP"

SUBMISSION_ZIP="$BUILD_DIR/notarize.zip"
rm -f "$SUBMISSION_ZIP"
ditto -c -k --keepParent "$APP" "$SUBMISSION_ZIP"

# submit --wait exits 0 even when Apple rejects the build, so read the status
SUBMISSION="$(xcrun notarytool submit "$SUBMISSION_ZIP" "${NOTARY_AUTH[@]}" --wait --output-format json)"
echo "$SUBMISSION"
SUBMISSION_ID="$(jq -r '.id // empty' <<<"$SUBMISSION")"
SUBMISSION_STATUS="$(jq -r '.status // "Unknown"' <<<"$SUBMISSION")"
if [ -z "$SUBMISSION_ID" ]; then
  echo "notarytool submit returned no submission id" >&2
  exit 1
fi
if [ "$SUBMISSION_STATUS" != "Accepted" ]; then
  echo "notarization $SUBMISSION_STATUS (submission $SUBMISSION_ID). notarytool log:" >&2
  xcrun notarytool log "$SUBMISSION_ID" "${NOTARY_AUTH[@]}" >&2
  exit 1
fi

xcrun stapler staple "$APP"
spctl --assess --type execute --verbose "$APP"

# zipped after stapling so the download carries the ticket
RELEASE_ZIP="$BUILD_DIR/Agent-Control-$VERSION-arm64.zip"
rm -f "$RELEASE_ZIP"
ditto -c -k --keepParent "$APP" "$RELEASE_ZIP"

echo "built $RELEASE_ZIP"
