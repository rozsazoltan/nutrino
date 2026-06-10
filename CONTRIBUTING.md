# Contributing

This file contains the development, testing, and release-maintenance notes for Nutrino. The README is intentionally kept user-facing.

- [Development setup](#development-setup)
- [Repository commands](#repository-commands)
- [WIP commits](#wip-commits)
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
hk install
```

The repository uses `hk` directly for Git hooks. `pre-commit` formats JavaScript and Rust files, then runs focused JavaScript, app-domain, i18n, Android bridge, and release workflow checks. `pre-push` runs the same checks plus Rust/Tauri checks and web builds. Re-run `hk install` after changing `hk.pkl`. If an older local hook path is still configured, clear it once with `git config --local --unset-all core.hooksPath`.

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

Run the faster gate that `pre-commit` uses after formatting:

```bash
aube run quality:commit
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
hk run pre-commit
hk run pre-push
hk check
```

When debugging hidden hook output, use:

```bash
hk check -v
HK_LOG=debug hk run pre-commit
```

Run hook formatters manually:

```bash
hk fix
```

`pre-commit` formats changed JavaScript and Rust sources first, then runs separate visible steps for JavaScript linting, Vitest unit tests, app-domain checks, i18n checks, Android bridge checks, and release workflow checks. Each check step depends on the formatter steps, so tests do not race against auto-formatting. `pre-push` runs the same checks plus Rust/Tauri checks and web builds before code is pushed.


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
