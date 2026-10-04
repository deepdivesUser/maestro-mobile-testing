#!/usr/bin/env bash
# Discover all available iOS simulators, Android emulators, and physical devices
# Usage: ./scripts/discover-devices.sh [--json]

set -euo pipefail

JSON_MODE=false
[[ "${1:-}" == "--json" ]] && JSON_MODE=true

divider() { $JSON_MODE || printf '\n─── %s ───\n' "$1"; }

# --- iOS Simulators ---
iOS_SIMULATORS=()
if command -v xcrun &>/dev/null; then
  while IFS= read -r line; do
    udid=$(echo "$line" | awk -F'\\(|\\)' '{print $2}' | xargs)
    name=$(echo "$line" | awk -F'\\(' '{print $1}' | xargs)
    os=$(echo "$line" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
    [[ -n "$udid" && -n "$name" ]] && iOS_SIMULATORS+=("$udid|$name|$os")
  done < <(xcrun simctl list devices available | grep -E '^  [A-Za-z]' | sed 's/^  //')
fi

# --- Android AVDs ---
ANDROID_AVDS=()
if command -v emulator &>/dev/null; then
  while IFS= read -r avd; do
    [[ -n "$avd" ]] && ANDROID_AVDS+=("$avd")
  done < <(emulator -list-avds 2>/dev/null)
fi

# --- Android Physical Devices ---
ANDROID_PHYSICAL=()
if command -v adb &>/dev/null; then
  while IFS= read -r line; do
    serial=$(echo "$line" | awk '{print $1}')
    model=$(adb -s "$serial" shell getprop ro.product.model 2>/dev/null | tr -d '\r' || echo "unknown")
    [[ -n "$serial" && "$serial" != "List" ]] && ANDROID_PHYSICAL+=("$serial|$model")
  done < <(adb devices 2>/dev/null | tail -n +2)
fi

# --- iOS Physical Devices ---
IOS_PHYSICAL=()
if command -v xcrun &>/dev/null && command -v ios-deploy &>/dev/null; then
  while IFS= read -r line; do
    udid=$(echo "$line" | awk '{print $NF}')
    name=$(echo "$line" | sed "s/ ($udid)//")
    [[ -n "$udid" ]] && IOS_PHYSICAL+=("$udid|$name")
  done < <(xcrun xctrace list devices 2>/dev/null | grep -E '^[A-Za-z]' | grep -v 'Simulator')
fi

# --- Helpers for empty-array-safe JSON ---
arr_to_json() {
  local format="$1"; shift
  if [[ $# -eq 0 ]]; then echo '[]'; return; fi
  printf '%s\n' "$@" | jq -R -s "$format" 2>/dev/null || echo '[]'
}

# --- Output ---
if $JSON_MODE; then
  ios_sims_json=$(arr_to_json '
    split("\n") | map(select(length > 0)) | map(
      split("|") | {
        udid: .[0],
        name: .[1],
        os: (.[2] // "unknown")
      }
    )' "${iOS_SIMULATORS[@]+${iOS_SIMULATORS[@]}}")

  android_avds_json=$(arr_to_json '
    split("\n") | map(select(length > 0)) | map({ name: . })' "${ANDROID_AVDS[@]+${ANDROID_AVDS[@]}}")

  android_phys_json=$(arr_to_json '
    split("\n") | map(select(length > 0)) | map(
      split("|") | { serial: .[0], model: (.[1] // "unknown") }
    )' "${ANDROID_PHYSICAL[@]+${ANDROID_PHYSICAL[@]}}")

  ios_phys_json=$(arr_to_json '
    split("\n") | map(select(length > 0)) | map(
      split("|") | { udid: .[0], name: (.[1] // "unknown") }
    )' "${IOS_PHYSICAL[@]+${IOS_PHYSICAL[@]}}")

  jq -n \
    --argjson ios_simulators "$ios_sims_json" \
    --argjson android_avds "$android_avds_json" \
    --argjson android_physical "$android_phys_json" \
    --argjson ios_physical "$ios_phys_json" \
    '{
      ios_simulators: $ios_simulators,
      android_avds: $android_avds,
      android_physical: $android_physical,
      ios_physical: $ios_physical,
      total: ($ios_simulators | length) + ($android_avds | length) + ($android_physical | length) + ($ios_physical | length)
    }'
  exit 0
fi

# --- Human-readable output ---
TOTAL=0

if [[ ${#iOS_SIMULATORS[@]} -gt 0 ]]; then
  divider "iOS Simulators (${#IOS_SIMULATORS[@]})"
  for entry in "${IOS_SIMULATORS[@]+${iOS_SIMULATORS[@]}}"; do
    IFS='|' read -r udid name os <<< "$entry"
    printf "  %-35s  %-45s  iOS %s\n" "$udid" "$name" "$os"
  done
  TOTAL=$((TOTAL + ${#IOS_SIMULATORS[@]}))
fi

if [[ ${#IOS_PHYSICAL[@]} -gt 0 ]]; then
  divider "iOS Physical Devices (${#IOS_PHYSICAL[@]})"
  for entry in "${IOS_PHYSICAL[@]+${IOS_PHYSICAL[@]}}"; do
    IFS='|' read -r udid name <<< "$entry"
    printf "  %-35s  %s\n" "$udid" "$name"
  done
  TOTAL=$((TOTAL + ${#IOS_PHYSICAL[@]}))
fi

if [[ ${#ANDROID_AVDS[@]} -gt 0 ]]; then
  divider "Android Emulators (${#ANDROID_AVDS[@]})"
  for avd in "${ANDROID_AVDS[@]+${ANDROID_AVDS[@]}}"; do
    printf "  %s\n" "$avd"
  done
  TOTAL=$((TOTAL + ${#ANDROID_AVDS[@]}))
fi

if [[ ${#ANDROID_PHYSICAL[@]} -gt 0 ]]; then
  divider "Android Physical Devices (${#ANDROID_PHYSICAL[@]})"
  for entry in "${ANDROID_PHYSICAL[@]+${ANDROID_PHYSICAL[@]}}"; do
    IFS='|' read -r serial model <<< "$entry"
    printf "  %-20s  %s\n" "$serial" "$model"
  done
  TOTAL=$((TOTAL + ${#ANDROID_PHYSICAL[@]}))
fi

if [[ $TOTAL -eq 0 ]]; then
  echo "\n⚠️  No devices, simulators, or emulators found."
  echo "   • iOS: ensure Xcode CLI tools are installed"
  echo "   • Android: ensure ANDROID_HOME is set and AVDs are created"
  exit 1
fi

echo ""
echo "Total: $TOTAL device(s) found"
