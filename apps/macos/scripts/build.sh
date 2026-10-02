#!/usr/bin/env bash
# Build, sign, notarize, and staple Agent Control.app. Runs on macOS only.
#   CODESIGN_IDENTITY  "Developer ID Application: …" (security find-identity -v -p codesigning)
#   NOTARY_PROFILE     keychain profile saved with `xcrun notarytool store-credentials`
set -euo pipefail

: "${CODESIGN_IDENTITY:?set CODESIGN_IDENTITY to your Developer ID Application identity}"
: "${NOTARY_PROFILE:?set NOTARY_PROFILE to your notarytool keychain profile}"

MACOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$MACOS_DIR/../.." && pwd)"
BUILD_DIR="$MACOS_DIR/build"
APP="$BUILD_DIR/Agent Control.app"
SERVER_BIN="$REPO_ROOT/apps/server/dist/agent-control-server"

(cd "$REPO_ROOT" && bun run --filter @agent-control/server build)

cd "$MACOS_DIR"
swift test
swift build -c release --arch arm64
SWIFT_BIN="$(swift build -c release --arch arm64 --show-bin-path)/AgentControl"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp Resources/Info.plist "$APP/Contents/Info.plist"
cp "$SWIFT_BIN" "$APP/Contents/MacOS/Agent Control"
cp "$SERVER_BIN" "$APP/Contents/MacOS/agent-control-server"

# inside-out: the nested binary is sealed before the bundle that contains it
codesign --force --options runtime --timestamp \
  --entitlements entitlements.plist \
  --sign "$CODESIGN_IDENTITY" "$APP/Contents/MacOS/agent-control-server"
codesign --force --options runtime --timestamp \
  --sign "$CODESIGN_IDENTITY" "$APP"
codesign --verify --strict --verbose=2 "$APP"

ZIP="$BUILD_DIR/Agent Control.zip"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$APP"
spctl --assess --type execute --verbose "$APP"

echo "built $APP"
