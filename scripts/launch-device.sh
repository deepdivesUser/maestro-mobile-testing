#!/usr/bin/env bash
# Boot a simulator or emulator by name/udid/serial (or auto-pick the first available)
# Usage:
#   ./scripts/launch-device.sh                     # auto-pick first available
#   ./scripts/launch-device.sh ios                 # auto-pick first iOS simulator
#   ./scripts/launch-device.sh android             # auto-pick first Android emulator
#   ./scripts/launch-device.sh <udid|avd_name>     # launch specific device

set -euo pipefail

TARGET="${1:-}"
BOOT_TIMEOUT=120  # seconds

# --- Helpers ---
boot_ios_simulator() {
  local udid="$1"
  echo "🍎 Booting iOS simulator $udid..."
  xcrun simctl boot "$udid" 2>/dev/null || true  # already booted is fine
  xcrun simctl list devices | grep -q "Booted" || open -a Simulator
  echo "✅ iOS simulator ready ($udid)"
  echo "DEVICE_ID=$udid"
}

boot_android_emulator() {
  local avd="$1"
  local emu_cmd
  emu_cmd="$(command -v emulator || echo "${ANDROID_HOME:-$HOME/Android/Sdk}/emulator/emulator")"
  if [[ ! -x "$emu_cmd" ]]; then
    echo "❌ Android emulator binary not found (set ANDROID_HOME)" >&2
    exit 1
  fi
  echo "🤖 Booting Android emulator '$avd'..."
  # Launch in background, wait for boot
  "$emu_cmd" -avd "$avd" -no-snapshot-load &
  local pid=$!
  echo "   PID: $pid"

  # Wait for device to appear in adb
  local elapsed=0
  echo "   Waiting for boot (timeout ${BOOT_TIMEOUT}s)..."
  while [[ $elapsed -lt $BOOT_TIMEOUT ]]; do
    if adb shell getprop sys.boot_completed 2>/dev/null | grep -q '1'; then
      echo "✅ Android emulator ready ($avd)"
      echo "DEVICE_ID=emulator-5554"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    printf '   \r   Waiting... %ds/%ds' "$elapsed" "$BOOT_TIMEOUT"
  done
  echo ""
  echo "❌ Emulator did not boot within ${BOOT_TIMEOUT}s" >&2
  kill "$pid" 2>/dev/null || true
  return 1
}

# --- Auto-discovery ---
if [[ -z "$TARGET" || "$TARGET" == "ios" || "$TARGET" == "android" ]]; then
  if [[ -z "$TARGET" || "$TARGET" == "ios" ]]; then
    if command -v xcrun &>/dev/null; then
      FIRST_UDID=$(xcrun simctl list devices available | grep -E '^  [A-Za-z]' | head -1 | sed 's/.*(\([^)]*\)).*/\1/' | xargs)
      if [[ -n "$FIRST_UDID" ]]; then
        boot_ios_simulator "$FIRST_UDID"
        exit 0
      fi
    fi
  fi

  if [[ -z "$TARGET" || "$TARGET" == "android" ]]; then
    if command -v emulator &>/dev/null; then
      FIRST_AVD=$(emulator -list-avds 2>/dev/null | head -1)
      if [[ -n "$FIRST_AVD" ]]; then
        boot_android_emulator "$FIRST_AVD"
        exit 0
      fi
    fi
  fi

  echo "❌ No available device found for platform '${TARGET:-any}'" >&2
  echo "" >&2
  echo "Available devices:" >&2
  "$(dirname "$0")/discover-devices.sh" >&2
  exit 1
fi

# --- Specific target ---
if command -v xcrun &>/dev/null && xcrun simctl list devices | grep -q "$TARGET"; then
  boot_ios_simulator "$TARGET"
  exit 0
fi

if command -v emulator &>/dev/null && emulator -list-avds 2>/dev/null | grep -qxF "$TARGET"; then
  boot_android_emulator "$TARGET"
  exit 0
fi

echo "❌ '$TARGET' is not a known simulator UDID or Android AVD name" >&2
exit 1
