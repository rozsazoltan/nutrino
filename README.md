# nutrino

Offline-first nutrition tracker built with Tauri v2 for logging daily meals, calories, macros, activity, BMI, and weight, with desktop/GitHub CSV catalog sync for foods, recipes and activities.

`nutrino` is designed for people who want nutrition tracking without depending on public food databases or online food search. You maintain your own food, recipe, and activity catalog on a desktop server and/or in one or more GitHub CSV repositories. The mobile app syncs available catalog sources on demand or daily and keeps diary data offline on the device.

- [What it is](#what-it-is)
- [How it works](#how-it-works)
  - [Desktop server](#desktop-server)
  - [Mobile app](#mobile-app)
  - [Data model and sync](#data-model-and-sync)
  - [Backup and restore](#backup-and-restore)
- [Privacy](#privacy)
- [Contributing](#contributing)

## What it is

`nutrino` is a two-app nutrition tracking system:

- `nutrino Desktop` manages the local food database, recipes, activity definitions, CSV imports/exports, backups, and the LAN API server.
- `nutrino Mobile` is the daily diary app for Android. It tracks meals, activities, calories, macros, BMI, weight, and goals while staying usable offline.

The desktop app is the catalog source of truth. The mobile app is the personal diary and offline cache. Fresh installs intentionally do not contain preloaded foods or recipes. The desktop app shows the expected CSV header structures inside the import screens, while optional starter CSVs can be published separately from the source archive.

## How it works

```text
Desktop app
  ├─ stores foods, recipes, activities and desktop settings
  ├─ exposes a local LAN API, for example http://192.168.1.202:8090/api/v1
  └─ increases catalog_revision when catalog data changes

Mobile app
  ├─ pulls foods, recipes and activities from the desktop server
  ├─ can also read Nutrino CSV files from one or more GitHub repositories
  ├─ can create foods, recipes, activities, diary entries and kcal notes offline
  ├─ pushes pending local changes when the desktop server is reachable
  ├─ monitors server health and catalog_revision
  └─ continues working when the desktop server is offline
```

The desktop app can protect the LAN API with an optional server password. Leaving the password empty keeps local sync open on your LAN. When a password is configured, the mobile app must use the same password in Profile → API settings.

### Desktop server

- Local food catalog management with optional notes; fresh installs start with an empty food/recipe catalog
- Recipe builder using stable food IDs and optional recipe notes; recipes are imported or created by the user
- Activity catalog management
- CSV import/export for foods, recipes, and activities, with duplicate-skip import mode
- Duplicate suggestion review with selected-item merge and “merge all selected” support
- QR generation for foods, recipes and activities so mobile can import individual catalog items
- ZIP backup/restore with manifest validation
- Local LAN API server for mobile sync
- System tray support
- Optional launch on Windows startup
- Optional start hidden in tray
- Optional auto-start LAN API server

### Mobile app

- Offline-first daily diary
- Home dashboard with today-only calories, supplied/burned values, and macro rings that roll over at midnight
- Meal sections: Activity, Breakfast, Lunch, Dinner, Snack
- Food and recipe picker with shared search, exact-match grouping, barcode/QR scan entry, and notes
- Optional GitHub CSV sources with multiple repos, optional paths and optional token for higher API limits
- Local recipe customization per diary entry
- Activity logging from catalog, watch, or manual kcal input
- Calendar diary with weight, BMI, daily macros, and editable day unlock
- Profile with height, weight, birthday/age, gender, activity level, and weekly goal
- BMI and kcal status coloring
- Hungarian and English UI
- ZIP export/import for complete app data

### Data model and sync

The sync model is local-first and bidirectional for user-created data:

```text
Desktop catalog ↔ Mobile pending local changes
```

The desktop server owns the main catalog and LAN API:

- foods with optional notes, imported from CSV, created manually, or synced from mobile
- recipes with optional notes and recipe ingredients
- activity definitions
- optional LAN API password

The mobile app owns the daily offline experience:

- diary entries, kcal-only notes, activity logs and weight logs
- locally created foods, recipes and activities marked as pending sync
- profile and calculation settings
- app language and local UI settings

When the desktop server is reachable, the mobile app pushes pending local changes and then pulls the current catalog. The desktop `/api/v1/health` endpoint exposes a `catalog_revision` and runtime channel information. The mobile app polls health and pulls fresh catalog data when the revision changes. Automatic offline warnings are shown once until the server becomes reachable again.

### Optional starter catalog CSVs

Fresh desktop databases are intentionally empty for foods and recipes. Nutrino does not silently preload example foods into a new installation.

Use the separate CSV starter files when you want the optional Hungarian catalog:

```text
nutrino-foods-v0.6.14.csv
nutrino-recipes-v0.6.14.csv
```

The CSV starter catalog is intentionally kept outside the monorepo ZIP. The desktop app does not ship sample food or recipe files; it only documents the required CSV structures in-app. Importing CSV rows is an explicit user action from the desktop app.

### Backup and restore

Both apps support full ZIP backup/restore.

Desktop exports use this format:

```text
nutrino-desktop-server-v0.6.14-YYYYMMDD-HHMMSS.zip
```

Mobile exports use this format:

```text
nutrino-mobile-app-v0.6.14-YYYYMMDD-HHMMSS.zip
```

Each backup contains a `manifest.json` with the app name, backup type, version, and export timestamp. Import validates the manifest before allowing overwrite.

After a mobile factory reset, use **Restore backup** on the first-run setup screen to import a previous mobile ZIP backup before creating a new profile. The mobile app also keeps local **Backup Profiles** separately from the normal profile. It creates safety restore points before export, import, backup-profile restore, and factory reset so an in-app reset does not remove the last recoverable state.

On Android, mobile backup export uses the Android Storage Access Framework save picker directly and writes the ZIP through Android's selected document URI. The app reads the selected file back byte-for-byte before reporting success, so a `0 B` file is not treated as a valid export. The older WebView download, share-sheet-only, and Tauri dialog URI-write paths are intentionally avoided for Android backup export because they can produce files that other Android apps see as empty. Mobile import uses the same Android document picker before falling back to non-Android picker paths.

## Acknowledgements

Special thanks to OpenNutriTracker for the privacy-first nutrition tracker inspiration, and to Tauri, Rust, Vue, Vite, TypeScript, JSZip and Lucide for the foundation Nutrino is built on.

## Privacy

`nutrino` is designed to be local-first and privacy-first.

- No public food database is queried.
- No account is required.
- No analytics are collected.
- Mobile diary data stays on the phone.
- Desktop catalog data stays on your machine.
- Sync happens only against your configured desktop LAN API server.

## Contributing

Issues and pull requests are welcome.

- Report bugs: https://github.com/rozsazoltan/nutrino/issues
- Request features: https://github.com/rozsazoltan/nutrino/issues
- Source code: https://github.com/rozsazoltan/nutrino

Please include the app version, platform, and reproduction steps when reporting bugs.

### Requirements

- Node.js
- pnpm
- Rust and Cargo
- Tauri v2 prerequisites
- Android Studio, Android SDK and NDK for Android development
- A physical Android device or emulator for mobile testing

### Get started

Repository layout:
```text
nutrino/
  apps/
    desktop/        Tauri v2 desktop app and LAN API server
    mobile/         Tauri v2 Android-first mobile app
  packages/
    shared/         Shared TypeScript domain types
    ui/             Shared design tokens
  .github/          GitHub Actions and issue templates
```

Install dependencies from the repository root:

```bash
pnpm install
```

Run the desktop app:

```bash
pnpm dev:desktop
```

Initialize the generated Android project once per fresh checkout:

```bash
pnpm init:android
```

Run the mobile app on a connected Android device. Replace the host with your desktop LAN IP:

```bash
pnpm dev:android -- --host 192.168.1.202
```

### Root scripts

The root command palette is intentionally small. `dev:*` means live development, `build:*` means stable packaged output, and `init:*` creates native generated projects when Tauri needs them.

```bash
pnpm dev:desktop      # live desktop development
pnpm dev:android      # live Android development, uses Vite/devUrl
pnpm dev:ios          # live iOS development

pnpm build:desktop    # stable desktop installer/app bundle
pnpm build:android    # stable Android APK, aarch64
pnpm build:ios        # stable iOS build

pnpm init:android     # one-time generated Android project setup
pnpm init:ios         # one-time generated iOS project setup
```

App-local maintenance commands still exist where they are needed, for example Android clean/patch/doctor under `apps/mobile`. Native project initialization is available from the root as `pnpm init:android` and `pnpm init:ios`.

On Windows, the Vite dev servers ignore Rust/Tauri build output directories such as `src-tauri/target` and `src-tauri/gen`, so Cargo-generated `.pdb` files are not watched while they are locked by the compiler.

### Release workflow

The repository has one manual `Release` workflow. Start it from GitHub Actions and provide the version, for example `0.11.12`. The input version must match the root package, desktop package, mobile package, both Tauri configs, and both Rust crates.

The workflow builds release artifacts first and publishes the GitHub Release only after every build job succeeds:

```text
Desktop: Linux, Windows, macOS
Mobile:  Android, plus signed iOS when Apple signing secrets are configured
```

Release builds use the public `verzly/tauri-release` GitHub Action. The generated GitHub Release body uses GitHub's `What's Changed` release notes and compares against the highest previous full `vX.Y.Z` tag, ignoring moving tags such as `latest`, `vX`, and `vX.Y`. After the assets are uploaded, the workflow updates these channel tags:

```text
latest
vX
vX.Y
```

The iOS job is optional. It runs only when all Apple signing secrets are configured:

```text
APPLE_TEAM_ID
IOS_CERTIFICATE_P12_BASE64
IOS_CERTIFICATE_PASSWORD
IOS_PROVISIONING_PROFILE_BASE64
```

When these secrets are missing, the workflow skips the iOS build and still publishes the release with the desktop and Android artifacts. This keeps hobby/open-source releases usable without paying for Apple Developer Program membership, while leaving the signed iOS path ready for later.

### Runtime channels and Android dev flow

Nutrino detects its channel at runtime. Vite/Tauri dev sessions show the Dev channel inside the app. Packaged builds are stable and use the normal `Nutrino` app name.

Use `pnpm dev:android` only for live development. It intentionally uses Tauri's `build.devUrl` and a Vite dev server, so that app expects your desktop dev server to be reachable from the phone. The dev script tracks app version/channel identity and clears stale native, JNI and Gradle artifacts before launching when that identity changes, so version bumps should no longer require manually restarting from a broken Android state.

```bash
pnpm init:android
pnpm dev:android -- --host <your-desktop-lan-ip>
```

For your own stable sideload build, use the root Android build command. It uses the stable package ID `net.datarose.nutrino.mobile`, the stable app name `Nutrino`, and targets `aarch64` for normal modern Android phones. If you have not configured a real keystore yet, the generated Android project is patched to use Android debug signing only as a local sideload fallback.

```bash
pnpm build:android
```

For iOS and desktop, use the same naming pattern:

```bash
pnpm dev:ios
pnpm build:ios

pnpm dev:desktop
pnpm build:desktop
```

If no `src-tauri/gen/android/keystore.properties` exists, Nutrino patches the generated Android project to sign local release APKs with Android's debug signing config so the APK is still a valid sideloadable Android package. Configure a real release keystore before distributing outside your own devices or publishing to a store.

After `tauri android init`, Nutrino's patch step force-copies the canonical Nutrino launcher icon resources into the generated Android project. If Android still shows the Tauri icon, remove the old generated Android project or run:

```bash
cd apps/mobile
pnpm android:patch
# optionally, for a fully clean rebuild
pnpm android:clean
cd ../..
pnpm init:android
```

If an older generated Android project still contains slow Gradle settings from a previous Nutrino version, run:

```bash
cd apps/mobile
pnpm android:patch
# optionally, for a fully clean rebuild
pnpm android:clean
```


### Android Kotlin daemon cache recovery

If Android dev/build logs show Kotlin daemon errors like `this and base files have different roots` on Windows, run a clean + patch cycle. Nutrino disables Kotlin incremental compilation in the generated Android project because Tauri plugin Kotlin sources may live in the Cargo registry on `C:` while the generated Android project lives on another drive such as `D:`. Rust and Gradle parallelism remain enabled.

```bash
cd apps/mobile
pnpm android:clean
pnpm android:patch
cd ../..
pnpm dev:android -- --host <your-desktop-lan-ip>
```

The mobile app intentionally avoids using `tauri.localhost` for LAN API access in development. The desktop LAN IP is used instead.

### Tauri and Android artifact storage

Nutrino keeps heavy Rust and Android cache output out of `src-tauri` where possible. The desktop and mobile Tauri wrappers set Cargo output to `.cache/tauri/cargo-target/<app>` by default, and Android Gradle user cache output to `.cache/tauri/gradle`. The generated Android project still lives under `apps/mobile/src-tauri/gen/android` because Tauri Android requires that native Gradle project, but package outputs are pruned after dev sessions and copied to `apps/mobile/dist/android/<channel>/` after successful stable builds.

Useful maintenance commands:

```bash
pnpm size:android      # show the largest Android/Tauri artifact directories
pnpm prune:android     # remove generated APK/AAB package outputs only
pnpm reset:android     # regenerate the Android native project, preserving Rust cache
```

Set `NUTRINO_ANDROID_KEEP_GENERATED_OUTPUTS=1` when you want to keep the Gradle-generated APK/AAB outputs inside `src-tauri/gen/android/app/build/outputs` for manual inspection. Set `NUTRINO_BUILD_CACHE_DIR` to move the shared Tauri cache somewhere else.


## License

`nutrino` is licensed under **AGPL-3.0-only**.

See [LICENSE](LICENSE) for details.
