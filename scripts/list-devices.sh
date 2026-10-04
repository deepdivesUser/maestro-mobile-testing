#!/usr/bin/env bash
# Quick alias: just list devices (human-readable)
# Usage: ./scripts/list-devices.sh
"$(dirname "$0")/discover-devices.sh" "$@"