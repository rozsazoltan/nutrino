# nutrino

`nutrino` is an offline-first nutrition tracker built with Tauri v2, Vue, TypeScript, Rust and SQLite. It helps you manage your own foods, recipes, activities, meals, calories, macros, BMI and weight without depending on public food databases or online food search.

It is designed for people who want a local-first nutrition workflow:

- **Desktop catalog management** for foods, recipes, activities, imports, exports, backups and the LAN API server
- **Mobile daily tracking** for meals, activities, kcal notes, goals, BMI, weight and offline diary data
- **CSV-based catalog sync** from the desktop server and optional GitHub repositories
- **QR import** for sharing individual foods, recipes and activities between devices
- **ZIP backup and restore** for desktop and mobile data
- **Internationalized UI** across the desktop and mobile apps
- **Unified release workflow** for desktop and mobile artifacts through `verzly/tauri-release`

Fresh installs intentionally start without bundled food or recipe data. Your catalog is your own data, maintained through the desktop app, imported from CSV files, synced from GitHub CSV sources, or created directly on mobile.

- [How it works](#how-it-works)
  - [Desktop app](#desktop-app)
  - [Mobile app](#mobile-app)
  - [Data model and sync](#data-model-and-sync)
  - [Backup and restore](#backup-and-restore)
- [Get started](#get-started)
  - [Requirements](#requirements)
  - [Install dependencies](#install-dependencies)
  - [Run the desktop app](#run-the-desktop-app)
  - [Run the Android app](#run-the-android-app)
- [Usage](#usage)
  - [Root scripts](#root-scripts)
  - [Runtime channels](#runtime-channels)
  - [Android maintenance](#android-maintenance)
  - [Tauri and Android artifact storage](#tauri-and-android-artifact-storage)
- [Release workflow](#release-workflow)
  - [Build matrix](#build-matrix)
  - [Release notes](#release-notes)
  - [Optional iOS signing](#optional-ios-signing)
- [Privacy](#privacy)
- [Contributing](#contributing)

Read on for the app architecture and development workflow. Or jump straight to [Get started](#get-started) for local setup.

## How it works

`nutrino` is a monorepo with two Tauri apps and shared packages:

```text
nutrino/
  apps/
    desktop/        Tauri desktop app, local catalog manager and LAN API server
    mobile/         Tauri mobile app for Android-first daily tracking
  packages/
    shared/         Shared TypeScript domain types
    ui/             Shared design tokens and UI primitives
  scripts/          Repository-level validation and maintenance scripts
  .github/          Release workflow and tauri-release configs
```

The desktop app is the catalog source of truth. The mobile app is the personal diary and offline cache. Sync is explicit and local-first: mobile can pull from the desktop LAN API, read one or more GitHub CSV catalog sources, and keep working when every remote source is unavailable.

```text
Desktop app
  ├─ stores foods, recipes, activities and desktop settings
  ├─ exposes a local LAN API, for example http://192.168.1.202:8090/api/v1
  └─ increases catalog_revision when catalog data changes

Mobile app
  ├─ pulls foods, recipes and activities from the desktop server
  ├─ can read Nutrino CSV files from configured GitHub repositories
  ├─ can create foods, recipes, activities, diary entries and kcal notes offline
  ├─ pushes pending local changes when the desktop server is reachable
  ├─ monitors server health and catalog_revision
  └─ continues working when the desktop server is offline
```

The desktop LAN API can be protected with an optional server password. Leaving the password empty keeps local sync open on your LAN. When a password is configured, the mobile app must use the same password in Profile → API settings.

### Desktop app

The desktop app provides the local catalog and synchronization backend:

- Food, recipe and activity catalog management
- CSV import and export for foods, recipes and activities
- Duplicate-skip import mode and selected-item duplicate merge flows
- QR generation for individual foods, recipes and activities
- ZIP backup and restore with manifest validation
- Local LAN API server for mobile sync
- Optional system tray behavior
- Optional launch on Windows startup
- Optional hidden startup and auto-start server behavior

### Mobile app

The mobile app is the daily offline tracker:

- Today dashboard for supplied calories, burned calories and macro progress
- Meal diary with foods, recipes and manual kcal notes
- Activity diary with kcal burn tracking
- BMI, body weight and goal tracking
- Offline food, recipe and activity creation
- Desktop LAN API sync when the server is reachable
- Optional GitHub CSV catalog sync
- QR scanner import for foods, recipes and activities
- ZIP backup and restore through Android's document picker

Android is the primary mobile release target. iOS support is prepared in the workflow, but signed iOS artifacts are optional because Apple distribution requires signing assets.

### Data model and sync

Catalog data and diary data are intentionally separated.

Foods, recipes and activities are catalog items. They can be created on desktop, imported from CSV, synced from GitHub CSV sources, or created on mobile. Diary entries, kcal notes, weight entries and profile data belong to the local mobile user and remain on the device unless explicitly backed up or synchronized through supported local flows.

Every catalog item has a stable identifier. Localized names can be stored per item. When a selected UI language has no localized name for an item, the app falls back to the original item name.

CSV import/export keeps optional i18n fields available without making them mandatory. This keeps simple catalog maintenance lightweight while still allowing multilingual catalogs.

### Backup and restore

The desktop app can export and restore a ZIP backup of its catalog and settings. The mobile app can export and restore a ZIP backup of profile, diary, goals, local catalog cache and local sync state.

Mobile backup export uses Android's Storage Access Framework save picker and verifies the selected file after writing. A `0 B` file is not treated as a successful backup. Mobile import uses the Android document picker before falling back to non-Android picker paths.

The mobile app also keeps local backup profiles and creates safety restore points before export, import, backup-profile restore and factory reset. After a mobile factory reset, use **Restore backup** on the first-run setup screen before creating a new profile when you want to recover a previous backup.

## Get started

### Requirements

- Node.js 22 or newer
- pnpm 10
- Rust and Cargo
- Tauri v2 prerequisites for your operating system
- Android Studio, Android SDK and Android NDK for Android development
- A physical Android device or emulator for mobile development
- Xcode and Apple signing assets only if you want signed iOS release builds

### Install dependencies

Install JavaScript dependencies from the repository root:

```bash
pnpm install
```

### Run the desktop app

Start the desktop app in development mode:

```bash
pnpm dev:desktop
```

The desktop app can start the LAN API server from the UI. Use your desktop LAN IP when connecting from a phone, for example `http://192.168.1.202:8090/api/v1`.

### Run the Android app

Initialize the generated Android project once per fresh checkout:

```bash
pnpm init:android
```

Run the mobile app on a connected Android device or emulator. Replace the host with your desktop LAN IP:

```bash
pnpm dev:android -- --host 192.168.1.202
```

Use the stable Android build command when you want a local sideloadable APK instead of a live dev session:

```bash
pnpm build:android
```

## Usage

### Root scripts

The root command palette keeps development, release builds and native project initialization separate:

```bash
pnpm dev:desktop      # live desktop development
pnpm dev:android      # live Android development, uses Vite/devUrl
pnpm dev:ios          # live iOS development

pnpm build:desktop    # stable desktop installer/app bundle
pnpm build:android    # stable Android APK, aarch64
pnpm build:ios        # stable iOS build

pnpm init:android     # one-time generated Android project setup
pnpm init:ios         # one-time generated iOS project setup

pnpm check:i18n       # i18n and Vue syntax validation
pnpm size:android     # show largest Android/Tauri artifact directories
pnpm prune:android    # remove generated APK/AAB package outputs only
pnpm reset:android    # regenerate Android native project, preserving Rust cache
```

App-local maintenance commands still exist under `apps/mobile` when Android-specific patching, cleaning or diagnostics are needed.

### Runtime channels

Nutrino detects its runtime channel from the build context. Vite/Tauri development sessions show the Dev channel inside the app. Packaged builds are stable and use the normal `Nutrino` app name.

Use `pnpm dev:android` only for live development. It intentionally uses Tauri's `build.devUrl` and expects the desktop Vite server to be reachable from the phone. The dev script tracks app version/channel identity and clears stale native, JNI and Gradle artifacts before launching when that identity changes.

Stable Android builds use the stable package ID `net.datarose.nutrino.mobile`, the stable app name `Nutrino`, and target `aarch64` for modern Android phones.

### Android maintenance

If Android still shows a stale icon or generated native project state, patch or regenerate the generated Android project:

```bash
cd apps/mobile
pnpm android:patch
pnpm android:clean
cd ../..
pnpm init:android
```

If Android dev/build logs show Kotlin daemon errors such as `this and base files have different roots` on Windows, run a clean + patch cycle:

```bash
cd apps/mobile
pnpm android:clean
pnpm android:patch
cd ../..
pnpm dev:android -- --host <your-desktop-lan-ip>
```

The mobile app intentionally avoids `tauri.localhost` for LAN API access in development. Use the desktop LAN IP instead.

### Tauri and Android artifact storage

Nutrino keeps heavy Rust and Android cache output out of `src-tauri` where possible. The desktop and mobile Tauri wrappers set Cargo output to `.cache/tauri/cargo-target/<app>` by default, and Android Gradle user cache output to `.cache/tauri/gradle`.

The generated Android project still lives under `apps/mobile/src-tauri/gen/android` because Tauri Android requires that native Gradle project. Package outputs are pruned after dev sessions and copied to `apps/mobile/dist/android/<channel>/` after successful stable builds.

Set `NUTRINO_ANDROID_KEEP_GENERATED_OUTPUTS=1` when you want to keep Gradle-generated APK/AAB outputs inside `src-tauri/gen/android/app/build/outputs` for manual inspection. Set `NUTRINO_BUILD_CACHE_DIR` to move the shared Tauri cache somewhere else.

## Release workflow

The repository has one manual `Release` workflow on the `master` branch. Start it from GitHub Actions and provide the version, for example `0.11.18`. The input version may be written with or without a leading `v`, but repository files must use the plain version number.

The workflow validates the root package, shared packages, desktop package, mobile package, both Tauri configs, both Rust crates and the Android `versionCode` before any release build starts. It resolves the selected ref to a commit SHA first, so all platform jobs build the same commit even if `master` moves while the workflow is running.

Builds use the public `verzly/tauri-release@latest` GitHub Action. Release artifacts are built first. The GitHub Release is created only after every required build succeeds. Desktop package names use the plain `Nutrino` product name so generated installer and bundle filenames do not contain spaces. Release uploads use short asset names such as `nutrino-desktop-windows-0.11.18.exe`, `nutrino-desktop-macos-0.11.18.dmg`, and `nutrino-mobile-android-0.11.18.apk`.

### Build matrix

```text
Desktop: Linux, Windows, macOS
Mobile:  Android APK/AAB
Optional: signed iOS when Apple signing secrets are configured
```

Desktop jobs run on their native GitHub-hosted runners. Android runs on Ubuntu with the Android SDK/NDK installed by the workflow. iOS runs on macOS only when signing secrets are available.

Nutrino does not create tool-style moving tags such as `latest`, `vX` or `vX.Y`. The workflow creates or updates only the normal release tag:

```text
vX.Y.Z
```

### Release notes

The release body is generated with GitHub's `What's Changed` release notes. The comparison base is resolved from the highest previous full `vX.Y.Z` tag lower than the new version. Moving or partial tags are ignored.

The workflow stages release artifacts and checksum files, creates a draft GitHub Release, uploads the assets, then publishes the release. This avoids showing a visible release before downloadable files are ready.

### Optional iOS signing

The iOS job runs only when all Apple signing secrets are configured:

```text
APPLE_TEAM_ID
IOS_CERTIFICATE_P12_BASE64
IOS_CERTIFICATE_PASSWORD
IOS_PROVISIONING_PROFILE_BASE64
```

When these secrets are missing, the workflow skips the iOS build and still publishes the release with desktop and Android artifacts. This keeps hobby/open-source releases usable without Apple Developer Program membership, while leaving the signed iOS path ready for later.

## Privacy

`nutrino` is designed to be local-first and privacy-first.

- No public food database is queried
- No account is required
- No analytics are collected
- Mobile diary data stays on the phone
- Desktop catalog data stays on your machine
- Sync happens only against your configured desktop LAN API server and optional GitHub CSV sources

## Contributing

Issues and pull requests are welcome.

- Report bugs: https://github.com/rozsazoltan/nutrino/issues
- Request features: https://github.com/rozsazoltan/nutrino/issues
- Source code: https://github.com/rozsazoltan/nutrino

Please include the app version, platform, expected behavior, actual behavior and reproduction steps when reporting bugs.

## Acknowledgements

Special thanks to OpenNutriTracker for the privacy-first nutrition tracker inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.

## License

`nutrino` is licensed under **AGPL-3.0-only**.

See [LICENSE](LICENSE) for details.
