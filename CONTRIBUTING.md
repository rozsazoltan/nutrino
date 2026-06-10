# Contributing

This file contains the development, testing, and release-maintenance notes for Nutrino. The README is intentionally kept user-facing.

- [Development setup](#development-setup)
- [Repository commands](#repository-commands)
- [Quality gates](#quality-gates)
- [Testing expectations](#testing-expectations)
- [Tooling conventions](#tooling-conventions)
- [Release maintenance](#release-maintenance)

## Development setup

Install the local toolchain through mise and aube:

```bash
mise trust
mise install
aube install
```

Install hooks once per clone:

```bash
aube run hooks:install
```

The hook setup uses `hk` through `mise`, installs a fast `pre-commit` formatter hook, and installs a stricter `pre-push` quality hook. Re-run the install command after changing `hk.pkl` or `scripts/install-hk-hooks.mjs`.

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

Run the full check suite:

```bash
aube run check
```

Run focused gates:

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
aube run pre-commit
aube run pre-push
aube run hooks:check
```

`pre-commit` only formats changed JavaScript and Rust sources. `pre-push` runs the slower JavaScript, app-domain, repository, and Rust quality gates before code is pushed.

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
verzly/github-release  -> release branch, version bump, merge, tag, release, cleanup
verzly/tauri-release   -> Android, iOS, Windows, macOS, Linux artifacts
verzly/android-signing -> Android release keystore helper
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
