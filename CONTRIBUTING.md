# Contributing

This file contains the development, testing, and release-maintenance notes for Nutrino. The README is intentionally kept user-facing.

- [Development setup](#development-setup)
- [Repository commands](#repository-commands)
- [WIP commits](#wip-commits)
- [Quality gates](#quality-gates)
- [Testing expectations](#testing-expectations)
- [Tooling conventions](#tooling-conventions)
- [Release maintenance](#release-maintenance)
- [Android signing](#android-signing)

## Development setup

Install the local toolchain through mise and aube:

```bash
mise trust
mise install
aube install
```

Install hooks once per clone:

```bash
hk install
```

The repository uses `hk` directly for Git hooks. `pre-commit` only runs fast JavaScript and Rust formatters, so commits stay quick while formatting drift is fixed before it reaches a push. `pre-push` is the quality gate: it checks formatting, JavaScript linting, Vitest unit tests, app-domain checks, i18n checks, Android bridge checks, release workflow checks, Rust/Tauri checks, and web builds before code is pushed. Re-run `hk install` after changing `hk.pkl`. If an older local hook path is still configured, clear it once with `git config --local --unset-all core.hooksPath`.

Run the apps locally:

```bash
aube run dev:desktop
aube run init:android
aube run dev:android
aube run init:ios
aube run dev:ios
```

Build locally:

```bash
aube run build:desktop
aube run build:android
aube run build:ios
```

Android and iOS builds require the native platform toolchains to be installed and configured on the host machine.

## Repository commands

Run the same full gate that `pre-push` uses:

```bash
aube run quality:push
```

Run focused gates when narrowing down a failure:

```bash
aube run test:js
aube run test:app
aube run test:rust
aube run check:i18n
aube run check:release-workflows
```

Format sources:

```bash
aube run format
aube run format:check
```

Run hook checks manually:

```bash
hk run pre-push
hk check
```

When debugging hidden hook output, use:

```bash
hk check -v
HK_LOG=debug hk run pre-push
```

Run hook formatters manually:

```bash
hk fix
```

`pre-commit` runs formatter fix steps only. `pre-push` runs separate visible steps for JavaScript formatting checks, Rust formatting checks, JavaScript linting, Vitest unit tests, app-domain checks, i18n checks, Android bridge checks, release workflow checks, Rust/Tauri checks, and web builds. Each check step depends on the formatter check steps, so tests do not race against formatting validation. Use `hk fix` or `aube run format` manually when you want to format without committing.

## WIP commits

Commits whose subject starts with `wip`, `wip:`, `wip -`, or a similar WIP prefix are treated as intentionally incomplete.

The Test workflow checks the HEAD commit subject before starting expensive jobs. For WIP commits, the workflow blocks in the small WIP guard job and skips the JavaScript and Rust quality jobs. This prevents a WIP push from looking like a valid green run while avoiding wasted CI time.

Rename the commit to a normal Conventional Commit subject before expecting CI to pass.

## Quality gates

JavaScript and TypeScript quality uses:

```text
Oxlint
Oxfmt
Vitest
repository invariant scripts
Vue SFC and i18n checks
```

Rust quality uses:

```text
rustfmt
clippy with -D warnings
cargo metadata
cargo check
cargo test
```

The mobile Tauri crate is validated with metadata on Linux because mobile-only capabilities are not always checkable as a normal host desktop crate. The desktop crate is formatted, checked, linted, and tested with Cargo.

## Testing expectations

Feature work should add or update tests close to the behavior being changed.

Use Vitest for pure app-domain behavior, including:

```text
food and recipe calculations
fluid tracking
alcohol kcal estimates
meal preparation kcal adjustments
piece-serving behavior
catalog alias resolution
backup and persisted-state normalization
release update selection
```

Use Rust tests for desktop-side behavior, including:

```text
catalog duplicate detection helpers
sync payload privacy rules
normalization helpers
signature/key generation
safe data cleanup before desktop inbox persistence
```

Use repository check scripts for workflow and configuration invariants that are easy to break but awkward to unit test.

## Tooling conventions

Across Verzly projects, the preferred quality stack is:

```text
PHP    -> Rector + Pest
JS/TS  -> Oxlint + Oxfmt + Vitest
Rust   -> rustfmt + clippy + cargo test
```

Nutrino currently has no PHP package, so Rector and Pest are not installed here. If PHP code is added later, it should follow that convention instead of introducing a separate PHP quality stack.

## Release maintenance

Nutrino release automation is split by responsibility:

```text
verzly/repository      -> shared repository policy, quality/release target validation
verzly/rust-cache      -> project-local Rust, Tauri, and Gradle cache routing
verzly/github-release  -> release branch, version bump, merge, tag, release, cleanup
verzly/tauri-release   -> Android, iOS, Windows, macOS, Linux artifacts
verzly/android-signing -> Android release keystore helper
```

Repository policy and shared cache paths are configured in:

```text
datarose.toml
.cargo/config.toml
```

Versioned files are configured in:

```text
.github/release/nutrino.github-release.toml
```

Platform build profiles are configured in:

```text
.github/release/nutrino-desktop.tauri-release.toml
.github/release/nutrino-mobile.tauri-release.toml
```

The manual delete-release workflow is available at:

```text
.github/workflows/delete-release.yml
```

It requires an explicit confirmation phrase before deleting a GitHub Release or tag.

## Android signing

Nutrino uses `verzly/android-signing` through mise for local release-key work and through GitHub Actions for CI fingerprint verification. The tool is pinned in `mise.toml`.

Install it with the rest of the local toolchain:

```bash
mise install
mise exec -- android-signing --version
```

Create the stable Android release key once. Do not regenerate this key for later releases:

```bash
mkdir -p apps/mobile/src-tauri/gen/android
android-signing generate --output apps/mobile/src-tauri/gen/android/nutrino-release-keystore.jks --alias nutrino-release
android-signing fingerprint apps/mobile/src-tauri/gen/android/nutrino-release-keystore.jks --alias nutrino-release
android-signing base64 apps/mobile/src-tauri/gen/android/nutrino-release-keystore.jks --output apps/mobile/src-tauri/gen/android/nutrino-release-keystore.jks.base64
android-signing print-secrets apps/mobile/src-tauri/gen/android/nutrino-release-keystore.jks --alias nutrino-release
```

For local stable release APK builds, create `apps/mobile/src-tauri/gen/android/keystore.properties` next to the keystore:

```properties
storeFile=nutrino-release-keystore.jks
storePassword=<keystore password>
keyAlias=nutrino-release
keyPassword=<key password>
```

Keep the keystore, passwords, and base64 file out of Git. The generated Android signing files under `apps/mobile/src-tauri/gen/android` are ignored by `.gitignore`.

Configure GitHub Actions with these values:

```text
ANDROID_KEYSTORE_BASE64        secret, from nutrino-release-keystore.jks.base64
ANDROID_KEYSTORE_PASSWORD      secret
ANDROID_KEY_ALIAS              secret, usually nutrino-release
ANDROID_KEY_PASSWORD           secret
ANDROID_SIGNING_CERT_SHA256    repository variable preferred, secret also supported
```

The Android release workflow decodes the keystore into a temporary file and runs `verzly/android-signing@v0.3.0 verify-fingerprint` before `verzly/tauri-release` builds the APK/AAB artifacts.

For sideload self-updates to remain smooth, every stable Android release must keep all of these stable:

```text
same Android application identifier
same release keystore and key alias
same signing certificate SHA-256 fingerprint
higher versionCode than the installed app
APK asset published on the GitHub Release
```

If the stable release key is lost or replaced, Android will not install the new APK over existing installations. Users would need to uninstall the old app first, which also breaks the seamless update path.
