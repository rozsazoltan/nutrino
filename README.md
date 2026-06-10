# Nutrino

Nutrino is a local-first nutrition and health diary for Android, iOS, Windows, macOS, and Linux. It helps track meals, activities, fluids, body weight, health notes, barcode-based food catalog entries, backups, and AI-ready exports without depending on a central cloud account.

- [What it is](#what-it-is)
- [Apps](#apps)
- [Features](#features)
- [Get started](#get-started)
  - [Requirements](#requirements)
  - [Install dependencies](#install-dependencies)
  - [Run locally](#run-locally)
  - [Build locally](#build-locally)
- [Testing](#testing)
- [Releases](#releases)
  - [Release tools](#release-tools)
  - [Android signing](#android-signing)
  - [Delete a release](#delete-a-release)
- [Project structure](#project-structure)
- [Privacy model](#privacy-model)
- [Contributing](#contributing)

## What it is

Nutrino is built for personal food and health logging with practical offline-first workflows:

- food, recipe, ingredient, and barcode catalog management;
- meal diary and activity tracking;
- fluid tracking with optional alcohol kcal estimates;
- body weight and health diary entries;
- local backup import/export;
- AI Markdown export with selectable data scope and date range;
- desktop/mobile pairing for trusted local-network handoff requests.

The app idea was inspired by OpenNutriTracker, but Nutrino is its own implementation and release workflow.

## Apps

Nutrino is a monorepo with two Tauri apps:

```text
apps/mobile   -> Android and iOS app
apps/desktop  -> Windows, macOS, and Linux desktop app
```

Shared package folders are reserved for reusable code and UI boundaries:

```text
packages/shared
packages/ui
```

## Features

Daily tracking:

```text
- meals and nutrition totals
- activities and burned kcal
- fluids in dl
- optional alcohol kcal estimates
- body weight
- health diary entries
```

Catalog and scanning:

```text
- ingredients
- foods
- recipes
- barcode scanning
- create a new Food from an unknown barcode
- scan directly into the Food form barcode field
```

Data flows:

```text
- local backup export/import
- backup scope selection
- AI Markdown export
- desktop-to-mobile export requests
- mobile approval before data transfer
- chunked export upload to desktop
```

## Get started

### Requirements

```text
Node.js 24
aube
Rust stable
hk + pkl for Git hooks
mise, recommended
Tauri prerequisites for the target platform
Android SDK + NDK for Android builds
Xcode and Apple signing assets for signed iOS builds
```

### Install dependencies

```bash
mise trust
mise install
aube install
aube run hooks:install
```

### Run locally

Desktop:

```bash
aube run dev:desktop
```

Android:

```bash
aube run init:android
aube run dev:android
```

iOS:

```bash
aube run init:ios
aube run dev:ios
```

### Build locally

```bash
aube run build:desktop
aube run build:android
aube run build:ios
```

Android and iOS builds require the native toolchains to be configured on the host machine.

## Testing

Run the repository checks:

```bash
aube run check
```

Format before committing:

```bash
aube run format
```

Install the local Git hook once per clone:

```bash
aube run hooks:install
```

The pre-commit hook is managed by `hk.pkl`. It runs the JavaScript and Rust formatters through hk before the commit is created.

Run focused checks when iterating locally:

```bash
aube run test:js
aube run test:app
aube run test:rust
aube run check:release-workflows
```

Tooling convention across related projects:

```text
PHP    -> Rector + Pest
JS/TS  -> Oxlint + Oxfmt + Vitest
Rust   -> rustfmt + clippy + cargo test
```

Nutrino currently has no PHP package, so Rector/Pest are not installed here. The active Nutrino gates are JavaScript/TypeScript and Rust/Tauri.

JavaScript quality uses the Oxc stack and Vitest:

```bash
aube run lint:js
aube run format:js:check
aube run test:unit
```

Rust quality uses the standard Cargo toolchain:

```bash
aube run format:rust:check
aube run lint:rust
aube run test:rust:cargo
```

The JavaScript checks cover Oxlint, Oxfmt, Vitest unit tests, workspace tooling, aube catalog usage, and package-manager drift. The app checks cover repository-level invariants that are easy to break during feature work, including fluid tracking domain behavior, i18n completeness, Vue SFC syntax, Android bridge patch expectations, and release workflow wiring. The Rust/Tauri checks keep Cargo package versions, Cargo.lock package entries, Tauri config versions, Android versionCode derivation, important native feature flags, formatting, clippy, and desktop crate tests aligned.

CI runs the same focused gates in `.github/workflows/test.yml`. The workflow installs mise-managed tools, runs the hk formatting hooks first, and then runs the JavaScript, app-domain, i18n, release workflow, and Rust/Tauri checks. The mobile Tauri crate is validated through `cargo metadata` on Linux because it contains mobile-only capabilities; the desktop Tauri crate is checked, linted, and tested with Cargo.

## Releases

Nutrino uses a release branch flow:

```text
github-release prepare
→ release/vX.Y.Z branch
→ version bump commit
→ desktop, Android, and optional iOS builds
→ github-release finalize
→ merge into master
→ tag master HEAD
→ GitHub Release with What's changed notes
→ upload artifacts
→ delete the release branch
```

If a required build fails, the temporary release branch is deleted without merging.

### Release tools

Nutrino release automation is split by responsibility:

```text
verzly/github-release  -> branch, version bump, merge, tag, release, cleanup
verzly/tauri-release   -> Android, iOS, Windows, macOS, Linux build artifacts
verzly/android-signing -> Android release keystore helper
```

The versioned files are configured in:

```text
.github/release/nutrino.github-release.toml
```

The platform build profiles are configured in:

```text
.github/release/nutrino-desktop.tauri-release.toml
.github/release/nutrino-mobile.tauri-release.toml
```

### Android signing

Android self-updates require every release APK to be signed with the same release key. Generate and export the signing material with `android-signing`, then store these values in GitHub Secrets:

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

Do not commit the `.jks` keystore file. Treat it as a private release signing secret.

### Delete a release

Use the manual workflow:

```text
.github/workflows/delete-release.yml
```

It deletes the GitHub Release and the matching `vX.Y.Z` tag after explicit confirmation:

```text
DELETE X.Y.Z
```

The workflow can also delete moving tags such as `latest`, `vX`, and `vX.Y` when requested.

## Project structure

```text
.github/release      release tool configuration
.github/workflows    CI, release, and delete-release workflows
aube-workspace.yaml  JavaScript workspace and dependency catalog
mise.toml            local toolchain dependencies
hk.pkl               pre-commit and format hook configuration
apps/desktop         Tauri desktop app
apps/mobile          Tauri mobile app
packages/shared      shared workspace package
packages/ui          shared UI workspace package
scripts              repository checks and helper scripts
```

## Privacy model

Nutrino is designed around local data ownership. Backups, AI exports, and desktop/mobile handoff requests require explicit user action. Desktop requests do not silently receive mobile data; the mobile app approves, scopes, or rejects each transfer.

## Contributing

Keep changes small and reviewable. For app changes, run:

```bash
aube run check
```

For release workflow changes, verify the relevant workflow and release config files before opening a pull request.

## License

Nutrino is licensed under `AGPL-3.0-only`.
