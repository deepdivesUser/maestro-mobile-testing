# Maestro Mobile Testing Repository

Mobile UI testing with [maestro.dev](https://maestro.mobile.dev).

## Prerequisites

- [Maestro CLI](https://maestro.mobile.dev/getting-started/installation) installed
- At least one of:
  - **iOS:** Xcode CLI tools (for simulators) — `xcode-select --install`
  - **Android:** Android SDK with `emulator` and `adb` on PATH
- Your app installed on the target device/emulator

## Project Structure

```
.maestro/
  flows/
    auth/           # Login, signup, logout flows
    smoke/          # Quick smoke tests
    regression/     # Regression test suite
    e2e/            # End-to-end test scenarios
    common/         # Reusable subflows (macros)
  fixtures/        # Test data / asset files
scripts/
  discover-devices.sh   # Find all local simulators, emulators, and physical devices
  launch-device.sh      # Boot a simulator/emulator by name or auto-pick
  maestro-test.sh       # Full test runner: discover → launch → test
  list-devices.sh       # Shorthand for discover-devices.sh
.github/workflows/
  maestro-tests.yml     # GitHub Actions CI
```

## Device Discovery

The `scripts/discover-devices.sh` script scans for everything on the local machine:

| Platform | Source | Command used |
|----------|--------|--------------|
| iOS Simulators | Xcode | `xcrun simctl list devices available` |
| iOS Physical | Xcode / ios-deploy | `xcrun xctrace list devices` |
| Android Emulators | Android SDK | `emulator -list-avds` |
| Android Physical | ADB | `adb devices` |

```bash
# List all devices (human-readable)
make discover
# or
./scripts/list-devices.sh

# JSON output (for scripting)
./scripts/discover-devices.sh --json
```

Example output:

```
─── iOS Simulators (3) ───
  A1B2C3D4-E5F6-7890-ABCD-EF1234567890  iPhone 16                              iOS 18.2
  1A2B3C4D-5E6F-7890-ABCD-EF1234567890  iPad Pro 13-inch (M4)                 iOS 18.2

─── Android Emulators (2) ───
  Pixel_8_API_34
  Pixel_Tablet_API_34

─── Android Physical Devices (1) ───
  R5CT10XXXXX         Pixel 8 Pro

Total: 6 device(s) found
```

## Running Tests

### Auto-discover device and run

```bash
# Auto-detect any device, run smoke tests
make test-smoke

# Auto-detect Android device specifically
./scripts/maestro-test.sh smoke --android

# Auto-detect iOS, run full suite, load staging env
make test-all ENV=staging

# Use a specific device
make test-smoke DEVICE=A1B2C3D4-E5F6-7890-ABCD-EF1234567890
```

### Boot a device first

```bash
# Auto-pick and boot the first available device
make launch

# Boot a specific platform
make launch-ios
make launch-android

# Boot a specific AVD or simulator
./scripts/launch-device.sh Pixel_8_API_34
./scripts/launch-device.sh A1B2C3D4-E5F6-7890-ABCD-EF1234567890
```

### Direct maestro (skip discovery, for CI)

```bash
make maestro-smoke APP_ID=com.example.app
make maestro-all APP_ID=com.example.app
```

## Writing Flows

Maestro flows are YAML files. See the [Maestro documentation](https://maestro.mobile.dev/) for the full API.

### Key patterns

- **Subflows** — Reusable flows imported via `runFlow` in `common/`
- **Environment variables** — Use `${ENV_VAR}` syntax for dynamic values
- **Device ID** — `${DEVICE_ID}` is automatically set by the test runner

### Locator Strategy

Maestro resolves elements in a priority order: `id` → `text` → `textRegex` → `label` → `className` → relative position (`below`/`above`/`leftOf`/`rightOf`) → `image` → `containsChild` → `index`. See the full [locator hierarchy guide](docs/locator-hierarchy.md) for details, decision trees, and debugging tips.

## Environment Files

- `.env.staging` — Staging app ID and credentials
- `.env.production` — Production app ID and credentials

Load with `--env=<name>`:

```bash
make test-smoke ENV=production
```

## CI

See `.github/workflows/maestro-tests.yml` for a GitHub Actions example that runs smoke tests on PRs and the full suite on push.