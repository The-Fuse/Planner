#!/bin/bash
# Auto re-sign + reinstall the UPSC planner on a paired iPhone.
# Free-account provisioning profiles expire every 7 days; this script,
# run twice a week by launchd, renews the profile (-allowProvisioningUpdates)
# and reinstalls the app whenever the phone is reachable (USB or Wi-Fi pairing).
#
# One-time setup (see README-ios.md):
#   1. Add your Apple ID in Xcode ▸ Settings ▸ Accounts (Personal Team)
#   2. Select that team once for both targets (App, PlannerWidget) in Xcode
#   3. echo "YOURTEAMID" > ~/.upsc-planner-team
#   4. Pair the iPhone once (plug in, trust, enable Developer Mode)
set -uo pipefail

APP_DIR="$HOME/Documents/kr1da/pllanner/frontend/ios/App"
DD="$HOME/Library/Caches/upsc-planner-build"
LOG="$HOME/Library/Logs/upsc-planner-refresh.log"
TEAM_FILE="$HOME/.upsc-planner-team"

exec >> "$LOG" 2>&1
echo "== $(date) =="

if [ ! -f "$TEAM_FILE" ]; then
  echo "no team id configured (~/.upsc-planner-team missing) — skipping"
  exit 0
fi
TEAM_ID="$(tr -d '[:space:]' < "$TEAM_FILE")"

DEVICE_ID="$(xcrun devicectl list devices --json-output /tmp/upsc-devices.json >/dev/null 2>&1 && \
  python3 -c "
import json
d = json.load(open('/tmp/upsc-devices.json'))
for dev in d.get('result', {}).get('devices', []):
    props = dev.get('deviceProperties', {})
    hw = dev.get('hardwareProperties', {})
    if hw.get('deviceType') == 'iPhone':
        print(dev.get('identifier', ''))
        break
")"

if [ -z "$DEVICE_ID" ]; then
  echo "no paired iPhone reachable — will retry next run"
  exit 0
fi

echo "building for device (team $TEAM_ID)..."
xcodebuild -project "$APP_DIR/App.xcodeproj" -scheme App -configuration Release \
  -destination "generic/platform=iOS" -derivedDataPath "$DD" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic build || {
    echo "build failed — open Xcode once; your Apple ID session may need re-login"
    exit 1
  }

echo "installing on $DEVICE_ID..."
xcrun devicectl device install app --device "$DEVICE_ID" \
  "$DD/Build/Products/Release-iphoneos/App.app" && echo "refreshed OK"
