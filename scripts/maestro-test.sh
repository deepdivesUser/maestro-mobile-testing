#!/usr/bin/env bash
# Run Maestro tests against a discovered or specified device
# Usage:
#   ./scripts/maestro-test.sh smoke                     # auto-detect device, run smoke
#   ./scripts/maestro-test.sh all --ios                 # auto-detect iOS, run everything
#   ./scripts/maestro-test.sh smoke --device <udid>     # specific device
#   ./scripts/maestro-test.sh regression --env staging  # with env file

set -euo pipefail

MAESTRO_BIN="${MAESTRO_BIN:-maestro}"
FLOW_DIR=".maestro/flows"
ENV_FILE=""
SPECIFIED_DEVICE=""
PLATFORM_FILTER=""

# --- Parse args ---
SUITE="smoke"
for arg in "$@"; do
  case "$arg" in
    --env=*)   ENV_FILE=".env.${arg#*=}" ;;
    --env)     shift; ENV_FILE=".env.$1" ;;
    --device=*) SPECIFIED_DEVICE="${arg#*=}" ;;
    --device)  shift; SPECIFIED_DEVICE="$1" ;;
    --ios)     PLATFORM_FILTER="ios" ;;
    --android) PLATFORM_FILTER="android" ;;
    smoke|auth|regression|e2e|all) SUITE="$arg" ;;
  esac
done

# --- Load env ---
if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
  echo "✅ Loaded $ENV_FILE"
fi

# --- Resolve flow directory ---
case "$SUITE" in
  smoke)     TARGET_DIR="$FLOW_DIR/smoke/" ;;
  auth)      TARGET_DIR="$FLOW_DIR/auth/" ;;
  regression) TARGET_DIR="$FLOW_DIR/regression/" ;;
  e2e)       TARGET_DIR="$FLOW_DIR/e2e/" ;;
  all)       TARGET_DIR="$FLOW_DIR/" ;;
  *)         echo "❌ Unknown suite: $SUITE"; exit 1 ;;
esac

# --- Discover or use specified device ---
DEVICE_ID=""
if [[ -n "$SPECIFIED_DEVICE" ]]; then
  DEVICE_ID="$SPECIFIED_DEVICE"
  echo "📱 Using specified device: $DEVICE_ID"
else
  echo "🔍 Discovering devices..."
  DISCOVERY=$("$(dirname "$0")/discover-devices.sh" --json 2>/dev/null || echo '{}')
  TOTAL=$(echo "$DISCOVERY" | jq -r '.total // 0')

  if [[ "$TOTAL" -eq 0 ]]; then
    echo "❌ No devices found. Launching one..." >&2
    LAUNCH_TARGET="$PLATFORM_FILTER"
    [[ -n "$PLATFORM_FILTER" ]] || LAUNCH_TARGET=""
    SOURCE "$("$(dirname "$0")/launch-device.sh" $LAUNCH_TARGET)"
    echo "✅ Device launched"
  else
    # Pick first available based on platform filter
    if [[ "$PLATFORM_FILTER" == "ios" ]]; then
      DEVICE_ID=$(echo "$DISCOVERY" | jq -r '.ios_simulators[0].udid // .ios_physical[0].udid // empty')
    elif [[ "$PLATFORM_FILTER" == "android" ]]; then
      DEVICE_ID=$(echo "$DISCOVERY" | jq -r '.android_avds[0].name // .android_physical[0].serial // empty')
    else
      DEVICE_ID=$(echo "$DISCOVERY" | jq -r '
        (.ios_simulators[0].udid // empty) //
        (.android_avds[0].name // empty) //
        (.ios_physical[0].udid // empty) //
        (.android_physical[0].serial // empty)
      ')
    fi
    echo "📱 Auto-selected device: $DEVICE_ID"
  fi
fi

# --- Run Maestro ---
MAESTRO_FLAGS=("--env" "DEVICE_ID=$DEVICE_ID")
if [[ -n "${APP_ID:-}" ]]; then
  MAESTRO_FLAGS+=("--env" "APP_ID=$APP_ID")
fi

echo "🚀 Running [$SUITE] tests on $DEVICE_ID..."
$MAESTRO_BIN test "${MAESTRO_FLAGS[@]}" "$TARGET_DIR"
echo "✅ [$SUITE] complete"